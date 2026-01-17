const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');

// Validation rules
const registerValidation = [
    body('fullName')
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Name must be 2-100 characters'),
    body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Please enter a valid email'),
    body('password')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters')
        .matches(/\d/)
        .withMessage('Password must contain a number'),
    body('confirmPassword')
        .custom((value, { req }) => {
            if (value !== req.body.password) {
                throw new Error('Passwords do not match');
            }
            return true;
        })
];

const loginValidation = [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty()
];

// GET: Login page
router.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.render('auth/login', { 
        title: 'Login - SmartSched',
        errors: []
    });
});

// GET: Register page
router.get('/register', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.render('auth/register', { 
        title: 'Register - SmartSched',
        errors: [],
        oldInput: {}
    });
});

// POST: Register
router.post('/register', registerValidation, async (req, res) => {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
        return res.render('auth/register', {
            title: 'Register - SmartSched',
            errors: errors.array(),
            oldInput: req.body
        });
    }

    const { fullName, email, password } = req.body;

    try {
        // Check if user exists
        const existingUser = await db.query(
            'SELECT id FROM users WHERE email = $1',
            [email]
        );

        if (existingUser.rows.length > 0) {
            return res.render('auth/register', {
                title: 'Register - SmartSched',
                errors: [{ msg: 'Email is already registered' }],
                oldInput: req.body
            });
        }

        // Hash password
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Create user
        const result = await db.query(
            `INSERT INTO users (full_name, email, password_hash) 
             VALUES ($1, $2, $3) 
             RETURNING id, email, full_name, created_at`,
            [fullName, email, passwordHash]
        );

        const newUser = result.rows[0];

        // Auto-login after registration
        req.session.user = {
            id: newUser.id,
            email: newUser.email,
            fullName: newUser.full_name
        };

        req.flash('success', 'Welcome to SmartSched! Your account has been created.');
        res.redirect('/dashboard');

    } catch (error) {
        console.error('Registration error:', error);
        res.render('auth/register', {
            title: 'Register - SmartSched',
            errors: [{ msg: 'An error occurred. Please try again.' }],
            oldInput: req.body
        });
    }
});

// POST: Login
router.post('/login', loginValidation, async (req, res) => {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
        return res.render('auth/login', {
            title: 'Login - SmartSched',
            errors: [{ msg: 'Please enter valid credentials' }]
        });
    }

    const { email, password } = req.body;

    try {
        // Find user
        const result = await db.query(
            'SELECT * FROM users WHERE email = $1 AND is_active = true',
            [email]
        );

        if (result.rows.length === 0) {
            return res.render('auth/login', {
                title: 'Login - SmartSched',
                errors: [{ msg: 'Invalid email or password' }]
            });
        }

        const user = result.rows[0];

        // Verify password
        const isValid = await bcrypt.compare(password, user.password_hash);

        if (!isValid) {
            return res.render('auth/login', {
                title: 'Login - SmartSched',
                errors: [{ msg: 'Invalid email or password' }]
            });
        }

        // Create session
        req.session.user = {
            id: user.id,
            email: user.email,
            fullName: user.full_name,
            avatarUrl: user.avatar_url
        };

        req.flash('success', `Welcome back, ${user.full_name}!`);
        res.redirect('/dashboard');

    } catch (error) {
        console.error('Login error:', error);
        res.render('auth/login', {
            title: 'Login - SmartSched',
            errors: [{ msg: 'An error occurred. Please try again.' }]
        });
    }
});

// GET: Logout
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
        }
        res.redirect('/');
    });
});

module.exports = router;
