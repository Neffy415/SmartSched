const { Pool } = require('pg');

// FAILSAFE: Disable certificate validation globally
// This is required for some cloud databases (like Aiven) that use self-signed certs
if (process.env.NODE_ENV === 'production' || process.env.DB_HOST) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

// Check if full DATABASE_URL is provided
const databaseUrl = process.env.DATABASE_URL;

// Database connection config
const pool = databaseUrl 
    ? new Pool({
        connectionString: databaseUrl,
        ssl: true // Let global setting handle verification
    })
    : new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || 'smartsched',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'password',
        ssl: (process.env.DB_HOST && process.env.DB_HOST !== 'localhost')
    });

// Test database connection
pool.on('connect', () => {
    console.log('📦 Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('❌ Database connection error:', err.message);
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool
};
