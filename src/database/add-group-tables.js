const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function createGroupTables() {
    const client = await pool.connect();

    try {
        console.log('Connecting to Aiven database...');
        console.log('Creating study group tables...\n');

        // Study Groups table
        await client.query(`
            CREATE TABLE IF NOT EXISTS study_groups (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(100) NOT NULL,
                description TEXT,
                invite_code VARCHAR(8) UNIQUE NOT NULL,
                created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ study_groups table created');

        // Group Members table
        await client.query(`
            CREATE TABLE IF NOT EXISTS group_members (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                group_id UUID NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                role VARCHAR(10) DEFAULT 'member' CHECK (role IN ('admin', 'member')),
                joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(group_id, user_id)
            )
        `);
        console.log('✓ group_members table created');

        // Group Shared Items table
        await client.query(`
            CREATE TABLE IF NOT EXISTS group_shared_items (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                group_id UUID NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                item_type VARCHAR(20) NOT NULL CHECK (item_type IN ('note', 'flashcard_set', 'material')),
                item_id UUID NOT NULL,
                shared_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ group_shared_items table created');

        // Group Messages table
        await client.query(`
            CREATE TABLE IF NOT EXISTS group_messages (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                group_id UUID NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                message TEXT NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ group_messages table created');

        // Indexes
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_study_groups_created_by ON study_groups(created_by);
            CREATE INDEX IF NOT EXISTS idx_study_groups_invite_code ON study_groups(invite_code);
            CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
            CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
            CREATE INDEX IF NOT EXISTS idx_group_shared_items_group ON group_shared_items(group_id);
            CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id);
            CREATE INDEX IF NOT EXISTS idx_group_messages_created ON group_messages(created_at DESC);
        `);
        console.log('✓ All indexes created');

        console.log('\n✅ All study group tables created successfully!');

    } catch (error) {
        console.error('❌ Error creating tables:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

createGroupTables();
