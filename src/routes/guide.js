const express = require('express');
const router = express.Router();

// Middleware to check if user is logged in
const ensureAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    }
    req.flash('error_msg', 'Please log in to view this resource');
    res.redirect('/auth/login');
};

router.get('/', ensureAuthenticated, (req, res) => {
    res.render('guide/index', {
        title: 'User Guide - SmartSched',
        path: '/guide',
        user: req.session.user
    });
});

module.exports = router;
