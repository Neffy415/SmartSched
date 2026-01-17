const { Pool } = require('pg');

// Check if full DATABASE_URL is provided (common in cloud deployments)
const databaseUrl = process.env.DATABASE_URL;

// Database connection config
const pool = databaseUrl 
    ? new Pool({
        connectionString: databaseUrl,
        ssl: {
            rejectUnauthorized: false
        }
    })
    : new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'smartsched',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'password',
        ssl: (process.env.DB_HOST && process.env.DB_HOST !== 'localhost') ? {
            rejectUnauthorized: false
        } : false
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
