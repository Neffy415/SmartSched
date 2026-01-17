const express = require('express');
const router = express.Router();
const db = require('../config/database');
const scheduler = require('../services/scheduler');

// Landing page
router.get('/', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.render('landing', { title: 'SmartSched - Smart Study Scheduling' });
});

// Dashboard (protected)
router.get('/dashboard', async (req, res) => {
    if (!req.session.user) {
        req.flash('error', 'Please login to access the dashboard');
        return res.redirect('/auth/login');
    }

    try {
        const userId = req.session.user.id;

        // Get today's stats
        const todayStats = await db.query(`
            SELECT 
                COALESCE(SUM(actual_minutes), 0) as minutes_today,
                COUNT(*) as sessions_today
            FROM study_sessions
            WHERE user_id = $1 AND DATE(start_time) = CURRENT_DATE AND status = 'completed'
        `, [userId]);

        // Get active session
        const activeSession = await db.query(`
            SELECT ss.*, t.name as topic_name, s.name as subject_name, s.color as subject_color
            FROM study_sessions ss
            JOIN topics t ON ss.topic_id = t.id
            JOIN subjects s ON t.subject_id = s.id
            WHERE ss.user_id = $1 AND ss.status = 'active'
            LIMIT 1
        `, [userId]);

        // Get task stats
        const taskStats = await db.query(`
            SELECT 
                COUNT(*) FILTER (WHERE status = 'pending') as pending,
                COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
                COUNT(*) FILTER (WHERE status = 'completed') as completed,
                COUNT(*) FILTER (WHERE deadline < NOW() AND status != 'completed') as overdue
            FROM tasks WHERE user_id = $1
        `, [userId]);

        // Get today's scheduled tasks (from intelligent scheduler)
        const todayTasks = await scheduler.getTodaysTasks(userId);
        const scheduleStats = await scheduler.getScheduleStats(userId);

        // Get upcoming deadlines
        const upcomingTasks = await db.query(`
            SELECT t.*, tp.name as topic_name, s.name as subject_name, s.color as subject_color
            FROM tasks t
            JOIN topics tp ON t.topic_id = tp.id
            JOIN subjects s ON tp.subject_id = s.id
            WHERE t.user_id = $1 AND t.status != 'completed' AND t.deadline IS NOT NULL
            ORDER BY t.deadline ASC
            LIMIT 5
        `, [userId]);

        // Get subject progress
        const subjects = await db.query(`
            SELECT 
                s.id, s.name, s.color,
                COUNT(DISTINCT t.id) as topic_count,
                COUNT(DISTINCT t.id) FILTER (WHERE t.is_completed = true) as completed_topics
            FROM subjects s
            LEFT JOIN topics t ON t.subject_id = s.id
            WHERE s.user_id = $1 AND s.is_archived = false
            GROUP BY s.id
            ORDER BY s.created_at DESC
            LIMIT 4
        `, [userId]);

        // Get recent sessions
        const recentSessions = await db.query(`
            SELECT ss.*, t.name as topic_name, s.name as subject_name, s.color as subject_color
            FROM study_sessions ss
            JOIN topics t ON ss.topic_id = t.id
            JOIN subjects s ON t.subject_id = s.id
            WHERE ss.user_id = $1 AND ss.status = 'completed'
            ORDER BY ss.start_time DESC
            LIMIT 5
        `, [userId]);

        // Calculate streak
        const streakResult = await db.query(`
            WITH daily_activity AS (
                SELECT DISTINCT DATE(start_time) as study_date
                FROM study_sessions
                WHERE user_id = $1 AND status = 'completed'
                ORDER BY study_date DESC
            ),
            streak_calc AS (
                SELECT study_date,
                       study_date - (ROW_NUMBER() OVER (ORDER BY study_date DESC))::integer as grp
                FROM daily_activity
            )
            SELECT COUNT(*) as streak
            FROM streak_calc
            WHERE grp = (SELECT grp FROM streak_calc WHERE study_date = CURRENT_DATE LIMIT 1)
        `, [userId]);

        res.render('dashboard/index', { 
            title: 'Dashboard - SmartSched',
            page: 'dashboard',
            stats: {
                minutesToday: todayStats.rows[0]?.minutes_today || 0,
                sessionsToday: todayStats.rows[0]?.sessions_today || 0,
                pendingTasks: taskStats.rows[0]?.pending || 0,
                overdueTasks: taskStats.rows[0]?.overdue || 0,
                streak: streakResult.rows[0]?.streak || 0
            },
            scheduleStats: {
                todayPending: parseInt(scheduleStats.today_pending) || 0,
                todayCompleted: parseInt(scheduleStats.today_completed) || 0,
                todayMinutes: parseInt(scheduleStats.today_minutes_remaining) || 0,
                weekTasks: parseInt(scheduleStats.week_tasks) || 0
            },
            todayTasks: todayTasks.slice(0, 3), // Show top 3 tasks
            activeSession: activeSession.rows[0] || null,
            upcomingTasks: upcomingTasks.rows,
            subjects: subjects.rows,
            recentSessions: recentSessions.rows
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.render('dashboard/index', { 
            title: 'Dashboard - SmartSched',
            page: 'dashboard',
            stats: { minutesToday: 0, sessionsToday: 0, pendingTasks: 0, overdueTasks: 0, streak: 0 },
            scheduleStats: { todayPending: 0, todayCompleted: 0, todayMinutes: 0, weekTasks: 0 },
            todayTasks: [],
            activeSession: null,
            upcomingTasks: [],
            subjects: [],
            recentSessions: []
        });
    }
});

module.exports = router;
