/**
 * Gamification Service
 * Handles XP awards, level calculation, and achievement checking
 */
const { pool } = require('../config/database');

// XP required per level: level N requires N*100 XP total
// Level 1 = 0 XP, Level 2 = 100 XP, Level 3 = 300 XP, Level 4 = 600 XP, etc.
function getLevelFromXP(totalXP) {
    let level = 1;
    let xpNeeded = 0;
    while (xpNeeded + level * 100 <= totalXP) {
        xpNeeded += level * 100;
        level++;
    }
    const currentLevelXP = totalXP - xpNeeded;
    const nextLevelXP = level * 100;
    return { level, currentLevelXP, nextLevelXP, totalXP };
}

/**
 * Award XP to a user
 */
async function awardXP(userId, amount, source, sourceId, description) {
    if (amount <= 0) return;
    await pool.query(
        'INSERT INTO xp_log (user_id, amount, source, source_id, description) VALUES ($1, $2, $3, $4, $5)',
        [userId, amount, source, sourceId || null, description || null]
    );
}

/**
 * Get user's total XP and level info
 */
async function getUserXP(userId) {
    const result = await pool.query(
        'SELECT COALESCE(SUM(amount), 0) as total_xp FROM xp_log WHERE user_id = $1',
        [userId]
    );
    return getLevelFromXP(parseInt(result.rows[0].total_xp));
}

/**
 * Check and award achievements after an action
 */
async function checkAchievements(userId) {
    const newlyUnlocked = [];

    // Get already unlocked
    const unlockedResult = await pool.query(
        'SELECT achievement_id FROM user_achievements WHERE user_id = $1',
        [userId]
    );
    const unlocked = new Set(unlockedResult.rows.map(r => r.achievement_id));

    // Get all achievements
    const achResult = await pool.query('SELECT * FROM achievements ORDER BY sort_order');
    const achievements = achResult.rows;

    // Gather user stats
    const [streakR, studyR, sessionR, fcR, quizR, quizAceR, taskR, groupCreateR, groupShareR] = await Promise.all([
        // Streak
        pool.query(`
            WITH daily AS (
                SELECT DISTINCT (start_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date as d
                FROM study_sessions WHERE user_id = $1 AND status = 'completed'
            ), numbered AS (
                SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d))::int AS grp FROM daily
            )
            SELECT MAX(cnt) as streak FROM (SELECT COUNT(*) as cnt FROM numbered GROUP BY grp) sub
        `, [userId]),
        // Total study minutes
        pool.query("SELECT COALESCE(SUM(actual_minutes), 0) as total FROM study_sessions WHERE user_id = $1 AND status = 'completed'", [userId]),
        // Session count
        pool.query("SELECT COUNT(*) as cnt FROM study_sessions WHERE user_id = $1 AND status = 'completed'", [userId]),
        // Flashcard reviews
        pool.query("SELECT COALESCE(SUM(repetitions), 0) as cnt FROM flashcard_progress fp JOIN flashcards f ON fp.flashcard_id = f.id JOIN flashcard_sets fs ON f.set_id = fs.id WHERE fs.user_id = $1", [userId]),
        // Quiz count
        pool.query("SELECT COUNT(*) as cnt FROM practice_attempts WHERE user_id = $1", [userId]),
        // Quizzes with 90%+
        pool.query("SELECT COUNT(*) as cnt FROM practice_attempts WHERE user_id = $1 AND percentage >= 90", [userId]),
        // Completed tasks
        pool.query("SELECT COUNT(*) as cnt FROM tasks WHERE user_id = $1 AND status = 'completed'", [userId]),
        // Groups created
        pool.query("SELECT COUNT(*) as cnt FROM study_groups WHERE created_by = $1", [userId]),
        // Items shared in groups
        pool.query("SELECT COUNT(*) as cnt FROM group_shared_items WHERE shared_by = $1", [userId]),
    ]);

    const stats = {
        maxStreak: parseInt(streakR.rows[0]?.streak || 0),
        totalMinutes: parseInt(studyR.rows[0].total),
        sessionCount: parseInt(sessionR.rows[0].cnt),
        fcReviews: parseInt(fcR.rows[0].cnt),
        quizCount: parseInt(quizR.rows[0].cnt),
        quizAceCount: parseInt(quizAceR.rows[0].cnt),
        taskCount: parseInt(taskR.rows[0].cnt),
        groupsCreated: parseInt(groupCreateR.rows[0].cnt),
        groupShares: parseInt(groupShareR.rows[0].cnt),
    };

    // Get user level
    const xpInfo = await getUserXP(userId);

    // Check perfect score (last quiz)
    const lastQuiz = await pool.query(
        "SELECT percentage FROM practice_attempts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
        [userId]
    );
    const lastQuizPerfect = lastQuiz.rows.length > 0 && lastQuiz.rows[0].percentage === 100;

    // Check subject completion
    const subjectComplete = await pool.query(`
        SELECT s.id FROM subjects s
        WHERE s.user_id = $1 AND s.is_archived = false
        AND (SELECT COUNT(*) FROM topics WHERE subject_id = s.id) > 0
        AND (SELECT COUNT(*) FROM topics WHERE subject_id = s.id AND is_completed = false) = 0
        LIMIT 1
    `, [userId]);

    for (const ach of achievements) {
        if (unlocked.has(ach.id)) continue;

        let earned = false;
        switch (ach.id) {
            // Streaks
            case 'streak_3': case 'streak_7': case 'streak_14': case 'streak_30':
                earned = stats.maxStreak >= ach.requirement_value; break;
            // Study time (requirement in minutes)
            case 'study_1h': case 'study_10h': case 'study_50h': case 'study_100h':
                earned = stats.totalMinutes >= ach.requirement_value; break;
            // Sessions
            case 'session_1': case 'session_10': case 'session_50': case 'session_100':
                earned = stats.sessionCount >= ach.requirement_value; break;
            // Flashcards
            case 'fc_review_10': case 'fc_review_100': case 'fc_review_500':
                earned = stats.fcReviews >= ach.requirement_value; break;
            // Quizzes
            case 'quiz_1': case 'quiz_10':
                earned = stats.quizCount >= ach.requirement_value; break;
            case 'quiz_perfect':
                earned = lastQuizPerfect; break;
            case 'quiz_ace':
                earned = stats.quizAceCount >= ach.requirement_value; break;
            // Tasks
            case 'task_1': case 'task_25': case 'task_100':
                earned = stats.taskCount >= ach.requirement_value; break;
            // Subject
            case 'subject_complete':
                earned = subjectComplete.rows.length > 0; break;
            // Social
            case 'group_create':
                earned = stats.groupsCreated >= ach.requirement_value; break;
            case 'group_share':
                earned = stats.groupShares >= ach.requirement_value; break;
            // Levels
            case 'level_5': case 'level_10': case 'level_25':
                earned = xpInfo.level >= ach.requirement_value; break;
        }

        if (earned) {
            try {
                await pool.query(
                    'INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [userId, ach.id]
                );
                // Award achievement XP
                if (ach.xp_reward > 0) {
                    await awardXP(userId, ach.xp_reward, 'achievement', null, `Achievement: ${ach.name}`);
                }
                newlyUnlocked.push(ach);
            } catch (e) {
                // ignore duplicate
            }
        }
    }

    return newlyUnlocked;
}

/**
 * Award XP for completing a study session, then check achievements
 * Returns { xpAwarded, newAchievements }
 */
async function onStudySessionComplete(userId, sessionId, actualMinutes) {
    // Base: 1 XP per minute, min 5 XP
    const xp = Math.max(5, Math.round(actualMinutes));
    await awardXP(userId, xp, 'study_session', sessionId, `${actualMinutes} min study session`);
    const newAchievements = await checkAchievements(userId);
    return { xpAwarded: xp, newAchievements };
}

/**
 * Award XP for flashcard review
 */
async function onFlashcardReview(userId, cardId, rating) {
    // 3 XP per review, +2 bonus if correct (rating >= 3)
    const xp = rating >= 3 ? 5 : 3;
    await awardXP(userId, xp, 'flashcard_review', cardId, `Card review (rating: ${rating})`);
    const newAchievements = await checkAchievements(userId);
    return { xpAwarded: xp, newAchievements };
}

/**
 * Award XP for completing a quiz
 */
async function onQuizComplete(userId, attemptId, percentage) {
    // Base 10 XP + percentage bonus
    let xp = 10 + Math.round(percentage / 5);
    if (percentage === 100) xp += 25; // perfect score bonus
    await awardXP(userId, xp, 'quiz', attemptId, `Quiz score: ${percentage}%`);
    const newAchievements = await checkAchievements(userId);
    return { xpAwarded: xp, newAchievements };
}

/**
 * Award XP for completing a task
 */
async function onTaskComplete(userId, taskId) {
    const xp = 10;
    await awardXP(userId, xp, 'task', taskId, 'Task completed');
    const newAchievements = await checkAchievements(userId);
    return { xpAwarded: xp, newAchievements };
}

module.exports = {
    getUserXP,
    getLevelFromXP,
    awardXP,
    checkAchievements,
    onStudySessionComplete,
    onFlashcardReview,
    onQuizComplete,
    onTaskComplete
};
