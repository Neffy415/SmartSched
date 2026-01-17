/**
 * SmartSched AI Routes
 * Phase 4: AI-Powered Study Assistant
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const aiService = require('../services/aiService');
const rateLimit = require('express-rate-limit');

// Rate limiting for AI endpoints (prevent abuse)
const aiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 requests per minute
    message: { error: 'Too many AI requests. Please wait a moment before trying again.' }
});

// Middleware to check authentication
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(401).json({ error: 'Please log in to use AI features' });
        }
        return res.redirect('/auth/login');
    }
    next();
};

router.use(requireAuth);

// ==========================================
// GET /ai/assistant - AI Assistant Dashboard
// ==========================================
router.get('/assistant', async (req, res) => {
    try {
        // Get user's subjects with topics
        const subjectsResult = await pool.query(`
            SELECT s.id, s.name, s.color,
                   json_agg(
                       json_build_object('id', t.id, 'name', t.name, 'difficulty', t.difficulty)
                       ORDER BY t.name
                   ) FILTER (WHERE t.id IS NOT NULL) as topics
            FROM subjects s
            LEFT JOIN topics t ON t.subject_id = s.id
            WHERE s.user_id = $1 AND s.is_archived = false
            GROUP BY s.id
            ORDER BY s.name
        `, [req.session.user.id]);

        // Get recent AI interactions
        const recentResult = await pool.query(`
            SELECT ai.*, t.name as topic_name, s.name as subject_name, s.color as subject_color
            FROM ai_interactions ai
            LEFT JOIN topics t ON ai.topic_id = t.id
            LEFT JOIN subjects s ON ai.subject_id = s.id
            WHERE ai.user_id = $1
            ORDER BY ai.created_at DESC
            LIMIT 5
        `, [req.session.user.id]);

        // Get AI usage stats
        const statsResult = await pool.query(`
            SELECT 
                COUNT(*) as total_interactions,
                COUNT(CASE WHEN interaction_type = 'explanation' THEN 1 END) as explanations,
                COUNT(CASE WHEN interaction_type = 'notes' THEN 1 END) as notes,
                COUNT(CASE WHEN interaction_type = 'questions' THEN 1 END) as questions,
                COUNT(CASE WHEN is_bookmarked = true THEN 1 END) as bookmarked
            FROM ai_interactions
            WHERE user_id = $1
        `, [req.session.user.id]);

        res.render('ai/assistant', {
            title: 'AI Study Assistant - SmartSched',
            page: 'ai-assistant',
            subjects: subjectsResult.rows,
            recentInteractions: recentResult.rows,
            stats: statsResult.rows[0],
            aiAvailable: aiService.isAvailable(),
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading AI assistant:', error);
        req.flash('error_msg', 'Failed to load AI assistant');
        res.redirect('/dashboard');
    }
});

// ==========================================
// POST /ai/explain - Generate Topic Explanation
// ==========================================
router.post('/explain', aiLimiter, async (req, res) => {
    try {
        const { topic_id, topic_name, subject_name, additional_context } = req.body;

        if (!aiService.isAvailable()) {
            return res.status(503).json({ 
                error: 'AI service is currently unavailable. Please try again later.' 
            });
        }

        // Get topic info if topic_id provided
        let topicInfo = { name: topic_name, subject_name };
        let subjectId = null;
        
        if (topic_id) {
            const topicResult = await pool.query(`
                SELECT t.*, s.name as subject_name, s.id as subject_id
                FROM topics t
                JOIN subjects s ON t.subject_id = s.id
                WHERE t.id = $1 AND s.user_id = $2
            `, [topic_id, req.session.user.id]);
            
            if (topicResult.rows.length > 0) {
                topicInfo = topicResult.rows[0];
                subjectId = topicInfo.subject_id;
            }
        }

        // Generate explanation
        const startTime = Date.now();
        const explanation = await aiService.generateExplanation(
            topicInfo.name || topic_name,
            {
                subjectName: topicInfo.subject_name || subject_name,
                difficulty: topicInfo.difficulty,
                additionalContext: additional_context
            }
        );
        const responseTime = Date.now() - startTime;

        // Save interaction
        await pool.query(`
            INSERT INTO ai_interactions 
            (user_id, topic_id, subject_id, interaction_type, prompt, response)
            VALUES ($1, $2, $3, 'explanation', $4, $5)
        `, [
            req.session.user.id,
            topic_id || null,
            subjectId,
            `Explain: ${topicInfo.name || topic_name}`,
            JSON.stringify(explanation)
        ]);

        res.json({
            success: true,
            data: explanation,
            responseTime
        });
    } catch (error) {
        console.error('Error generating explanation:', error);
        res.status(500).json({ 
            error: 'Failed to generate explanation. Please try again.',
            details: error.message 
        });
    }
});

// ==========================================
// POST /ai/notes - Generate Study Notes
// ==========================================
router.post('/notes', aiLimiter, async (req, res) => {
    try {
        const { topic_id, topic_name, subject_name, material_text, focus_areas } = req.body;

        if (!aiService.isAvailable()) {
            return res.status(503).json({ 
                error: 'AI service is currently unavailable.' 
            });
        }

        // Get topic info
        let topicInfo = { name: topic_name, subject_name };
        let subjectId = null;
        
        if (topic_id) {
            const topicResult = await pool.query(`
                SELECT t.*, s.name as subject_name, s.id as subject_id
                FROM topics t
                JOIN subjects s ON t.subject_id = s.id
                WHERE t.id = $1 AND s.user_id = $2
            `, [topic_id, req.session.user.id]);
            
            if (topicResult.rows.length > 0) {
                topicInfo = topicResult.rows[0];
                subjectId = topicInfo.subject_id;
            }
        }

        // Generate notes
        const startTime = Date.now();
        const notes = await aiService.generateNotes(
            topicInfo.name || topic_name,
            {
                subjectName: topicInfo.subject_name || subject_name,
                materialText: material_text,
                focusAreas: focus_areas
            }
        );
        const responseTime = Date.now() - startTime;

        // Save interaction
        await pool.query(`
            INSERT INTO ai_interactions 
            (user_id, topic_id, subject_id, interaction_type, prompt, response)
            VALUES ($1, $2, $3, 'notes', $4, $5)
        `, [
            req.session.user.id,
            topic_id || null,
            subjectId,
            `Notes for: ${topicInfo.name || topic_name}`,
            JSON.stringify(notes)
        ]);

        // Also save to ai_generated_content for easy retrieval
        await pool.query(`
            INSERT INTO ai_generated_content 
            (user_id, topic_id, content_type, title, content)
            VALUES ($1, $2, 'notes', $3, $4)
        `, [
            req.session.user.id,
            topic_id || null,
            `Notes: ${topicInfo.name || topic_name}`,
            JSON.stringify(notes)
        ]);

        res.json({
            success: true,
            data: notes,
            responseTime
        });
    } catch (error) {
        console.error('Error generating notes:', error);
        res.status(500).json({ 
            error: 'Failed to generate notes. Please try again.' 
        });
    }
});

// ==========================================
// POST /ai/questions - Generate Practice Questions
// ==========================================
router.post('/questions', aiLimiter, async (req, res) => {
    try {
        const { topic_id, topic_name, subject_name, difficulty, question_type, count } = req.body;

        if (!aiService.isAvailable()) {
            return res.status(503).json({ 
                error: 'AI service is currently unavailable.' 
            });
        }

        // Get topic info
        let topicInfo = { name: topic_name, subject_name, difficulty };
        let subjectId = null;
        
        if (topic_id) {
            const topicResult = await pool.query(`
                SELECT t.*, s.name as subject_name, s.id as subject_id
                FROM topics t
                JOIN subjects s ON t.subject_id = s.id
                WHERE t.id = $1 AND s.user_id = $2
            `, [topic_id, req.session.user.id]);
            
            if (topicResult.rows.length > 0) {
                topicInfo = topicResult.rows[0];
                subjectId = topicInfo.subject_id;
            }
        }

        // Generate questions
        const startTime = Date.now();
        const questions = await aiService.generateQuestions(
            topicInfo.name || topic_name,
            {
                subjectName: topicInfo.subject_name || subject_name,
                difficulty: difficulty || topicInfo.difficulty,
                questionType: question_type,
                count: parseInt(count) || 5
            }
        );
        const responseTime = Date.now() - startTime;

        // Save interaction
        await pool.query(`
            INSERT INTO ai_interactions 
            (user_id, topic_id, subject_id, interaction_type, prompt, response)
            VALUES ($1, $2, $3, 'questions', $4, $5)
        `, [
            req.session.user.id,
            topic_id || null,
            subjectId,
            `Questions for: ${topicInfo.name || topic_name}`,
            JSON.stringify(questions)
        ]);

        // Save to ai_generated_content
        await pool.query(`
            INSERT INTO ai_generated_content 
            (user_id, topic_id, content_type, title, content)
            VALUES ($1, $2, 'questions', $3, $4)
        `, [
            req.session.user.id,
            topic_id || null,
            `Practice: ${topicInfo.name || topic_name}`,
            JSON.stringify(questions)
        ]);

        res.json({
            success: true,
            data: questions,
            responseTime
        });
    } catch (error) {
        console.error('Error generating questions:', error);
        res.status(500).json({ 
            error: 'Failed to generate questions. Please try again.' 
        });
    }
});

// ==========================================
// POST /ai/ask - Ask a Question (Chat)
// ==========================================
router.post('/ask', aiLimiter, async (req, res) => {
    try {
        const { question, topic_id, topic_name, subject_name } = req.body;

        if (!question || question.trim().length < 5) {
            return res.status(400).json({ error: 'Please provide a valid question.' });
        }

        if (!aiService.isAvailable()) {
            return res.status(503).json({ 
                error: 'AI service is currently unavailable.' 
            });
        }

        // Get topic info if provided
        let topicInfo = { name: topic_name, subject_name };
        
        if (topic_id) {
            const topicResult = await pool.query(`
                SELECT t.*, s.name as subject_name
                FROM topics t
                JOIN subjects s ON t.subject_id = s.id
                WHERE t.id = $1 AND s.user_id = $2
            `, [topic_id, req.session.user.id]);
            
            if (topicResult.rows.length > 0) {
                topicInfo = topicResult.rows[0];
            }
        }

        // Get answer
        const startTime = Date.now();
        const answer = await aiService.answerQuestion(question, {
            topicName: topicInfo.name,
            subjectName: topicInfo.subject_name
        });
        const responseTime = Date.now() - startTime;

        // Save interaction
        await pool.query(`
            INSERT INTO ai_interactions 
            (user_id, topic_id, interaction_type, prompt, response)
            VALUES ($1, $2, 'answer', $3, $4)
        `, [
            req.session.user.id,
            topic_id || null,
            question,
            JSON.stringify(answer)
        ]);

        res.json({
            success: true,
            data: answer,
            responseTime
        });
    } catch (error) {
        console.error('Error answering question:', error);
        res.status(500).json({ 
            error: 'Failed to get answer. Please try again.' 
        });
    }
});

// ==========================================
// GET /ai/history - AI Interaction History
// ==========================================
router.get('/history', async (req, res) => {
    try {
        const { type, subject, bookmarked, page = 1 } = req.query;
        const limit = 20;
        const offset = (page - 1) * limit;

        let whereClause = 'WHERE ai.user_id = $1';
        const params = [req.session.user.id];
        let paramIndex = 2;

        if (type) {
            whereClause += ` AND ai.interaction_type = $${paramIndex}`;
            params.push(type);
            paramIndex++;
        }

        if (subject) {
            whereClause += ` AND ai.subject_id = $${paramIndex}`;
            params.push(subject);
            paramIndex++;
        }

        if (bookmarked === 'true') {
            whereClause += ' AND ai.is_bookmarked = true';
        }

        // Get interactions
        const result = await pool.query(`
            SELECT ai.*, 
                   t.name as topic_name,
                   s.name as subject_name,
                   s.color as subject_color
            FROM ai_interactions ai
            LEFT JOIN topics t ON ai.topic_id = t.id
            LEFT JOIN subjects s ON ai.subject_id = s.id
            ${whereClause}
            ORDER BY ai.created_at DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `, [...params, limit, offset]);

        // Get total count
        const countResult = await pool.query(`
            SELECT COUNT(*) as total
            FROM ai_interactions ai
            ${whereClause}
        `, params);

        // Get filter options - subjects for dropdown
        const subjectsResult = await pool.query(`
            SELECT id, name FROM subjects
            WHERE user_id = $1 AND is_archived = false
            ORDER BY name
        `, [req.session.user.id]);

        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.json({
                interactions: result.rows,
                total: parseInt(countResult.rows[0].total),
                page: parseInt(page),
                totalPages: Math.ceil(countResult.rows[0].total / limit)
            });
        }

        res.render('ai/history', {
            title: 'AI History - SmartSched',
            page: 'ai-history',
            interactions: result.rows,
            total: parseInt(countResult.rows[0].total),
            currentPage: parseInt(page),
            totalPages: Math.ceil(countResult.rows[0].total / limit),
            filters: { type, subject: req.query.subject, bookmarked },
            subjects: subjectsResult.rows,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading AI history:', error);
        req.flash('error_msg', 'Failed to load AI history');
        res.redirect('/ai/assistant');
    }
});

// ==========================================
// POST /ai/bookmark/:id - Toggle Bookmark
// ==========================================
router.post('/bookmark/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            UPDATE ai_interactions 
            SET is_bookmarked = NOT is_bookmarked
            WHERE id = $1 AND user_id = $2
            RETURNING is_bookmarked
        `, [req.params.id, req.session.user.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Interaction not found' });
        }

        res.json({
            success: true,
            bookmarked: result.rows[0].is_bookmarked
        });
    } catch (error) {
        console.error('Error toggling bookmark:', error);
        res.status(500).json({ error: 'Failed to update bookmark' });
    }
});

// ==========================================
// POST /ai/rate/:id - Rate AI Response
// ==========================================
router.post('/rate/:id', async (req, res) => {
    try {
        const { rating } = req.body;
        
        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ error: 'Rating must be between 1 and 5' });
        }

        await pool.query(`
            UPDATE ai_interactions 
            SET rating = $1
            WHERE id = $2 AND user_id = $3
        `, [rating, req.params.id, req.session.user.id]);

        res.json({ success: true });
    } catch (error) {
        console.error('Error rating interaction:', error);
        res.status(500).json({ error: 'Failed to save rating' });
    }
});

// ==========================================
// GET /ai/interaction/:id - Get Single Interaction
// ==========================================
router.get('/interaction/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT ai.*, 
                   t.name as topic_name,
                   s.name as subject_name,
                   s.color as subject_color
            FROM ai_interactions ai
            LEFT JOIN topics t ON ai.topic_id = t.id
            LEFT JOIN subjects s ON ai.subject_id = s.id
            WHERE ai.id = $1 AND ai.user_id = $2
        `, [req.params.id, req.session.user.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Interaction not found' });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        console.error('Error getting interaction:', error);
        res.status(500).json({ error: 'Failed to get interaction' });
    }
});

// ==========================================
// DELETE /ai/interaction/:id - Delete Interaction
// ==========================================
router.delete('/interaction/:id', async (req, res) => {
    try {
        await pool.query(`
            DELETE FROM ai_interactions 
            WHERE id = $1 AND user_id = $2
        `, [req.params.id, req.session.user.id]);

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting interaction:', error);
        res.status(500).json({ error: 'Failed to delete interaction' });
    }
});

// ==========================================
// POST /ai/estimate-topic - Estimate Topic Complexity
// ==========================================
router.post('/estimate-topic', aiLimiter, async (req, res) => {
    try {
        const { topic_name, subject_name, description } = req.body;

        if (!aiService.isAvailable()) {
            return res.status(503).json({ 
                error: 'AI service is currently unavailable.' 
            });
        }

        const estimation = await aiService.estimateTopicComplexity(topic_name, {
            subjectName: subject_name,
            description
        });

        res.json({
            success: true,
            data: estimation
        });
    } catch (error) {
        console.error('Error estimating topic:', error);
        res.status(500).json({ 
            error: 'Failed to estimate topic complexity.' 
        });
    }
});

// ==========================================
// POST /ai/study-plan - Generate Study Plan
// ==========================================
router.post('/study-plan', aiLimiter, async (req, res) => {
    try {
        const { subject_id, exam_date, daily_hours } = req.body;

        if (!aiService.isAvailable()) {
            return res.status(503).json({ 
                error: 'AI service is currently unavailable.' 
            });
        }

        // Get topics for the subject
        const topicsResult = await pool.query(`
            SELECT t.name, t.difficulty, t.estimated_hours, t.importance
            FROM topics t
            JOIN subjects s ON t.subject_id = s.id
            WHERE s.id = $1 AND s.user_id = $2 AND t.is_completed = false
            ORDER BY t.importance DESC
        `, [subject_id, req.session.user.id]);

        if (topicsResult.rows.length === 0) {
            return res.status(400).json({ 
                error: 'No topics found for this subject.' 
            });
        }

        const plan = await aiService.generateStudyPlan(topicsResult.rows, {
            examDate: exam_date,
            dailyHours: daily_hours || req.session.user.daily_study_hours
        });

        // Save interaction
        await pool.query(`
            INSERT INTO ai_interactions 
            (user_id, subject_id, interaction_type, prompt, response)
            VALUES ($1, $2, 'study_plan', $3, $4)
        `, [
            req.session.user.id,
            subject_id,
            `Study plan for ${topicsResult.rows.length} topics`,
            JSON.stringify(plan)
        ]);

        res.json({
            success: true,
            data: plan
        });
    } catch (error) {
        console.error('Error generating study plan:', error);
        res.status(500).json({ 
            error: 'Failed to generate study plan.' 
        });
    }
});

module.exports = router;
