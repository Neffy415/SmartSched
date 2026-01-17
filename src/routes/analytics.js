const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Middleware to check authentication
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }
    next();
};

router.use(requireAuth);

// GET /analytics - Main analytics dashboard
router.get('/', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);

        // Overall stats
        const overallStats = await pool.query(`
            SELECT 
                COALESCE(SUM(actual_minutes), 0) as total_minutes,
                COUNT(*) as total_sessions,
                COALESCE(AVG(actual_minutes), 0) as avg_session_length,
                COALESCE(AVG(quality_rating), 0) as avg_quality
            FROM study_sessions 
            WHERE user_id = $1 AND status = 'completed'
        `, [userId]);

        // This week's stats
        const weekStats = await pool.query(`
            SELECT 
                COALESCE(SUM(actual_minutes), 0) as minutes,
                COUNT(*) as sessions
            FROM study_sessions 
            WHERE user_id = $1 
            AND status = 'completed'
            AND start_time >= $2
        `, [userId, startOfWeek]);

        // Last week's stats for comparison
        const lastWeekStart = new Date(startOfWeek);
        lastWeekStart.setDate(lastWeekStart.getDate() - 7);
        const lastWeekStats = await pool.query(`
            SELECT 
                COALESCE(SUM(actual_minutes), 0) as minutes,
                COUNT(*) as sessions
            FROM study_sessions 
            WHERE user_id = $1 
            AND status = 'completed'
            AND start_time >= $2
            AND start_time < $3
        `, [userId, lastWeekStart, startOfWeek]);

        // Daily breakdown for the past 7 days
        const dailyBreakdown = await pool.query(`
            SELECT 
                DATE(start_time) as date,
                COALESCE(SUM(actual_minutes), 0) as minutes,
                COUNT(*) as sessions
            FROM study_sessions 
            WHERE user_id = $1 
            AND status = 'completed'
            AND start_time >= NOW() - INTERVAL '7 days'
            GROUP BY DATE(start_time)
            ORDER BY date
        `, [userId]);

        // Subject distribution
        const subjectDistribution = await pool.query(`
            SELECT 
                s.id,
                s.name,
                s.color,
                COALESCE(SUM(ss.actual_minutes), 0) as total_minutes,
                COUNT(ss.id) as session_count
            FROM subjects s
            LEFT JOIN topics t ON t.subject_id = s.id
            LEFT JOIN study_sessions ss ON ss.topic_id = t.id AND ss.status = 'completed'
            WHERE s.user_id = $1 AND s.is_archived = false
            GROUP BY s.id, s.name, s.color
            ORDER BY total_minutes DESC
        `, [userId]);

        // Task completion stats
        const taskStats = await pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE status = 'completed') as completed,
                COUNT(*) FILTER (WHERE status = 'pending') as pending,
                COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
                COUNT(*) as total
            FROM tasks WHERE user_id = $1
        `, [userId]);

        // Topic progress (top weak topics)
        const weakTopics = await pool.query(`
            SELECT 
                t.id,
                t.name,
                t.difficulty,
                s.name as subject_name,
                s.color as subject_color,
                COALESCE(SUM(ss.actual_minutes), 0) as study_time,
                t.estimated_hours * 60 as estimated_minutes,
                CASE 
                    WHEN t.estimated_hours * 60 > 0 
                    THEN ROUND((COALESCE(SUM(ss.actual_minutes), 0) / (t.estimated_hours * 60.0)) * 100)
                    ELSE 0 
                END as progress_percent
            FROM topics t
            JOIN subjects s ON t.subject_id = s.id
            LEFT JOIN study_sessions ss ON ss.topic_id = t.id AND ss.status = 'completed'
            WHERE s.user_id = $1 AND s.is_archived = false AND t.is_completed = false
            GROUP BY t.id, t.name, t.difficulty, t.estimated_hours, s.name, s.color
            HAVING COALESCE(SUM(ss.actual_minutes), 0) < t.estimated_hours * 60 * 0.5
            ORDER BY t.importance DESC, progress_percent ASC
            LIMIT 5
        `, [userId]);

        // Streak calculation
        const streakResult = await pool.query(`
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

        // Best day stats
        const bestDay = await pool.query(`
            SELECT 
                DATE(start_time) as date,
                COALESCE(SUM(actual_minutes), 0) as minutes
            FROM study_sessions
            WHERE user_id = $1 AND status = 'completed'
            GROUP BY DATE(start_time)
            ORDER BY minutes DESC
            LIMIT 1
        `, [userId]);

        // Consistency score (days studied this month / days in month so far)
        const daysThisMonth = now.getDate();
        const daysStudied = await pool.query(`
            SELECT COUNT(DISTINCT DATE(start_time)) as days
            FROM study_sessions
            WHERE user_id = $1 
            AND status = 'completed'
            AND EXTRACT(MONTH FROM start_time) = EXTRACT(MONTH FROM CURRENT_DATE)
            AND EXTRACT(YEAR FROM start_time) = EXTRACT(YEAR FROM CURRENT_DATE)
        `, [userId]);
        
        const consistencyScore = Math.round((daysStudied.rows[0]?.days || 0) / daysThisMonth * 100);

        // Prepare chart data
        const last7Days = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            date.setHours(0, 0, 0, 0);
            const dateStr = date.toISOString().split('T')[0];
            const dayData = dailyBreakdown.rows.find(d => 
                new Date(d.date).toISOString().split('T')[0] === dateStr
            );
            last7Days.push({
                date: dateStr,
                dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
                minutes: dayData ? parseInt(dayData.minutes) : 0,
                sessions: dayData ? parseInt(dayData.sessions) : 0
            });
        }

        // Calculate week over week change
        const thisWeekMinutes = parseInt(weekStats.rows[0]?.minutes || 0);
        const lastWeekMinutes = parseInt(lastWeekStats.rows[0]?.minutes || 0);
        const weekChange = lastWeekMinutes > 0 
            ? Math.round(((thisWeekMinutes - lastWeekMinutes) / lastWeekMinutes) * 100)
            : 0;

        res.render('analytics/index', {
            title: 'Analytics - SmartSched',
            page: 'analytics',
            stats: {
                total: overallStats.rows[0],
                week: weekStats.rows[0],
                weekChange,
                tasks: taskStats.rows[0],
                streak: streakResult.rows[0]?.streak || 0,
                bestDay: bestDay.rows[0] || null,
                consistencyScore
            },
            chartData: {
                daily: last7Days,
                subjects: subjectDistribution.rows
            },
            weakTopics: weakTopics.rows,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading analytics:', error);
        req.flash('error_msg', 'Failed to load analytics');
        res.redirect('/dashboard');
    }
});

// GET /analytics/reports - Weekly reports
router.get('/reports', async (req, res) => {
    try {
        const userId = req.session.user.id;

        // Get weekly analytics records
        const reports = await pool.query(`
            SELECT * FROM weekly_analytics
            WHERE user_id = $1
            ORDER BY week_start_date DESC
            LIMIT 12
        `, [userId]);

        res.render('analytics/reports', {
            title: 'Weekly Reports - SmartSched',
            reports: reports.rows,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading reports:', error);
        req.flash('error_msg', 'Failed to load reports');
        res.redirect('/analytics');
    }
});

// POST /analytics/generate-report - Generate weekly report
router.post('/generate-report', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const now = new Date();
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay() - 7); // Last week
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);

        // Calculate weekly stats
        const stats = await pool.query(`
            SELECT 
                COALESCE(SUM(actual_minutes), 0) as total_minutes,
                COUNT(*) as sessions_completed,
                COALESCE(AVG(quality_rating), 0) as avg_focus_score
            FROM study_sessions 
            WHERE user_id = $1 
            AND status = 'completed'
            AND start_time >= $2 
            AND start_time < $3
        `, [userId, weekStart, weekEnd]);

        const taskStats = await pool.query(`
            SELECT COUNT(*) as completed
            FROM tasks 
            WHERE user_id = $1 
            AND status = 'completed'
            AND completed_at >= $2 
            AND completed_at < $3
        `, [userId, weekStart, weekEnd]);

        // Calculate consistency (days studied)
        const daysStudied = await pool.query(`
            SELECT COUNT(DISTINCT DATE(start_time)) as days
            FROM study_sessions
            WHERE user_id = $1 
            AND status = 'completed'
            AND start_time >= $2 
            AND start_time < $3
        `, [userId, weekStart, weekEnd]);

        const consistencyScore = Math.round((daysStudied.rows[0]?.days || 0) / 7 * 100);

        // Insert or update weekly report
        await pool.query(`
            INSERT INTO weekly_analytics (user_id, week_start_date, week_end_date, total_completed_minutes, sessions_count, 
                                         tasks_completed, avg_session_length, consistency_score)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (user_id, week_start_date) DO UPDATE SET
                total_completed_minutes = $4,
                sessions_count = $5,
                tasks_completed = $6,
                avg_session_length = $7,
                consistency_score = $8,
                updated_at = NOW()
        `, [
            userId,
            weekStart,
            weekEnd,
            stats.rows[0]?.total_minutes || 0,
            stats.rows[0]?.sessions_completed || 0,
            taskStats.rows[0]?.completed || 0,
            stats.rows[0]?.avg_focus_score || 0,
            consistencyScore
        ]);

        req.flash('success_msg', 'Weekly report generated!');
        res.redirect('/analytics/reports');
    } catch (error) {
        console.error('Error generating report:', error);
        req.flash('error_msg', 'Failed to generate report');
        res.redirect('/analytics/reports');
    }
});

// GET /analytics/history - View study history by date
router.get('/history', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { date } = req.query;
        
        // Default to today if no date specified
        const selectedDate = date ? new Date(date) : new Date();
        const dateStr = selectedDate.toISOString().split('T')[0];
        
        // Get study sessions for the selected date
        const sessions = await pool.query(`
            SELECT 
                ss.*,
                t.name as topic_name,
                s.name as subject_name,
                s.color as subject_color,
                tk.title as task_title
            FROM study_sessions ss
            LEFT JOIN topics t ON ss.topic_id = t.id
            LEFT JOIN subjects s ON t.subject_id = s.id
            LEFT JOIN tasks tk ON ss.task_id = tk.id
            WHERE ss.user_id = $1 
            AND DATE(ss.start_time) = $2
            ORDER BY ss.start_time DESC
        `, [userId, dateStr]);
        
        // Get daily summary for selected date
        const daySummary = await pool.query(`
            SELECT 
                COALESCE(SUM(actual_minutes), 0) as total_minutes,
                COUNT(*) as session_count,
                COALESCE(AVG(quality_rating), 0) as avg_quality
            FROM study_sessions
            WHERE user_id = $1 
            AND DATE(start_time) = $2
            AND status = 'completed'
        `, [userId, dateStr]);
        
        // Get tasks completed on that day
        const tasksCompleted = await pool.query(`
            SELECT 
                t.*,
                top.name as topic_name,
                s.name as subject_name,
                s.color as subject_color
            FROM tasks t
            JOIN topics top ON t.topic_id = top.id
            JOIN subjects s ON top.subject_id = s.id
            WHERE t.user_id = $1 
            AND DATE(t.completed_at) = $2
            ORDER BY t.completed_at DESC
        `, [userId, dateStr]);
        
        // Get calendar data (last 30 days with activity)
        const calendarData = await pool.query(`
            SELECT 
                DATE(start_time) as date,
                COALESCE(SUM(actual_minutes), 0) as minutes,
                COUNT(*) as sessions
            FROM study_sessions
            WHERE user_id = $1 
            AND status = 'completed'
            AND start_time >= NOW() - INTERVAL '30 days'
            GROUP BY DATE(start_time)
            ORDER BY date DESC
        `, [userId]);
        
        // Generate calendar array for last 30 days
        const calendar = [];
        for (let i = 0; i < 30; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dStr = d.toISOString().split('T')[0];
            const dayData = calendarData.rows.find(cd => 
                new Date(cd.date).toISOString().split('T')[0] === dStr
            );
            calendar.push({
                date: dStr,
                dayNum: d.getDate(),
                dayName: d.toLocaleDateString('en-US', { weekday: 'short' }),
                monthName: d.toLocaleDateString('en-US', { month: 'short' }),
                minutes: dayData ? parseInt(dayData.minutes) : 0,
                sessions: dayData ? parseInt(dayData.sessions) : 0,
                isToday: i === 0,
                isSelected: dStr === dateStr
            });
        }
        
        // Compare with previous day
        const prevDate = new Date(selectedDate);
        prevDate.setDate(prevDate.getDate() - 1);
        const prevSummary = await pool.query(`
            SELECT COALESCE(SUM(actual_minutes), 0) as total_minutes
            FROM study_sessions
            WHERE user_id = $1 
            AND DATE(start_time) = $2
            AND status = 'completed'
        `, [userId, prevDate.toISOString().split('T')[0]]);
        
        res.render('analytics/history', {
            title: 'Study History - SmartSched',
            page: 'analytics',
            selectedDate: dateStr,
            displayDate: selectedDate.toLocaleDateString('en-US', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            }),
            sessions: sessions.rows,
            summary: daySummary.rows[0],
            prevDayMinutes: parseInt(prevSummary.rows[0]?.total_minutes || 0),
            tasksCompleted: tasksCompleted.rows,
            calendar: calendar.reverse(),
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading history:', error);
        req.flash('error_msg', 'Failed to load history');
        res.redirect('/analytics');
    }
});

// API endpoint for quick stats by date
router.get('/api/day/:date', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const dateStr = req.params.date;
        
        const summary = await pool.query(`
            SELECT 
                COALESCE(SUM(actual_minutes), 0) as total_minutes,
                COUNT(*) as session_count,
                COALESCE(AVG(quality_rating), 0) as avg_quality
            FROM study_sessions
            WHERE user_id = $1 
            AND DATE(start_time) = $2
            AND status = 'completed'
        `, [userId, dateStr]);
        
        const tasksCount = await pool.query(`
            SELECT COUNT(*) as count
            FROM tasks
            WHERE user_id = $1 
            AND DATE(completed_at) = $2
        `, [userId, dateStr]);
        
        res.json({
            success: true,
            date: dateStr,
            totalMinutes: parseInt(summary.rows[0]?.total_minutes || 0),
            sessionCount: parseInt(summary.rows[0]?.session_count || 0),
            avgQuality: parseFloat(summary.rows[0]?.avg_quality || 0).toFixed(1),
            tasksCompleted: parseInt(tasksCount.rows[0]?.count || 0)
        });
    } catch (error) {
        console.error('Error fetching day stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

module.exports = router;
