# 🎓 SmartSched Phase 4: AI Integration - Complete Technical Documentation

## 📋 Executive Summary

Phase 4 transformed SmartSched from a traditional study scheduling application into an **AI-powered intelligent learning platform**. This phase introduced Google Gemini AI integration, enabling students to get instant explanations, generate study notes, practice with AI-generated questions, upload and analyze study materials, and save/organize their AI-generated content.

**Key Achievements:**
- ✅ Full Gemini AI integration (gemini-2.5-flash model)
- ✅ 5 AI interaction types (Explain, Notes, Questions, Ask, Analyze)
- ✅ Study materials upload and management system
- ✅ Saved Notes feature with filtering and organization
- ✅ Seamless integration with existing subjects/topics
- ✅ Reminder system linked to AI study sessions

---

## 🏗️ Architecture Overview

### System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser)                            │
├─────────────────────────────────────────────────────────────────────┤
│  EJS Templates → HTML/CSS/JavaScript                                │
│  - assistant.ejs (AI Interface)                                     │
│  - notes/index.ejs, view.ejs (Notes Management)                     │
│  - materials/index.ejs, upload.ejs, view.ejs (File Management)      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      EXPRESS.JS SERVER                              │
├─────────────────────────────────────────────────────────────────────┤
│  Routes:                                                            │
│  ├── /ai/* (AI interactions)                                        │
│  ├── /notes/* (Saved notes CRUD)                                    │
│  ├── /materials/* (File uploads)                                    │
│  └── /reminders/* (Review reminders)                                │
├─────────────────────────────────────────────────────────────────────┤
│  Services:                                                          │
│  └── aiService.js (Gemini AI wrapper)                               │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
           ┌──────────────┐ ┌─────────────┐ ┌─────────────┐
           │  PostgreSQL  │ │ Google      │ │ File System │
           │  Database    │ │ Gemini AI   │ │ (uploads/)  │
           └──────────────┘ └─────────────┘ └─────────────┘
```

### Data Flow

```
User Action → Route Handler → AI Service → Gemini API
                    │                           │
                    ▼                           │
              Save to DB ◄──────────────────────┘
                    │
                    ▼
            Render Response
```

---

## 📁 Complete File Structure (Phase 4 Additions)

```
smartSched/
├── src/
│   ├── routes/
│   │   ├── ai.js              ← NEW: AI interaction endpoints
│   │   ├── materials.js       ← NEW: File upload/management
│   │   ├── notes.js           ← NEW: Saved notes CRUD
│   │   └── reminders.js       ← MODIFIED: Added review type
│   │
│   ├── services/
│   │   └── aiService.js       ← NEW: Gemini AI wrapper service
│   │
│   ├── views/
│   │   ├── ai/
│   │   │   ├── assistant.ejs  ← NEW: Main AI interface (1500+ lines)
│   │   │   └── history.ejs    ← NEW: AI interaction history
│   │   │
│   │   ├── materials/
│   │   │   ├── index.ejs      ← NEW: Materials list
│   │   │   ├── upload.ejs     ← NEW: Upload form
│   │   │   └── view.ejs       ← NEW: View/analyze material
│   │   │
│   │   ├── notes/
│   │   │   ├── index.ejs      ← NEW: Notes list with filters
│   │   │   └── view.ejs       ← NEW: View/edit single note
│   │   │
│   │   ├── reminders/
│   │   │   └── form.ejs       ← MODIFIED: Added review type
│   │   │
│   │   └── partials/
│   │       └── sidebar.ejs    ← MODIFIED: Added AI Tools section
│   │
│   ├── database/
│   │   ├── add-ai-tables.js   ← NEW: Migration for AI tables
│   │   └── add-notes-table.js ← NEW: Migration for notes table
│   │
│   └── server.js              ← MODIFIED: Added new routes
│
└── uploads/                   ← NEW: User uploaded files
    └── {user-uuid}/
        └── {filename}
```

---

## 🗄️ Database Schema

### New Tables

#### 1. ai_interactions
Stores all AI conversation history.

```sql
CREATE TABLE ai_interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
    topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
    interaction_type VARCHAR(50) NOT NULL,
    -- Types: 'explanation', 'notes', 'questions', 'answer', 'analysis', 'summary'
    prompt TEXT NOT NULL,
    response TEXT NOT NULL,
    response_time INTEGER,  -- milliseconds
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_ai_interactions_user_id ON ai_interactions(user_id);
CREATE INDEX idx_ai_interactions_type ON ai_interactions(interaction_type);
CREATE INDEX idx_ai_interactions_created ON ai_interactions(created_at DESC);
```

#### 2. user_files
Stores uploaded study materials metadata.

```sql
CREATE TABLE user_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
    original_filename VARCHAR(255) NOT NULL,
    stored_filename VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_user_files_user_id ON user_files(user_id);
CREATE INDEX idx_user_files_subject_id ON user_files(subject_id);
```

#### 3. saved_notes
Stores user-saved AI-generated content.

```sql
CREATE TABLE saved_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    note_type VARCHAR(50) DEFAULT 'notes',
    -- Types: 'explanation', 'notes', 'questions', 'summary', 'analysis'
    subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
    topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
    ai_interaction_id UUID REFERENCES ai_interactions(id) ON DELETE SET NULL,
    is_favorite BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for filtering and sorting
CREATE INDEX idx_saved_notes_user_id ON saved_notes(user_id);
CREATE INDEX idx_saved_notes_subject_id ON saved_notes(subject_id);
CREATE INDEX idx_saved_notes_note_type ON saved_notes(note_type);
CREATE INDEX idx_saved_notes_created_at ON saved_notes(created_at DESC);
```

### Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   users     │───────│  subjects   │───────│   topics    │
└─────────────┘  1:N  └─────────────┘  1:N  └─────────────┘
      │                     │                     │
      │                     │                     │
      │    ┌────────────────┼────────────────┐   │
      │    │                │                │   │
      ▼    ▼                ▼                ▼   ▼
┌──────────────────┐  ┌─────────────┐  ┌─────────────────┐
│ ai_interactions  │  │ user_files  │  │  saved_notes    │
└──────────────────┘  └─────────────┘  └─────────────────┘
         │
         │ 1:1 (optional)
         ▼
┌─────────────────┐
│  saved_notes    │
└─────────────────┘
```

---

## 🔌 API Endpoints Reference

### AI Routes (`/ai`)

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| GET | `/ai/assistant` | Main AI interface page | - | HTML |
| POST | `/ai/explain` | Get AI explanation | `{topic, subjectId?, topicId?}` | `{success, data, interactionId}` |
| POST | `/ai/notes` | Generate study notes | `{topic, subjectId?, topicId?}` | `{success, data, interactionId}` |
| POST | `/ai/questions` | Generate practice questions | `{topic, subjectId?, topicId?}` | `{success, data, interactionId}` |
| POST | `/ai/ask` | Ask custom question | `{question, subjectId?, topicId?}` | `{success, data, interactionId}` |
| POST | `/ai/analyze` | Analyze uploaded file | `{fileId}` | `{success, data}` |
| POST | `/ai/summarize` | Summarize content | `{fileId}` | `{success, data}` |
| GET | `/ai/interaction/:id` | Get single interaction | - | `{success, data}` |
| GET | `/ai/history` | All AI history page | - | HTML |

### Materials Routes (`/materials`)

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| GET | `/materials` | List all materials | - | HTML |
| GET | `/materials/upload` | Upload form page | - | HTML |
| POST | `/materials/upload` | Process file upload | `multipart/form-data` | Redirect |
| GET | `/materials/:id` | View single material | - | HTML |
| GET | `/materials/:id/download` | Download file | - | File |
| DELETE | `/materials/:id` | Delete material | - | `{success}` |

### Notes Routes (`/notes`)

| Method | Endpoint | Description | Query Params | Response |
|--------|----------|-------------|--------------|----------|
| GET | `/notes` | List with filters | `subject, type, search, sort` | HTML |
| POST | `/notes/save` | Save new note | `{title, content, note_type, subject_id?, topic_id?}` | `{success, noteId}` |
| GET | `/notes/:id` | View single note | - | HTML |
| PUT | `/notes/:id` | Update note | `{title, content}` | `{success}` |
| DELETE | `/notes/:id` | Delete note | - | `{success}` |
| POST | `/notes/:id/favorite` | Toggle favorite | - | `{success, is_favorite}` |

---

## 🤖 AI Service Implementation

### aiService.js Overview

```javascript
// Core service structure
const { GoogleGenerativeAI } = require('@google/generative-ai');

class AIService {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = this.genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash" 
        });
    }

    // Main methods
    async explainTopic(topic, context) { ... }
    async generateNotes(topic, context) { ... }
    async generateQuestions(topic, context) { ... }
    async answerQuestion(question, context) { ... }
    async analyzeDocument(content, filename) { ... }
    async summarizeDocument(content, filename) { ... }
}
```

### AI Prompt Templates

#### Explanation Prompt
```
You are an expert tutor. Explain the following topic in a clear, 
comprehensive way suitable for a student:

Topic: {topic}
Subject Context: {subject}

Provide:
1. A clear definition
2. Key concepts and principles
3. Real-world examples
4. Common misconceptions to avoid
5. Summary points

Format your response with clear headings and bullet points.
```

#### Notes Generation Prompt
```
Create comprehensive study notes for the following topic:

Topic: {topic}
Subject: {subject}

Structure the notes with:
- Main headings and subheadings
- Key definitions highlighted
- Important formulas/concepts in boxes
- Bullet points for easy scanning
- Summary section at the end

Make the notes suitable for exam revision.
```

#### Questions Generation Prompt
```
Generate practice questions for the following topic:

Topic: {topic}
Subject: {subject}

Create a mix of:
1. 3 Multiple Choice Questions (with 4 options each)
2. 2 Short Answer Questions
3. 1 Long Answer/Essay Question

For MCQs, indicate the correct answer.
For all questions, provide brief model answers.
```

---

## 🎨 UI/UX Components

### AI Assistant Interface

```
┌─────────────────────────────────────────────────────────────┐
│  AI Assistant                                        Stats  │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │ Controls Panel  │  │       Results Panel             │  │
│  │                 │  │                                 │  │
│  │ [Subject ▼]     │  │  ┌─────────────────────────┐   │  │
│  │ [Topic ▼]       │  │  │   AI Response           │   │  │
│  │                 │  │  │                         │   │  │
│  │ Or custom topic │  │  │   Formatted content     │   │  │
│  │ [___________]   │  │  │   with headings,        │   │  │
│  │                 │  │  │   bullet points,        │   │  │
│  │ Actions:        │  │  │   and examples          │   │  │
│  │ [💡 Explain   ] │  │  │                         │   │  │
│  │ [📝 Notes     ] │  │  │                         │   │  │
│  │ [❓ Questions ] │  │  │                         │   │  │
│  │ [💬 Ask       ] │  │  └─────────────────────────┘   │  │
│  │                 │  │                                 │  │
│  │ Recent:         │  │  Actions: [💾][🔔][📋][🖨]     │  │
│  │ - Item 1        │  │                                 │  │
│  │ - Item 2        │  │                                 │  │
│  └─────────────────┘  └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Notes Management Interface

```
┌─────────────────────────────────────────────────────────────┐
│  📓 My Notes                               [Total: 12]      │
├─────────────────────────────────────────────────────────────┤
│  Filters: [Subject ▼] [Type ▼] [🔍 Search...] [Sort ▼]     │
│                                                             │
│  Type Badges:                                               │
│  [All (12)] [💡 Explanations (3)] [📝 Notes (5)]           │
│  [❓ Questions (2)] [📄 Summaries (2)]                      │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ 📝  ⭐       │  │ 💡  ⭐       │  │ ❓  ⭐       │      │
│  │              │  │              │  │              │      │
│  │ Notes: Topic │  │ Explain: X   │  │ Questions: Y │      │
│  │ ● Subject    │  │ ● Subject    │  │ ● Subject    │      │
│  │              │  │              │  │              │      │
│  │ Preview...   │  │ Preview...   │  │ Preview...   │      │
│  │              │  │              │  │              │      │
│  │ 📅 Jan 17    │  │ 📅 Jan 16    │  │ 📅 Jan 15    │      │
│  │ [View] [🗑]  │  │ [View] [🗑]  │  │ [View] [🗑]  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔧 Key JavaScript Functions

### AI Request Handler (Frontend)

```javascript
async function performAIAction(action) {
    const topic = customTopic.value || topicSelect.options[topicSelect.selectedIndex].text;
    
    showLoading();
    
    try {
        const response = await fetch(`/ai/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                topic: topic,
                subjectId: subjectSelect.value || null,
                topicId: topicSelect.value || null
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            displayResults(result.data, action);
            currentInteractionId = result.interactionId;
        } else {
            showError(result.error);
        }
    } catch (error) {
        showError('Failed to get AI response');
    }
}
```

### Save Note Handler

```javascript
document.getElementById('saveNoteBtn').addEventListener('click', async function() {
    const content = document.getElementById('resultsContainer').innerHTML;
    
    const response = await fetch('/notes/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: `${noteType}: ${topicName}`,
            content: content,
            note_type: noteType,
            subject_id: subjectId,
            topic_id: topicId
        })
    });
    
    const result = await response.json();
    if (result.success) {
        showToast('Note saved!', 'success');
    }
});
```

### Dynamic Topic Loading

```javascript
subjectSelect.addEventListener('change', async function() {
    const subjectId = this.value;
    topicSelect.innerHTML = '<option value="">Loading...</option>';
    
    if (subjectId) {
        const response = await fetch(`/api/subjects/${subjectId}/topics`);
        const topics = await response.json();
        
        topicSelect.innerHTML = '<option value="">Select a topic</option>';
        topics.forEach(topic => {
            topicSelect.innerHTML += `<option value="${topic.id}">${topic.name}</option>`;
        });
    }
});
```

---

## 🔒 Security Implementation

### Authentication Middleware

```javascript
const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        next();
    } else {
        res.redirect('/auth/login');
    }
};

// Applied to all AI, notes, and materials routes
router.use(isAuthenticated);
```

### User Data Isolation

```javascript
// All queries include user_id filter
const notes = await pool.query(`
    SELECT * FROM saved_notes 
    WHERE user_id = $1
    ORDER BY created_at DESC
`, [req.session.user.id]);
```

### File Upload Security

```javascript
// Multer configuration with restrictions
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // User-specific directory using UUID
        const userDir = path.join(uploadsDir, req.session.user.id);
        fs.mkdirSync(userDir, { recursive: true });
        cb(null, userDir);
    },
    filename: (req, file, cb) => {
        // Unique filename prevents overwrites
        const uniqueName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        cb(null, uniqueName + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    fileFilter: (req, file, cb) => {
        const allowed = ['application/pdf', 'text/plain', 
                        'application/msword', 'application/vnd.openxmlformats...'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'));
        }
    }
});
```

---

## 📊 Statistics & Analytics

### AI Usage Stats (Dashboard)

```javascript
// Fetch AI interaction counts
const stats = await pool.query(`
    SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE interaction_type = 'explanation') as explanations,
        COUNT(*) FILTER (WHERE interaction_type = 'notes') as notes,
        COUNT(*) FILTER (WHERE interaction_type = 'questions') as questions
    FROM ai_interactions
    WHERE user_id = $1
`, [userId]);
```

### Recent Interactions

```javascript
// Get last 5 interactions for sidebar
const recent = await pool.query(`
    SELECT id, interaction_type, prompt, created_at
    FROM ai_interactions
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT 5
`, [userId]);
```

---

## 🐛 Issues Fixed During Development

| Issue | Cause | Solution |
|-------|-------|----------|
| UUID rendering as `[object Object]` | Passing object instead of string | Access `.id` property |
| pdf-parse v2 API error | API change in library | Use `pdf(buffer)` format |
| Session userId mismatch | Different session key | Changed to `req.session.user.id` |
| Notes page redirecting | Wrong session check | Fixed auth middleware |
| HTML in note preview | Raw HTML stored | Added HTML tag stripping regex |
| Content overlap on scroll | CSS sticky positioning | Changed to scrollable containers |
| Recent items not clickable | Missing event handlers | Added click handlers with fetch |

---

## 🧪 Testing Checklist

### AI Assistant Tests
- [ ] Select subject → topics load dynamically
- [ ] Enter custom topic
- [ ] Click "Explain Topic" → AI responds
- [ ] Click "Generate Notes" → formatted notes appear
- [ ] Click "Practice Questions" → MCQs and questions appear
- [ ] Click "Ask a Question" with custom input
- [ ] Response displays with proper formatting
- [ ] Copy button copies content
- [ ] Save button saves to My Notes
- [ ] Reminder button opens pre-filled form
- [ ] Recent items load past interactions

### Materials Tests
- [ ] Upload PDF file (< 10MB)
- [ ] Upload TXT file
- [ ] View uploaded file details
- [ ] Analyze with AI
- [ ] Summarize with AI
- [ ] Download file
- [ ] Delete file

### Notes Tests
- [ ] View all saved notes
- [ ] Filter by subject
- [ ] Filter by type (explanation/notes/questions)
- [ ] Search by keyword
- [ ] Sort by date/title/subject
- [ ] View single note
- [ ] Edit note content
- [ ] Toggle favorite
- [ ] Print note
- [ ] Copy note content
- [ ] Delete note

---

## ⚙️ Configuration

### Environment Variables

```env
# Required for Phase 4
GEMINI_API_KEY=your_google_gemini_api_key

# Existing
DATABASE_URL=postgresql://user:pass@localhost:5432/smartsched
SESSION_SECRET=your_session_secret
NODE_ENV=development
PORT=3000
```

### Getting Gemini API Key

1. Go to https://makersuite.google.com/app/apikey
2. Sign in with Google account
3. Click "Create API Key"
4. Copy the key to `.env` file

---

## 🚀 Deployment Considerations

### Production Checklist

1. **Environment Variables**
   - Set `NODE_ENV=production`
   - Use strong `SESSION_SECRET`
   - Configure production database URL

2. **File Storage**
   - Consider cloud storage (S3, GCS) for uploads
   - Set up proper backup for uploads directory

3. **Database**
   - Run all migrations
   - Set up connection pooling
   - Configure proper indexes

4. **Security**
   - Enable HTTPS
   - Set secure cookie flag
   - Rate limit AI endpoints
   - Validate file uploads server-side

---

## 📈 Future Enhancements (Phase 5 Ideas)

1. **Flashcard Generation** - Auto-generate flashcards from notes
2. **Quiz Mode** - Interactive quizzes with scoring
3. **Voice Input** - Ask questions by speaking
4. **Collaborative Notes** - Share notes with classmates
5. **AI Chat History** - Conversational follow-ups
6. **Smart Scheduling** - AI suggests study times based on difficulty
7. **Progress Tracking** - Track topics mastered via AI
8. **Export Options** - Export notes to PDF/Word
9. **Mobile App** - React Native companion app
10. **Offline Mode** - Cache AI responses for offline access

---

## 📝 Summary

Phase 4 successfully transformed SmartSched into an AI-powered study platform with:

- **4 New Routes** (ai, materials, notes + modified reminders)
- **1 New Service** (aiService.js)
- **3 New Database Tables** (ai_interactions, user_files, saved_notes)
- **8 New View Files** (assistant, history, materials×3, notes×2)
- **15+ API Endpoints** for AI, materials, and notes
- **Complete CRUD** for saved notes with filtering
- **File Upload System** with security measures
- **Integrated UI** with responsive design

**Total Lines of Code Added:** ~4,000+ lines
**Development Time:** Multiple sessions
**Technologies Integrated:** Google Gemini AI, Multer, pdf-parse

---

*Phase 4 Complete - SmartSched is now AI-powered! 🎉*

*Documentation Version: 1.0*
*Last Updated: January 17, 2026*
