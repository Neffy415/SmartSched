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
app.use('/groups', require('./routes/groups'));
app.use('/achievements', require('./routes/achievements'));
app.use('/exam', require('./routes/exam'));
app.use('/concepts', require('./routes/concepts'));

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

app.listen(PORT, async () => {
    console.log(`
    ╔═══════════════════════════════════════════╗
    ║                                           ║
    ║   🎓 SmartSched Server Running            ║
    ║   📍 http://localhost:${PORT}               ║
    ║   🌍 Environment: ${process.env.NODE_ENV || 'development'}        ║
    ║                                           ║
    ╚═══════════════════════════════════════════╝
    `);

    // One-time migration: ensure remind_at is TIMESTAMPTZ
    try {
        const { pool } = require('./config/database');
        const colCheck = await pool.query(`
            SELECT data_type FROM information_schema.columns 
            WHERE table_name = 'reminders' AND column_name = 'remind_at'
        `);
        if (colCheck.rows.length > 0 && colCheck.rows[0].data_type !== 'timestamp with time zone') {
            await pool.query(`ALTER TABLE reminders ALTER COLUMN remind_at TYPE TIMESTAMPTZ USING remind_at AT TIME ZONE 'Asia/Singapore'`);
            console.log('✅ Migrated remind_at to TIMESTAMPTZ');
        }
    } catch (e) {
        console.error('Migration check failed:', e.message);
    }

    // Ensure gamification tables exist
    try {
        const { pool } = require('./config/database');
        const tableCheck = await pool.query(`SELECT to_regclass('public.xp_log')`);
        if (!tableCheck.rows[0].to_regclass) {
            console.log('🏆 Creating gamification tables...');
            await pool.query(`
                CREATE TABLE IF NOT EXISTS xp_log (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    amount INTEGER NOT NULL,
                    source VARCHAR(50) NOT NULL,
                    source_id UUID,
                    description TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_xp_log_user ON xp_log(user_id);
                CREATE INDEX IF NOT EXISTS idx_xp_log_created ON xp_log(user_id, created_at);
                CREATE TABLE IF NOT EXISTS achievements (
                    id VARCHAR(60) PRIMARY KEY,
                    name VARCHAR(120) NOT NULL,
                    description TEXT NOT NULL,
                    icon VARCHAR(40) NOT NULL,
                    category VARCHAR(30) NOT NULL,
                    xp_reward INTEGER NOT NULL DEFAULT 0,
                    requirement_value INTEGER NOT NULL DEFAULT 1,
                    sort_order INTEGER DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS user_achievements (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    achievement_id VARCHAR(60) NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
                    unlocked_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE(user_id, achievement_id)
                );
                CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id);
            `);
            // Seed achievements
            const achs = [
                ['streak_3','On Fire','3-day study streak','flame','streak',50,3,10],
                ['streak_7','Week Warrior','7-day study streak','flame','streak',150,7,11],
                ['streak_14','Fortnight Focus','14-day study streak','flame','streak',300,14,12],
                ['streak_30','Monthly Master','30-day study streak','flame','streak',750,30,13],
                ['study_1h','First Hour','Study for 1 total hour','clock','study',25,60,20],
                ['study_10h','Dedicated Learner','Study for 10 total hours','clock','study',100,600,21],
                ['study_50h','Scholar','Study for 50 total hours','clock','study',400,3000,22],
                ['study_100h','Academic Hero','Study for 100 total hours','clock','study',1000,6000,23],
                ['session_1','Getting Started','Complete your first study session','play-circle','session',20,1,30],
                ['session_10','Regular Student','Complete 10 study sessions','play-circle','session',75,10,31],
                ['session_50','Study Machine','Complete 50 study sessions','play-circle','session',250,50,32],
                ['session_100','Centurion','Complete 100 study sessions','play-circle','session',500,100,33],
                ['fc_review_10','Card Flipper','Review 10 flashcards','layers','flashcard',30,10,40],
                ['fc_review_100','Memory Builder','Review 100 flashcards','layers','flashcard',150,100,41],
                ['fc_review_500','Flash Master','Review 500 flashcards','layers','flashcard',500,500,42],
                ['quiz_1','Quiz Taker','Complete your first quiz','brain','quiz',25,1,50],
                ['quiz_10','Quiz Enthusiast','Complete 10 quizzes','brain','quiz',100,10,51],
                ['quiz_perfect','Perfect Score','Score 100% on a quiz','trophy','quiz',200,100,52],
                ['quiz_ace','Quiz Ace','Score 90%+ on 5 quizzes','award','quiz',300,5,53],
                ['task_1','Task Starter','Complete your first task','check-square','task',15,1,60],
                ['task_25','Task Crusher','Complete 25 tasks','check-square','task',100,25,61],
                ['task_100','Productivity King','Complete 100 tasks','check-square','task',400,100,62],
                ['subject_complete','Subject Mastery','Complete all topics in a subject','book-open','subject',500,1,70],
                ['group_create','Team Builder','Create a study group','users','social',50,1,80],
                ['group_share','Knowledge Sharer','Share 5 items in a group','share-2','social',75,5,81],
                ['level_5','Rising Scholar','Reach Level 5','star','level',100,5,90],
                ['level_10','Dedicated Scholar','Reach Level 10','star','level',250,10,91],
                ['level_25','Master Scholar','Reach Level 25','crown','level',750,25,92],
            ];
            for (const [id,name,desc,icon,cat,xp,req_val,sort] of achs) {
                await pool.query('INSERT INTO achievements (id,name,description,icon,category,xp_reward,requirement_value,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING',
                    [id,name,desc,icon,cat,xp,req_val,sort]);
            }
            console.log('✅ Gamification tables created & achievements seeded');
        }
    } catch (e) {
        console.error('Gamification setup failed:', e.message);
    }

    // Ensure exam simulator tables exist
    try {
        const { pool } = require('./config/database');
        const examCheck = await pool.query(`SELECT to_regclass('public.exam_attempts')`);
        if (!examCheck.rows[0].to_regclass) {
            console.log('📝 Creating exam simulator tables...');
            await pool.query(`
                CREATE TABLE IF NOT EXISTS exam_attempts (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
                    title VARCHAR(255) NOT NULL,
                    question_count INTEGER NOT NULL DEFAULT 20,
                    time_limit_seconds INTEGER NOT NULL DEFAULT 3600,
                    difficulty VARCHAR(20) DEFAULT 'mixed',
                    status VARCHAR(20) DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
                    score INTEGER,
                    percentage INTEGER,
                    time_taken_seconds INTEGER,
                    answers JSONB,
                    topic_breakdown JSONB,
                    difficulty_breakdown JSONB,
                    started_at TIMESTAMPTZ,
                    completed_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_exam_attempts_user ON exam_attempts(user_id);

                CREATE TABLE IF NOT EXISTS exam_questions (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    exam_id UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
                    question_number INTEGER NOT NULL,
                    question_text TEXT NOT NULL,
                    topic_name VARCHAR(200),
                    difficulty VARCHAR(20) DEFAULT 'medium',
                    option_a TEXT NOT NULL,
                    option_b TEXT NOT NULL,
                    option_c TEXT NOT NULL,
                    option_d TEXT NOT NULL,
                    correct_option VARCHAR(1) NOT NULL,
                    explanation TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_exam_questions_exam ON exam_questions(exam_id);
            `);
            console.log('✅ Exam simulator tables created');
        }
    } catch (e) {
        console.error('Exam tables setup failed:', e.message);
    }

    // Ensure concept graph table exists
    try {
        const { pool } = require('./config/database');
        const cgCheck = await pool.query(`SELECT to_regclass('public.concept_graphs')`);
        if (!cgCheck.rows[0].to_regclass) {
            console.log('🔗 Creating concept graph table...');
            await pool.query(`
                CREATE TABLE IF NOT EXISTS concept_graphs (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
                    title VARCHAR(255) NOT NULL,
                    graph_data JSONB NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_concept_graphs_user ON concept_graphs(user_id);
            `);
            console.log('✅ Concept graph table created');
        }
    } catch (e) {
        console.error('Concept graph table setup failed:', e.message);
    }

    // Start background cron jobs (due reminders + streak emails)
    const { startCronJobs } = require('./services/cronJobs');
    startCronJobs();
});

module.exports = app;
