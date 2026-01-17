/**
 * SmartSched Intelligent Scheduling Engine
 * Phase 3 & 4: Priority Calculation, Automatic Task Generation & AI Integration
 * 
 * This engine uses the following data sources:
 * - users.daily_study_hours: User's preferred study time per day
 * - subjects.priority_level: 1-5 importance scale
 * - subjects.exam_date: Deadline for urgency calculation
 * - topics.difficulty: easy/medium/hard
 * - topics.importance: 1-5 scale
 * - topics.estimated_hours: Expected time to complete topic
 * - study_sessions: Past performance scores and time spent
 * - progress_logs: Topic-level progress tracking
 * - AI service: For intelligent topic complexity estimation
 */

const db = require('../config/database');

// Conditionally load AI service for topic estimation
let aiService = null;
try {
    aiService = require('./aiService');
} catch (e) {
    console.log('AI service not available for scheduler integration');
}

class SchedulerService {

    /**
     * Use AI to estimate topic complexity and suggest study time
     * Falls back to rule-based estimation if AI is unavailable
     */
    async estimateTopicWithAI(topicName, subjectName, existingDifficulty) {
        // If AI service is not available or not configured, use fallback
        if (!aiService || !aiService.isConfigured()) {
            return this.fallbackTopicEstimate(existingDifficulty);
        }

        try {
            const context = {
                subject_name: subjectName,
                existing_difficulty: existingDifficulty
            };

            const estimation = await aiService.estimateTopicComplexity(topicName, context);
            
            return {
                difficulty: estimation.difficulty || existingDifficulty || 'medium',
                estimated_hours: estimation.estimated_hours || this.getDefaultHours(existingDifficulty),
                ai_reasoning: estimation.reasoning || null,
                prerequisites: estimation.prerequisites || [],
                ai_enhanced: true
            };
        } catch (error) {
            console.error('AI topic estimation failed, using fallback:', error.message);
            return this.fallbackTopicEstimate(existingDifficulty);
        }
    }

    /**
     * Rule-based fallback for topic estimation
     */
    fallbackTopicEstimate(difficulty) {
        const hours = this.getDefaultHours(difficulty);
        return {
            difficulty: difficulty || 'medium',
            estimated_hours: hours,
            ai_reasoning: null,
            prerequisites: [],
            ai_enhanced: false
        };
    }

    /**
     * Get default hours based on difficulty
     */
    getDefaultHours(difficulty) {
        const hoursByDifficulty = {
            'easy': 1.5,
            'medium': 3,
            'hard': 5
        };
        return hoursByDifficulty[difficulty] || 3;
    }
    
    /**
     * Calculate priority score for a topic
     * Higher score = higher priority (should be studied first)
     * 
     * Formula breakdown:
     * - Subject importance: 3x multiplier
     * - Topic difficulty: 2x multiplier
     * - Exam urgency: 5x multiplier (inversely proportional to days remaining)
     * - Topic importance: 2x multiplier
     * - Weak topic boost: +5 if performance < 60%, +3 if < 75%
     * - Spaced repetition boost: +0.5 to +5 based on days since last studied
     * - Never-studied boost: +8 for topics with no study history
     */
    calculateTopicPriority(topic, subject, performanceData = null) {
        let priority = 0;
        
        // 1. Subject importance (weight: 3x)
        const subjectImportance = subject.priority_level || 3;
        priority += subjectImportance * 3;
        
        // 2. Topic difficulty (weight: 2x) - harder topics need more attention
        const difficultyScore = {
            'easy': 1,
            'medium': 2,
            'hard': 3
        };
        priority += (difficultyScore[topic.difficulty] || 2) * 2;
        
        // 3. Urgency based on exam date (weight: 5x for close deadlines)
        if (subject.exam_date) {
            const today = new Date();
            const examDate = new Date(subject.exam_date);
            const daysRemaining = Math.max(1, Math.ceil((examDate - today) / (1000 * 60 * 60 * 24)));
            
            // Closer exams get higher priority (30/days gives high score for near exams)
            const urgencyScore = Math.min(10, 30 / daysRemaining);
            priority += urgencyScore * 5;
            
            // If exam is in less than 3 days, massive boost
            if (daysRemaining <= 3) {
                priority += 15;
            }
        }
        
        // 4. Topic importance (weight: 2x)
        priority += (topic.importance || 3) * 2;
        
        // 5. Performance-based boost (weak topics get priority)
        // This uses REAL data from study_sessions.quality_rating
        if (performanceData && performanceData.session_count > 0) {
            const avgScore = performanceData.avg_score; // Already converted to 0-100 scale
            
            if (avgScore < 40) {
                priority += 8; // Critical - needs major attention
            } else if (avgScore < 60) {
                priority += 5; // Major boost for weak topics
            } else if (avgScore < 75) {
                priority += 3; // Moderate boost
            } else if (avgScore >= 90) {
                priority -= 2; // Slight reduction for mastered topics
            }
        } else {
            // Never studied before - high priority to get started
            priority += 8;
        }
        
        // 6. Completion status penalty (completed topics get lower priority)
        if (topic.is_completed) {
            priority -= 15;
        }
        
        // 7. Spaced Repetition Logic
        // Topics not studied recently need revision
        if (performanceData && performanceData.last_studied) {
            const daysSinceStudied = Math.ceil((new Date() - new Date(performanceData.last_studied)) / (1000 * 60 * 60 * 24));
            
            // Optimal review intervals: 1 day, 3 days, 7 days, 14 days, 30 days
            if (daysSinceStudied >= 30) {
                priority += 6; // Major revision needed
            } else if (daysSinceStudied >= 14) {
                priority += 4; // Review recommended
            } else if (daysSinceStudied >= 7) {
                priority += 2; // Light review
            } else if (daysSinceStudied >= 3) {
                priority += 1; // Minor boost
            }
            // 1-2 days: recently studied, no boost needed
        }
        
        return Math.round(priority * 100) / 100;
    }
    
    /**
     * Get all topics with their priority scores for a user
     */
    async getPrioritizedTopics(userId) {
        try {
            // Get all incomplete topics with subject info
            const topicsResult = await db.query(`
                SELECT t.*, 
                       s.name as subject_name,
                       s.color as subject_color,
                       s.exam_date,
                       s.priority_level as subject_priority,
                       s.id as subject_id
                FROM topics t
                JOIN subjects s ON t.subject_id = s.id
                WHERE s.user_id = $1 
                  AND s.is_archived = false
                  AND t.is_completed = false
                ORDER BY s.priority_level DESC, t.importance DESC
            `, [userId]);
            
            // Get performance data for each topic
            const performanceResult = await db.query(`
                SELECT 
                    topic_id,
                    AVG(quality_rating) as avg_score,
                    COUNT(*) as session_count,
                    MAX(start_time) as last_studied,
                    SUM(actual_minutes) as total_minutes
                FROM study_sessions
                WHERE user_id = $1 AND topic_id IS NOT NULL AND status = 'completed'
                GROUP BY topic_id
            `, [userId]);
            
            // Create performance map
            const performanceMap = {};
            performanceResult.rows.forEach(p => {
                performanceMap[p.topic_id] = {
                    avg_score: parseFloat(p.avg_score) * 20 || 0, // Convert 1-5 to 0-100
                    session_count: parseInt(p.session_count),
                    last_studied: p.last_studied,
                    total_minutes: parseInt(p.total_minutes) || 0
                };
            });
            
            // Calculate priority for each topic
            const prioritizedTopics = topicsResult.rows.map(topic => {
                const subject = {
                    priority_level: topic.subject_priority,
                    exam_date: topic.exam_date
                };
                const performance = performanceMap[topic.id] || null;
                
                return {
                    ...topic,
                    priority_score: this.calculateTopicPriority(topic, subject, performance),
                    performance: performance,
                    remaining_hours: Math.max(0, (topic.estimated_hours || 1) - ((performance?.total_minutes || 0) / 60))
                };
            });
            
            // Sort by priority score (highest first)
            prioritizedTopics.sort((a, b) => b.priority_score - a.priority_score);
            
            return prioritizedTopics;
        } catch (error) {
            console.error('Error getting prioritized topics:', error);
            throw error;
        }
    }
    
    /**
     * Get user's study preferences
     */
    async getUserPreferences(userId) {
        const result = await db.query(`
            SELECT daily_study_hours, preferred_study_time, timezone
            FROM users WHERE id = $1
        `, [userId]);
        
        return result.rows[0] || {
            daily_study_hours: 4,
            preferred_study_time: 'morning',
            timezone: 'Asia/Kolkata'
        };
    }
    
    /**
     * Generate automatic tasks for a specified number of days
     * 
     * Edge cases handled:
     * - No topics added: Returns error message
     * - All topics completed: Generates revision tasks for best-performing topics
     * - Zero daily hours: Uses minimum 30 minutes
     * - Exam date missing: Uses default priority without urgency boost
     * - Too many hours for a day: Caps at user's daily_study_hours
     */
    async generateSchedule(userId, days = 7) {
        try {
            const preferences = await this.getUserPreferences(userId);
            
            // Edge case: Zero or invalid daily hours - use minimum
            let dailyMinutes = Math.max(30, (preferences.daily_study_hours || 4) * 60);
            
            // Cap at reasonable maximum (8 hours)
            dailyMinutes = Math.min(dailyMinutes, 480);
            
            const prioritizedTopics = await this.getPrioritizedTopics(userId);
            
            // Edge case: No topics available
            if (prioritizedTopics.length === 0) {
                // Check if user has subjects but no topics
                const subjectCheck = await db.query(`
                    SELECT COUNT(*) as count FROM subjects WHERE user_id = $1 AND is_archived = false
                `, [userId]);
                
                if (parseInt(subjectCheck.rows[0]?.count) > 0) {
                    return { 
                        success: false, 
                        message: 'No topics available for scheduling. Add topics to your subjects first.' 
                    };
                }
                
                return { 
                    success: false, 
                    message: 'No subjects found. Please add subjects and topics first before generating a schedule.' 
                };
            }
            
            // Edge case: All topics are completed - generate revision tasks
            const incompletTopics = prioritizedTopics.filter(t => !t.is_completed);
            let topicsToSchedule = incompletTopics.length > 0 ? prioritizedTopics : [];
            
            if (incompletTopics.length === 0) {
                // All completed - get all topics for revision, sorted by last studied
                const revisionTopics = await db.query(`
                    SELECT t.*, s.name as subject_name, s.color as subject_color, 
                           s.exam_date, s.priority_level as subject_priority
                    FROM topics t
                    JOIN subjects s ON t.subject_id = s.id
                    WHERE s.user_id = $1 AND s.is_archived = false
                    ORDER BY t.updated_at ASC
                    LIMIT 10
                `, [userId]);
                
                if (revisionTopics.rows.length === 0) {
                    return { 
                        success: false, 
                        message: 'All topics completed! Add new subjects and topics or mark topics as incomplete for revision.' 
                    };
                }
                
                // Create revision tasks
                topicsToSchedule = revisionTopics.rows.map(t => ({
                    ...t,
                    priority_score: 20, // Base priority for revision
                    remaining_hours: 0.5, // 30 min revision sessions
                    is_revision: true
                }));
            }
            
            // Clear existing auto-generated pending tasks for future dates
            await db.query(`
                DELETE FROM tasks 
                WHERE user_id = $1 
                  AND scheduled_date > CURRENT_DATE 
                  AND status = 'pending'
                  AND task_type = 'study'
            `, [userId]);
            
            const generatedTasks = [];
            let topicIndex = 0;
            let cycleCount = 0;
            const maxCycles = 3; // Prevent infinite loops
            
            // Generate tasks for each day
            for (let dayOffset = 0; dayOffset < days; dayOffset++) {
                const scheduledDate = new Date();
                scheduledDate.setDate(scheduledDate.getDate() + dayOffset);
                const dateStr = scheduledDate.toISOString().split('T')[0];
                
                // Check existing tasks for this day (manual tasks)
                const existingResult = await db.query(`
                    SELECT COALESCE(SUM(estimated_minutes), 0) as total_minutes
                    FROM tasks
                    WHERE user_id = $1 AND scheduled_date = $2 AND status != 'completed'
                `, [userId, dateStr]);
                
                let remainingMinutes = dailyMinutes - (parseInt(existingResult.rows[0]?.total_minutes) || 0);
                
                // Edge case: Day already fully scheduled
                if (remainingMinutes < 25) {
                    continue;
                }
                
                let tasksAddedThisDay = 0;
                
                // Allocate time to topics
                while (remainingMinutes >= 25 && topicIndex < topicsToSchedule.length) {
                    const topic = topicsToSchedule[topicIndex];
                    
                    // Skip if topic has no remaining hours (unless it's a revision topic)
                    if (!topic.is_revision && topic.remaining_hours <= 0) {
                        topicIndex++;
                        continue;
                    }
                    
                    // Calculate session duration (25-60 min blocks)
                    const topicMinutesNeeded = Math.min(
                        topic.is_revision ? 30 : topic.remaining_hours * 60,
                        60, // Max 60 min per session
                        remainingMinutes
                    );
                    
                    const sessionMinutes = Math.max(25, Math.round(topicMinutesNeeded / 5) * 5);
                    
                    if (sessionMinutes > remainingMinutes) {
                        topicIndex++;
                        continue;
                    }
                    
                    // Create the task
                    const taskResult = await db.query(`
                        INSERT INTO tasks (
                            user_id, topic_id, title, description,
                            task_type, scheduled_date, estimated_minutes,
                            priority, priority_score, status
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
                        RETURNING *
                    `, [
                        userId,
                        topic.id,
                        `Study: ${topic.name}`,
                        `Auto-generated study session for ${topic.subject_name} - ${topic.name}`,
                        'study',
                        dateStr,
                        sessionMinutes,
                        Math.min(5, Math.ceil(topic.priority_score / 10)),
                        topic.priority_score
                    ]);
                    
                    generatedTasks.push({
                        ...taskResult.rows[0],
                        topic_name: topic.name,
                        subject_name: topic.subject_name,
                        subject_color: topic.subject_color
                    });
                    
                    remainingMinutes -= sessionMinutes;
                    tasksAddedThisDay++;
                    
                    // Update remaining hours for this topic
                    if (!topic.is_revision) {
                        topic.remaining_hours -= sessionMinutes / 60;
                    }
                    
                    // Move to next topic if this one is allocated enough time today
                    // or add variety (don't study same topic all day)
                    if (topic.remaining_hours <= 0 || tasksAddedThisDay >= 2 || Math.random() > 0.6) {
                        topicIndex++;
                    }
                }
                
                // Reset topic index for variety across days
                if (topicIndex >= topicsToSchedule.length && cycleCount < maxCycles) {
                    topicIndex = 0;
                    cycleCount++;
                    
                    // Refresh remaining hours for re-study (spaced repetition)
                    topicsToSchedule.forEach(t => {
                        if (!t.is_revision) {
                            const originalHours = t.estimated_hours || 1;
                            t.remaining_hours = Math.max(originalHours * 0.3, t.remaining_hours); // Allow re-study
                        }
                    });
                }
            }
            
            // Edge case: No tasks generated
            if (generatedTasks.length === 0) {
                return {
                    success: false,
                    message: 'Could not generate any tasks. Please check your topics have estimated hours set.'
                };
            }
            
            return {
                success: true,
                message: `Generated ${generatedTasks.length} study tasks for the next ${days} days`,
                tasks: generatedTasks,
                tasksCount: generatedTasks.length
            };
        } catch (error) {
            console.error('Error generating schedule:', error);
            return {
                success: false,
                message: 'An error occurred while generating the schedule. Please try again.'
            };
        }
    }
    
    /**
     * Get today's scheduled tasks
     */
    async getTodaysTasks(userId) {
        const result = await db.query(`
            SELECT t.*, 
                   tp.name as topic_name,
                   tp.difficulty,
                   s.name as subject_name,
                   s.color as subject_color
            FROM tasks t
            JOIN topics tp ON t.topic_id = tp.id
            JOIN subjects s ON tp.subject_id = s.id
            WHERE t.user_id = $1 
              AND t.scheduled_date = CURRENT_DATE
              AND t.status != 'completed'
            ORDER BY t.priority_score DESC, t.priority ASC
        `, [userId]);
        
        return result.rows;
    }
    
    /**
     * Get weekly scheduled tasks
     */
    async getWeeklyTasks(userId, startDate = null) {
        const start = startDate || new Date();
        const startStr = start.toISOString().split('T')[0];
        
        const result = await db.query(`
            SELECT t.*, 
                   tp.name as topic_name,
                   tp.difficulty,
                   s.name as subject_name,
                   s.color as subject_color,
                   EXTRACT(DOW FROM t.scheduled_date) as day_of_week
            FROM tasks t
            JOIN topics tp ON t.topic_id = tp.id
            JOIN subjects s ON tp.subject_id = s.id
            WHERE t.user_id = $1 
              AND t.scheduled_date >= $2
              AND t.scheduled_date < ($2::date + INTERVAL '7 days')
            ORDER BY t.scheduled_date ASC, t.priority_score DESC
        `, [userId, startStr]);
        
        // Group by date
        const tasksByDate = {};
        result.rows.forEach(task => {
            const dateKey = new Date(task.scheduled_date).toISOString().split('T')[0];
            if (!tasksByDate[dateKey]) {
                tasksByDate[dateKey] = [];
            }
            tasksByDate[dateKey].push(task);
        });
        
        return {
            tasks: result.rows,
            tasksByDate
        };
    }
    
    /**
     * Mark a task as completed
     */
    async completeTask(userId, taskId) {
        try {
            // Verify task belongs to user
            const taskResult = await db.query(`
                SELECT * FROM tasks WHERE id = $1 AND user_id = $2
            `, [taskId, userId]);
            
            if (taskResult.rows.length === 0) {
                return { success: false, message: 'Task not found' };
            }
            
            // Update task status
            await db.query(`
                UPDATE tasks 
                SET status = 'completed', 
                    completed_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
            `, [taskId]);
            
            // Update topic progress if this was a study task
            const task = taskResult.rows[0];
            if (task.topic_id) {
                // Check if all tasks for this topic are completed
                const remainingTasks = await db.query(`
                    SELECT COUNT(*) as count FROM tasks
                    WHERE topic_id = $1 AND status != 'completed'
                `, [task.topic_id]);
                
                // Log progress
                await db.query(`
                    INSERT INTO progress_logs (user_id, task_id, topic_id, completion_percentage, notes)
                    VALUES ($1, $2, $3, 100, 'Task completed')
                `, [userId, taskId, task.topic_id]);
            }
            
            // Update daily stats
            await this.updateDailyStats(userId);
            
            return { success: true, message: 'Task completed successfully' };
        } catch (error) {
            console.error('Error completing task:', error);
            throw error;
        }
    }
    
    /**
     * Skip a task and reschedule
     */
    async skipTask(userId, taskId, reason = '') {
        try {
            // Verify task belongs to user
            const taskResult = await db.query(`
                SELECT t.*, tp.name as topic_name
                FROM tasks t
                JOIN topics tp ON t.topic_id = tp.id
                WHERE t.id = $1 AND t.user_id = $2
            `, [taskId, userId]);
            
            if (taskResult.rows.length === 0) {
                return { success: false, message: 'Task not found' };
            }
            
            const task = taskResult.rows[0];
            
            // Mark current task as skipped
            await db.query(`
                UPDATE tasks 
                SET status = 'skipped',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
            `, [taskId]);
            
            // Find next available day to reschedule
            const nextDayResult = await db.query(`
                SELECT COALESCE(
                    (SELECT MIN(scheduled_date) 
                     FROM generate_series(CURRENT_DATE + 1, CURRENT_DATE + 14, '1 day'::interval) AS d(scheduled_date)
                     WHERE NOT EXISTS (
                         SELECT 1 FROM tasks 
                         WHERE user_id = $1 
                           AND tasks.scheduled_date = d.scheduled_date::date
                         GROUP BY scheduled_date
                         HAVING SUM(estimated_minutes) >= $2
                     )),
                    CURRENT_DATE + 1
                ) as next_date
            `, [userId, 240]); // 4 hours max per day
            
            const nextDate = nextDayResult.rows[0]?.next_date || new Date(Date.now() + 86400000);
            
            // Create rescheduled task with increased priority
            await db.query(`
                INSERT INTO tasks (
                    user_id, topic_id, title, description,
                    task_type, scheduled_date, estimated_minutes,
                    priority, priority_score, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
            `, [
                userId,
                task.topic_id,
                `[Rescheduled] ${task.title}`,
                `Rescheduled from ${task.scheduled_date}. ${reason ? 'Reason: ' + reason : ''}`,
                task.task_type,
                nextDate,
                task.estimated_minutes,
                Math.min(5, (task.priority || 3) + 1), // Increase priority
                (task.priority_score || 0) + 5 // Boost priority score
            ]);
            
            return { 
                success: true, 
                message: `Task skipped and rescheduled to ${new Date(nextDate).toLocaleDateString()}` 
            };
        } catch (error) {
            console.error('Error skipping task:', error);
            throw error;
        }
    }
    
    /**
     * Update daily stats for a user
     */
    async updateDailyStats(userId) {
        try {
            const today = new Date().toISOString().split('T')[0];
            
            // Get today's stats
            const statsResult = await db.query(`
                SELECT 
                    COALESCE(SUM(ss.actual_minutes), 0) as study_minutes,
                    COUNT(DISTINCT ss.id) as sessions_count,
                    (SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND scheduled_date = CURRENT_DATE) as tasks_planned,
                    (SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND scheduled_date = CURRENT_DATE AND status = 'completed') as tasks_completed
                FROM study_sessions ss
                WHERE ss.user_id = $1 AND DATE(ss.start_time) = CURRENT_DATE AND ss.status = 'completed'
            `, [userId]);
            
            const stats = statsResult.rows[0];
            
            // Upsert daily stats
            await db.query(`
                INSERT INTO daily_stats (user_id, stat_date, study_minutes, sessions_count, tasks_planned, tasks_completed)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (user_id, stat_date) 
                DO UPDATE SET 
                    study_minutes = $3,
                    sessions_count = $4,
                    tasks_planned = $5,
                    tasks_completed = $6,
                    updated_at = CURRENT_TIMESTAMP
            `, [
                userId, 
                today, 
                stats.study_minutes || 0,
                stats.sessions_count || 0,
                stats.tasks_planned || 0,
                stats.tasks_completed || 0
            ]);
        } catch (error) {
            console.error('Error updating daily stats:', error);
        }
    }
    
    /**
     * Get scheduling stats for dashboard
     */
    async getScheduleStats(userId) {
        const result = await db.query(`
            SELECT 
                (SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND scheduled_date = CURRENT_DATE AND status = 'pending') as today_pending,
                (SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND scheduled_date = CURRENT_DATE AND status = 'completed') as today_completed,
                (SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND scheduled_date = CURRENT_DATE AND status = 'skipped') as today_skipped,
                (SELECT COALESCE(SUM(estimated_minutes), 0) FROM tasks WHERE user_id = $1 AND scheduled_date = CURRENT_DATE AND status = 'pending') as today_minutes_remaining,
                (SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND scheduled_date > CURRENT_DATE AND scheduled_date <= CURRENT_DATE + 7) as week_tasks
        `, [userId]);
        
        return result.rows[0];
    }
}

module.exports = new SchedulerService();
