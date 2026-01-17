# SmartSched Data Flow: From Study Session to Scheduler

## 1. STUDY_SESSIONS Table Structure

```
study_sessions (PostgreSQL Table)
├── id (UUID)
├── user_id (UUID) → references users
├── task_id (UUID) → references tasks
├── topic_id (UUID) → references topics
├── start_time (TIMESTAMP) ← When study session started
├── end_time (TIMESTAMP) ← When study session ended
├── planned_minutes (INTEGER)
├── actual_minutes (INTEGER) ← How long actually studied
├── status (VARCHAR) → 'active' / 'completed' / 'cancelled'
├── quality_rating (INTEGER 1-5) ← Your performance score
├── notes (TEXT)
└── created_at (TIMESTAMP)
```

---

## 2. Data Creation Flow: User Study Session

### Step 1: User Starts Study Session
**Route:** `POST /study/start` ([study.js Line 169](../src/routes/study.js#L169))

```javascript
// User clicks "Start Studying" button on a topic
const result = await pool.query(`
    INSERT INTO study_sessions (
        user_id, 
        topic_id, 
        task_id, 
        start_time, 
        status, 
        planned_minutes
    ) VALUES ($1, $2, $3, NOW(), 'active', $4)
    RETURNING *
`, [userId, topicId, taskId, plannedMinutes]);
```

**Data Created:**
- `start_time` = Current timestamp
- `status` = 'active'
- `topic_id` = Selected topic
- `user_id` = Current user
- `planned_minutes` = User's estimate (25 min, 30 min, etc.)

---

### Step 2: User Completes Study Session
**Route:** `POST /study/stop/:id` ([study.js Line 259](../src/routes/study.js#L259))

```javascript
// User clicks "Complete Session" button
// They enter quality_rating (1-5) and optional notes
const result = await pool.query(`
    UPDATE study_sessions SET
        status = 'completed',
        end_time = NOW(),
        actual_minutes = $1,        // Calculated from start_time to NOW()
        notes = $2,
        quality_rating = $3         // User enters 1-5 score
    WHERE id = $4
`, [actualMinutes, notes, qualityRating, sessionId]);
```

**Data Populated:**
- `end_time` = Current timestamp
- `actual_minutes` = (end_time - start_time) in minutes
- `status` = 'completed'
- `quality_rating` = 1-5 (User's self-assessment)
- `notes` = Optional study notes

---

## 3. Example: Complete Data Journey

### User: Amlan De | Topic: Calculus | Subject: Mathematics

#### Session 1 (January 10)
```
INSERT INTO study_sessions:
├── user_id: 'a1b2c3d4-...' (Amlan)
├── topic_id: 'calc-uuid-...' (Calculus)
├── task_id: 'task-uuid-...'
├── start_time: '2026-01-10 14:00:00'
└── planned_minutes: 60

THEN User completes session:
└── UPDATE study_sessions SET:
    ├── end_time: '2026-01-10 15:05:00'
    ├── actual_minutes: 65
    ├── quality_rating: 2 (struggled, low score) ⚠️
    └── status: 'completed'
```

#### Session 2 (January 12)
```
UPDATE study_sessions:
├── end_time: '2026-01-12 15:45:00'
├── actual_minutes: 55
├── quality_rating: 3 (average)
└── status: 'completed'
```

#### Session 3 (January 15)
```
UPDATE study_sessions:
├── end_time: '2026-01-15 16:30:00'
├── actual_minutes: 60
├── quality_rating: 4 (good)
└── status: 'completed'
```

---

## 4. Scheduler Queries This Data

**Location:** [scheduler.js Lines 103-112](../src/services/scheduler.js#L103)

```javascript
// When generating schedule, engine queries:
SELECT 
    topic_id,
    AVG(quality_rating) as avg_score,         // Average of all sessions: (2+3+4)/3 = 3
    COUNT(*) as session_count,                 // 3 sessions
    MAX(start_time) as last_studied,          // '2026-01-15 16:30:00'
    SUM(actual_minutes) as total_minutes      // 65+55+60 = 180 minutes
FROM study_sessions
WHERE user_id = $1 AND topic_id IS NOT NULL AND status = 'completed'
GROUP BY topic_id
```

**Results for Calculus:**
```javascript
{
    topic_id: 'calc-uuid',
    avg_score: 3,              // 3/5 = average performance
    session_count: 3,
    last_studied: '2026-01-15',
    total_minutes: 180
}
```

---

## 5. Conversion & Usage in Priority Calculation

```javascript
// In getPrioritizedTopics() [scheduler.js Line 153]:
const performance = performanceMap[topic.id] = {
    avg_score: parseFloat(3) * 20,  // CONVERT: 3 → 60 (0-100 scale)
    session_count: 3,
    last_studied: '2026-01-15',
    total_minutes: 180
}

// Then in calculateTopicPriority():
const avgScore = 60;  // 0-100 scale

if (avgScore < 60) {
    priority += 5;  // Calculus gets +5 boost (weak topic)
}

// Days since studied:
const daysSinceStudied = 1;  // Today is 2026-01-16, last was 2026-01-15
if (daysSinceStudied >= 3) {
    priority += 1; // No spaced repetition boost yet (too recent)
}
```

---

## 6. Complete Data Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│                    USER ACTIVITY                             │
│                                                               │
│  1. Click "Start Session" on Calculus topic                 │
│     ↓                                                         │
│  2. Study for 60-65 minutes                                  │
│     ↓                                                         │
│  3. Click "Complete Session"                                 │
│     ↓                                                         │
│  4. Rate quality (1-5 scale): "2 - Struggled"               │
│     ↓                                                         │
│  5. Click "Save"                                             │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│               STUDY_SESSIONS TABLE                           │
│                                                               │
│  INSERT/UPDATE study_sessions:                              │
│  ├── user_id: Amlan De                                      │
│  ├── topic_id: Calculus                                     │
│  ├── start_time: 2026-01-15 16:30:00                       │
│  ├── end_time: 2026-01-15 17:35:00                         │
│  ├── actual_minutes: 65                                     │
│  ├── quality_rating: 2 ⚠️                                   │
│  └── status: 'completed'                                    │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│           SCHEDULER ANALYSIS (On "Generate")                 │
│                                                               │
│  Query all study_sessions for user:                         │
│  GROUP BY topic_id                                          │
│                                                               │
│  For Calculus:                                               │
│  ├── avg_score: 3 → 60/100 (performance)                   │
│  ├── session_count: 3 (studied 3 times)                     │
│  ├── last_studied: 2026-01-15 (1 day ago)                  │
│  ├── total_minutes: 180 (3 hours total)                     │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│        PRIORITY CALCULATION                                  │
│                                                               │
│  Factors:                                                     │
│  ├── Subject importance (Math): 5 × 3 = 15 pts              │
│  ├── Difficulty (Hard): 3 × 2 = 6 pts                      │
│  ├── Days until exam (25 days): 2 × 5 = 10 pts             │
│  ├── Topic importance: 5 × 2 = 10 pts                      │
│  ├── WEAK TOPIC (avg_score=60): +5 pts ⚠️                  │
│  ├── Spaced repetition (1 day, recent): 0 pts               │
│  └── TOTAL PRIORITY: 15+6+10+10+5 = 46 pts                 │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│        SCHEDULE GENERATION                                   │
│                                                               │
│  Topics sorted by priority (highest first):                 │
│  1. Calculus (46 pts) ← Scheduled first!                    │
│  2. Algebra (38 pts)                                        │
│  3. World War II (32 pts)                                   │
│                                                               │
│  Tasks created:                                              │
│  └── "Study: Calculus" (60 min) on Jan 16, 17, 18...       │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              WEEKLY PLAN VIEW                                │
│                                                               │
│  User sees:                                                  │
│  ├── MON 12: Study Calculus (60 min)                        │
│  ├── TUE 13: Study Calculus (60 min)                        │
│  ├── WED 14: Study Algebra (60 min)                         │
│  ├── THU 15: Study World War II (60 min)                    │
│  └── ... (cycle continues)                                  │
│                                                               │
│  Calculus appears MORE OFTEN because:                        │
│  → Quality rating was LOW (2/5)                             │
│  → Engine prioritizes weak topics!                          │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Key Data Fields Explained

| Field | Source | How It Gets There | Used For |
|-------|--------|-------------------|----------|
| **quality_rating** | User input | User enters 1-5 at end of session | Performance-based priority boost |
| **actual_minutes** | Calculated | (end_time - start_time) | Remaining hours calculation |
| **last_studied** | Automatic | MAX(start_time) from sessions | Spaced repetition boost |
| **total_minutes** | Calculated | SUM(actual_minutes) all sessions | Remaining hours = estimated - total |
| **avg_score** | Calculated | AVG(quality_rating) all sessions | Weak topic detection |
| **session_count** | Calculated | COUNT(*) of sessions | Confidence in performance data |

---

## 8. Real-Time Example Flow

**Scenario:** You just completed a Calculus study session with quality rating of 2

```
TIME: 2026-01-15 17:35 (You click "Complete")
    ↓
study_sessions table updated:
- end_time = '2026-01-15 17:35:00'
- actual_minutes = 65
- quality_rating = 2
- status = 'completed'
    ↓
TIME: 2026-01-16 10:00 (You click "Generate Schedule")
    ↓
Scheduler queries study_sessions:
- Sees: avg_score = (2+3+4)/3 = 3.0
- Converts: 3.0 × 20 = 60/100 (weak)
    ↓
Priority calculation:
- Weak topic boost: +5 (because avg_score < 60)
    ↓
Result:
- Calculus gets HIGH priority
- Appears in today's and this week's schedule
- Scheduled multiple times (because weak)
- Gets 60-minute sessions (because important + weak)
```

---

## Summary

The scheduler engine gets all its performance data from the **study_sessions table** which is populated when you:

1. **Start a session** → `start_time` is recorded
2. **Study** → You spend actual time
3. **Complete session** → `end_time`, `actual_minutes`, and `quality_rating` are recorded
4. **Engine analyzes** → Calculates priorities based on your performance

If a topic has low quality ratings, the scheduler automatically gives it higher priority and schedules more time for it!
