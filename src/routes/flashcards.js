/**
 * SmartSched Flashcards Routes
 * Phase 5: AI Flashcards & Practice Module
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

// ==========================================
// FLASHCARD SETS
// ==========================================

/**
 * GET /flashcards - List all flashcard sets
 */
router.get('/', async (req, res) => {
    try {
        const userId = req.session.user.id;

        // Get all flashcard sets with card counts and review stats
        const setsResult = await pool.query(`
            SELECT 
                fs.*,
                s.name as subject_name,
                s.color as subject_color,
                t.name as topic_name,
                COUNT(DISTINCT f.id) as card_count,
                COUNT(DISTINCT CASE WHEN fp.next_review <= NOW() THEN fp.id END) as due_count
            FROM flashcard_sets fs
            LEFT JOIN subjects s ON fs.subject_id = s.id
            LEFT JOIN topics t ON fs.topic_id = t.id
            LEFT JOIN flashcards f ON fs.id = f.set_id
            LEFT JOIN flashcard_progress fp ON f.id = fp.card_id AND fp.user_id = $1
            WHERE fs.user_id = $1
            GROUP BY fs.id, s.name, s.color, t.name
            ORDER BY fs.updated_at DESC
        `, [userId]);

        // Get total cards due today
        const dueResult = await pool.query(`
            SELECT COUNT(*) as due_today
            FROM flashcard_progress fp
            JOIN flashcards f ON fp.card_id = f.id
            JOIN flashcard_sets fs ON f.set_id = fs.id
            WHERE fp.user_id = $1 AND fp.next_review <= NOW()
        `, [userId]);

        // Get subjects for filter/create
        const subjectsResult = await pool.query(
            'SELECT id, name, color FROM subjects WHERE user_id = $1 ORDER BY name',
            [userId]
        );

        res.render('flashcards/index', {
            title: 'Flashcards - SmartSched',
            sets: setsResult.rows,
            dueToday: parseInt(dueResult.rows[0].due_today) || 0,
            subjects: subjectsResult.rows,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading flashcards:', error);
        res.status(500).render('errors/500', { title: 'Error', user: req.session.user });
    }
});

/**
 * GET /flashcards/daily - Daily review page
 */
router.get('/daily', async (req, res) => {
    try {
        const userId = req.session.user.id;

        // Get all cards due for review
        const cardsResult = await pool.query(`
            SELECT 
                f.*,
                fs.title as set_title,
                s.name as subject_name,
                s.color as subject_color,
                fp.ease_factor,
                fp.interval_days,
                fp.correct_count,
                fp.wrong_count
            FROM flashcard_progress fp
            JOIN flashcards f ON fp.card_id = f.id
            JOIN flashcard_sets fs ON f.set_id = fs.id
            LEFT JOIN subjects s ON fs.subject_id = s.id
            WHERE fp.user_id = $1 AND fp.next_review <= NOW()
            ORDER BY fp.next_review ASC
            LIMIT 50
        `, [userId]);

        res.render('flashcards/review', {
            title: 'Daily Review - SmartSched',
            cards: cardsResult.rows,
            mode: 'daily',
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading daily review:', error);
        res.status(500).render('errors/500', { title: 'Error', user: req.session.user });
    }
});

/**
 * GET /flashcards/create - Create flashcard set form
 */
router.get('/create', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { topic_id, from_notes } = req.query;

        // Get subjects with topics
        const subjectsResult = await pool.query(`
            SELECT s.id, s.name, s.color,
                   json_agg(json_build_object('id', t.id, 'name', t.name) ORDER BY t.name) as topics
            FROM subjects s
            LEFT JOIN topics t ON s.id = t.subject_id
            WHERE s.user_id = $1
            GROUP BY s.id
            ORDER BY s.name
        `, [userId]);

        // If coming from notes, get the note content
        let noteContent = null;
        let selectedTopic = null;
        if (from_notes && topic_id) {
            const noteResult = await pool.query(`
                SELECT sn.content, t.name as topic_name, t.id as topic_id, 
                       s.id as subject_id, s.name as subject_name
                FROM saved_notes sn
                JOIN topics t ON sn.topic_id = t.id
                JOIN subjects s ON t.subject_id = s.id
                WHERE sn.topic_id = $1 AND sn.user_id = $2
                ORDER BY sn.created_at DESC
                LIMIT 1
            `, [topic_id, userId]);
            
            if (noteResult.rows[0]) {
                noteContent = noteResult.rows[0].content;
                selectedTopic = noteResult.rows[0];
            }
        }

        res.render('flashcards/create', {
            title: 'Create Flashcards - SmartSched',
            subjects: subjectsResult.rows,
            noteContent,
            selectedTopic,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading create page:', error);
        res.status(500).render('errors/500', { title: 'Error', user: req.session.user });
    }
});

/**
 * POST /flashcards/create - Create a new flashcard set with cards
 */
router.post('/create', async (req, res) => {
    const client = await pool.connect();
    try {
        const userId = req.session.user.id;
        const { title, subject_id, topic_id, description, cards } = req.body;

        await client.query('BEGIN');

        // Create the set
        const setResult = await client.query(`
            INSERT INTO flashcard_sets (user_id, subject_id, topic_id, title, description, card_count)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
        `, [userId, subject_id || null, topic_id || null, title, description || '', cards?.length || 0]);

        const setId = setResult.rows[0].id;

        // Insert cards if provided
        if (cards && cards.length > 0) {
            for (const card of cards) {
                if (card.front && card.back) {
                    const cardResult = await client.query(`
                        INSERT INTO flashcards (set_id, front_text, back_text)
                        VALUES ($1, $2, $3)
                        RETURNING id
                    `, [setId, card.front, card.back]);

                    // Create progress entry for spaced repetition
                    await client.query(`
                        INSERT INTO flashcard_progress (card_id, user_id, next_review)
                        VALUES ($1, $2, NOW())
                    `, [cardResult.rows[0].id, userId]);
                }
            }
        }

        await client.query('COMMIT');

        res.json({ success: true, setId });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating flashcard set:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
});

/**
 * POST /flashcards/generate - AI generate flashcards
 */
router.post('/generate', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { topic_id, topic_name, notes_content, card_count = 10 } = req.body;

        if (!aiService.isConfigured()) {
            return res.status(503).json({ 
                success: false, 
                error: 'AI service is not available' 
            });
        }

        // Generate flashcards using AI
        const flashcards = await aiService.generateFlashcards(
            topic_name,
            notes_content,
            parseInt(card_count)
        );

        res.json({ success: true, flashcards });
    } catch (error) {
        console.error('Error generating flashcards:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /flashcards/:setId - View/study a specific set
 */
router.get('/:setId', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { setId } = req.params;
        const { mode } = req.query; // 'study' or 'view'

        // Get set details
        const setResult = await pool.query(`
            SELECT fs.*, s.name as subject_name, s.color as subject_color, t.name as topic_name
            FROM flashcard_sets fs
            LEFT JOIN subjects s ON fs.subject_id = s.id
            LEFT JOIN topics t ON fs.topic_id = t.id
            WHERE fs.id = $1 AND fs.user_id = $2
        `, [setId, userId]);

        if (setResult.rows.length === 0) {
            return res.status(404).render('errors/404', { title: 'Not Found', user: req.session.user });
        }

        // Get cards with progress
        const cardsResult = await pool.query(`
            SELECT f.*, 
                   fp.ease_factor, fp.interval_days, fp.correct_count, fp.wrong_count,
                   fp.next_review, fp.last_reviewed
            FROM flashcards f
            LEFT JOIN flashcard_progress fp ON f.id = fp.card_id AND fp.user_id = $2
            WHERE f.set_id = $1
            ORDER BY f.created_at ASC
        `, [setId, userId]);

        // Count due cards
        const dueCount = cardsResult.rows.filter(c => 
            !c.next_review || new Date(c.next_review) <= new Date()
        ).length;

        if (mode === 'study') {
            res.render('flashcards/review', {
                title: `Study: ${setResult.rows[0].title} - SmartSched`,
                set: setResult.rows[0],
                cards: cardsResult.rows,
                mode: 'set',
                user: req.session.user
            });
        } else {
            res.render('flashcards/set', {
                title: `${setResult.rows[0].title} - SmartSched`,
                set: setResult.rows[0],
                cards: cardsResult.rows,
                dueCount,
                user: req.session.user
            });
        }
    } catch (error) {
        console.error('Error loading flashcard set:', error);
        res.status(500).render('errors/500', { title: 'Error', user: req.session.user });
    }
});

/**
 * POST /flashcards/review - Submit review result (spaced repetition)
 */
router.post('/review', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { card_id, rating } = req.body;

        // Rating: 1 = Again, 2 = Hard, 3 = Good, 4 = Easy
        const ratingNum = parseInt(rating);

        // Get current progress
        const progressResult = await pool.query(`
            SELECT * FROM flashcard_progress
            WHERE card_id = $1 AND user_id = $2
        `, [card_id, userId]);

        let easeFactor, intervalDays, correctCount, wrongCount;

        if (progressResult.rows.length === 0) {
            // First review - create progress entry
            easeFactor = 2.5;
            intervalDays = 1;
            correctCount = ratingNum >= 3 ? 1 : 0;
            wrongCount = ratingNum < 3 ? 1 : 0;
        } else {
            const current = progressResult.rows[0];
            easeFactor = parseFloat(current.ease_factor);
            intervalDays = current.interval_days;
            correctCount = current.correct_count;
            wrongCount = current.wrong_count;
        }

        // SM-2 Algorithm implementation
        if (ratingNum < 3) {
            // Wrong answer - reset interval
            intervalDays = 1;
            wrongCount++;
            easeFactor = Math.max(1.3, easeFactor - 0.2);
        } else {
            // Correct answer - increase interval
            correctCount++;
            if (ratingNum === 3) {
                // Good - standard increase
                intervalDays = Math.round(intervalDays * easeFactor);
            } else if (ratingNum === 4) {
                // Easy - bigger increase
                intervalDays = Math.round(intervalDays * easeFactor * 1.3);
                easeFactor = Math.min(2.5, easeFactor + 0.1);
            } else if (ratingNum === 2) {
                // Hard - smaller increase
                intervalDays = Math.round(intervalDays * 1.2);
                easeFactor = Math.max(1.3, easeFactor - 0.15);
            }
        }

        // Calculate next review date
        const nextReview = new Date();
        nextReview.setDate(nextReview.getDate() + intervalDays);

        // Update or insert progress
        await pool.query(`
            INSERT INTO flashcard_progress (card_id, user_id, last_reviewed, next_review, ease_factor, interval_days, correct_count, wrong_count)
            VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7)
            ON CONFLICT (card_id, user_id) 
            DO UPDATE SET 
                last_reviewed = NOW(),
                next_review = $3,
                ease_factor = $4,
                interval_days = $5,
                correct_count = $6,
                wrong_count = $7,
                repetitions = flashcard_progress.repetitions + 1
        `, [card_id, userId, nextReview, easeFactor, intervalDays, correctCount, wrongCount]);

        res.json({ 
            success: true, 
            nextReview: nextReview.toISOString(),
            intervalDays,
            easeFactor
        });
    } catch (error) {
        console.error('Error submitting review:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /flashcards/:setId/add-card - Add a single card to a set
 */
router.post('/:setId/add-card', async (req, res) => {
    const client = await pool.connect();
    try {
        const userId = req.session.user.id;
        const { setId } = req.params;
        const { front, back } = req.body;

        // Verify ownership
        const setResult = await client.query(
            'SELECT id FROM flashcard_sets WHERE id = $1 AND user_id = $2',
            [setId, userId]
        );

        if (setResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Set not found' });
        }

        await client.query('BEGIN');

        // Add card
        const cardResult = await client.query(`
            INSERT INTO flashcards (set_id, front_text, back_text)
            VALUES ($1, $2, $3)
            RETURNING *
        `, [setId, front, back]);

        // Create progress entry
        await client.query(`
            INSERT INTO flashcard_progress (card_id, user_id, next_review)
            VALUES ($1, $2, NOW())
        `, [cardResult.rows[0].id, userId]);

        // Update card count
        await client.query(`
            UPDATE flashcard_sets SET card_count = card_count + 1, updated_at = NOW()
            WHERE id = $1
        `, [setId]);

        await client.query('COMMIT');

        res.json({ success: true, card: cardResult.rows[0] });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error adding card:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
});

/**
 * DELETE /flashcards/card/:cardId - Delete a single card
 */
router.delete('/card/:cardId', async (req, res) => {
    const client = await pool.connect();
    try {
        const userId = req.session.user.id;
        const { cardId } = req.params;

        // Verify ownership through set
        const cardResult = await client.query(`
            SELECT f.set_id FROM flashcards f
            JOIN flashcard_sets fs ON f.set_id = fs.id
            WHERE f.id = $1 AND fs.user_id = $2
        `, [cardId, userId]);

        if (cardResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Card not found' });
        }

        const setId = cardResult.rows[0].set_id;

        await client.query('BEGIN');

        await client.query('DELETE FROM flashcards WHERE id = $1', [cardId]);

        // Update card count
        await client.query(`
            UPDATE flashcard_sets SET card_count = card_count - 1, updated_at = NOW()
            WHERE id = $1
        `, [setId]);

        await client.query('COMMIT');

        res.json({ success: true });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error deleting card:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
});

/**
 * DELETE /flashcards/:setId - Delete entire set
 */
router.delete('/:setId', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { setId } = req.params;

        const result = await pool.query(
            'DELETE FROM flashcard_sets WHERE id = $1 AND user_id = $2 RETURNING id',
            [setId, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Set not found' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting set:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /flashcards/api/stats - Get flashcard statistics
 */
router.get('/api/stats', async (req, res) => {
    try {
        const userId = req.session.user.id;

        const stats = await pool.query(`
            SELECT 
                COUNT(DISTINCT fs.id) as total_sets,
                COUNT(DISTINCT f.id) as total_cards,
                COUNT(DISTINCT CASE WHEN fp.next_review <= NOW() THEN f.id END) as due_today,
                COALESCE(SUM(fp.correct_count), 0) as total_correct,
                COALESCE(SUM(fp.wrong_count), 0) as total_wrong
            FROM flashcard_sets fs
            LEFT JOIN flashcards f ON fs.id = f.set_id
            LEFT JOIN flashcard_progress fp ON f.id = fp.card_id AND fp.user_id = $1
            WHERE fs.user_id = $1
        `, [userId]);

        const row = stats.rows[0];
        const totalReviews = parseInt(row.total_correct) + parseInt(row.total_wrong);
        const accuracy = totalReviews > 0 
            ? Math.round((parseInt(row.total_correct) / totalReviews) * 100) 
            : 0;

        res.json({
            success: true,
            stats: {
                totalSets: parseInt(row.total_sets) || 0,
                totalCards: parseInt(row.total_cards) || 0,
                dueToday: parseInt(row.due_today) || 0,
                accuracy,
                totalReviews
            }
        });
    } catch (error) {
        console.error('Error getting stats:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
