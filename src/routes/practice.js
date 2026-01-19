/**
 * SmartSched Practice Quiz Routes
 * Phase 5: AI Practice Module
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const aiService = require('../services/aiService');

// Middleware to check authentication
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }
    next();
};

router.use(requireAuth);

/**
 * GET /practice - Practice quiz home
 */
router.get('/', async (req, res) => {
    try {
        const userId = req.session.user.id;

        // Get recent quiz attempts
        const attemptsResult = await pool.query(`
            SELECT pa.*, pq.title as quiz_title, s.name as subject_name, s.color as subject_color
            FROM practice_attempts pa
            JOIN practice_quizzes pq ON pa.quiz_id = pq.id
            LEFT JOIN subjects s ON pq.subject_id = s.id
            WHERE pa.user_id = $1
            ORDER BY pa.completed_at DESC
            LIMIT 10
        `, [userId]);

        // Get saved quizzes
        const quizzesResult = await pool.query(`
            SELECT pq.*, s.name as subject_name, s.color as subject_color, t.name as topic_name,
                   COUNT(qq.id) as question_count
            FROM practice_quizzes pq
            LEFT JOIN subjects s ON pq.subject_id = s.id
            LEFT JOIN topics t ON pq.topic_id = t.id
            LEFT JOIN quiz_questions qq ON pq.id = qq.quiz_id
            WHERE pq.user_id = $1
            GROUP BY pq.id, s.name, s.color, t.name
            ORDER BY pq.created_at DESC
            LIMIT 20
        `, [userId]);

        // Get subjects for quiz generation
        const subjectsResult = await pool.query(`
            SELECT s.id, s.name, s.color,
                   json_agg(json_build_object('id', t.id, 'name', t.name) ORDER BY t.name) as topics
            FROM subjects s
            LEFT JOIN topics t ON s.id = t.subject_id
            WHERE s.user_id = $1
            GROUP BY s.id
            ORDER BY s.name
        `, [userId]);

        // Get performance stats
        const statsResult = await pool.query(`
            SELECT 
                COUNT(*) as total_attempts,
                COALESCE(AVG(percentage), 0) as avg_score,
                COALESCE(SUM(total_questions), 0) as total_questions
            FROM practice_attempts
            WHERE user_id = $1
        `, [userId]);

        res.render('practice/index', {
            title: 'Practice Quizzes - SmartSched',
            attempts: attemptsResult.rows,
            quizzes: quizzesResult.rows,
            subjects: subjectsResult.rows,
            stats: statsResult.rows[0],
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading practice page:', error);
        res.status(500).render('errors/500', { title: 'Error', user: req.session.user });
    }
});

/**
 * POST /practice/generate - Generate AI quiz
 */
router.post('/generate', async (req, res) => {
    const client = await pool.connect();
    try {
        const userId = req.session.user.id;
        const { topic_name, subject_id, topic_id, question_count = 5, difficulty = 'medium', context = '' } = req.body;

        if (!aiService.isConfigured()) {
            return res.status(503).json({ 
                success: false, 
                error: 'AI service is not available' 
            });
        }

        // Generate questions with AI
        const questions = await aiService.generateQuiz(
            topic_name,
            context,
            parseInt(question_count),
            difficulty
        );

        if (!questions || questions.length === 0) {
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to generate questions' 
            });
        }

        await client.query('BEGIN');

        // Create quiz
        const quizResult = await client.query(`
            INSERT INTO practice_quizzes (user_id, subject_id, topic_id, title, question_count)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
        `, [userId, subject_id || null, topic_id || null, topic_name + ' Quiz', questions.length]);

        const quizId = quizResult.rows[0].id;

        // Insert questions
        for (const q of questions) {
            await client.query(`
                INSERT INTO quiz_questions (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [quizId, q.question, q.options.A, q.options.B, q.options.C, q.options.D, q.correct, q.explanation || '']);
        }

        await client.query('COMMIT');

        res.json({ success: true, quizId });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error generating quiz:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
});

/**
 * GET /practice/:quizId - Take a quiz
 */
router.get('/:quizId', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { quizId } = req.params;

        // Get quiz details
        const quizResult = await pool.query(`
            SELECT pq.*, s.name as subject_name, s.color as subject_color, t.name as topic_name
            FROM practice_quizzes pq
            LEFT JOIN subjects s ON pq.subject_id = s.id
            LEFT JOIN topics t ON pq.topic_id = t.id
            WHERE pq.id = $1 AND pq.user_id = $2
        `, [quizId, userId]);

        if (quizResult.rows.length === 0) {
            return res.status(404).render('errors/404', { title: 'Not Found', user: req.session.user });
        }

        // Get questions
        const questionsResult = await pool.query(`
            SELECT id, question_text, option_a, option_b, option_c, option_d
            FROM quiz_questions
            WHERE quiz_id = $1
            ORDER BY created_at ASC
        `, [quizId]);

        res.render('practice/quiz', {
            title: `${quizResult.rows[0].title} - SmartSched`,
            quiz: quizResult.rows[0],
            questions: questionsResult.rows,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading quiz:', error);
        res.status(500).render('errors/500', { title: 'Error', user: req.session.user });
    }
});

/**
 * POST /practice/:quizId/submit - Submit quiz answers
 */
router.post('/:quizId/submit', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { quizId } = req.params;
        const { answers, timeTaken } = req.body;

        // Get correct answers
        const questionsResult = await pool.query(`
            SELECT id, correct_option, explanation
            FROM quiz_questions
            WHERE quiz_id = $1
        `, [quizId]);

        const questions = questionsResult.rows;
        let score = 0;
        const results = [];

        questions.forEach(q => {
            const userAnswer = answers[q.id];
            const isCorrect = userAnswer === q.correct_option;
            if (isCorrect) score++;
            
            results.push({
                questionId: q.id,
                userAnswer,
                correctAnswer: q.correct_option,
                isCorrect,
                explanation: q.explanation
            });
        });

        const percentage = Math.round((score / questions.length) * 100);

        // Save attempt
        const attemptResult = await pool.query(`
            INSERT INTO practice_attempts (user_id, quiz_id, score, total_questions, percentage, time_taken_seconds, answers)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id
        `, [userId, quizId, score, questions.length, percentage, timeTaken || 0, JSON.stringify(results)]);

        res.json({
            success: true,
            attemptId: attemptResult.rows[0].id,
            score,
            total: questions.length,
            percentage,
            results
        });
    } catch (error) {
        console.error('Error submitting quiz:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /practice/result/:attemptId - View quiz results
 */
router.get('/result/:attemptId', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { attemptId } = req.params;

        // Get attempt details
        const attemptResult = await pool.query(`
            SELECT pa.*, pq.title as quiz_title, s.name as subject_name, s.color as subject_color
            FROM practice_attempts pa
            JOIN practice_quizzes pq ON pa.quiz_id = pq.id
            LEFT JOIN subjects s ON pq.subject_id = s.id
            WHERE pa.id = $1 AND pa.user_id = $2
        `, [attemptId, userId]);

        if (attemptResult.rows.length === 0) {
            return res.status(404).render('errors/404', { title: 'Not Found', user: req.session.user });
        }

        // Get questions with full details
        const questionsResult = await pool.query(`
            SELECT *
            FROM quiz_questions
            WHERE quiz_id = $1
            ORDER BY created_at ASC
        `, [attemptResult.rows[0].quiz_id]);

        res.render('practice/result', {
            title: 'Quiz Results - SmartSched',
            attempt: attemptResult.rows[0],
            questions: questionsResult.rows,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading results:', error);
        res.status(500).render('errors/500', { title: 'Error', user: req.session.user });
    }
});

/**
 * DELETE /practice/:quizId - Delete a quiz
 */
router.delete('/:quizId', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { quizId } = req.params;

        const result = await pool.query(
            'DELETE FROM practice_quizzes WHERE id = $1 AND user_id = $2 RETURNING id',
            [quizId, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Quiz not found' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting quiz:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
