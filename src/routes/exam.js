/**
 * SmartSched Live Exam Simulator Routes
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const aiService = require('../services/aiService');

const requireAuth = (req, res, next) => {
    if (!req.session.user) return res.redirect('/auth/login');
    next();
};

router.use(requireAuth);

/**
 * GET /exam - Exam simulator home
 */
router.get('/', async (req, res) => {
    try {
        const userId = req.session.user.id;

        // Get subjects with topics
        const subjects = await pool.query(`
            SELECT s.*, COUNT(t.id) as topic_count
            FROM subjects s
            LEFT JOIN topics t ON s.id = t.subject_id
            WHERE s.user_id = $1 AND s.is_archived = false
            GROUP BY s.id ORDER BY s.name
        `, [userId]);

        // Get recent exam attempts
        const attempts = await pool.query(`
            SELECT ea.*, s.name as subject_name, s.color as subject_color
            FROM exam_attempts ea
            LEFT JOIN subjects s ON ea.subject_id = s.id
            WHERE ea.user_id = $1
            ORDER BY ea.completed_at DESC NULLS LAST
            LIMIT 10
        `, [userId]);

        // Stats
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_exams,
                COALESCE(AVG(percentage), 0) as avg_score,
                COALESCE(MAX(percentage), 0) as best_score,
                COALESCE(SUM(time_taken_seconds), 0) as total_time
            FROM exam_attempts
            WHERE user_id = $1 AND percentage IS NOT NULL
        `, [userId]);

        res.render('exam/index', {
            title: 'Exam Simulator - SmartSched',
            page: 'exam',
            subjects: subjects.rows,
            attempts: attempts.rows,
            stats: stats.rows[0]
        });
    } catch (error) {
        console.error('Exam index error:', error);
        req.flash('error', 'Failed to load exam simulator');
        res.redirect('/dashboard');
    }
});

/**
 * POST /exam/generate - Generate a full exam
 */
router.post('/generate', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { subject_id, question_count = 20, time_limit = 60, difficulty = 'mixed' } = req.body;

        if (!subject_id) {
            req.flash('error', 'Please select a subject');
            return res.redirect('/exam');
        }

        // Get subject info and topics
        const subject = await pool.query('SELECT * FROM subjects WHERE id = $1 AND user_id = $2', [subject_id, userId]);
        if (subject.rows.length === 0) {
            req.flash('error', 'Subject not found');
            return res.redirect('/exam');
        }

        const topics = await pool.query('SELECT name, difficulty, importance FROM topics WHERE subject_id = $1 ORDER BY importance DESC', [subject_id]);
        const topicNames = topics.rows.map(t => t.name);
        const subjectName = subject.rows[0].name;

        const qCount = Math.min(Math.max(parseInt(question_count) || 20, 5), 50);
        const timeMin = Math.min(Math.max(parseInt(time_limit) || 60, 10), 180);

        // Generate exam via AI
        const prompt = `You are an exam creator for a student studying "${subjectName}".

Topics covered: ${topicNames.join(', ')}

Create a realistic exam with exactly ${qCount} questions. Mix question types for a real exam feel.
Difficulty: ${difficulty === 'mixed' ? 'Mix of easy (30%), medium (40%), hard (30%)' : difficulty + ' level'}

Return ONLY valid JSON (no markdown):
{
  "exam_title": "string - name for this exam",
  "questions": [
    {
      "number": 1,
      "question": "The question text",
      "type": "mcq",
      "topic": "Which topic this covers",
      "difficulty": "easy|medium|hard",
      "options": {"a": "Option A", "b": "Option B", "c": "Option C", "d": "Option D"},
      "correct_answer": "a",
      "explanation": "Why this is correct"
    }
  ]
}

Rules:
- All questions must be multiple choice (a/b/c/d)
- Questions should test real understanding, not just memorization
- Include application-based and analytical questions
- Each question must reference a specific topic
- Provide clear, educational explanations
- Vary difficulty across questions
- Make it feel like a real midterm/final exam`;

        const response = await aiService.callGemini(prompt);

        if (!response.questions || !Array.isArray(response.questions)) {
            req.flash('error', 'Failed to generate exam. Please try again.');
            return res.redirect('/exam');
        }

        // Create exam record
        const examResult = await pool.query(`
            INSERT INTO exam_attempts (user_id, subject_id, title, question_count, time_limit_seconds, difficulty, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'in_progress')
            RETURNING id
        `, [userId, subject_id, response.exam_title || `${subjectName} Exam`, qCount, timeMin * 60, difficulty]);

        const examId = examResult.rows[0].id;

        // Insert questions
        for (const q of response.questions) {
            await pool.query(`
                INSERT INTO exam_questions (exam_id, question_number, question_text, topic_name, difficulty, option_a, option_b, option_c, option_d, correct_option, explanation)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            `, [
                examId, q.number, q.question, q.topic || '', q.difficulty || 'medium',
                q.options?.a || '', q.options?.b || '', q.options?.c || '', q.options?.d || '',
                q.correct_answer || 'a', q.explanation || ''
            ]);
        }

        res.redirect(`/exam/${examId}/take`);
    } catch (error) {
        console.error('Exam generation error:', error);
        req.flash('error', 'Failed to generate exam: ' + error.message);
        res.redirect('/exam');
    }
});

/**
 * GET /exam/:id/take - Take the exam
 */
router.get('/:id/take', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const examId = req.params.id;

        const exam = await pool.query(`
            SELECT ea.*, s.name as subject_name, s.color as subject_color
            FROM exam_attempts ea
            LEFT JOIN subjects s ON ea.subject_id = s.id
            WHERE ea.id = $1 AND ea.user_id = $2
        `, [examId, userId]);

        if (exam.rows.length === 0) {
            req.flash('error', 'Exam not found');
            return res.redirect('/exam');
        }

        if (exam.rows[0].status === 'completed') {
            return res.redirect(`/exam/${examId}/result`);
        }

        const questions = await pool.query(`
            SELECT id, question_number, question_text, topic_name, difficulty, option_a, option_b, option_c, option_d
            FROM exam_questions WHERE exam_id = $1 ORDER BY question_number
        `, [examId]);

        // Set start time if not already set
        await pool.query(`
            UPDATE exam_attempts SET started_at = COALESCE(started_at, NOW()) WHERE id = $1
        `, [examId]);

        res.render('exam/take', {
            title: exam.rows[0].title + ' - SmartSched',
            page: 'exam',
            exam: exam.rows[0],
            questions: questions.rows
        });
    } catch (error) {
        console.error('Exam take error:', error);
        req.flash('error', 'Failed to load exam');
        res.redirect('/exam');
    }
});

/**
 * POST /exam/:id/submit - Submit exam answers
 */
router.post('/:id/submit', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const examId = req.params.id;
        const { answers, timeTaken } = req.body;

        const exam = await pool.query('SELECT * FROM exam_attempts WHERE id = $1 AND user_id = $2', [examId, userId]);
        if (exam.rows.length === 0) return res.status(404).json({ error: 'Exam not found' });

        // Get questions with correct answers
        const questions = await pool.query(
            'SELECT * FROM exam_questions WHERE exam_id = $1 ORDER BY question_number', [examId]
        );

        let score = 0;
        let topicBreakdown = {};
        let difficultyBreakdown = { easy: { correct: 0, total: 0 }, medium: { correct: 0, total: 0 }, hard: { correct: 0, total: 0 } };
        const results = [];

        for (const q of questions.rows) {
            const userAnswer = answers?.[q.id] || null;
            const isCorrect = userAnswer === q.correct_option;
            if (isCorrect) score++;

            const topic = q.topic_name || 'General';
            if (!topicBreakdown[topic]) topicBreakdown[topic] = { correct: 0, total: 0 };
            topicBreakdown[topic].total++;
            if (isCorrect) topicBreakdown[topic].correct++;

            const diff = q.difficulty || 'medium';
            if (difficultyBreakdown[diff]) {
                difficultyBreakdown[diff].total++;
                if (isCorrect) difficultyBreakdown[diff].correct++;
            }

            results.push({
                question_id: q.id,
                question_number: q.question_number,
                user_answer: userAnswer,
                correct_answer: q.correct_option,
                is_correct: isCorrect,
                topic: topic,
                difficulty: diff
            });
        }

        const percentage = Math.round((score / questions.rows.length) * 100);
        const timeSec = parseInt(timeTaken) || 0;

        // Update exam attempt
        await pool.query(`
            UPDATE exam_attempts 
            SET status = 'completed', score = $1, percentage = $2, 
                time_taken_seconds = $3, answers = $4,
                topic_breakdown = $5, difficulty_breakdown = $6,
                completed_at = NOW()
            WHERE id = $7
        `, [score, percentage, timeSec, JSON.stringify(results), JSON.stringify(topicBreakdown), JSON.stringify(difficultyBreakdown), examId]);

        // Award XP
        try {
            const gamificationService = require('../services/gamificationService');
            const xpAmount = Math.max(10, Math.round(percentage * 0.3 * questions.rows.length / 10));
            await gamificationService.awardXP(userId, xpAmount, 'exam', examId, `Exam: ${exam.rows[0].title} (${percentage}%)`);
        } catch (e) { /* XP is optional */ }

        res.json({ success: true, examId, score, total: questions.rows.length, percentage });
    } catch (error) {
        console.error('Exam submit error:', error);
        res.status(500).json({ error: 'Failed to submit exam' });
    }
});

/**
 * GET /exam/:id/result - View exam results
 */
router.get('/:id/result', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const examId = req.params.id;

        const exam = await pool.query(`
            SELECT ea.*, s.name as subject_name, s.color as subject_color
            FROM exam_attempts ea
            LEFT JOIN subjects s ON ea.subject_id = s.id
            WHERE ea.id = $1 AND ea.user_id = $2
        `, [examId, userId]);

        if (exam.rows.length === 0) {
            req.flash('error', 'Exam not found');
            return res.redirect('/exam');
        }

        const questions = await pool.query(
            'SELECT * FROM exam_questions WHERE exam_id = $1 ORDER BY question_number', [examId]
        );

        const answersMap = {};
        const answers = exam.rows[0].answers || [];
        if (Array.isArray(answers)) {
            answers.forEach(a => { answersMap[a.question_id] = a; });
        }

        res.render('exam/result', {
            title: 'Exam Results - SmartSched',
            page: 'exam',
            exam: exam.rows[0],
            questions: questions.rows,
            answersMap,
            topicBreakdown: exam.rows[0].topic_breakdown || {},
            difficultyBreakdown: exam.rows[0].difficulty_breakdown || {}
        });
    } catch (error) {
        console.error('Exam result error:', error);
        req.flash('error', 'Failed to load results');
        res.redirect('/exam');
    }
});

/**
 * DELETE /exam/:id - Delete an exam
 */
router.delete('/:id', async (req, res) => {
    try {
        const userId = req.session.user.id;
        await pool.query('DELETE FROM exam_attempts WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete exam' });
    }
});

module.exports = router;
