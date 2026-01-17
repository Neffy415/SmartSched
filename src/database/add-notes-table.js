const pool = require('../config/database');

async function addNotesTable() {
    try {
        // Create saved_notes table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS saved_notes (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                note_type VARCHAR(50) DEFAULT 'notes',
                subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
                topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
                ai_interaction_id UUID REFERENCES ai_interactions(id) ON DELETE SET NULL,
                is_favorite BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ saved_notes table created');

        // Create indexes for better query performance
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_saved_notes_user_id ON saved_notes(user_id);
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_saved_notes_subject_id ON saved_notes(subject_id);
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_saved_notes_note_type ON saved_notes(note_type);
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_saved_notes_created_at ON saved_notes(created_at DESC);
        `);
        console.log('✅ Indexes created for saved_notes');

        console.log('✅ Notes table setup complete!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error creating notes table:', error);
        process.exit(1);
    }
}

addNotesTable();
