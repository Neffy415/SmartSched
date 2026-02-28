require('dotenv').config();
const { pool } = require('../config/database');

const initSQL = `
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =================================================
-- USERS TABLE
-- =================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    avatar_url VARCHAR(500),
    daily_study_hours DECIMAL(3,1) DEFAULT 4.0,
    preferred_study_time VARCHAR(20) DEFAULT 'morning',
    timezone VARCHAR(50) DEFAULT 'Asia/Kolkata',
    is_active BOOLEAN DEFAULT true,
    email_verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- =============================================
-- SUBJECTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS subjects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    color VARCHAR(7) DEFAULT '#6366f1',
    exam_date DATE,
    priority_level INTEGER DEFAULT 3 CHECK (priority_level >= 1 AND priority_level <= 5),
    is_archived BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subjects_user ON subjects(user_id);
CREATE INDEX IF NOT EXISTS idx_subjects_exam ON subjects(exam_date);

-- =============================================
-- TOPICS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS topics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    difficulty VARCHAR(10) DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
    importance INTEGER DEFAULT 3 CHECK (importance >= 1 AND importance <= 5),
    estimated_hours DECIMAL(4,1) DEFAULT 1.0,
    is_completed BOOLEAN DEFAULT false,
    completed_at TIMESTAMP,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_topics_subject ON topics(subject_id);

-- =============================================
-- TASKS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    task_type VARCHAR(20) DEFAULT 'study' CHECK (task_type IN ('study', 'revision', 'practice', 'assignment')),
    scheduled_date DATE,
    deadline DATE,
    estimated_minutes INTEGER DEFAULT 30,
    actual_minutes INTEGER DEFAULT 0,
    priority INTEGER DEFAULT 3 CHECK (priority >= 1 AND priority <= 5),
    priority_score DECIMAL(6,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped', 'overdue')),
    is_recurring BOOLEAN DEFAULT false,
    recurrence_pattern VARCHAR(20),
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_topic ON tasks(topic_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);

-- =============================================
-- STUDY SESSIONS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS study_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,
    planned_minutes INTEGER,
    actual_minutes INTEGER,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    quality_rating INTEGER CHECK (quality_rating >= 1 AND quality_rating <= 5),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON study_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_task ON study_sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON study_sessions(status);

-- =============================================
-- PROGRESS LOGS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS progress_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
    session_id UUID REFERENCES study_sessions(id) ON DELETE SET NULL,
    completion_percentage INTEGER DEFAULT 0 CHECK (completion_percentage >= 0 AND completion_percentage <= 100),
    confidence_level INTEGER DEFAULT 3 CHECK (confidence_level >= 1 AND confidence_level <= 5),
    difficulty_feedback VARCHAR(10) CHECK (difficulty_feedback IN ('easy', 'medium', 'hard')),
    notes TEXT,
    logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_progress_user ON progress_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_progress_date ON progress_logs(logged_at);

-- =============================================
-- WEEKLY ANALYTICS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS weekly_analytics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_start_date DATE NOT NULL,
    week_end_date DATE NOT NULL,
    total_planned_minutes INTEGER DEFAULT 0,
    total_completed_minutes INTEGER DEFAULT 0,
    tasks_planned INTEGER DEFAULT 0,
    tasks_completed INTEGER DEFAULT 0,
    tasks_skipped INTEGER DEFAULT 0,
    sessions_count INTEGER DEFAULT 0,
    avg_session_length INTEGER DEFAULT 0,
    consistency_score DECIMAL(5,2) DEFAULT 0,
    efficiency_score DECIMAL(5,2) DEFAULT 0,
    streak_days INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, week_start_date)
);

CREATE INDEX IF NOT EXISTS idx_analytics_user ON weekly_analytics(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_week ON weekly_analytics(week_start_date);

-- =============================================
-- DAILY STATS TABLE (for quick dashboard access)
-- =============================================
CREATE TABLE IF NOT EXISTS daily_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stat_date DATE NOT NULL,
    study_minutes INTEGER DEFAULT 0,
    tasks_completed INTEGER DEFAULT 0,
    tasks_planned INTEGER DEFAULT 0,
    sessions_count INTEGER DEFAULT 0,
    streak_maintained BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, stat_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_user ON daily_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_stats(stat_date);

-- =============================================
-- NOTIFICATIONS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL,
    title VARCHAR(200) NOT NULL,
    message TEXT,
    link VARCHAR(500),
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read);

-- =============================================
-- REMINDERS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS reminders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    remind_at TIMESTAMP NOT NULL,
    reminder_type VARCHAR(30) DEFAULT 'custom' CHECK (reminder_type IN ('task_deadline', 'study_session', 'exam', 'custom')),
    is_triggered BOOLEAN DEFAULT false,
    is_dismissed BOOLEAN DEFAULT false,
    repeat_type VARCHAR(20) DEFAULT 'none' CHECK (repeat_type IN ('none', 'daily', 'weekly', 'monthly')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_time ON reminders(remind_at);
CREATE INDEX IF NOT EXISTS idx_reminders_pending ON reminders(user_id, is_triggered, is_dismissed);

-- =============================================
-- AI INTERACTIONS TABLE (Phase 4)
-- =============================================
CREATE TABLE IF NOT EXISTS ai_interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
    subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
    interaction_type VARCHAR(30) NOT NULL CHECK (interaction_type IN ('explanation', 'notes', 'questions', 'answer', 'analysis', 'summary', 'study_plan')),
    prompt TEXT,
    response JSONB NOT NULL,
    tokens_used INTEGER DEFAULT 0,
    response_time_ms INTEGER DEFAULT 0,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    is_bookmarked BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_interactions_user ON ai_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_interactions_topic ON ai_interactions(topic_id);
CREATE INDEX IF NOT EXISTS idx_ai_interactions_type ON ai_interactions(interaction_type);
CREATE INDEX IF NOT EXISTS idx_ai_interactions_bookmarked ON ai_interactions(user_id, is_bookmarked);

-- =============================================
-- USER FILES TABLE (Phase 4 - Materials)
-- =============================================
CREATE TABLE IF NOT EXISTS user_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_type VARCHAR(50) NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type VARCHAR(100),
    extracted_text TEXT,
    is_processed BOOLEAN DEFAULT false,
    processing_error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_files_user ON user_files(user_id);
CREATE INDEX IF NOT EXISTS idx_user_files_subject ON user_files(subject_id);

-- =============================================
-- FILE TOPICS JUNCTION TABLE (Phase 4)
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
-- AI GENERATED CONTENT TABLE (Phase 4)
-- =============================================
CREATE TABLE IF NOT EXISTS ai_generated_content (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
    content_type VARCHAR(30) NOT NULL CHECK (content_type IN ('notes', 'flashcards', 'summary', 'questions')),
    title VARCHAR(200),
    content JSONB NOT NULL,
    is_favorite BOOLEAN DEFAULT false,
    view_count INTEGER DEFAULT 0,
    last_viewed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_content_user ON ai_generated_content(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_content_topic ON ai_generated_content(topic_id);
CREATE INDEX IF NOT EXISTS idx_ai_content_type ON ai_generated_content(content_type);

-- =============================================
-- FUNCTION: Update updated_at timestamp
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to all tables with updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_subjects_updated_at ON subjects;
CREATE TRIGGER update_subjects_updated_at BEFORE UPDATE ON subjects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_topics_updated_at ON topics;
CREATE TRIGGER update_topics_updated_at BEFORE UPDATE ON topics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_analytics_updated_at ON weekly_analytics;
CREATE TRIGGER update_analytics_updated_at BEFORE UPDATE ON weekly_analytics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_daily_stats_updated_at ON daily_stats;
CREATE TRIGGER update_daily_stats_updated_at BEFORE UPDATE ON daily_stats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_files_updated_at ON user_files;
CREATE TRIGGER update_user_files_updated_at BEFORE UPDATE ON user_files
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ai_content_updated_at ON ai_generated_content;
CREATE TRIGGER update_ai_content_updated_at BEFORE UPDATE ON ai_generated_content
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- FUNCTION: Calculate Task Priority Score
-- =============================================
CREATE OR REPLACE FUNCTION calculate_priority_score(
    p_importance INTEGER,
    p_difficulty VARCHAR(10),
    p_deadline DATE,
    p_priority INTEGER
) RETURNS DECIMAL AS $$
DECLARE
    difficulty_weight DECIMAL;
    days_remaining INTEGER;
    urgency_score DECIMAL;
BEGIN
    -- Convert difficulty to weight
    difficulty_weight := CASE p_difficulty
        WHEN 'easy' THEN 1
        WHEN 'medium' THEN 2
        WHEN 'hard' THEN 3
        ELSE 2
    END;
    
    -- Calculate days remaining
    days_remaining := GREATEST(1, p_deadline - CURRENT_DATE);
    
    -- Calculate urgency (higher when deadline is closer)
    urgency_score := LEAST(10, 30.0 / days_remaining);
    
    -- Final priority score
    RETURN (p_importance * 3) + (difficulty_weight * 2) + urgency_score + (p_priority * 1.5);
END;
$$ LANGUAGE plpgsql;

SELECT 'Database initialized successfully!' as status;
`;

async function initDatabase() {
    console.log('🚀 Initializing SmartSched database...\n');
    
    try {
        // Drop existing tables in reverse order of dependencies
        console.log('🗑️  Dropping existing tables...');
        await pool.query(`
            DROP TABLE IF EXISTS notifications CASCADE;
            DROP TABLE IF EXISTS daily_stats CASCADE;
            DROP TABLE IF EXISTS weekly_analytics CASCADE;
            DROP TABLE IF EXISTS progress_logs CASCADE;
            DROP TABLE IF EXISTS study_sessions CASCADE;
            DROP TABLE IF EXISTS tasks CASCADE;
            DROP TABLE IF EXISTS topics CASCADE;
            DROP TABLE IF EXISTS subjects CASCADE;
        `);
        console.log('✅ Existing tables dropped');
        
        // Run initialization SQL
        console.log('📝 Creating tables...');
        await pool.query(initSQL);
        console.log('✅ All tables created successfully');
        console.log('\n🎉 Database initialization complete!\n');
    } catch (error) {
        console.error('❌ Database initialization failed:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

initDatabase();
