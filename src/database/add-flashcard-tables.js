const { pool } = require('../config/database');

async function addFlashcardTables() {
    const client = await pool.connect();
    
    try {
        console.log('Creating flashcard tables...');

        // Flashcard Sets table
        await client.query(`
            CREATE TABLE IF NOT EXISTS flashcard_sets (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
                topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                card_count INTEGER DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ flashcard_sets table created');

        // Flashcards table
        await client.query(`
            CREATE TABLE IF NOT EXISTS flashcards (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                set_id UUID NOT NULL REFERENCES flashcard_sets(id) ON DELETE CASCADE,
                front_text TEXT NOT NULL,
                back_text TEXT NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ flashcards table created');

        // Flashcard Progress table (for spaced repetition)
        await client.query(`
            CREATE TABLE IF NOT EXISTS flashcard_progress (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                card_id UUID NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                last_reviewed TIMESTAMP WITH TIME ZONE,
                next_review TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                ease_factor DECIMAL(3,2) DEFAULT 2.50,
                interval_days INTEGER DEFAULT 1,
                repetitions INTEGER DEFAULT 0,
                correct_count INTEGER DEFAULT 0,
                wrong_count INTEGER DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(card_id, user_id)
            )
        `);
        console.log('✓ flashcard_progress table created');

        // Practice Quizzes table
        await client.query(`
            CREATE TABLE IF NOT EXISTS practice_quizzes (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
                topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
                title VARCHAR(255) NOT NULL,
                question_count INTEGER DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ practice_quizzes table created');

        // Quiz Questions table
        await client.query(`
            CREATE TABLE IF NOT EXISTS quiz_questions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                quiz_id UUID NOT NULL REFERENCES practice_quizzes(id) ON DELETE CASCADE,
                question_text TEXT NOT NULL,
                option_a TEXT NOT NULL,
                option_b TEXT NOT NULL,
                option_c TEXT NOT NULL,
                option_d TEXT NOT NULL,
                correct_option CHAR(1) NOT NULL CHECK (correct_option IN ('A', 'B', 'C', 'D')),
                explanation TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ quiz_questions table created');

        // Practice Attempts table
        await client.query(`
            CREATE TABLE IF NOT EXISTS practice_attempts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                quiz_id UUID NOT NULL REFERENCES practice_quizzes(id) ON DELETE CASCADE,
                score INTEGER NOT NULL,
                total_questions INTEGER NOT NULL,
                percentage DECIMAL(5,2) NOT NULL,
                time_taken_seconds INTEGER,
                answers JSONB,
                completed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ practice_attempts table created');

        // Create indexes for performance
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_flashcard_sets_user ON flashcard_sets(user_id);
            CREATE INDEX IF NOT EXISTS idx_flashcard_sets_topic ON flashcard_sets(topic_id);
            CREATE INDEX IF NOT EXISTS idx_flashcards_set ON flashcards(set_id);
            CREATE INDEX IF NOT EXISTS idx_flashcard_progress_user ON flashcard_progress(user_id);
            CREATE INDEX IF NOT EXISTS idx_flashcard_progress_next_review ON flashcard_progress(next_review);
            CREATE INDEX IF NOT EXISTS idx_practice_quizzes_user ON practice_quizzes(user_id);
            CREATE INDEX IF NOT EXISTS idx_practice_attempts_user ON practice_attempts(user_id);
        `);
        console.log('✓ Indexes created');

        console.log('\n✅ All flashcard tables created successfully!');

    } catch (error) {
        console.error('Error creating flashcard tables:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Run if called directly
if (require.main === module) {
    addFlashcardTables()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = { addFlashcardTables };
