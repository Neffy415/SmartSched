const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'SmartSched <onboarding@resend.dev>';

// Reminder type config
const REMINDER_ICONS = {
    custom: '🔔',
    review: '📝',
    task_deadline: '🎯',
    study_session: '📖',
    exam: '🎓'
};

const REMINDER_LABELS = {
    custom: 'Custom Reminder',
    review: 'Review Session',
    task_deadline: 'Task Deadline',
    study_session: 'Study Session',
    exam: 'Exam Reminder'
};

function buildReminderEmail(reminder, userName) {
    const icon = REMINDER_ICONS[reminder.reminder_type] || '🔔';
    const label = REMINDER_LABELS[reminder.reminder_type] || 'Reminder';
    const remindAt = new Date(reminder.remind_at);
    const dateStr = remindAt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = remindAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

    <!-- Header -->
    <tr><td style="background:linear-gradient(135deg,#6366f1,#4f46e5);border-radius:16px 16px 0 0;padding:32px 40px;text-align:center;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
            <div style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">
                📅 SmartSched
            </div>
            <div style="color:#c7d2fe;font-size:13px;margin-top:4px;">Your Intelligent Study Companion</div>
        </td></tr></table>
    </td></tr>

    <!-- Body -->
    <tr><td style="background-color:#1e293b;padding:40px;">
        <p style="color:#e2e8f0;font-size:16px;margin:0 0 24px;">Hi <strong style="color:#ffffff;">${userName}</strong>,</p>

        <!-- Reminder Card -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;border-radius:12px;border:1px solid #334155;">
        <tr><td style="padding:24px;">
            <div style="display:inline-block;background:linear-gradient(135deg,#6366f1,#818cf8);color:#fff;font-size:12px;font-weight:600;padding:4px 12px;border-radius:20px;margin-bottom:16px;">
                ${icon} ${label}
            </div>
            <h2 style="color:#ffffff;font-size:20px;margin:12px 0 8px;font-weight:700;">${reminder.title}</h2>
            ${reminder.description ? `<p style="color:#94a3b8;font-size:14px;margin:0 0 20px;line-height:1.5;">${reminder.description}</p>` : ''}

            <!-- Date/Time Row -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
            <tr>
                <td width="50%" style="padding:12px;background-color:#1e293b;border-radius:8px;">
                    <div style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">📅 Date</div>
                    <div style="color:#e2e8f0;font-size:14px;font-weight:600;">${dateStr}</div>
                </td>
                <td width="8"></td>
                <td width="50%" style="padding:12px;background-color:#1e293b;border-radius:8px;">
                    <div style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">⏰ Time</div>
                    <div style="color:#e2e8f0;font-size:14px;font-weight:600;">${timeStr}</div>
                </td>
            </tr>
            </table>

            ${reminder.task_title ? `
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
            <tr><td style="padding:12px;background-color:#1e293b;border-radius:8px;">
                <div style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">🔗 Linked Task</div>
                <div style="color:#e2e8f0;font-size:14px;font-weight:600;">${reminder.task_title}</div>
            </td></tr>
            </table>` : ''}

            ${reminder.repeat_type && reminder.repeat_type !== 'none' ? `
            <div style="margin-top:12px;color:#818cf8;font-size:13px;">🔁 Repeats ${reminder.repeat_type}</div>` : ''}
        </td></tr>
        </table>

        <!-- CTA Button -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
        <tr><td align="center">
            <a href="${process.env.APP_URL || 'https://smartsched.onrender.com'}/reminders"
               style="display:inline-block;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 32px;border-radius:8px;">
                View Reminders →
            </a>
        </td></tr>
        </table>
    </td></tr>

    <!-- Footer -->
    <tr><td style="background-color:#0f172a;border-top:1px solid #1e293b;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center;">
        <p style="color:#64748b;font-size:12px;margin:0 0 8px;">
            You're receiving this because a reminder was set on your SmartSched account.
        </p>
        <p style="color:#475569;font-size:11px;margin:0;">
            © ${new Date().getFullYear()} SmartSched · Your Intelligent Study Companion
        </p>
    </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

async function sendReminderEmail(userEmail, userName, reminder) {
    if (!resend) {
        console.log('Resend API key not set — skipping email for reminder:', reminder.title);
        return false;
    }

    try {
        await resend.emails.send({
            from: FROM_EMAIL,
            to: userEmail,
            subject: `${REMINDER_ICONS[reminder.reminder_type] || '🔔'} Reminder: ${reminder.title}`,
            html: buildReminderEmail(reminder, userName),
        });
        console.log(`📧 Reminder email sent to ${userEmail} for "${reminder.title}"`);
        return true;
    } catch (error) {
        console.error('Resend email error:', error.message || error);
        return false;
    }
}

module.exports = { sendReminderEmail };
