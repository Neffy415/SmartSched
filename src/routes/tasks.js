const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { body, validationResult } = require('express-validator');

// Middleware to check authentication
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }
    next();
};

router.use(requireAuth);

// Validation rules
const taskValidation = [
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('topic_id').notEmpty().withMessage('Topic is required'),
    body('task_type').isIn(['reading', 'notes', 'practice', 'revision', 'project', 'other']).withMessage('Invalid task type'),
    body('estimated_minutes').isInt({ min: 5, max: 480 }).withMessage('Estimated time must be between 5 and 480 minutes'),
    body('priority').optional().isInt({ min: 1, max: 5 }).withMessage('Priority must be between 1 and 5')
];

// GET /tasks - List all tasks
router.get('/', async (req, res) => {
    try {
        const { status, topic, priority, sort } = req.query;
        
        let query = `
            SELECT t.*, 
                   tp.name as topic_name,
                   s.name as subject_name,
                   s.color as subject_color
            FROM tasks t
            JOIN topics tp ON t.topic_id = tp.id
            JOIN subjects s ON tp.subject_id = s.id
            WHERE t.user_id = $1
        `;
        const params = [req.session.user.id];
        let paramCount = 1;

        // Apply filters
        if (status && ['pending', 'in_progress', 'completed'].includes(status)) {
            paramCount++;
            query += ` AND t.status = $${paramCount}`;
            params.push(status);
        }

        if (topic) {
            paramCount++;
            query += ` AND t.topic_id = $${paramCount}`;
            params.push(topic);
        }

        if (priority && ['1', '2', '3', '4', '5'].includes(priority)) {
            paramCount++;
            query += ` AND t.priority = $${paramCount}`;
            params.push(parseInt(priority));
        }

        // Sorting
        switch (sort) {
            case 'deadline':
                query += ` ORDER BY t.deadline ASC NULLS LAST, t.priority ASC`;
                break;
            case 'priority':
                query += ` ORDER BY t.priority ASC, t.deadline ASC NULLS LAST`;
                break;
            case 'status':
                query += ` ORDER BY CASE t.status 
                           WHEN 'in_progress' THEN 1 
                           WHEN 'pending' THEN 2 
                           ELSE 3 END, t.priority ASC`;
                break;
            default:
                query += ` ORDER BY t.created_at DESC`;
        }

        const result = await pool.query(query, params);

        // Get subjects for filter dropdown
        const subjectsResult = await pool.query(
            `SELECT s.id, s.name, s.color,
                    json_agg(json_build_object('id', tp.id, 'name', tp.name) ORDER BY tp.name) as topics
             FROM subjects s
             LEFT JOIN topics tp ON tp.subject_id = s.id
             WHERE s.user_id = $1 AND s.is_archived = false
             GROUP BY s.id
             ORDER BY s.name`,
            [req.session.user.id]
        );

        // Calculate stats
        const statsResult = await pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE status = 'pending') as pending,
                COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
                COUNT(*) FILTER (WHERE status = 'completed') as completed,
                COUNT(*) FILTER (WHERE deadline < NOW() AND status != 'completed') as overdue
            FROM tasks WHERE user_id = $1
        `, [req.session.user.id]);

        res.render('tasks/index', {
            title: 'Tasks - SmartSched',
            page: 'tasks',
            tasks: result.rows,
            subjects: subjectsResult.rows,
            stats: statsResult.rows[0],
            filters: { status, topic, priority, sort },
            user: req.session.user
        });
    } catch (error) {
        console.error('Error fetching tasks:', error);
        req.flash('error_msg', 'Failed to load tasks');
        res.redirect('/dashboard');
    }
});

// GET /tasks/new - Show new task form
router.get('/new', async (req, res) => {
    try {
        const { topic } = req.query;
        
        // Get subjects with topics
        const subjectsResult = await pool.query(
            `SELECT s.id, s.name, s.color,
                    json_agg(json_build_object('id', tp.id, 'name', tp.name) ORDER BY tp.name) as topics
             FROM subjects s
             LEFT JOIN topics tp ON tp.subject_id = s.id
             WHERE s.user_id = $1 AND s.is_archived = false
             GROUP BY s.id
             ORDER BY s.name`,
            [req.session.user.id]
        );

        res.render('tasks/form', {
            title: 'Add Task - SmartSched',
            page: 'tasks',
            task: { topic_id: topic || '' },
            subjects: subjectsResult.rows,
            editing: false,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading new task form:', error);
        req.flash('error_msg', 'Failed to load form');
        res.redirect('/tasks');
    }
});

// POST /tasks - Create new task
router.post('/', taskValidation, async (req, res) => {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
        try {
            const subjectsResult = await pool.query(
                `SELECT s.id, s.name, s.color,
                        json_agg(json_build_object('id', tp.id, 'name', tp.name) ORDER BY tp.name) as topics
                 FROM subjects s
                 LEFT JOIN topics tp ON tp.subject_id = s.id
                 WHERE s.user_id = $1 AND s.is_archived = false
                 GROUP BY s.id
                 ORDER BY s.name`,
                [req.session.user.id]
            );

            return res.render('tasks/form', {
                title: 'Add Task - SmartSched',
                task: req.body,
                subjects: subjectsResult.rows,
                editing: false,
                errors: errors.array(),
                user: req.session.user
            });
        } catch (error) {
            req.flash('error_msg', 'Validation failed');
            return res.redirect('/tasks/new');
        }
    }

    try {
        const { title, description, topic_id, task_type, estimated_minutes, priority, deadline } = req.body;

        // Verify topic belongs to user
        const topicCheck = await pool.query(`
            SELECT tp.id FROM topics tp
            JOIN subjects s ON tp.subject_id = s.id
            WHERE tp.id = $1 AND s.user_id = $2
        `, [topic_id, req.session.user.id]);

        if (topicCheck.rows.length === 0) {
            req.flash('error_msg', 'Invalid topic');
            return res.redirect('/tasks/new');
        }

        await pool.query(`
            INSERT INTO tasks (user_id, topic_id, title, description, task_type, estimated_minutes, priority, deadline)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
            req.session.user.id,
            topic_id,
            title,
            description || null,
            task_type,
            parseInt(estimated_minutes),
            priority ? parseInt(priority) : 3,
            deadline || null
        ]);

        req.flash('success_msg', 'Task created successfully!');
        res.redirect('/tasks');
    } catch (error) {
        console.error('Error creating task:', error);
        req.flash('error_msg', 'Failed to create task');
        res.redirect('/tasks/new');
    }
});

// GET /tasks/:id - View task details
router.get('/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*,
                   tp.name as topic_name,
                   tp.id as topic_id,
                   s.name as subject_name,
                   s.color as subject_color,
                   s.id as subject_id
            FROM tasks t
            JOIN topics tp ON t.topic_id = tp.id
            JOIN subjects s ON tp.subject_id = s.id
            WHERE t.id = $1 AND t.user_id = $2
        `, [req.params.id, req.session.user.id]);

        if (result.rows.length === 0) {
            return res.status(404).render('errors/404', {
                title: 'Task Not Found - SmartSched'
            });
        }

        const task = result.rows[0];

        // Get related study sessions
        const sessionsResult = await pool.query(`
            SELECT * FROM study_sessions
            WHERE task_id = $1
            ORDER BY start_time DESC
            LIMIT 10
        `, [task.id]);

        res.render('tasks/view', {
            title: `${task.title} - SmartSched`,
            task,
            sessions: sessionsResult.rows,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error fetching task:', error);
        req.flash('error_msg', 'Failed to load task');
        res.redirect('/tasks');
    }
});

// GET /tasks/:id/edit - Show edit form
router.get('/:id/edit', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*, s.id as subject_id
            FROM tasks t
            JOIN topics tp ON t.topic_id = tp.id
            JOIN subjects s ON tp.subject_id = s.id
            WHERE t.id = $1 AND t.user_id = $2
        `, [req.params.id, req.session.user.id]);

        if (result.rows.length === 0) {
            return res.status(404).render('errors/404', {
                title: 'Task Not Found - SmartSched'
            });
        }

        // Get subjects with topics
        const subjectsResult = await pool.query(
            `SELECT s.id, s.name, s.color,
                    json_agg(json_build_object('id', tp.id, 'name', tp.name) ORDER BY tp.name) as topics
             FROM subjects s
             LEFT JOIN topics tp ON tp.subject_id = s.id
             WHERE s.user_id = $1 AND s.is_archived = false
             GROUP BY s.id
             ORDER BY s.name`,
            [req.session.user.id]
        );

        res.render('tasks/form', {
            title: 'Edit Task - SmartSched',
            task: result.rows[0],
            subjects: subjectsResult.rows,
            editing: true,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading edit form:', error);
        req.flash('error_msg', 'Failed to load form');
        res.redirect('/tasks');
    }
});

// POST /tasks/:id - Update task
router.post('/:id', taskValidation, async (req, res) => {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
        try {
            const subjectsResult = await pool.query(
                `SELECT s.id, s.name, s.color,
                        json_agg(json_build_object('id', tp.id, 'name', tp.name) ORDER BY tp.name) as topics
                 FROM subjects s
                 LEFT JOIN topics tp ON tp.subject_id = s.id
                 WHERE s.user_id = $1 AND s.is_archived = false
                 GROUP BY s.id
                 ORDER BY s.name`,
                [req.session.user.id]
            );

            return res.render('tasks/form', {
                title: 'Edit Task - SmartSched',
                task: { ...req.body, id: req.params.id },
                subjects: subjectsResult.rows,
                editing: true,
                errors: errors.array(),
                user: req.session.user
            });
        } catch (error) {
            req.flash('error_msg', 'Validation failed');
            return res.redirect(`/tasks/${req.params.id}/edit`);
        }
    }

    try {
        const { title, description, topic_id, task_type, estimated_minutes, priority, deadline } = req.body;

        // Verify task and topic belong to user
        const taskCheck = await pool.query(`
            SELECT t.id FROM tasks t WHERE t.id = $1 AND t.user_id = $2
        `, [req.params.id, req.session.user.id]);

        if (taskCheck.rows.length === 0) {
            req.flash('error_msg', 'Task not found');
            return res.redirect('/tasks');
        }

        await pool.query(`
            UPDATE tasks SET
                title = $1,
                description = $2,
                topic_id = $3,
                task_type = $4,
                estimated_minutes = $5,
                priority = $6,
                deadline = $7,
                updated_at = NOW()
            WHERE id = $8 AND user_id = $9
        `, [
            title,
            description || null,
            topic_id,
            task_type,
            parseInt(estimated_minutes),
            priority ? parseInt(priority) : 3,
            deadline || null,
            req.params.id,
            req.session.user.id
        ]);

        req.flash('success_msg', 'Task updated successfully!');
        res.redirect(`/tasks/${req.params.id}`);
    } catch (error) {
        console.error('Error updating task:', error);
        req.flash('error_msg', 'Failed to update task');
        res.redirect(`/tasks/${req.params.id}/edit`);
    }
});

// POST /tasks/:id/status - Update task status
router.post('/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        const validStatuses = ['pending', 'in_progress', 'completed'];

        if (!validStatuses.includes(status)) {
            req.flash('error_msg', 'Invalid status');
            return res.redirect('back');
        }

        const completedAt = status === 'completed' ? 'NOW()' : 'NULL';

        await pool.query(`
            UPDATE tasks SET
                status = $1,
                completed_at = ${completedAt},
                updated_at = NOW()
            WHERE id = $2 AND user_id = $3
        `, [status, req.params.id, req.session.user.id]);

        // If completed, also log progress
        if (status === 'completed') {
            const taskResult = await pool.query(
                'SELECT topic_id FROM tasks WHERE id = $1',
                [req.params.id]
            );

            if (taskResult.rows.length > 0) {
                await pool.query(`
                    INSERT INTO progress_logs (user_id, topic_id, task_id, completion_percentage, notes)
                    VALUES ($1, $2, $3, 100, 'Completed task')
                `, [req.session.user.id, taskResult.rows[0].topic_id, req.params.id]);
            }
        }

        res.redirect('back');
    } catch (error) {
        console.error('Error updating task status:', error);
        req.flash('error_msg', 'Failed to update status');
        res.redirect('back');
    }
});

// POST /tasks/:id/delete - Delete task
router.post('/:id/delete', async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM tasks WHERE id = $1 AND user_id = $2',
            [req.params.id, req.session.user.id]
        );

        req.flash('success_msg', 'Task deleted successfully');
        res.redirect('/tasks');
    } catch (error) {
        console.error('Error deleting task:', error);
        req.flash('error_msg', 'Failed to delete task');
        res.redirect('back');
    }
});

module.exports = router;
