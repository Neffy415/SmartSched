/**
 * Migration: Change remind_at from TIMESTAMP to TIMESTAMPTZ
 * 
 * The column was TIMESTAMP (without timezone), which caused timezone-dependent
 * storage when using AT TIME ZONE conversions. TIMESTAMPTZ stores UTC internally
 * regardless of session timezone, fixing the issue.
 * 
 * Run: node src/database/fix-remind-at-timezone.js
 */

const { pool } = require('../config/database');

async function migrate() {
    try {
        console.log('Altering remind_at column to TIMESTAMPTZ...');
        
        // Convert existing values: they were stored in server session timezone (Asia/Singapore)
        // so we use USING to reinterpret them correctly during the type change
        await pool.query(`
            ALTER TABLE reminders 
            ALTER COLUMN remind_at TYPE TIMESTAMPTZ 
            USING remind_at AT TIME ZONE 'Asia/Singapore'
        `);
        
        // Clear any test reminders that may have wrong times
        await pool.query(`
            UPDATE reminders SET is_triggered = false 
            WHERE is_triggered = true AND is_dismissed = false
        `);
        
        console.log('✅ remind_at column changed to TIMESTAMPTZ successfully');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error.message);
        process.exit(1);
    }
}

migrate();
