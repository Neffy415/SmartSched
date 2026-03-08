/**
 * SmartSched Cron Jobs
 * - Check for due reminders every 60 seconds, send email notifications
 * - Send daily AI-generated streak motivation emails at ~8 AM IST (2:30 AM UTC)
 */

const db = require('../config/database');
const { sendReminderDueEmail, sendStreakMotivationEmail } = require('./emailService');

let aiService = null;
try {
    aiService = require('./aiService');
} catch (e) {
    console.log('AI service not available for cron jobs');
}

/**
 * Check for due reminders and send emails
 * Runs every 60 seconds
 */
async function checkDueReminders() {
    try {
        // Find reminders that are due, not yet triggered, and not dismissed
        const result = await db.query(`
            SELECT r.*, u.email as user_email, u.full_name as user_name,
                   t.title as task_title
            FROM reminders r
            JOIN users u ON r.user_id = u.id
            LEFT JOIN tasks t ON r.task_id = t.id
            WHERE r.is_triggered = false
              AND r.is_dismissed = false
              AND r.remind_at <= NOW()
        `);

        for (const reminder of result.rows) {
            // Mark as triggered immediately to avoid duplicate sends
            await db.query(
                'UPDATE reminders SET is_triggered = true WHERE id = $1',
                [reminder.id]
            );

            // Send due email
            await sendReminderDueEmail(
                reminder.user_email,
                reminder.user_name || 'there',
                {
                    title: reminder.title,
                    description: reminder.description,
                    reminder_type: reminder.reminder_type,
                    task_title: reminder.task_title
                }
            );

            // Handle repeating reminders
            if (reminder.repeat_type && reminder.repeat_type !== 'none') {
                const nextTime = calculateNextRepeat(reminder.remind_at, reminder.repeat_type);
                if (nextTime) {
                    await db.query(`
                        INSERT INTO reminders (user_id, title, description, remind_at, reminder_type, task_id, repeat_type)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                    `, [
                        reminder.user_id, reminder.title, reminder.description,
                        nextTime, reminder.reminder_type, reminder.task_id, reminder.repeat_type
                    ]);
                }
            }
        }

        if (result.rows.length > 0) {
            console.log(`⏰ Processed ${result.rows.length} due reminder(s)`);
        }
    } catch (error) {
        console.error('Cron: Error checking due reminders:', error.message);
    }
}

/**
 * Calculate next repeat time
 */
function calculateNextRepeat(currentTime, repeatType) {
    const next = new Date(currentTime);
    switch (repeatType) {
        case 'daily':
            next.setDate(next.getDate() + 1);
            break;
        case 'weekly':
            next.setDate(next.getDate() + 7);
            break;
        case 'monthly':
            next.setMonth(next.getMonth() + 1);
            break;
        default:
            return null;
    }
    return next.toISOString();
}

/**
 * Send daily streak motivation emails
 * Finds all users with active streaks and sends AI-generated motivation
 */
async function sendDailyStreakEmails() {
    try {
        // Find users with active streaks (studied yesterday)
        const result = await db.query(`
            WITH user_streaks AS (
                SELECT 
                    u.id as user_id,
                    u.email,
                    u.full_name,
                    (
                        SELECT COUNT(*)
                        FROM (
                            WITH daily_activity AS (
                                SELECT DISTINCT (start_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date as study_date
                                FROM study_sessions
                                WHERE user_id = u.id AND status = 'completed'
                                ORDER BY study_date DESC
                            ),
                            streak_calc AS (
                                SELECT study_date,
                                       study_date - (ROW_NUMBER() OVER (ORDER BY study_date DESC))::integer as grp
                                FROM daily_activity
                            )
                            SELECT 1
                            FROM streak_calc
                            WHERE grp = (
                                SELECT grp FROM streak_calc 
                                WHERE study_date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date - 1
                                LIMIT 1
                            )
                        ) sub
                    ) as streak_days
                FROM users u
                WHERE EXISTS (
                    SELECT 1 FROM study_sessions ss 
                    WHERE ss.user_id = u.id 
                      AND ss.status = 'completed'
                      AND (ss.start_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date - 1
                )
            )
            SELECT * FROM user_streaks WHERE streak_days >= 2
        `);

        for (const user of result.rows) {
            const motivation = await generateMotivation(user.full_name || 'Student', user.streak_days);
            await sendStreakMotivationEmail(
                user.email,
                user.full_name || 'Student',
                user.streak_days,
                motivation
            );
        }

        if (result.rows.length > 0) {
            console.log(`🔥 Sent streak motivation to ${result.rows.length} user(s)`);
        }
    } catch (error) {
        console.error('Cron: Error sending streak emails:', error.message);
    }
}

/**
 * Generate AI motivation text for streak
 */
async function generateMotivation(userName, streakDays) {
    if (!aiService || !aiService.isConfigured()) {
        return getDefaultMotivation(streakDays);
    }

    try {
        const prompt = `Generate a short, energetic, and inspiring motivational message for a student named ${userName} who is on a ${streakDays}-day study streak. Keep it to 1-2 sentences max. Be specific about the streak number. Make it personal and encouraging. Don't use hashtags. Return ONLY the motivation text, nothing else.`;
        const result = await aiService.callGemini(prompt);
        const text = result.raw_response || (typeof result === 'string' ? result : null);
        return text || getDefaultMotivation(streakDays);
    } catch (error) {
        console.error('AI motivation generation failed:', error.message);
        return getDefaultMotivation(streakDays);
    }
}

/**
 * Fallback motivations when AI is unavailable
 */
function getDefaultMotivation(streakDays) {
    const messages = [
        `${streakDays} days of consistent studying — you're building an unstoppable habit! Keep it up!`,
        `You've shown up for ${streakDays} days straight. That's not luck, that's dedication. Let's make it ${streakDays + 1}!`,
        `Every day you study brings you closer to mastery. ${streakDays} days down, and you're on fire!`,
        `Consistency beats intensity. ${streakDays} days proves you have what it takes. Don't stop now!`,
        `${streakDays}-day streak? That's incredible discipline. Your future self will thank you!`
    ];
    return messages[Math.floor(Math.random() * messages.length)];
}

// Track if daily streak email was sent today
let lastStreakEmailDate = null;

/**
 * Start all cron jobs
 */
function startCronJobs() {
    console.log('🕐 Starting cron jobs...');

    // Check due reminders every 60 seconds
    setInterval(checkDueReminders, 60 * 1000);
    // Run immediately on startup too
    checkDueReminders();

    // Check every 10 minutes if it's time for daily streak emails
    // Sends at ~8:00 AM IST (2:30 AM UTC)
    setInterval(() => {
        const now = new Date();
        const istHour = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getHours();
        const today = now.toISOString().slice(0, 10);

        if (istHour >= 8 && istHour < 9 && lastStreakEmailDate !== today) {
            lastStreakEmailDate = today;
            sendDailyStreakEmails();
        }
    }, 10 * 60 * 1000);

    console.log('  ⏰ Reminder due-check: every 60s');
    console.log('  🔥 Streak motivation emails: daily ~8 AM IST');
}

module.exports = { startCronJobs };
