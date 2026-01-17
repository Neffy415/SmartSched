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

router.use(requireAuth);

// Validation rules
const topicValidation = [
    body('name')
        .trim()
        .isLength({ min: 2, max: 150 })
        .withMessage('Topic name must be 2-150 characters'),
    body('description')
        .optional()
        .trim()
        .isLength({ max: 1000 })
        .withMessage('Description must be under 1000 characters'),
    body('difficulty')
        .optional()
        .isIn(['easy', 'medium', 'hard'])
        .withMessage('Invalid difficulty level'),
    body('importance')
        .optional()
        .isInt({ min: 1, max: 5 })
        .withMessage('Importance must be 1-5'),
    body('estimated_hours')
        .optional()
        .isFloat({ min: 0.5, max: 100 })
        .withMessage('Estimated hours must be between 0.5 and 100'),
    body('subject_id')
        .isUUID()
        .withMessage('Invalid subject')
];

// ===================================
// GET: New Topic Form
// ===================================
router.get('/new', async (req, res) => {
    const userId = req.session.user.id;
    const subjectId = req.query.subject;

    try {
        // Get user's subjects for dropdown
        const subjectsResult = await db.query(`
            SELECT id, name, color FROM subjects 
            WHERE user_id = $1 AND is_archived = false
            ORDER BY name
        `, [userId]);

        res.render('topics/form', {
            title: 'Add Topic - SmartSched',
            page: 'subjects',
            topic: subjectId ? { subject_id: subjectId } : null,
            subjects: subjectsResult.rows,
            errors: []
        });
    } catch (error) {
        console.error('Error loading topic form:', error);
        req.flash('error', 'Failed to load form');
        res.redirect('/subjects');
    }
});

// ===================================
// POST: Create Topic
// ===================================
router.post('/', topicValidation, async (req, res) => {
    const userId = req.session.user.id;
    const errors = validationResult(req);

    // Get subjects for form re-render
    const subjectsResult = await db.query(`
        SELECT id, name, color FROM subjects 
        WHERE user_id = $1 AND is_archived = false
        ORDER BY name
    `, [userId]);

    if (!errors.isEmpty()) {
        return res.render('topics/form', {
            title: 'Add Topic - SmartSched',
            page: 'subjects',
            topic: req.body,
            subjects: subjectsResult.rows,
            errors: errors.array()
        });
    }

    const { subject_id, name, description, difficulty, importance, estimated_hours } = req.body;

    try {
        // Verify subject belongs to user
        const subjectCheck = await db.query(
            'SELECT id FROM subjects WHERE id = $1 AND user_id = $2',
            [subject_id, userId]
        );

        if (subjectCheck.rows.length === 0) {
            return res.render('topics/form', {
                title: 'Add Topic - SmartSched',
                page: 'subjects',
                topic: req.body,
                subjects: subjectsResult.rows,
                errors: [{ msg: 'Invalid subject selected' }]
            });
        }

        // Get max order index
        const orderResult = await db.query(
            'SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM topics WHERE subject_id = $1',
            [subject_id]
        );

        await db.query(`
            INSERT INTO topics (subject_id, name, description, difficulty, importance, estimated_hours, order_index)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
            subject_id,
            name,
            description || null,
            difficulty || 'medium',
            importance || 3,
            estimated_hours || 1.0,
            orderResult.rows[0].next_order
        ]);

        req.flash('success', `Topic "${name}" added successfully!`);
        res.redirect(`/subjects/${subject_id}`);
    } catch (error) {
        console.error('Error creating topic:', error);
        res.render('topics/form', {
            title: 'Add Topic - SmartSched',
            page: 'subjects',
            topic: req.body,
            subjects: subjectsResult.rows,
            errors: [{ msg: 'Failed to create topic. Please try again.' }]
        });
    }
});

// ===================================
// GET: View Topic Details
// ===================================
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;

    try {
        // Get topic with subject info
        const topicResult = await db.query(`
            SELECT t.*, s.name as subject_name, s.color as subject_color, s.user_id
            FROM topics t
            JOIN subjects s ON t.subject_id = s.id
            WHERE t.id = $1 AND s.user_id = $2
        `, [id, userId]);

        if (topicResult.rows.length === 0) {
            req.flash('error', 'Topic not found');
            return res.redirect('/subjects');
        }

        const topic = topicResult.rows[0];

        // Get tasks for this topic
        const tasksResult = await db.query(`
            SELECT * FROM tasks 
            WHERE topic_id = $1
            ORDER BY 
                CASE status 
                    WHEN 'in_progress' THEN 1
                    WHEN 'pending' THEN 2
                    WHEN 'overdue' THEN 3
                    WHEN 'completed' THEN 4
                    WHEN 'skipped' THEN 5
                END,
                priority DESC,
                deadline ASC NULLS LAST
        `, [id]);

        // Get study sessions for this topic
        const sessionsResult = await db.query(`
            SELECT * FROM study_sessions
            WHERE topic_id = $1
            ORDER BY start_time DESC
            LIMIT 10
        `, [id]);

        // Calculate stats
        const statsResult = await db.query(`
            SELECT 
                COUNT(*) as total_tasks,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_tasks,
                COALESCE(SUM(estimated_minutes), 0) as total_estimated,
                COALESCE(SUM(actual_minutes), 0) as total_actual
            FROM tasks
            WHERE topic_id = $1
        `, [id]);

        res.render('topics/view', {
            title: `${topic.name} - SmartSched`,
            page: 'subjects',
            topic,
            tasks: tasksResult.rows,
            sessions: sessionsResult.rows,
            stats: statsResult.rows[0]
        });
    } catch (error) {
        console.error('Error fetching topic:', error);
        req.flash('error', 'Failed to load topic');
        res.redirect('/subjects');
    }
});

// ===================================
// GET: Edit Topic Form
// ===================================
router.get('/:id/edit', async (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;

    try {
        const topicResult = await db.query(`
            SELECT t.*, s.user_id
            FROM topics t
            JOIN subjects s ON t.subject_id = s.id
            WHERE t.id = $1 AND s.user_id = $2
        `, [id, userId]);

        if (topicResult.rows.length === 0) {
            req.flash('error', 'Topic not found');
            return res.redirect('/subjects');
        }

        const subjectsResult = await db.query(`
            SELECT id, name, color FROM subjects 
            WHERE user_id = $1 AND is_archived = false
            ORDER BY name
        `, [userId]);

        res.render('topics/form', {
            title: 'Edit Topic - SmartSched',
            page: 'subjects',
            topic: topicResult.rows[0],
            subjects: subjectsResult.rows,
            errors: []
        });
    } catch (error) {
        console.error('Error loading topic:', error);
        req.flash('error', 'Failed to load topic');
        res.redirect('/subjects');
    }
});

// ===================================
// POST: Update Topic
// ===================================
router.post('/:id', topicValidation, async (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;
    const errors = validationResult(req);

    const subjectsResult = await db.query(`
        SELECT id, name, color FROM subjects 
        WHERE user_id = $1 AND is_archived = false
        ORDER BY name
    `, [userId]);

    if (!errors.isEmpty()) {
        return res.render('topics/form', {
            title: 'Edit Topic - SmartSched',
            page: 'subjects',
            topic: { ...req.body, id },
            subjects: subjectsResult.rows,
            errors: errors.array()
        });
    }

    const { subject_id, name, description, difficulty, importance, estimated_hours } = req.body;

    try {
        // Verify topic belongs to user
        const topicCheck = await db.query(`
            SELECT t.id FROM topics t
            JOIN subjects s ON t.subject_id = s.id
            WHERE t.id = $1 AND s.user_id = $2
        `, [id, userId]);

        if (topicCheck.rows.length === 0) {
            req.flash('error', 'Topic not found');
            return res.redirect('/subjects');
        }

        await db.query(`
            UPDATE topics 
            SET subject_id = $1, name = $2, description = $3, difficulty = $4, importance = $5, estimated_hours = $6
            WHERE id = $7
        `, [
            subject_id,
            name,
            description || null,
            difficulty || 'medium',
            importance || 3,
            estimated_hours || 1.0,
            id
        ]);

        req.flash('success', `Topic "${name}" updated successfully!`);
        res.redirect(`/topics/${id}`);
    } catch (error) {
        console.error('Error updating topic:', error);
        res.render('topics/form', {
            title: 'Edit Topic - SmartSched',
            page: 'subjects',
            topic: { ...req.body, id },
            subjects: subjectsResult.rows,
            errors: [{ msg: 'Failed to update topic. Please try again.' }]
        });
    }
});

// ===================================
// POST: Toggle Topic Completion
// ===================================
router.post('/:id/toggle', async (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;

    try {
        const result = await db.query(`
            UPDATE topics t
            SET is_completed = NOT is_completed,
                completed_at = CASE WHEN NOT is_completed THEN CURRENT_TIMESTAMP ELSE NULL END
            FROM subjects s
            WHERE t.id = $1 AND t.subject_id = s.id AND s.user_id = $2
            RETURNING t.subject_id
        `, [id, userId]);

        if (result.rows.length > 0) {
            // Redirect back to subject page
            const referer = req.get('Referer');
            if (referer) {
                return res.redirect(referer);
            }
            res.redirect(`/subjects/${result.rows[0].subject_id}`);
        } else {
            req.flash('error', 'Topic not found');
            res.redirect('/subjects');
        }
    } catch (error) {
        console.error('Error toggling topic:', error);
        req.flash('error', 'Failed to update topic');
        res.redirect('/subjects');
    }
});

// ===================================
// POST: Delete Topic
// ===================================
router.post('/:id/delete', async (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;

    try {
        const result = await db.query(`
            DELETE FROM topics t
            USING subjects s
            WHERE t.id = $1 AND t.subject_id = s.id AND s.user_id = $2
            RETURNING t.name, t.subject_id
        `, [id, userId]);

        if (result.rows.length > 0) {
            req.flash('success', `Topic "${result.rows[0].name}" deleted successfully!`);
            res.redirect(`/subjects/${result.rows[0].subject_id}`);
        } else {
            req.flash('error', 'Topic not found');
            res.redirect('/subjects');
        }
    } catch (error) {
        console.error('Error deleting topic:', error);
        req.flash('error', 'Failed to delete topic');
        res.redirect('/subjects');
    }
});

module.exports = router;
