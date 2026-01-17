const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../config/database');

// Middleware: Check if user is authenticated
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        req.flash('error', 'Please login to access this page');
        return res.redirect('/auth/login');
    }
    next();
};

router.use(requireAuth);

// GET /settings - Settings page
router.get('/', async (req, res) => {
    try {
        const userId = req.session.user.id;
        
        // Get user preferences (you can add a preferences table later)
        const preferences = {
            dailyGoal: 4,
            sessionDuration: 60,
            breakDuration: 10
        };

        res.render('settings/index', {
            title: 'Settings - SmartSched',
            page: 'settings',
            preferences
        });
    } catch (error) {
        console.error('Settings error:', error);
        req.flash('error', 'Failed to load settings');
        res.redirect('/dashboard');
    }
});

// POST /settings/profile - Update profile
router.post('/profile', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { fullName, email } = req.body;

        // Check if email is already in use by another user
        const existingUser = await db.query(
            'SELECT id FROM users WHERE email = $1 AND id != $2',
            [email, userId]
        );

        if (existingUser.rows.length > 0) {
            req.flash('error', 'Email is already in use');
            return res.redirect('/settings');
        }

        // Update user
        await db.query(
            'UPDATE users SET full_name = $1, email = $2 WHERE id = $3',
            [fullName, email, userId]
        );

        // Update session
        req.session.user.fullName = fullName;
        req.session.user.email = email;

        req.flash('success', 'Profile updated successfully');
        res.redirect('/settings');
    } catch (error) {
        console.error('Update profile error:', error);
        req.flash('error', 'Failed to update profile');
        res.redirect('/settings');
    }
});

// POST /settings/password - Change password
router.post('/password', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { currentPassword, newPassword, confirmPassword } = req.body;

        // Validate passwords match
        if (newPassword !== confirmPassword) {
            req.flash('error', 'New passwords do not match');
            return res.redirect('/settings');
        }

        // Validate password length
        if (newPassword.length < 6) {
            req.flash('error', 'Password must be at least 6 characters');
            return res.redirect('/settings');
        }

        // Get current user
        const userResult = await db.query(
            'SELECT password FROM users WHERE id = $1',
            [userId]
        );

        if (userResult.rows.length === 0) {
            req.flash('error', 'User not found');
            return res.redirect('/settings');
        }

        // Verify current password
        const validPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password);
        if (!validPassword) {
            req.flash('error', 'Current password is incorrect');
            return res.redirect('/settings');
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 12);

        // Update password
        await db.query(
            'UPDATE users SET password = $1 WHERE id = $2',
            [hashedPassword, userId]
        );

        req.flash('success', 'Password changed successfully');
        res.redirect('/settings');
    } catch (error) {
        console.error('Change password error:', error);
        req.flash('error', 'Failed to change password');
        res.redirect('/settings');
    }
});

// POST /settings/preferences - Update preferences
router.post('/preferences', async (req, res) => {
    try {
        // For now, just flash success (can add preferences table later)
        req.flash('success', 'Preferences saved successfully');
        res.redirect('/settings');
    } catch (error) {
        console.error('Update preferences error:', error);
        req.flash('error', 'Failed to save preferences');
        res.redirect('/settings');
    }
});

// POST /settings/clear-data - Clear all user data
router.post('/clear-data', async (req, res) => {
    try {
        const userId = req.session.user.id;

        // Delete all user data in order (respecting foreign keys)
        await db.query('DELETE FROM study_sessions WHERE user_id = $1', [userId]);
        await db.query('DELETE FROM progress_logs WHERE user_id = $1', [userId]);
        await db.query('DELETE FROM daily_stats WHERE user_id = $1', [userId]);
        await db.query('DELETE FROM weekly_analytics WHERE user_id = $1', [userId]);
        await db.query('DELETE FROM notifications WHERE user_id = $1', [userId]);
        await db.query('DELETE FROM tasks WHERE user_id = $1', [userId]);
        await db.query('DELETE FROM topics WHERE subject_id IN (SELECT id FROM subjects WHERE user_id = $1)', [userId]);
        await db.query('DELETE FROM subjects WHERE user_id = $1', [userId]);

        req.flash('success', 'All data has been cleared');
        res.redirect('/settings');
    } catch (error) {
        console.error('Clear data error:', error);
        req.flash('error', 'Failed to clear data');
        res.redirect('/settings');
    }
});

// POST /settings/delete-account - Delete user account
router.post('/delete-account', async (req, res) => {
    try {
        const userId = req.session.user.id;

        // Delete all user data first
        await db.query('DELETE FROM study_sessions WHERE user_id = $1', [userId]);
        await db.query('DELETE FROM progress_logs WHERE user_id = $1', [userId]);
        await db.query('DELETE FROM daily_stats WHERE user_id = $1', [userId]);
        await db.query('DELETE FROM weekly_analytics WHERE user_id = $1', [userId]);
        await db.query('DELETE FROM notifications WHERE user_id = $1', [userId]);
        await db.query('DELETE FROM tasks WHERE user_id = $1', [userId]);
        await db.query('DELETE FROM topics WHERE subject_id IN (SELECT id FROM subjects WHERE user_id = $1)', [userId]);
        await db.query('DELETE FROM subjects WHERE user_id = $1', [userId]);
        
        // Delete user
        await db.query('DELETE FROM users WHERE id = $1', [userId]);

        // Destroy session
        req.session.destroy((err) => {
            res.redirect('/');
        });
    } catch (error) {
        console.error('Delete account error:', error);
        req.flash('error', 'Failed to delete account');
        res.redirect('/settings');
    }
});

module.exports = router;
