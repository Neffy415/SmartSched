const express = require('express');
const router = express.Router();
const db = require('../config/database');
const scheduler = require('../services/scheduler');

// Middleware: Check if user is authenticated
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        req.flash('error', 'Please login to access this page');
        return res.redirect('/auth/login');
    }
    next();
};

router.use(requireAuth);

// GET /schedule - Main schedule overview (redirects to today)
router.get('/', async (req, res) => {
    res.redirect('/schedule/today');
});

// GET /schedule/today - Today's study plan
router.get('/today', async (req, res) => {
    try {
        const userId = req.session.user.id;
        
        // Get today's tasks
        const todayTasks = await scheduler.getTodaysTasks(userId);
        
        // Get schedule stats
        const stats = await scheduler.getScheduleStats(userId);
        
        // Get user preferences
        const preferences = await scheduler.getUserPreferences(userId);
        
        // Calculate completion percentage
        const totalTasks = (parseInt(stats.today_pending) || 0) + (parseInt(stats.today_completed) || 0);
        const completionPercent = totalTasks > 0 ? Math.round((parseInt(stats.today_completed) / totalTasks) * 100) : 0;
        
        res.render('schedule/today', {
            title: "Today's Plan - SmartSched",
            page: 'schedule',
            tasks: todayTasks,
            stats: {
                pending: parseInt(stats.today_pending) || 0,
                completed: parseInt(stats.today_completed) || 0,
                skipped: parseInt(stats.today_skipped) || 0,
                minutesRemaining: parseInt(stats.today_minutes_remaining) || 0,
                completionPercent
            },
            preferences,
            today: new Date().toLocaleDateString('en-US', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            })
        });
    } catch (error) {
        console.error('Today schedule error:', error);
        req.flash('error', 'Failed to load today\'s schedule');
        res.redirect('/dashboard');
    }
});

// GET /schedule/week - Weekly plan view
router.get('/week', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { start } = req.query;
        
        // Parse start date or use today
        let startDate = start ? new Date(start) : new Date();
        // Get to Monday of this week
        const dayOfWeek = startDate.getDay();
        const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        startDate.setDate(startDate.getDate() + diff);
        
        // Get weekly tasks
        const weekData = await scheduler.getWeeklyTasks(userId, startDate);
        
        // Get schedule stats
        const stats = await scheduler.getScheduleStats(userId);
        
        // Generate week days array
        const weekDays = [];
        for (let i = 0; i < 7; i++) {
            const date = new Date(startDate);
            date.setDate(date.getDate() + i);
            const dateStr = date.toISOString().split('T')[0];
            weekDays.push({
                date: date,
                dateStr: dateStr,
                dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
                dayNum: date.getDate(),
                isToday: dateStr === new Date().toISOString().split('T')[0],
                tasks: weekData.tasksByDate[dateStr] || []
            });
        }
        
        // Calculate week navigation dates
        const prevWeek = new Date(startDate);
        prevWeek.setDate(prevWeek.getDate() - 7);
        const nextWeek = new Date(startDate);
        nextWeek.setDate(nextWeek.getDate() + 7);
        
        res.render('schedule/week', {
            title: 'Weekly Plan - SmartSched',
            page: 'schedule',
            weekDays,
            stats: {
                weekTasks: parseInt(stats.week_tasks) || 0
            },
            weekStart: startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            weekEnd: new Date(startDate.getTime() + 6 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            prevWeekStr: prevWeek.toISOString().split('T')[0],
            nextWeekStr: nextWeek.toISOString().split('T')[0]
        });
    } catch (error) {
        console.error('Week schedule error:', error);
        req.flash('error', 'Failed to load weekly schedule');
        res.redirect('/dashboard');
    }
});

// POST /schedule/generate - Generate automatic schedule
router.post('/generate', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const days = parseInt(req.body.days) || 7;
        
        const result = await scheduler.generateSchedule(userId, days);
        
        if (result.success) {
            req.flash('success', result.message);
        } else {
            req.flash('error', result.message);
        }
        
        // Return JSON for AJAX requests
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.json(result);
        }
        
        res.redirect('/schedule/week');
    } catch (error) {
        console.error('Generate schedule error:', error);
        
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(500).json({ success: false, message: 'Failed to generate schedule' });
        }
        
        req.flash('error', 'Failed to generate schedule');
        res.redirect('/schedule/week');
    }
});

// GET /schedule/api/today - API endpoint for today's tasks
router.get('/api/today', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const tasks = await scheduler.getTodaysTasks(userId);
        const stats = await scheduler.getScheduleStats(userId);
        
        res.json({ success: true, tasks, stats });
    } catch (error) {
        console.error('API today error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch today\'s tasks' });
    }
});

// GET /schedule/api/priorities - Get prioritized topics
router.get('/api/priorities', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const topics = await scheduler.getPrioritizedTopics(userId);
        
        res.json({ success: true, topics });
    } catch (error) {
        console.error('API priorities error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch priorities' });
    }
});

// POST /schedule/task/:id/complete - Mark task as completed
router.post('/task/:id/complete', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const taskId = req.params.id;
        
        const result = await scheduler.completeTask(userId, taskId);
        
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.json(result);
        }
        
        if (result.success) {
            req.flash('success', 'Task completed! Great work! 🎉');
        } else {
            req.flash('error', result.message);
        }
        
        res.redirect('/schedule/today');
    } catch (error) {
        console.error('Complete task error:', error);
        
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(500).json({ success: false, message: 'Failed to complete task' });
        }
        
        req.flash('error', 'Failed to complete task');
        res.redirect('/schedule/today');
    }
});

// POST /schedule/task/:id/skip - Skip and reschedule task
router.post('/task/:id/skip', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const taskId = req.params.id;
        const reason = req.body.reason || '';
        
        const result = await scheduler.skipTask(userId, taskId, reason);
        
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.json(result);
        }
        
        if (result.success) {
            req.flash('success', result.message);
        } else {
            req.flash('error', result.message);
        }
        
        res.redirect('/schedule/today');
    } catch (error) {
        console.error('Skip task error:', error);
        
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(500).json({ success: false, message: 'Failed to skip task' });
        }
        
        req.flash('error', 'Failed to skip task');
        res.redirect('/schedule/today');
    }
});

// Legacy route for upcoming deadlines view
router.get('/deadlines', async (req, res) => {
    try {
        const userId = req.session.user.id;

        // Get upcoming tasks with deadlines
        const upcomingTasks = await db.query(`
            SELECT t.*, 
                   tp.name as topic_name,
                   s.name as subject_name, 
                   s.color as subject_color
            FROM tasks t
            JOIN topics tp ON t.topic_id = tp.id
            JOIN subjects s ON tp.subject_id = s.id
            WHERE t.user_id = $1 
            AND t.status != 'completed'
            AND t.deadline IS NOT NULL
            ORDER BY t.deadline ASC
            LIMIT 20
        `, [userId]);

        res.render('schedule/index', {
            title: 'Deadlines - SmartSched',
            page: 'schedule',
            upcomingTasks: upcomingTasks.rows,
            weekTasks: []
        });
    } catch (error) {
        console.error('Deadlines error:', error);
        req.flash('error', 'Failed to load deadlines');
        res.redirect('/dashboard');
    }
});

module.exports = router;
