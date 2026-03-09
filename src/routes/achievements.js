const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { getUserXP } = require('../services/gamificationService');

// Auth middleware
function requireAuth(req, res, next) {
    if (!req.session.user) return res.redirect('/auth/login');
    next();
}

// GET /achievements - Main achievements page
router.get('/', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;

        const [xpInfo, achievementsR, unlockedR, recentXPR] = await Promise.all([
            getUserXP(userId),
            pool.query('SELECT * FROM achievements ORDER BY sort_order'),
            pool.query('SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = $1', [userId]),
            pool.query('SELECT * FROM xp_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20', [userId]),
        ]);

        const unlockedMap = {};
        unlockedR.rows.forEach(r => { unlockedMap[r.achievement_id] = r.unlocked_at; });

        // Group achievements by category
        const categories = {};
        achievementsR.rows.forEach(ach => {
            if (!categories[ach.category]) categories[ach.category] = [];
            categories[ach.category].push({
                ...ach,
                unlocked: !!unlockedMap[ach.id],
                unlocked_at: unlockedMap[ach.id] || null
            });
        });

        const totalAchievements = achievementsR.rows.length;
        const unlockedCount = unlockedR.rows.length;

        res.render('achievements/index', {
            title: 'Achievements & XP - SmartSched',
            page: 'achievements',
            xpInfo,
            categories,
            totalAchievements,
            unlockedCount,
            recentXP: recentXPR.rows,
        });
    } catch (error) {
        console.error('Error loading achievements:', error);
        req.flash('error', 'Failed to load achievements');
        res.redirect('/dashboard');
    }
});

// GET /achievements/leaderboard - Group leaderboards
router.get('/leaderboard', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;

        // Get all groups user is a member of
        const groupsR = await pool.query(`
            SELECT sg.id, sg.name FROM study_groups sg
            JOIN group_members gm ON sg.id = gm.group_id
            WHERE gm.user_id = $1
            ORDER BY sg.name
        `, [userId]);

        const leaderboards = [];
        for (const group of groupsR.rows) {
            const membersR = await pool.query(`
                SELECT u.id, u.full_name,
                       COALESCE((SELECT SUM(amount) FROM xp_log WHERE user_id = u.id), 0) as total_xp,
                       (SELECT COUNT(*) FROM user_achievements WHERE user_id = u.id) as badge_count
                FROM group_members gm
                JOIN users u ON gm.user_id = u.id
                WHERE gm.group_id = $1
                ORDER BY total_xp DESC
            `, [group.id]);
            leaderboards.push({
                group,
                members: membersR.rows.map((m, i) => ({ ...m, rank: i + 1, isYou: m.id === userId }))
            });
        }

        const xpInfo = await getUserXP(userId);

        res.render('achievements/leaderboard', {
            title: 'Leaderboard - SmartSched',
            page: 'achievements',
            xpInfo,
            leaderboards,
        });
    } catch (error) {
        console.error('Error loading leaderboard:', error);
        req.flash('error', 'Failed to load leaderboard');
        res.redirect('/achievements');
    }
});

module.exports = router;
