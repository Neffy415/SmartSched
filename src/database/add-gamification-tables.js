/**
 * Add Gamification Tables: XP log, achievements, user_achievements
 * Run: node src/database/add-gamification-tables.js
 */
const { pool } = require('../config/database');

async function createGamificationTables() {
    try {
        console.log('Creating gamification tables...');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS xp_log (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                amount INTEGER NOT NULL,
                source VARCHAR(50) NOT NULL,
                source_id UUID,
                description TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_xp_log_user ON xp_log(user_id);
            CREATE INDEX IF NOT EXISTS idx_xp_log_created ON xp_log(user_id, created_at);

            CREATE TABLE IF NOT EXISTS achievements (
                id VARCHAR(60) PRIMARY KEY,
                name VARCHAR(120) NOT NULL,
                description TEXT NOT NULL,
                icon VARCHAR(40) NOT NULL,
                category VARCHAR(30) NOT NULL,
                xp_reward INTEGER NOT NULL DEFAULT 0,
                requirement_value INTEGER NOT NULL DEFAULT 1,
                sort_order INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS user_achievements (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                achievement_id VARCHAR(60) NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
                unlocked_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(user_id, achievement_id)
            );

            CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id);
        `);

        // Seed achievements
        const achievements = [
            // Study streaks
            ['streak_3', 'On Fire', '3-day study streak', 'flame', 'streak', 50, 3, 10],
            ['streak_7', 'Week Warrior', '7-day study streak', 'flame', 'streak', 150, 7, 11],
            ['streak_14', 'Fortnight Focus', '14-day study streak', 'flame', 'streak', 300, 14, 12],
            ['streak_30', 'Monthly Master', '30-day study streak', 'flame', 'streak', 750, 30, 13],

            // Study time
            ['study_1h', 'First Hour', 'Study for 1 total hour', 'clock', 'study', 25, 60, 20],
            ['study_10h', 'Dedicated Learner', 'Study for 10 total hours', 'clock', 'study', 100, 600, 21],
            ['study_50h', 'Scholar', 'Study for 50 total hours', 'clock', 'study', 400, 3000, 22],
            ['study_100h', 'Academic Hero', 'Study for 100 total hours', 'clock', 'study', 1000, 6000, 23],

            // Sessions
            ['session_1', 'Getting Started', 'Complete your first study session', 'play-circle', 'session', 20, 1, 30],
            ['session_10', 'Regular Student', 'Complete 10 study sessions', 'play-circle', 'session', 75, 10, 31],
            ['session_50', 'Study Machine', 'Complete 50 study sessions', 'play-circle', 'session', 250, 50, 32],
            ['session_100', 'Centurion', 'Complete 100 study sessions', 'play-circle', 'session', 500, 100, 33],

            // Flashcards
            ['fc_review_10', 'Card Flipper', 'Review 10 flashcards', 'layers', 'flashcard', 30, 10, 40],
            ['fc_review_100', 'Memory Builder', 'Review 100 flashcards', 'layers', 'flashcard', 150, 100, 41],
            ['fc_review_500', 'Flash Master', 'Review 500 flashcards', 'layers', 'flashcard', 500, 500, 42],

            // Quizzes
            ['quiz_1', 'Quiz Taker', 'Complete your first quiz', 'brain', 'quiz', 25, 1, 50],
            ['quiz_10', 'Quiz Enthusiast', 'Complete 10 quizzes', 'brain', 'quiz', 100, 10, 51],
            ['quiz_perfect', 'Perfect Score', 'Score 100% on a quiz', 'trophy', 'quiz', 200, 100, 52],
            ['quiz_ace', 'Quiz Ace', 'Score 90%+ on 5 quizzes', 'award', 'quiz', 300, 5, 53],

            // Tasks
            ['task_1', 'Task Starter', 'Complete your first task', 'check-square', 'task', 15, 1, 60],
            ['task_25', 'Task Crusher', 'Complete 25 tasks', 'check-square', 'task', 100, 25, 61],
            ['task_100', 'Productivity King', 'Complete 100 tasks', 'check-square', 'task', 400, 100, 62],

            // Subjects
            ['subject_complete', 'Subject Mastery', 'Complete all topics in a subject', 'book-open', 'subject', 500, 1, 70],

            // Social
            ['group_create', 'Team Builder', 'Create a study group', 'users', 'social', 50, 1, 80],
            ['group_share', 'Knowledge Sharer', 'Share 5 items in a group', 'share-2', 'social', 75, 5, 81],

            // Level milestones
            ['level_5', 'Rising Scholar', 'Reach Level 5', 'star', 'level', 100, 5, 90],
            ['level_10', 'Dedicated Scholar', 'Reach Level 10', 'star', 'level', 250, 10, 91],
            ['level_25', 'Master Scholar', 'Reach Level 25', 'crown', 'level', 750, 25, 92],
        ];

        for (const [id, name, desc, icon, cat, xp, req_val, sort] of achievements) {
            await pool.query(`
                INSERT INTO achievements (id, name, description, icon, category, xp_reward, requirement_value, sort_order)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (id) DO UPDATE SET name=$2, description=$3, icon=$4, category=$5, xp_reward=$6, requirement_value=$7, sort_order=$8
            `, [id, name, desc, icon, cat, xp, req_val, sort]);
        }

        console.log('✅ Gamification tables created and achievements seeded');
        process.exit(0);
    } catch (error) {
        console.error('Failed:', error.message);
        process.exit(1);
    }
}

createGamificationTables();
