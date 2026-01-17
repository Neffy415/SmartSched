const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../config/database');

// Middleware: Check if user is authenticated
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        req.flash('error', 'Please login to access this page');
        return res.redirect('/auth/login');
    }
    next();
};

// Apply auth middleware to all routes
router.use(requireAuth);

// Validation rules
const subjectValidation = [
    body('name')
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Subject name must be 2-100 characters'),
    body('description')
        .optional()
        .trim()
        .isLength({ max: 500 })
        .withMessage('Description must be under 500 characters'),
    body('exam_date')
        .optional({ checkFalsy: true })
        .isDate()
        .withMessage('Invalid exam date'),
    body('priority_level')
        .optional()
        .isInt({ min: 1, max: 5 })
        .withMessage('Priority must be 1-5'),
    body('color')
        .optional()
        .matches(/^#[0-9A-Fa-f]{6}$/)
        .withMessage('Invalid color format')
];

// ===================================
// GET: Subjects List Page
// ===================================
router.get('/', async (req, res) => {
    try {
        const userId = req.session.user.id;
        
        // Get all subjects with topic counts and progress
        const result = await db.query(`
            SELECT 
                s.*,
                COUNT(DISTINCT t.id) as topic_count,
                COUNT(DISTINCT CASE WHEN t.is_completed THEN t.id END) as completed_topics,
                COALESCE(SUM(t.estimated_hours), 0) as total_hours,
                CASE 
                    WHEN COUNT(t.id) > 0 
                    THEN ROUND((COUNT(CASE WHEN t.is_completed THEN 1 END)::DECIMAL / COUNT(t.id)) * 100)
                    ELSE 0 
                END as progress_percentage
            FROM subjects s
            LEFT JOIN topics t ON t.subject_id = s.id
            WHERE s.user_id = $1 AND s.is_archived = false
            GROUP BY s.id
            ORDER BY 
                CASE WHEN s.exam_date IS NOT NULL THEN 0 ELSE 1 END,
                s.exam_date ASC,
                s.priority_level DESC,
                s.created_at DESC
        `, [userId]);

        res.render('subjects/index', {
            title: 'Subjects - SmartSched',
            page: 'subjects',
            subjects: result.rows
        });
    } catch (error) {
        console.error('Error fetching subjects:', error);
        req.flash('error', 'Failed to load subjects');
        res.redirect('/dashboard');
    }
});

// ===================================
// GET: New Subject Form
// ===================================
router.get('/new', (req, res) => {
    res.render('subjects/form', {
        title: 'Add Subject - SmartSched',
        page: 'subjects',
        subject: null,
        errors: []
    });
});

// ===================================
// POST: Create Subject
// ===================================
router.post('/', subjectValidation, async (req, res) => {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
        return res.render('subjects/form', {
            title: 'Add Subject - SmartSched',
            page: 'subjects',
            subject: req.body,
            errors: errors.array()
        });
    }

    const { name, description, exam_date, priority_level, color } = req.body;
    const userId = req.session.user.id;

    try {
        await db.query(`
            INSERT INTO subjects (user_id, name, description, exam_date, priority_level, color)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [
            userId,
            name,
            description || null,
            exam_date || null,
            priority_level || 3,
            color || '#6366f1'
        ]);

        req.flash('success', `Subject "${name}" created successfully!`);
        res.redirect('/subjects');
    } catch (error) {
        console.error('Error creating subject:', error);
        res.render('subjects/form', {
            title: 'Add Subject - SmartSched',
            page: 'subjects',
            subject: req.body,
            errors: [{ msg: 'Failed to create subject. Please try again.' }]
        });
    }
});

// ===================================
// GET: View Subject Details
// ===================================
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;

    try {
        // Get subject
        const subjectResult = await db.query(`
            SELECT * FROM subjects 
            WHERE id = $1 AND user_id = $2
        `, [id, userId]);

        if (subjectResult.rows.length === 0) {
            req.flash('error', 'Subject not found');
            return res.redirect('/subjects');
        }

        const subject = subjectResult.rows[0];

        // Get topics with task counts
        const topicsResult = await db.query(`
            SELECT 
                t.*,
                COUNT(DISTINCT tk.id) as task_count,
                COUNT(DISTINCT CASE WHEN tk.status = 'completed' THEN tk.id END) as completed_tasks,
                COALESCE(SUM(CASE WHEN tk.status = 'completed' THEN tk.actual_minutes ELSE 0 END), 0) as time_spent
            FROM topics t
            LEFT JOIN tasks tk ON tk.topic_id = t.id
            WHERE t.subject_id = $1
            GROUP BY t.id
            ORDER BY t.order_index, t.created_at
        `, [id]);

        // Get recent study sessions for this subject
        const sessionsResult = await db.query(`
            SELECT ss.*, t.name as topic_name, tk.title as task_title
            FROM study_sessions ss
            LEFT JOIN topics t ON ss.topic_id = t.id
            LEFT JOIN tasks tk ON ss.task_id = tk.id
            WHERE ss.user_id = $1 AND t.subject_id = $2
            ORDER BY ss.start_time DESC
            LIMIT 5
        `, [userId, id]);

        // Calculate stats
        const statsResult = await db.query(`
            SELECT 
                COALESCE(SUM(t.estimated_hours), 0) as total_estimated_hours,
                COALESCE(SUM(CASE WHEN tk.status = 'completed' THEN tk.actual_minutes ELSE 0 END), 0) as total_minutes_spent,
                COUNT(DISTINCT t.id) as total_topics,
                COUNT(DISTINCT CASE WHEN t.is_completed THEN t.id END) as completed_topics,
                COUNT(DISTINCT tk.id) as total_tasks,
                COUNT(DISTINCT CASE WHEN tk.status = 'completed' THEN tk.id END) as completed_tasks
            FROM topics t
            LEFT JOIN tasks tk ON tk.topic_id = t.id
            WHERE t.subject_id = $1
        `, [id]);

        res.render('subjects/view', {
            title: `${subject.name} - SmartSched`,
            page: 'subjects',
            subject,
            topics: topicsResult.rows,
            recentSessions: sessionsResult.rows,
            stats: statsResult.rows[0]
        });
    } catch (error) {
        console.error('Error fetching subject:', error);
        req.flash('error', 'Failed to load subject');
        res.redirect('/subjects');
    }
});

// ===================================
// GET: Edit Subject Form
// ===================================
router.get('/:id/edit', async (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;

    try {
        const result = await db.query(`
            SELECT * FROM subjects 
            WHERE id = $1 AND user_id = $2
        `, [id, userId]);

        if (result.rows.length === 0) {
            req.flash('error', 'Subject not found');
            return res.redirect('/subjects');
        }

        res.render('subjects/form', {
            title: 'Edit Subject - SmartSched',
            page: 'subjects',
            subject: result.rows[0],
            errors: []
        });
    } catch (error) {
        console.error('Error fetching subject:', error);
        req.flash('error', 'Failed to load subject');
        res.redirect('/subjects');
    }
});

// ===================================
// PUT: Update Subject
// ===================================
router.post('/:id', subjectValidation, async (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
        return res.render('subjects/form', {
            title: 'Edit Subject - SmartSched',
            page: 'subjects',
            subject: { ...req.body, id },
            errors: errors.array()
        });
    }

    const { name, description, exam_date, priority_level, color } = req.body;

    try {
        const result = await db.query(`
            UPDATE subjects 
            SET name = $1, description = $2, exam_date = $3, priority_level = $4, color = $5
            WHERE id = $6 AND user_id = $7
            RETURNING *
        `, [
            name,
            description || null,
            exam_date || null,
            priority_level || 3,
            color || '#6366f1',
            id,
            userId
        ]);

        if (result.rows.length === 0) {
            req.flash('error', 'Subject not found');
            return res.redirect('/subjects');
        }

        req.flash('success', `Subject "${name}" updated successfully!`);
        res.redirect(`/subjects/${id}`);
    } catch (error) {
        console.error('Error updating subject:', error);
        res.render('subjects/form', {
            title: 'Edit Subject - SmartSched',
            page: 'subjects',
            subject: { ...req.body, id },
            errors: [{ msg: 'Failed to update subject. Please try again.' }]
        });
    }
});

// ===================================
// DELETE: Delete Subject
// ===================================
router.post('/:id/delete', async (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;

    try {
        const result = await db.query(`
            DELETE FROM subjects 
            WHERE id = $1 AND user_id = $2
            RETURNING name
        `, [id, userId]);

        if (result.rows.length === 0) {
            req.flash('error', 'Subject not found');
        } else {
            req.flash('success', `Subject "${result.rows[0].name}" deleted successfully!`);
        }
        
        res.redirect('/subjects');
    } catch (error) {
        console.error('Error deleting subject:', error);
        req.flash('error', 'Failed to delete subject');
        res.redirect('/subjects');
    }
});

// ===================================
// POST: Archive Subject
// ===================================
router.post('/:id/archive', async (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;

    try {
        await db.query(`
            UPDATE subjects SET is_archived = true
            WHERE id = $1 AND user_id = $2
        `, [id, userId]);

        req.flash('success', 'Subject archived successfully!');
        res.redirect('/subjects');
    } catch (error) {
        console.error('Error archiving subject:', error);
        req.flash('error', 'Failed to archive subject');
        res.redirect('/subjects');
    }
});

module.exports = router;
