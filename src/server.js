require('dotenv').config();

const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');

const app = express();

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Flash messages
app.use(flash());

// Global variables for templates
app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success');
    res.locals.error_msg = req.flash('error');
    res.locals.user = req.session.user || null;
    next();
});

// Routes
app.use('/', require('./routes/index'));
app.use('/auth', require('./routes/auth'));
app.use('/guide', require('./routes/guide'));
app.use('/', require('./routes/search'));
app.use('/subjects', require('./routes/subjects'));
app.use('/topics', require('./routes/topics'));
app.use('/tasks', require('./routes/tasks'));
app.use('/study', require('./routes/study'));
app.use('/analytics', require('./routes/analytics'));
app.use('/schedule', require('./routes/schedule'));
app.use('/settings', require('./routes/settings'));
app.use('/reminders', require('./routes/reminders'));
app.use('/ai', require('./routes/ai'));
app.use('/materials', require('./routes/materials'));
app.use('/notes', require('./routes/notes'));
app.use('/flashcards', require('./routes/flashcards'));
app.use('/practice', require('./routes/practice'));

// 404 handler
app.use((req, res) => {
    res.status(404).render('errors/404', { title: 'Page Not Found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('errors/500', { title: 'Server Error' });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`
    ╔═══════════════════════════════════════════╗
    ║                                           ║
    ║   🎓 SmartSched Server Running            ║
    ║   📍 http://localhost:${PORT}               ║
    ║   🌍 Environment: ${process.env.NODE_ENV || 'development'}        ║
    ║                                           ║
    ╚═══════════════════════════════════════════╝
    `);
});

module.exports = app;
