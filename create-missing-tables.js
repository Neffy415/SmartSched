// Bypass SSL check for Aiven database
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { Pool } = require('pg');

// Use environment variable for connection string
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.error('❌ DATABASE_URL environment variable not set');
    process.exit(1);
}

const pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false }
});

async function createMissingTables() {
    try {
        console.log('🔌 Connecting to database...');
        const client = await pool.connect();

        // Create concept_graphs table
        console.log('📊 Creating concept_graphs table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS concept_graphs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
                title VARCHAR(255),
                description TEXT,
                graph_data JSONB NOT NULL,
                is_favorite BOOLEAN DEFAULT false,
                view_count INTEGER DEFAULT 0,
                last_viewed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ concept_graphs table created');

        // Create indexes for concept_graphs
        console.log('🔧 Creating indexes for concept_graphs...');
        try {
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_concept_graphs_user_id ON concept_graphs(user_id)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_concept_graphs_subject_id ON concept_graphs(subject_id)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_concept_graphs_favorite ON concept_graphs(user_id, is_favorite)
            `);
            console.log('✅ concept_graphs indexes created');
        } catch (indexErr) {
            console.log('⚠️  Index creation skipped (may already exist or table schema differs)');
        }

        // Add source column to saved_notes
        console.log('📝 Adding source column to saved_notes...');
        await client.query(`
            ALTER TABLE saved_notes
            ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'manual'
        `);
        console.log('✅ source column added to saved_notes');

        // Create index on source column
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_saved_notes_source ON saved_notes(source)
        `);
        console.log('✅ saved_notes source index created');

        console.log('\n✅ All missing tables and columns have been created!');
        console.log('🎉 Your concept graph and quick-note features should now work!');

        client.release();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

createMissingTables();
