const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// Auth middleware
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }
    next();
};

router.use(requireAuth);

// GET /reminders - List all reminders
router.get('/', async (req, res) => {
    try {
        const userId = req.session.user.id;
        
        // Get all reminders
        const remindersResult = await pool.query(`
            SELECT r.*, t.title as task_title
            FROM reminders r
            LEFT JOIN tasks t ON r.task_id = t.id
            WHERE r.user_id = $1
            ORDER BY 
                CASE WHEN r.is_dismissed THEN 1 ELSE 0 END,
                r.remind_at ASC
        `, [userId]);
        
        // Get stats
        const statsResult = await pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE NOT is_dismissed AND remind_at > NOW()) as upcoming,
                COUNT(*) FILTER (WHERE NOT is_dismissed AND remind_at <= NOW() AND NOT is_triggered) as due_now,
                COUNT(*) FILTER (WHERE is_dismissed) as dismissed,
                COUNT(*) as total
            FROM reminders
            WHERE user_id = $1
        `, [userId]);
        
        res.render('reminders/index', {
            title: 'Reminders - SmartSched',
            page: 'reminders',
            reminders: remindersResult.rows,
            stats: statsResult.rows[0]
        });
    } catch (error) {
        console.error('Error fetching reminders:', error);
        req.flash('error', 'Failed to load reminders');
        res.redirect('/dashboard');
    }
});

// GET /reminders/new - New reminder form
router.get('/new', async (req, res) => {
    try {
        const userId = req.session.user.id;
        
        // Get tasks for linking
        const tasksResult = await pool.query(`
            SELECT t.id, t.title, top.name as topic_name, s.name as subject_name
            FROM tasks t
            JOIN topics top ON t.topic_id = top.id
            JOIN subjects s ON top.subject_id = s.id
            WHERE t.user_id = $1 AND t.status != 'completed'
            ORDER BY t.deadline ASC NULLS LAST
        `, [userId]);
        
        res.render('reminders/form', {
            title: 'New Reminder - SmartSched',
            page: 'reminders',
            reminder: {},
            tasks: tasksResult.rows,
            editing: false
        });
    } catch (error) {
        console.error('Error loading reminder form:', error);
        req.flash('error', 'Failed to load form');
        res.redirect('/reminders');
    }
});

// POST /reminders - Create new reminder
router.post('/', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { title, description, remind_date, remind_time, reminder_type, task_id, repeat_type } = req.body;
        
        // Combine date and time
        const remindAt = new Date(`${remind_date}T${remind_time}`);
        
        await pool.query(`
            INSERT INTO reminders (user_id, title, description, remind_at, reminder_type, task_id, repeat_type)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [userId, title, description || null, remindAt, reminder_type || 'custom', task_id || null, repeat_type || 'none']);
        
        req.flash('success', 'Reminder created successfully!');
        res.redirect('/reminders');
    } catch (error) {
        console.error('Error creating reminder:', error);
        req.flash('error', 'Failed to create reminder');
        res.redirect('/reminders/new');
    }
});

// GET /reminders/:id/edit - Edit reminder form
router.get('/:id/edit', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const reminderId = req.params.id;
        
        const reminderResult = await pool.query(`
            SELECT * FROM reminders WHERE id = $1 AND user_id = $2
        `, [reminderId, userId]);
        
        if (reminderResult.rows.length === 0) {
            req.flash('error', 'Reminder not found');
            return res.redirect('/reminders');
        }
        
        const tasksResult = await pool.query(`
            SELECT t.id, t.title, top.name as topic_name, s.name as subject_name
            FROM tasks t
            JOIN topics top ON t.topic_id = top.id
            JOIN subjects s ON top.subject_id = s.id
            WHERE t.user_id = $1 AND t.status != 'completed'
            ORDER BY t.deadline ASC NULLS LAST
        `, [userId]);
        
        res.render('reminders/form', {
            title: 'Edit Reminder - SmartSched',
            page: 'reminders',
            reminder: reminderResult.rows[0],
            tasks: tasksResult.rows,
            editing: true
        });
    } catch (error) {
        console.error('Error loading reminder:', error);
        req.flash('error', 'Failed to load reminder');
        res.redirect('/reminders');
    }
});

// POST /reminders/:id - Update reminder
router.post('/:id', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const reminderId = req.params.id;
        const { title, description, remind_date, remind_time, reminder_type, task_id, repeat_type } = req.body;
        
        const remindAt = new Date(`${remind_date}T${remind_time}`);
        
        await pool.query(`
            UPDATE reminders 
            SET title = $1, description = $2, remind_at = $3, reminder_type = $4, task_id = $5, repeat_type = $6,
                is_triggered = false
            WHERE id = $7 AND user_id = $8
        `, [title, description || null, remindAt, reminder_type || 'custom', task_id || null, repeat_type || 'none', reminderId, userId]);
        
        req.flash('success', 'Reminder updated successfully!');
        res.redirect('/reminders');
    } catch (error) {
        console.error('Error updating reminder:', error);
        req.flash('error', 'Failed to update reminder');
        res.redirect(`/reminders/${req.params.id}/edit`);
    }
});

// POST /reminders/:id/dismiss - Dismiss a reminder
router.post('/:id/dismiss', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const reminderId = req.params.id;
        
        await pool.query(`
            UPDATE reminders SET is_dismissed = true, is_triggered = true
            WHERE id = $1 AND user_id = $2
        `, [reminderId, userId]);
        
        // Check if it's an AJAX request
        if (req.xhr || req.headers.accept.indexOf('json') > -1) {
            return res.json({ success: true });
        }
        
        req.flash('success', 'Reminder dismissed');
        res.redirect('/reminders');
    } catch (error) {
        console.error('Error dismissing reminder:', error);
        if (req.xhr) {
            return res.status(500).json({ error: 'Failed to dismiss' });
        }
        req.flash('error', 'Failed to dismiss reminder');
        res.redirect('/reminders');
    }
});

// POST /reminders/:id/snooze - Snooze a reminder
router.post('/:id/snooze', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const reminderId = req.params.id;
        const { minutes } = req.body;
        
        const snoozeMinutes = parseInt(minutes) || 15;
        const newTime = new Date(Date.now() + snoozeMinutes * 60 * 1000);
        
        await pool.query(`
            UPDATE reminders SET remind_at = $1, is_triggered = false
            WHERE id = $2 AND user_id = $3
        `, [newTime, reminderId, userId]);
        
        if (req.xhr || req.headers.accept.indexOf('json') > -1) {
            return res.json({ success: true, newTime: newTime.toISOString() });
        }
        
        req.flash('success', `Reminder snoozed for ${snoozeMinutes} minutes`);
        res.redirect('/reminders');
    } catch (error) {
        console.error('Error snoozing reminder:', error);
        if (req.xhr) {
            return res.status(500).json({ error: 'Failed to snooze' });
        }
        req.flash('error', 'Failed to snooze reminder');
        res.redirect('/reminders');
    }
});

// DELETE /reminders/:id - Delete reminder
router.post('/:id/delete', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const reminderId = req.params.id;
        
        await pool.query(`
            DELETE FROM reminders WHERE id = $1 AND user_id = $2
        `, [reminderId, userId]);
        
        req.flash('success', 'Reminder deleted');
        res.redirect('/reminders');
    } catch (error) {
        console.error('Error deleting reminder:', error);
        req.flash('error', 'Failed to delete reminder');
        res.redirect('/reminders');
    }
});

// API endpoint - Get pending notifications/reminders (for topbar)
router.get('/api/pending', async (req, res) => {
    try {
        const userId = req.session.user.id;
        
        // Get reminders that are due (within last hour or upcoming in next 5 min)
        const remindersResult = await pool.query(`
            SELECT r.*, t.title as task_title
            FROM reminders r
            LEFT JOIN tasks t ON r.task_id = t.id
            WHERE r.user_id = $1 
              AND r.is_dismissed = false
              AND r.remind_at <= NOW() + INTERVAL '5 minutes'
            ORDER BY r.remind_at ASC
            LIMIT 10
        `, [userId]);
        
        // Get unread notifications
        const notificationsResult = await pool.query(`
            SELECT * FROM notifications
            WHERE user_id = $1 AND is_read = false
            ORDER BY created_at DESC
            LIMIT 10
        `, [userId]);
        
        // Get task deadline alerts (tasks due today or overdue)
        const deadlineAlertsResult = await pool.query(`
            SELECT t.id, t.title, t.deadline, s.name as subject_name, s.color as subject_color
            FROM tasks t
            JOIN topics top ON t.topic_id = top.id
            JOIN subjects s ON top.subject_id = s.id
            WHERE t.user_id = $1 
              AND t.status != 'completed'
              AND t.deadline IS NOT NULL
              AND t.deadline <= CURRENT_DATE + INTERVAL '1 day'
            ORDER BY t.deadline ASC
            LIMIT 5
        `, [userId]);
        
        const totalCount = remindersResult.rows.length + notificationsResult.rows.length + deadlineAlertsResult.rows.length;
        
        res.json({
            success: true,
            count: totalCount,
            reminders: remindersResult.rows,
            notifications: notificationsResult.rows,
            deadlineAlerts: deadlineAlertsResult.rows
        });
    } catch (error) {
        console.error('Error fetching pending notifications:', error);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

// API endpoint - Mark notification as read
router.post('/api/notifications/:id/read', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const notificationId = req.params.id;
        
        await pool.query(`
            UPDATE notifications SET is_read = true
            WHERE id = $1 AND user_id = $2
        `, [notificationId, userId]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ error: 'Failed to update notification' });
    }
});

// API endpoint - Mark all as read
router.post('/api/read-all', async (req, res) => {
    try {
        const userId = req.session.user.id;
        
        await pool.query(`
            UPDATE notifications SET is_read = true WHERE user_id = $1
        `, [userId]);
        
        await pool.query(`
            UPDATE reminders SET is_triggered = true WHERE user_id = $1 AND remind_at <= NOW()
        `, [userId]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error marking all as read:', error);
        res.status(500).json({ error: 'Failed to update' });
    }
});

module.exports = router;
