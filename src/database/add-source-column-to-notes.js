// FORCE SSL VALIDATION BYPASS FOR THIS SCRIPT
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { pool } = require('../config/database');

async function addSourceColumn() {
    try {
        // Add source column to saved_notes table
        await pool.query(`
            ALTER TABLE saved_notes
            ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'manual'
        `);
        console.log('✅ source column added to saved_notes table');

        // Create index on source for query performance
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_saved_notes_source ON saved_notes(source)
        `);
        console.log('✅ Index created on source column');

        console.log('✅ Migration complete!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error adding source column:', error);
        process.exit(1);
    }
}

addSourceColumn();
