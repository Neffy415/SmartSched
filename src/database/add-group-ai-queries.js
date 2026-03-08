/**
 * Add Group AI Queries table
 * Stores AI questions and responses shared within study groups
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.AIVEN_DATABASE_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function addGroupAIQueries() {
    const client = await pool.connect();
    try {
        console.log('Creating group_ai_queries table...');

        await client.query(`
            CREATE TABLE IF NOT EXISTS group_ai_queries (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                group_id UUID NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                question TEXT NOT NULL,
                response TEXT NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_group_ai_queries_group ON group_ai_queries(group_id);
            CREATE INDEX IF NOT EXISTS idx_group_ai_queries_created ON group_ai_queries(group_id, created_at DESC);
        `);

        console.log('✅ group_ai_queries table created successfully');
    } catch (error) {
        console.error('❌ Error creating table:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

addGroupAIQueries();
