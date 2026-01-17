const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Middleware to check authentication
const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        next();
    } else {
        res.redirect('/auth/login');
    }
};

router.use(isAuthenticated);

// GET /notes - List all saved notes with filtering
router.get('/', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { subject, type, search, sort } = req.query;
        
        let query = `
            SELECT 
                n.*,
                s.name as subject_name,
                s.color as subject_color,
                t.name as topic_name
            FROM saved_notes n
            LEFT JOIN subjects s ON n.subject_id = s.id
            LEFT JOIN topics t ON n.topic_id = t.id
            WHERE n.user_id = $1
        `;
        const params = [userId];
        let paramIndex = 2;
        
        // Filter by subject
        if (subject && subject !== 'all') {
            query += ` AND n.subject_id = $${paramIndex}`;
            params.push(subject);
            paramIndex++;
        }
        
        // Filter by type
        if (type && type !== 'all') {
            query += ` AND n.note_type = $${paramIndex}`;
            params.push(type);
            paramIndex++;
        }
        
        // Search in title or content
        if (search) {
            query += ` AND (n.title ILIKE $${paramIndex} OR n.content ILIKE $${paramIndex})`;
            params.push(`%${search}%`);
            paramIndex++;
        }
        
        // Sort options
        switch (sort) {
            case 'oldest':
                query += ' ORDER BY n.created_at ASC';
                break;
            case 'title':
                query += ' ORDER BY n.title ASC';
                break;
            case 'subject':
                query += ' ORDER BY s.name ASC, n.created_at DESC';
                break;
            default:
                query += ' ORDER BY n.created_at DESC';
        }
        
        const notesResult = await pool.query(query, params);
        
        // Get subjects for filter dropdown
        const subjectsResult = await pool.query(
            'SELECT id, name, color FROM subjects WHERE user_id = $1 ORDER BY name',
            [userId]
        );
        
        // Get note counts by type
        const statsResult = await pool.query(`
            SELECT 
                note_type,
                COUNT(*) as count
            FROM saved_notes
            WHERE user_id = $1
            GROUP BY note_type
        `, [userId]);
        
        const stats = {
            total: notesResult.rows.length,
            explanation: 0,
            notes: 0,
            questions: 0,
            summary: 0,
            analysis: 0
        };
        
        statsResult.rows.forEach(row => {
            stats[row.note_type] = parseInt(row.count);
        });
        
        res.render('notes/index', {
            title: 'My Notes',
            notes: notesResult.rows,
            subjects: subjectsResult.rows,
            stats,
            filters: { subject, type, search, sort }
        });
    } catch (error) {
        console.error('Error fetching notes:', error);
        res.status(500).render('errors/500', { error: 'Failed to load notes' });
    }
});

// POST /notes/save - Save a new note from AI content
router.post('/save', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { title, content, note_type, subject_id, topic_id, ai_interaction_id } = req.body;
        
        // Validate required fields
        if (!title || !content) {
            return res.status(400).json({ 
                success: false, 
                error: 'Title and content are required' 
            });
        }
        
        const result = await pool.query(`
            INSERT INTO saved_notes (user_id, title, content, note_type, subject_id, topic_id, ai_interaction_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id
        `, [
            userId,
            title,
            content,
            note_type || 'notes',
            subject_id || null,
            topic_id || null,
            ai_interaction_id || null
        ]);
        
        res.json({ 
            success: true, 
            noteId: result.rows[0].id,
            message: 'Note saved successfully!'
        });
    } catch (error) {
        console.error('Error saving note:', error);
        res.status(500).json({ success: false, error: 'Failed to save note' });
    }
});

// GET /notes/:id - View a single note
router.get('/:id', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const noteId = req.params.id;
        
        const result = await pool.query(`
            SELECT 
                n.*,
                s.name as subject_name,
                s.color as subject_color,
                t.name as topic_name
            FROM saved_notes n
            LEFT JOIN subjects s ON n.subject_id = s.id
            LEFT JOIN topics t ON n.topic_id = t.id
            WHERE n.id = $1 AND n.user_id = $2
        `, [noteId, userId]);
        
        if (result.rows.length === 0) {
            return res.status(404).render('errors/404', { message: 'Note not found' });
        }
        
        res.render('notes/view', {
            title: result.rows[0].title,
            note: result.rows[0]
        });
    } catch (error) {
        console.error('Error fetching note:', error);
        res.status(500).render('errors/500', { error: 'Failed to load note' });
    }
});

// PUT /notes/:id - Update a note
router.put('/:id', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const noteId = req.params.id;
        const { title, content } = req.body;
        
        const result = await pool.query(`
            UPDATE saved_notes 
            SET title = $1, content = $2, updated_at = CURRENT_TIMESTAMP
            WHERE id = $3 AND user_id = $4
            RETURNING id
        `, [title, content, noteId, userId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Note not found' });
        }
        
        res.json({ success: true, message: 'Note updated successfully' });
    } catch (error) {
        console.error('Error updating note:', error);
        res.status(500).json({ success: false, error: 'Failed to update note' });
    }
});

// DELETE /notes/:id - Delete a note
router.delete('/:id', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const noteId = req.params.id;
        
        const result = await pool.query(
            'DELETE FROM saved_notes WHERE id = $1 AND user_id = $2 RETURNING id',
            [noteId, userId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Note not found' });
        }
        
        res.json({ success: true, message: 'Note deleted successfully' });
    } catch (error) {
        console.error('Error deleting note:', error);
        res.status(500).json({ success: false, error: 'Failed to delete note' });
    }
});

// POST /notes/:id/favorite - Toggle favorite status
router.post('/:id/favorite', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const noteId = req.params.id;
        
        const result = await pool.query(`
            UPDATE saved_notes 
            SET is_favorite = NOT is_favorite, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND user_id = $2
            RETURNING is_favorite
        `, [noteId, userId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Note not found' });
        }
        
        res.json({ 
            success: true, 
            is_favorite: result.rows[0].is_favorite 
        });
    } catch (error) {
        console.error('Error toggling favorite:', error);
        res.status(500).json({ success: false, error: 'Failed to update note' });
    }
});

module.exports = router;
