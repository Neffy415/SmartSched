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

// GET /study - Study sessions overview
router.get('/', async (req, res) => {
    try {
        // Check for active session
        const activeResult = await pool.query(`
            SELECT ss.*, t.title as task_title, tp.name as topic_name, s.name as subject_name, s.color as subject_color
            FROM study_sessions ss
            LEFT JOIN tasks t ON ss.task_id = t.id
            LEFT JOIN topics tp ON ss.topic_id = tp.id
            LEFT JOIN subjects s ON tp.subject_id = s.id
            WHERE ss.user_id = $1 AND ss.status = 'active'
            LIMIT 1
        `, [req.session.user.id]);

        // Get recent sessions
        const recentResult = await pool.query(`
            SELECT ss.*, t.title as task_title, tp.name as topic_name, s.name as subject_name, s.color as subject_color
            FROM study_sessions ss
            LEFT JOIN tasks t ON ss.task_id = t.id
            LEFT JOIN topics tp ON ss.topic_id = tp.id
            LEFT JOIN subjects s ON tp.subject_id = s.id
            WHERE ss.user_id = $1 AND ss.status = 'completed'
            ORDER BY ss.start_time DESC
            LIMIT 20
        `, [req.session.user.id]);

        // Get today's stats
        const todayResult = await pool.query(`
            SELECT 
                COUNT(*) as session_count,
                COALESCE(SUM(actual_minutes), 0) as total_minutes
            FROM study_sessions
            WHERE user_id = $1 AND DATE(start_time) = CURRENT_DATE AND status = 'completed'
        `, [req.session.user.id]);

        // Get weekly stats
        const weeklyResult = await pool.query(`
            SELECT 
                COUNT(*) as session_count,
                COALESCE(SUM(actual_minutes), 0) as total_minutes,
                COALESCE(AVG(actual_minutes), 0) as avg_minutes
            FROM study_sessions
            WHERE user_id = $1 
            AND start_time >= DATE_TRUNC('week', CURRENT_DATE)
            AND status = 'completed'
        `, [req.session.user.id]);

        // Get subjects for quick start
        const subjectsResult = await pool.query(`
            SELECT s.id, s.name, s.color,
                   json_agg(json_build_object('id', tp.id, 'name', tp.name) ORDER BY tp.name) as topics
            FROM subjects s
            LEFT JOIN topics tp ON tp.subject_id = s.id
            WHERE s.user_id = $1 AND s.is_archived = false
            GROUP BY s.id
            ORDER BY s.name
        `, [req.session.user.id]);

        res.render('study/index', {
            title: 'Study Sessions - SmartSched',
            page: 'study',
            activeSession: activeResult.rows[0] || null,
            recentSessions: recentResult.rows,
            todayStats: todayResult.rows[0],
            weeklyStats: weeklyResult.rows[0],
            subjects: subjectsResult.rows,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading study page:', error);
        req.flash('error_msg', 'Failed to load study sessions');
        res.redirect('/dashboard');
    }
});

// GET /study/start - Start a new session
router.get('/start', async (req, res) => {
    try {
        const { topic, task } = req.query;

        // Check for existing active session
        const activeCheck = await pool.query(
            'SELECT id FROM study_sessions WHERE user_id = $1 AND status = $2',
            [req.session.user.id, 'active']
        );

        if (activeCheck.rows.length > 0) {
            req.flash('error_msg', 'You already have an active session. Complete or cancel it first.');
            return res.redirect('/study');
        }

        // Get subjects with topics
        const subjectsResult = await pool.query(`
            SELECT s.id, s.name, s.color,
                   json_agg(json_build_object('id', tp.id, 'name', tp.name) ORDER BY tp.name) as topics
            FROM subjects s
            LEFT JOIN topics tp ON tp.subject_id = s.id
            WHERE s.user_id = $1 AND s.is_archived = false
            GROUP BY s.id
            ORDER BY s.name
        `, [req.session.user.id]);

        // Get tasks for the topic if provided
        let tasks = [];
        let selectedTopic = null;
        let selectedTask = null;

        if (task) {
            const taskResult = await pool.query(`
                SELECT t.*, tp.name as topic_name, tp.id as topic_id, s.name as subject_name, s.id as subject_id
                FROM tasks t
                JOIN topics tp ON t.topic_id = tp.id
                JOIN subjects s ON tp.subject_id = s.id
                WHERE t.id = $1 AND t.user_id = $2
            `, [task, req.session.user.id]);
            
            if (taskResult.rows.length > 0) {
                selectedTask = taskResult.rows[0];
                selectedTopic = { id: selectedTask.topic_id };
            }
        }

        if (topic) {
            selectedTopic = { id: topic };
            const tasksResult = await pool.query(`
                SELECT * FROM tasks 
                WHERE topic_id = $1 AND user_id = $2 AND status != 'completed'
                ORDER BY priority ASC, deadline ASC NULLS LAST
            `, [topic, req.session.user.id]);
            tasks = tasksResult.rows;
        }

        res.render('study/start', {
            title: 'Start Study Session - SmartSched',
            page: 'study',
            subjects: subjectsResult.rows,
            tasks,
            selectedTopic,
            selectedTask,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading start session page:', error);
        req.flash('error_msg', 'Failed to load session form');
        res.redirect('/study');
    }
});

// POST /study/start - Create and start a session
router.post('/start', async (req, res) => {
    try {
        const { topic_id, task_id, planned_minutes } = req.body;

        // Check for existing active session
        const activeCheck = await pool.query(
            'SELECT id FROM study_sessions WHERE user_id = $1 AND status = $2',
            [req.session.user.id, 'active']
        );

        if (activeCheck.rows.length > 0) {
            req.flash('error_msg', 'You already have an active session');
            return res.redirect('/study');
        }

        // Verify topic belongs to user
        const topicCheck = await pool.query(`
            SELECT tp.id FROM topics tp
            JOIN subjects s ON tp.subject_id = s.id
            WHERE tp.id = $1 AND s.user_id = $2
        `, [topic_id, req.session.user.id]);

        if (topicCheck.rows.length === 0) {
            req.flash('error_msg', 'Invalid topic');
            return res.redirect('/study/start');
        }

        // Create session
        const result = await pool.query(`
            INSERT INTO study_sessions (user_id, topic_id, task_id, planned_minutes, status, start_time)
            VALUES ($1, $2, $3, $4, 'active', NOW())
            RETURNING id
        `, [
            req.session.user.id,
            topic_id,
            task_id || null,
            planned_minutes || 25
        ]);

        // Update task status to in_progress if linked
        if (task_id) {
            await pool.query(
                "UPDATE tasks SET status = 'in_progress', updated_at = NOW() WHERE id = $1 AND status = 'pending'",
                [task_id]
            );
        }

        res.redirect(`/study/active/${result.rows[0].id}`);
    } catch (error) {
        console.error('Error starting session:', error);
        req.flash('error_msg', 'Failed to start session');
        res.redirect('/study/start');
    }
});

// GET /study/active/:id - Active session page
router.get('/active/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT ss.*, 
                   t.title as task_title, t.estimated_minutes as task_estimated,
                   tp.name as topic_name, tp.id as topic_id, tp.description as topic_description,
                   tp.estimated_hours as topic_estimated_hours, tp.difficulty as topic_difficulty,
                   s.name as subject_name, s.color as subject_color, s.id as subject_id
            FROM study_sessions ss
            LEFT JOIN tasks t ON ss.task_id = t.id
            JOIN topics tp ON ss.topic_id = tp.id
            JOIN subjects s ON tp.subject_id = s.id
            WHERE ss.id = $1 AND ss.user_id = $2
        `, [req.params.id, req.session.user.id]);

        if (result.rows.length === 0) {
            req.flash('error_msg', 'Session not found');
            return res.redirect('/study');
        }

        const session = result.rows[0];

        if (session.status !== 'active') {
            return res.redirect(`/study/complete/${session.id}`);
        }

        // Get topic progress (total study time for this topic)
        const progressResult = await pool.query(`
            SELECT 
                COALESCE(SUM(actual_minutes), 0) as total_minutes,
                COUNT(*) as session_count
            FROM study_sessions 
            WHERE topic_id = $1 AND user_id = $2 AND status = 'completed'
        `, [session.topic_id, req.session.user.id]);

        // Get any saved AI notes for this topic
        const notesResult = await pool.query(`
            SELECT id, title, content, created_at
            FROM saved_notes 
            WHERE user_id = $1 AND topic_id = $2
            ORDER BY created_at DESC
            LIMIT 3
        `, [req.session.user.id, session.topic_id]);

        // Calculate progress percentage
        const topicProgress = {
            totalMinutes: parseInt(progressResult.rows[0].total_minutes) || 0,
            sessionCount: parseInt(progressResult.rows[0].session_count) || 0,
            estimatedHours: session.topic_estimated_hours || 1,
            percentage: Math.min(100, Math.round(
                ((progressResult.rows[0].total_minutes || 0) / 60) / (session.topic_estimated_hours || 1) * 100
            ))
        };

        res.render('study/active', {
            title: 'Active Session - SmartSched',
            session,
            topicProgress,
            savedNotes: notesResult.rows,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading active session:', error);
        req.flash('error_msg', 'Failed to load session');
        res.redirect('/study');
    }
});

// POST /study/stop/:id - Stop a session
router.post('/stop/:id', async (req, res) => {
    try {
        const { notes, quality_rating } = req.body;

        // Get session and calculate duration
        const sessionResult = await pool.query(
            'SELECT * FROM study_sessions WHERE id = $1 AND user_id = $2 AND status = $3',
            [req.params.id, req.session.user.id, 'active']
        );

        if (sessionResult.rows.length === 0) {
            req.flash('error_msg', 'Active session not found');
            return res.redirect('/study');
        }

        const session = sessionResult.rows[0];
        const startTime = new Date(session.start_time);
        const endTime = new Date();
        const actualMinutes = Math.round((endTime - startTime) / (1000 * 60));

        // Update session
        await pool.query(`
            UPDATE study_sessions SET
                status = 'completed',
                end_time = NOW(),
                actual_minutes = $1,
                notes = $2,
                quality_rating = $3
            WHERE id = $4
        `, [actualMinutes, notes || null, quality_rating || null, req.params.id]);

        // Update task actual_minutes if linked
        if (session.task_id) {
            await pool.query(`
                UPDATE tasks SET 
                    actual_minutes = COALESCE(actual_minutes, 0) + $1,
                    updated_at = NOW()
                WHERE id = $2
            `, [actualMinutes, session.task_id]);
        }

        // Log progress
        await pool.query(`
            INSERT INTO progress_logs (user_id, topic_id, session_id, completion_percentage, confidence_level, notes)
            VALUES ($1, $2, $3, 100, $4, $5)
        `, [
            req.session.user.id,
            session.topic_id,
            req.params.id,
            quality_rating || 3,
            `Completed study session: ${actualMinutes} minutes`
        ]);

        // Update daily stats
        await pool.query(`
            INSERT INTO daily_stats (user_id, stat_date, study_minutes, sessions_count)
            VALUES ($1, CURRENT_DATE, $2, 1)
            ON CONFLICT (user_id, stat_date) DO UPDATE SET
                study_minutes = daily_stats.study_minutes + $2,
                sessions_count = daily_stats.sessions_count + 1,
                updated_at = NOW()
        `, [req.session.user.id, actualMinutes]);

        req.flash('success_msg', `Session completed! You studied for ${actualMinutes} minutes.`);
        res.redirect(`/study/complete/${req.params.id}`);
    } catch (error) {
        console.error('Error stopping session:', error);
        req.flash('error_msg', 'Failed to stop session');
        res.redirect(`/study/active/${req.params.id}`);
    }
});

// GET /study/complete/:id - Session completion page
router.get('/complete/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT ss.*, 
                   t.title as task_title,
                   tp.name as topic_name,
                   s.name as subject_name, s.color as subject_color
            FROM study_sessions ss
            LEFT JOIN tasks t ON ss.task_id = t.id
            JOIN topics tp ON ss.topic_id = tp.id
            JOIN subjects s ON tp.subject_id = s.id
            WHERE ss.id = $1 AND ss.user_id = $2
        `, [req.params.id, req.session.user.id]);

        if (result.rows.length === 0) {
            req.flash('error_msg', 'Session not found');
            return res.redirect('/study');
        }

        const session = result.rows[0];

        // Get today's total
        const todayResult = await pool.query(`
            SELECT COALESCE(SUM(actual_minutes), 0) as total_today
            FROM study_sessions
            WHERE user_id = $1 AND DATE(start_time) = CURRENT_DATE AND status = 'completed'
        `, [req.session.user.id]);

        res.render('study/complete', {
            title: 'Session Complete - SmartSched',
            session,
            todayTotal: todayResult.rows[0].total_today,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading completion page:', error);
        req.flash('error_msg', 'Failed to load session details');
        res.redirect('/study');
    }
});

// POST /study/cancel/:id - Cancel a session
router.post('/cancel/:id', async (req, res) => {
    try {
        await pool.query(
            "UPDATE study_sessions SET status = 'cancelled', end_time = NOW() WHERE id = $1 AND user_id = $2 AND status = 'active'",
            [req.params.id, req.session.user.id]
        );

        req.flash('success_msg', 'Session cancelled');
        res.redirect('/study');
    } catch (error) {
        console.error('Error cancelling session:', error);
        req.flash('error_msg', 'Failed to cancel session');
        res.redirect('back');
    }
});

// GET /study/history - Full session history
router.get('/history', async (req, res) => {
    try {
        const { page = 1, subject, from, to } = req.query;
        const limit = 20;
        const offset = (page - 1) * limit;

        let query = `
            SELECT ss.*, 
                   t.title as task_title,
                   tp.name as topic_name,
                   s.name as subject_name, s.color as subject_color
            FROM study_sessions ss
            LEFT JOIN tasks t ON ss.task_id = t.id
            JOIN topics tp ON ss.topic_id = tp.id
            JOIN subjects s ON tp.subject_id = s.id
            WHERE ss.user_id = $1 AND ss.status = 'completed'
        `;
        const params = [req.session.user.id];
        let paramCount = 1;

        if (subject) {
            paramCount++;
            query += ` AND s.id = $${paramCount}`;
            params.push(subject);
        }

        if (from) {
            paramCount++;
            query += ` AND DATE(ss.start_time) >= $${paramCount}`;
            params.push(from);
        }

        if (to) {
            paramCount++;
            query += ` AND DATE(ss.start_time) <= $${paramCount}`;
            params.push(to);
        }

        query += ` ORDER BY ss.start_time DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(limit, offset);

        const result = await pool.query(query, params);

        // Get subjects for filter
        const subjectsResult = await pool.query(
            'SELECT id, name, color FROM subjects WHERE user_id = $1 AND is_archived = false ORDER BY name',
            [req.session.user.id]
        );

        // Get total count for pagination
        let countQuery = `
            SELECT COUNT(*) FROM study_sessions ss
            JOIN topics tp ON ss.topic_id = tp.id
            JOIN subjects s ON tp.subject_id = s.id
            WHERE ss.user_id = $1 AND ss.status = 'completed'
        `;
        const countResult = await pool.query(countQuery, [req.session.user.id]);
        const totalPages = Math.ceil(countResult.rows[0].count / limit);

        res.render('study/history', {
            title: 'Session History - SmartSched',
            sessions: result.rows,
            subjects: subjectsResult.rows,
            filters: { subject, from, to },
            pagination: { page: parseInt(page), totalPages },
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading history:', error);
        req.flash('error_msg', 'Failed to load history');
        res.redirect('/study');
    }
});

// POST /study/quick-note/:sessionId - Save quick note during session
router.post('/quick-note/:sessionId', async (req, res) => {
    try {
        const { note } = req.body;
        const sessionId = req.params.sessionId;

        // Verify session belongs to user and is active
        const sessionResult = await pool.query(`
            SELECT ss.id, ss.topic_id, tp.name as topic_name
            FROM study_sessions ss
            JOIN topics tp ON ss.topic_id = tp.id
            WHERE ss.id = $1 AND ss.user_id = $2 AND ss.status = 'active'
        `, [sessionId, req.session.user.id]);

        if (sessionResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Session not found' });
        }

        const session = sessionResult.rows[0];

        // Save as a quick note linked to the topic
        const noteResult = await pool.query(`
            INSERT INTO saved_notes (user_id, topic_id, title, content, source)
            VALUES ($1, $2, $3, $4, 'quick_note')
            RETURNING id, created_at
        `, [
            req.session.user.id,
            session.topic_id,
            `Quick Note - ${session.topic_name}`,
            note
        ]);

        res.json({ 
            success: true, 
            noteId: noteResult.rows[0].id,
            message: 'Note saved!'
        });
    } catch (error) {
        console.error('Error saving quick note:', error);
        res.status(500).json({ success: false, error: 'Failed to save note' });
    }
});

module.exports = router;
