# SmartSched Intelligent Scheduling Engine - Performance & Weak Topic Detection

## How It Detects Weak Topics & Performance

### 1. **Data Source: study_sessions Table**

The engine reads from the `study_sessions` table which contains:
- `topic_id` - Which topic was studied
- `quality_rating` - Your performance score (1-5 scale)
- `start_time` - When the topic was last studied
- `actual_minutes` - How long you studied
- `status` - 'completed' or other

**SQL Query (Lines 103-112):**
```javascript
SELECT 
    topic_id,
    AVG(quality_rating) as avg_score,
    COUNT(*) as session_count,
    MAX(start_time) as last_studied,
    SUM(actual_minutes) as total_minutes
FROM study_sessions
WHERE user_id = $1 AND topic_id IS NOT NULL AND status = 'completed'
GROUP BY topic_id
```

### 2. **Performance Score Conversion**

The quality_rating (1-5) is converted to 0-100 scale:

```javascript
avg_score: parseFloat(p.avg_score) * 20 || 0  // Converts 1-5 to 0-100
```

| Quality Rating | Converted Score |
|---|---|
| 5 (Excellent) | 100 |
| 4 (Good) | 80 |
| 3 (Average) | 60 |
| 2 (Weak) | 40 |
| 1 (Very Weak) | 20 |

### 3. **Weak Topic Detection in Priority Calculation**

Once performance data is fetched, the `calculateTopicPriority()` function (Lines 33-98) applies these boosts for weak topics:

#### Performance-Based Boosts:

```javascript
if (performanceData && performanceData.session_count > 0) {
    const avgScore = performanceData.avg_score; // 0-100 scale
    
    if (avgScore < 40) {
        priority += 8; // CRITICAL - needs major attention ⚠️
    } else if (avgScore < 60) {
        priority += 5; // MAJOR boost for weak topics
    } else if (avgScore < 75) {
        priority += 3; // Moderate boost
    } else if (avgScore >= 90) {
        priority -= 2; // Slight reduction for mastered topics
    }
} else {
    // Never studied before - high priority to get started
    priority += 8;
}
```

### 4. **Topics Never Studied**

If a topic has NO study_sessions records:
- `performanceData` is `null`
- Engine gives it **+8 priority boost** (same as critical weak topics)
- This ensures new topics are scheduled right away

### 5. **Spaced Repetition Check**

The engine also tracks when you last studied a topic:

```javascript
if (performanceData && performanceData.last_studied) {
    const daysSinceStudied = Math.ceil((new Date() - new Date(performanceData.last_studied)) / (1000 * 60 * 60 * 24));
    
    if (daysSinceStudied >= 30) {
        priority += 6; // Major revision needed
    } else if (daysSinceStudied >= 14) {
        priority += 4; // Review recommended
    } else if (daysSinceStudied >= 7) {
        priority += 2; // Light review
    } else if (daysSinceStudied >= 3) {
        priority += 1; // Minor boost
    }
}
```

## Complete Priority Formula

```
PRIORITY SCORE = 
    (Subject Importance × 3) +
    (Topic Difficulty × 2) +
    (Exam Urgency × 5) +
    (Topic Importance × 2) +
    [Performance Boost: +8 (critical), +5 (weak), +3 (average), -2 (mastered)] +
    [Spaced Repetition Boost: +0.5 to +6] -
    [Completion Penalty: -15 if completed]
```

## Example Scenario

**Your Study Data:**
- **Mathematics > Calculus**
  - Subject Priority: 5
  - Topic Difficulty: Hard (3)
  - Topic Importance: 5
  - Last Quality Rating: 2/5 (40/100) ⚠️ **WEAK**
  - Last Studied: 40 days ago
  - Estimated Hours: 4

**Priority Calculation:**
- Subject importance: 5 × 3 = **15**
- Difficulty: 3 × 2 = **6**
- Urgency (exam in 25 days): ~2.4 × 5 = **12**
- Topic importance: 5 × 2 = **10**
- **Weak topic boost: +8** (avg_score < 60)
- **Spaced repetition boost: +6** (40 days since studied)
- **TOTAL: 15 + 6 + 12 + 10 + 8 + 6 = 57 points** ← HIGH PRIORITY

Compare to a mastered topic with recent study → gets much lower score → scheduled later

## How the Engine Uses This Data

1. **Fetches all topics** for the user
2. **Queries study_sessions** to get performance and timing data
3. **Calculates priority score** for each topic using the formula above
4. **Sorts topics by priority** (highest first)
5. **Generates tasks** in priority order during schedule generation
6. **Tasks are distributed** across your daily study hours

## Testing This Feature

To see weak topics being prioritized:

1. **Add study sessions with low quality ratings** (1-2) for a topic
2. **Generate a schedule** 
3. **Check the Tasks view** - that weak topic should appear more frequently or earlier
4. **Check the Weekly Plan** - weak topics should have more sessions scheduled

## Key Insight

The scheduling engine is **adaptive** - it learns from your actual performance (quality_rating) and automatically schedules more time for topics you struggle with, less time for topics you've mastered, and brings back topics you haven't reviewed in a while based on optimal spaced repetition intervals.
