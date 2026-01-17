require('dotenv').config();
const db = require('../config/database');

const aiTablesSQL = `
-- =============================================
-- AI INTERACTIONS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS ai_interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
    subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
    interaction_type VARCHAR(50) NOT NULL,
    prompt TEXT NOT NULL,
    response JSONB,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    is_bookmarked BOOLEAN DEFAULT false,
    tokens_used INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_interactions_user ON ai_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_interactions_type ON ai_interactions(interaction_type);
CREATE INDEX IF NOT EXISTS idx_ai_interactions_bookmarked ON ai_interactions(is_bookmarked) WHERE is_bookmarked = true;

-- =============================================
-- USER FILES TABLE (for uploaded materials)
-- =============================================
CREATE TABLE IF NOT EXISTS user_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
    original_filename VARCHAR(255) NOT NULL,
    stored_filename VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type VARCHAR(100),
    description TEXT,
    extracted_text TEXT,
    ai_analysis JSONB,
    ai_summary JSONB,
    is_processed BOOLEAN DEFAULT false,
    processing_error TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_files_user ON user_files(user_id);
CREATE INDEX IF NOT EXISTS idx_user_files_subject ON user_files(subject_id);

-- =============================================
-- FILE-TOPIC JUNCTION TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS file_topics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_id UUID NOT NULL REFERENCES user_files(id) ON DELETE CASCADE,
    topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    relevance_score DECIMAL(3,2) DEFAULT 1.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(file_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_file_topics_file ON file_topics(file_id);
CREATE INDEX IF NOT EXISTS idx_file_topics_topic ON file_topics(topic_id);

-- =============================================
-- AI GENERATED CONTENT TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS ai_generated_content (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
    content_type VARCHAR(50) NOT NULL,
    title VARCHAR(255),
    content JSONB NOT NULL,
    is_favorite BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_content_user ON ai_generated_content(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_content_topic ON ai_generated_content(topic_id);
CREATE INDEX IF NOT EXISTS idx_ai_content_type ON ai_generated_content(content_type);
`;

async function addAITables() {
    console.log('🚀 Adding AI tables to SmartSched database...\n');
    
    try {
        await db.query(aiTablesSQL);
        console.log('✅ AI tables created successfully!');
        console.log('   - ai_interactions');
        console.log('   - user_files');
        console.log('   - file_topics');
        console.log('   - ai_generated_content');
        console.log('\n🎉 Done!\n');
    } catch (error) {
        console.error('❌ Failed to create AI tables:', error.message);
    } finally {
        await db.pool.end();
    }
}

addAITables();
