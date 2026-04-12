require('dotenv').config();
const { pool } = require('../config/database');

const conceptGraphsSQL = `
-- =============================================
-- CONCEPT GRAPHS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS concept_graphs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    graph_data JSONB NOT NULL,
    is_favorite BOOLEAN DEFAULT false,
    view_count INTEGER DEFAULT 0,
    last_viewed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_concept_graphs_user ON concept_graphs(user_id);
CREATE INDEX IF NOT EXISTS idx_concept_graphs_subject ON concept_graphs(subject_id);
CREATE INDEX IF NOT EXISTS idx_concept_graphs_favorite ON concept_graphs(user_id, is_favorite);
`;

async function addConceptGraphsTables() {
    console.log('🚀 Adding Concept Graphs table to SmartSched database...\n');
    
    try {
        await pool.query(conceptGraphsSQL);
        console.log('✅ Concept Graphs table created successfully!');
        console.log('   - concept_graphs');
        console.log('   - Indexes created for performance optimization');
        console.log('\n🎉 Done!\n');
    } catch (error) {
        console.error('❌ Failed to create Concept Graphs table:', error.message);
    } finally {
        await pool.end();
    }
}

addConceptGraphsTables();
