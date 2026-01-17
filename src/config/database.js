const { Pool } = require('pg');

// Check if we're in production (Render) or development (local)
const isProduction = process.env.NODE_ENV === 'production';

// Database connection config
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'smartsched',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
    // SSL is REQUIRED for cloud databases (Render, Aiven, etc.)
    ssl: isProduction ? { rejectUnauthorized: false } : false
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
