const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Global search API endpoint - Fixed SQL queries for proper joins
// Middleware to check if user is logged in
const ensureAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    }
    res.status(401).json({ error: 'Unauthorized' });
};

// Global search endpoint
router.get('/api/search', ensureAuthenticated, async (req, res) => {
    try {
        const query = req.query.q || '';
        const userId = req.session.user.id;
        
        if (query.trim().length < 2) {
            return res.json({ results: [] });
        }
        
        const searchPattern = `%${query}%`;
        
        // Search across subjects, topics, tasks, and notes
        const [subjects, topics, tasks, notes] = await Promise.all([
            // Search subjects
            pool.query(
                `SELECT 'subject' as type, id, name as title, color, NULL as description, NULL as parent_id
                 FROM subjects 
                 WHERE user_id = $1 AND name ILIKE $2
                 LIMIT 5`,
                [userId, searchPattern]
            ),
            // Search topics
            pool.query(
                `SELECT 'topic' as type, t.id, t.name as title, s.color, t.difficulty as description, t.subject_id as parent_id
                 FROM topics t
                 JOIN subjects s ON t.subject_id = s.id
                 WHERE s.user_id = $1 AND t.name ILIKE $2
                 LIMIT 5`,
                [userId, searchPattern]
            ),
            // Search tasks
            pool.query(
                `SELECT 'task' as type, id, title, NULL as color, status as description, NULL as parent_id
                 FROM tasks 
                 WHERE user_id = $1 AND (title ILIKE $2 OR description ILIKE $2)
                 LIMIT 5`,
                [userId, searchPattern]
            ),
            // Search notes
            pool.query(
                `SELECT 'note' as type, id, title, NULL as color, content as description, NULL as parent_id
                 FROM saved_notes 
                 WHERE user_id = $1 AND (title ILIKE $2 OR content ILIKE $2)
                 LIMIT 5`,
                [userId, searchPattern]
            )
        ]);
        
        const results = [
            ...subjects.rows,
            ...topics.rows,
            ...tasks.rows,
            ...notes.rows
        ];
        
        res.json({ results });
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

module.exports = router;
