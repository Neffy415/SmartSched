# 🎓 SmartSched - Complete Beginner's Guide

## Welcome! Let's Learn Step by Step 👋

This guide will teach you everything about this project like you're learning for the first time. No prior knowledge needed!

---

# 📚 PART 1: THE BASICS - What is This Project?

## What Does SmartSched Do?

SmartSched is a **web application** (a website that does stuff) for students to:
- 📅 Schedule their study sessions
- 📝 Manage subjects and topics
- 🤖 Get AI help for studying
- 📄 Upload study materials
- 💾 Save notes from AI

Think of it like a smart study planner that lives on the internet!

---

## How Does a Web Application Work?

Imagine a restaurant:

```
🧑 Customer (YOU - the Browser)
        ↓
    "I want pizza!" (HTTP Request)
        ↓
👨‍🍳 Kitchen (SERVER - Node.js)
        ↓
    Makes the pizza (Processes request)
        ↓
📦 Fridge (DATABASE - PostgreSQL)
        ↓
    Gets ingredients (Data)
        ↓
🍕 Pizza delivered! (HTTP Response - HTML page)
```

**In technical terms:**
- **Browser** = Where you see the website (Chrome, Firefox)
- **Server** = Computer program that handles requests (Node.js)
- **Database** = Where all data is stored (PostgreSQL)
- **Request** = When you click a button or visit a page
- **Response** = What the server sends back (HTML, JSON)

---

# 📁 PART 2: PROJECT STRUCTURE - What's in Each Folder?

```
smartSched/
│
├── 📁 src/                    ← All our code lives here
│   ├── 📄 server.js           ← THE BRAIN - starts everything
│   │
│   ├── 📁 config/
│   │   └── database.js        ← How to connect to database
│   │
│   ├── 📁 routes/             ← URL handlers (what happens when you visit a page)
│   │   ├── auth.js            ← Login/Register
│   │   ├── ai.js              ← AI features
│   │   ├── notes.js           ← Notes feature
│   │   └── ...more
│   │
│   ├── 📁 services/           ← Business logic (the actual work)
│   │   ├── aiService.js       ← Talks to Google AI
│   │   └── scheduler.js       ← Schedule calculations
│   │
│   ├── 📁 views/              ← HTML templates (what you see)
│   │   ├── 📁 ai/
│   │   ├── 📁 notes/
│   │   └── ...more
│   │
│   └── 📁 database/           ← Database setup scripts
│
├── 📁 uploads/                ← Where uploaded files go
├── 📄 package.json            ← Project info & dependencies
└── 📄 .env                    ← Secret passwords (never share!)
```

---

# 🧠 PART 3: THE SERVER - The Brain of Our App

## What is `server.js`?

This is the **main file** that starts everything. When you run `npm start`, this file runs!

Let me explain it piece by piece:

```javascript
// ═══════════════════════════════════════════════════════════════
// STEP 1: IMPORTING TOOLS (Like getting your cooking utensils)
// ═══════════════════════════════════════════════════════════════

const express = require('express');
// What is Express? 
// It's a framework (pre-built code) that makes building websites easier
// Without Express, we'd have to write 100s of lines of code ourselves

const session = require('express-session');
// What is a Session?
// When you login, the server remembers you. That memory = Session
// It's like a wristband at a theme park - proves you paid entry

const path = require('path');
// What is Path?
// Helps us work with file locations
// Example: path.join('folder', 'file.txt') → 'folder/file.txt'

require('dotenv').config();
// What is dotenv?
// Loads secret passwords from .env file
// We don't want passwords in our code (someone might see them!)


// ═══════════════════════════════════════════════════════════════
// STEP 2: CREATING THE APP
// ═══════════════════════════════════════════════════════════════

const app = express();
// This creates our web application
// Think of it as: "I'm opening a restaurant called 'app'"


// ═══════════════════════════════════════════════════════════════
// STEP 3: MIDDLEWARE (Things that happen to EVERY request)
// ═══════════════════════════════════════════════════════════════

app.use(express.json());
// This lets us read JSON data from requests
// JSON = JavaScript Object Notation, like: {"name": "John", "age": 20}

app.use(express.urlencoded({ extended: true }));
// This lets us read form data (when user submits a form)

app.use(express.static(path.join(__dirname, 'public')));
// This serves static files (CSS, images, JavaScript)
// When browser asks for "styles.css", this finds and sends it


// ═══════════════════════════════════════════════════════════════
// STEP 4: SETTING UP VIEWS (HTML Templates)
// ═══════════════════════════════════════════════════════════════

app.set('view engine', 'ejs');
// What is EJS?
// It's HTML with superpowers! We can put JavaScript inside HTML
// Example: <h1>Hello <%= username %></h1> becomes <h1>Hello John</h1>

app.set('views', path.join(__dirname, 'views'));
// Tells Express where our HTML templates are


// ═══════════════════════════════════════════════════════════════
// STEP 5: CONNECTING ROUTES
// ═══════════════════════════════════════════════════════════════

const authRoutes = require('./routes/auth');
const aiRoutes = require('./routes/ai');
const notesRoutes = require('./routes/notes');

app.use('/auth', authRoutes);    // URLs starting with /auth go to auth.js
app.use('/ai', aiRoutes);        // URLs starting with /ai go to ai.js
app.use('/notes', notesRoutes);  // URLs starting with /notes go to notes.js

// Example:
// User visits: http://localhost:3000/notes
// Express sees "/notes" and says "Let notes.js handle this!"


// ═══════════════════════════════════════════════════════════════
// STEP 6: STARTING THE SERVER
// ═══════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;
// Use port from .env file, or default to 3000

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
// This "opens the restaurant" - server starts listening for visitors
```

---

# 🗄️ PART 4: THE DATABASE - Where Data Lives

## What is a Database?

A database is like a **super organized filing cabinet**. Instead of papers, it stores data in **tables**.

### What is PostgreSQL?

PostgreSQL (or "Postgres") is a **database program**. It's like Excel, but:
- Much faster
- Can handle millions of rows
- Multiple people can use it at once
- Accessible from code

### Understanding Tables

A table is like a spreadsheet:

```
TABLE: users
┌──────────────────────────────────────────────────────────────┐
│ id (UUID)          │ email           │ password  │ name     │
├──────────────────────────────────────────────────────────────┤
│ abc-123-def        │ john@email.com  │ ****      │ John     │
│ xyz-789-ghi        │ jane@email.com  │ ****      │ Jane     │
└──────────────────────────────────────────────────────────────┘

TABLE: subjects
┌──────────────────────────────────────────────────────────────┐
│ id (UUID)          │ user_id         │ name      │ color    │
├──────────────────────────────────────────────────────────────┤
│ sub-111            │ abc-123-def     │ Math      │ #FF5733  │
│ sub-222            │ abc-123-def     │ Science   │ #33FF57  │
└──────────────────────────────────────────────────────────────┘
```

### What is a UUID?

UUID = Universally Unique Identifier
- It's a random string like: `550e8400-e29b-41d4-a716-446655440000`
- Used as ID because it's guaranteed to be unique
- Better than numbers (1, 2, 3) because it works across multiple servers

### What is a Foreign Key?

Look at `user_id` in the subjects table. It **references** the `id` in users table.
This creates a **relationship**: "This subject belongs to this user"

```
users.id ──────────────────────┐
                               │ FOREIGN KEY
subjects.user_id ◄─────────────┘
```

---

## Database Connection Code Explained

### `config/database.js`

```javascript
// ═══════════════════════════════════════════════════════════════
// DATABASE CONNECTION FILE
// ═══════════════════════════════════════════════════════════════

const { Pool } = require('pg');
// 'pg' is the PostgreSQL library for Node.js
// 'Pool' is a connection pool (explained below)

// What is a Connection Pool?
// Instead of connecting to database every time (slow),
// we keep several connections ready (fast!)
// Like having multiple phone lines instead of one

const pool = new Pool({
    host: process.env.DB_HOST,         // Where database lives (usually 'localhost')
    port: process.env.DB_PORT,         // Door number (usually 5432)
    database: process.env.DB_NAME,     // Database name
    user: process.env.DB_USER,         // Username
    password: process.env.DB_PASSWORD  // Password
});

// Test the connection
pool.connect()
    .then(() => console.log('📦 Connected to PostgreSQL database'))
    .catch(err => console.error('❌ Database connection error:', err));

// Export so other files can use it
module.exports = pool;
```

### How to Use the Database in Code

```javascript
const pool = require('../config/database');

// QUERY = Asking the database a question

// Example 1: Get all subjects for a user
const result = await pool.query(
    'SELECT * FROM subjects WHERE user_id = $1',
    [userId]
);
// $1 is a placeholder - gets replaced with userId
// This prevents SQL injection attacks (hackers can't mess with our query)

// Example 2: Insert a new subject
await pool.query(
    'INSERT INTO subjects (id, user_id, name, color) VALUES ($1, $2, $3, $4)',
    [newId, userId, 'Math', '#FF5733']
);

// Example 3: Update a subject
await pool.query(
    'UPDATE subjects SET name = $1 WHERE id = $2 AND user_id = $3',
    ['Mathematics', subjectId, userId]
);

// Example 4: Delete a subject
await pool.query(
    'DELETE FROM subjects WHERE id = $1 AND user_id = $2',
    [subjectId, userId]
);
```

---

# 🛤️ PART 5: ROUTES - Handling URLs

## What is a Route?

A route is a **URL pattern** and what happens when someone visits it.

Think of it like a receptionist:
- Someone walks in and says "I want to see my notes"
- Receptionist (Route) says "Go to room 5, John will help you"

### Route File Explained: `routes/notes.js`

```javascript
// ═══════════════════════════════════════════════════════════════
// NOTES ROUTE FILE - Handles all /notes URLs
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
// Router is a mini-app that handles a group of related routes

const pool = require('../config/database');
// Database connection


// ═══════════════════════════════════════════════════════════════
// MIDDLEWARE: Authentication Check
// ═══════════════════════════════════════════════════════════════

function requireAuth(req, res, next) {
    // This runs BEFORE the route handler
    
    if (req.session && req.session.user) {
        // User is logged in, continue to the route
        next();  // "Go ahead, proceed to the next function"
    } else {
        // User is NOT logged in, send them to login page
        res.redirect('/auth/login');
    }
}

// What is Middleware?
// It's a function that runs BETWEEN the request and the response
// Like a security guard checking your ID before letting you in


// ═══════════════════════════════════════════════════════════════
// ROUTE: GET /notes - Show all notes
// ═══════════════════════════════════════════════════════════════

router.get('/', requireAuth, async (req, res) => {
    // router.get = Handle GET requests (when browser loads a page)
    // '/' = The root of /notes, so this handles /notes
    // requireAuth = Middleware - check if logged in first
    // async = This function uses await (waits for database)
    // req = Request (information FROM the browser)
    // res = Response (what we send BACK to browser)
    
    try {
        const userId = req.session.user.id;
        // Get the logged-in user's ID from their session
        
        // Get all notes for this user from database
        const result = await pool.query(
            `SELECT n.*, s.name as subject_name 
             FROM saved_notes n 
             LEFT JOIN subjects s ON n.subject_id = s.id 
             WHERE n.user_id = $1 
             ORDER BY n.created_at DESC`,
            [userId]
        );
        // LEFT JOIN = Also get subject info if it exists
        // ORDER BY created_at DESC = Newest first
        
        // Render the HTML template with the notes data
        res.render('notes/index', {
            notes: result.rows,      // The notes from database
            user: req.session.user   // User info for the page
        });
        // res.render = Take a template and fill in the data
        
    } catch (error) {
        console.error('Error fetching notes:', error);
        res.status(500).render('errors/500');
        // If something goes wrong, show error page
        // 500 = Server Error status code
    }
});


// ═══════════════════════════════════════════════════════════════
// ROUTE: POST /notes/save - Save a new note
// ═══════════════════════════════════════════════════════════════

router.post('/save', requireAuth, async (req, res) => {
    // router.post = Handle POST requests (when browser sends data)
    // POST is used when creating/submitting something
    
    try {
        const userId = req.session.user.id;
        
        // Get data from the request body (what the form sent)
        const { title, content, note_type, subject_id, topic_id } = req.body;
        // This is "destructuring" - extracting values from an object
        // Same as:
        // const title = req.body.title;
        // const content = req.body.content;
        // etc.
        
        // Insert the new note into database
        const result = await pool.query(
            `INSERT INTO saved_notes 
             (user_id, title, content, note_type, subject_id, topic_id) 
             VALUES ($1, $2, $3, $4, $5, $6) 
             RETURNING id`,
            [userId, title, content, note_type, subject_id || null, topic_id || null]
        );
        // RETURNING id = After inserting, tell us the new ID
        // subject_id || null = If subject_id is empty, use null
        
        // Send success response as JSON
        res.json({ 
            success: true, 
            noteId: result.rows[0].id 
        });
        // res.json = Send JSON data (not HTML)
        
    } catch (error) {
        console.error('Error saving note:', error);
        res.status(500).json({ success: false, error: 'Failed to save note' });
    }
});


// ═══════════════════════════════════════════════════════════════
// ROUTE: DELETE /notes/:id - Delete a note
// ═══════════════════════════════════════════════════════════════

router.delete('/:id', requireAuth, async (req, res) => {
    // :id is a PARAMETER - it can be any value
    // If someone visits /notes/abc-123, then req.params.id = 'abc-123'
    
    try {
        const userId = req.session.user.id;
        const noteId = req.params.id;
        // req.params contains URL parameters
        
        // Delete the note (only if it belongs to this user!)
        await pool.query(
            'DELETE FROM saved_notes WHERE id = $1 AND user_id = $2',
            [noteId, userId]
        );
        // AND user_id = $2 is IMPORTANT for security!
        // Without it, someone could delete other people's notes!
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Error deleting note:', error);
        res.status(500).json({ success: false, error: 'Failed to delete note' });
    }
});


// Export the router so server.js can use it
module.exports = router;
```

---

# 🎨 PART 6: VIEWS - What Users See

## What is EJS?

EJS = Embedded JavaScript. It's HTML with JavaScript inside!

### EJS Syntax Cheat Sheet

```html
<!-- 1. OUTPUT A VALUE -->
<h1>Hello <%= username %></h1>
<!-- <%= %> = Output the value (escaped for safety) -->
<!-- If username = "John", shows: Hello John -->

<!-- 2. OUTPUT RAW HTML -->
<div><%- htmlContent %></div>
<!-- <%- %> = Output raw HTML (be careful with this!) -->

<!-- 3. JAVASCRIPT LOGIC (no output) -->
<% if (user) { %>
    <p>Welcome back!</p>
<% } else { %>
    <p>Please log in</p>
<% } %>
<!-- <% %> = Run JavaScript but don't output anything -->

<!-- 4. LOOPS -->
<ul>
<% notes.forEach(function(note) { %>
    <li><%= note.title %></li>
<% }); %>
</ul>
<!-- This creates one <li> for each note -->

<!-- 5. INCLUDING OTHER FILES -->
<%- include('../partials/sidebar') %>
<!-- Inserts the sidebar.ejs file here -->
```

### Example: `views/notes/index.ejs` Explained

```html
<!-- ═══════════════════════════════════════════════════════════════ -->
<!-- LAYOUT: Include the base layout (header, sidebar, etc.) -->
<!-- ═══════════════════════════════════════════════════════════════ -->

<%- include('../layouts/base', { 
    title: 'My Notes',           // Page title
    currentPage: 'notes'         // Which sidebar item to highlight
}) %>

<!-- ═══════════════════════════════════════════════════════════════ -->
<!-- PAGE CONTENT -->
<!-- ═══════════════════════════════════════════════════════════════ -->

<div class="content-wrapper">
    <h1>My Notes</h1>
    
    <!-- Show message if no notes -->
    <% if (notes.length === 0) { %>
        <div class="empty-state">
            <p>You haven't saved any notes yet!</p>
        </div>
    <% } else { %>
    
        <!-- Loop through each note and display it -->
        <div class="notes-grid">
            <% notes.forEach(function(note) { %>
                <div class="note-card">
                    <h3><%= note.title %></h3>
                    
                    <!-- Show subject if exists -->
                    <% if (note.subject_name) { %>
                        <span class="badge"><%= note.subject_name %></span>
                    <% } %>
                    
                    <!-- Preview of content (first 100 characters) -->
                    <p class="preview">
                        <%= note.content.replace(/<[^>]*>/g, ' ').substring(0, 100) %>...
                    </p>
                    <!-- 
                        note.content.replace(/<[^>]*>/g, ' ') 
                        = Remove HTML tags for plain text preview
                        
                        .substring(0, 100)
                        = Get first 100 characters only
                    -->
                    
                    <!-- View button -->
                    <a href="/notes/<%= note.id %>" class="btn">View</a>
                    
                    <!-- Delete button -->
                    <button onclick="deleteNote('<%= note.id %>')" class="btn-danger">
                        Delete
                    </button>
                </div>
            <% }); %>
        </div>
        
    <% } %>
</div>

<!-- ═══════════════════════════════════════════════════════════════ -->
<!-- JAVASCRIPT FOR THIS PAGE -->
<!-- ═══════════════════════════════════════════════════════════════ -->

<script>
async function deleteNote(noteId) {
    // Confirm before deleting
    if (!confirm('Are you sure you want to delete this note?')) {
        return;  // User clicked Cancel
    }
    
    try {
        // Send DELETE request to server
        const response = await fetch(`/notes/${noteId}`, {
            method: 'DELETE'
        });
        // fetch = Modern way to make HTTP requests from JavaScript
        // method: 'DELETE' = Use DELETE HTTP method
        
        const data = await response.json();
        // Parse the JSON response
        
        if (data.success) {
            // Reload page to show updated list
            window.location.reload();
        } else {
            alert('Failed to delete note');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Something went wrong');
    }
}
</script>
```

---

# 🤖 PART 7: AI SERVICE - Talking to Google AI

## What is an API?

API = Application Programming Interface

It's a way for programs to talk to each other. Like a waiter:
- You (our app) tell the waiter (API) what you want
- Waiter goes to kitchen (Google's servers)
- Waiter brings back your food (AI response)

## `services/aiService.js` Explained

```javascript
// ═══════════════════════════════════════════════════════════════
// AI SERVICE - Communicates with Google Gemini AI
// ═══════════════════════════════════════════════════════════════

const { GoogleGenerativeAI } = require('@google/generative-ai');
// This is Google's official library for their AI

// Initialize the AI with our API key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// API Key = Like a password that identifies our app to Google
// It's in .env file so it stays secret

// Get the specific model we want to use
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
// gemini-2.5-flash = A fast, capable AI model from Google


// ═══════════════════════════════════════════════════════════════
// FUNCTION: Explain a topic
// ═══════════════════════════════════════════════════════════════

async function explainTopic(topic, context = {}) {
    // async = This function does something that takes time
    // topic = What the user wants explained (e.g., "Photosynthesis")
    // context = Extra info like subject name
    
    // Create the prompt (what we ask the AI)
    const prompt = `
        You are an expert tutor. Explain the following topic clearly:
        
        Topic: ${topic}
        ${context.subject ? `Subject: ${context.subject}` : ''}
        
        Provide:
        1. A clear definition
        2. Key concepts
        3. Examples
        4. Summary
        
        Format with clear headings.
    `;
    // Template literal (backticks) lets us put variables inside strings
    // ${topic} gets replaced with the actual topic value
    
    try {
        // Send the prompt to AI and wait for response
        const result = await model.generateContent(prompt);
        // await = Wait here until AI responds (might take a few seconds)
        
        // Get the text from the response
        const response = result.response.text();
        
        return response;
        
    } catch (error) {
        console.error('AI Error:', error);
        throw new Error('Failed to get AI response');
        // throw = Stop and report the error to whoever called this function
    }
}


// ═══════════════════════════════════════════════════════════════
// FUNCTION: Generate study notes
// ═══════════════════════════════════════════════════════════════

async function generateNotes(topic, context = {}) {
    const prompt = `
        Create comprehensive study notes for: ${topic}
        
        Include:
        - Key definitions
        - Important concepts
        - Formulas (if applicable)
        - Examples
        - Memory tips
        
        Format for easy studying with bullet points and sections.
    `;
    
    const result = await model.generateContent(prompt);
    return result.response.text();
}


// ═══════════════════════════════════════════════════════════════
// FUNCTION: Generate practice questions
// ═══════════════════════════════════════════════════════════════

async function generateQuestions(topic, context = {}) {
    const prompt = `
        Create 5 practice questions about: ${topic}
        
        Include:
        - 2 multiple choice questions
        - 2 short answer questions  
        - 1 application/scenario question
        
        Provide answers at the end.
    `;
    
    const result = await model.generateContent(prompt);
    return result.response.text();
}


// ═══════════════════════════════════════════════════════════════
// FUNCTION: Analyze a document
// ═══════════════════════════════════════════════════════════════

async function analyzeDocument(content, filename) {
    // content = The text extracted from the uploaded file
    // filename = Original name of the file
    
    const prompt = `
        Analyze this study material and provide:
        
        1. **Main Topics**: What subjects does this cover?
        2. **Key Concepts**: List the important ideas
        3. **Summary**: Brief overview
        4. **Study Tips**: How to best learn from this material
        
        Document: ${filename}
        
        Content:
        ${content.substring(0, 10000)}
    `;
    // .substring(0, 10000) = Only use first 10000 characters
    // AI has limits on how much text it can process
    
    const result = await model.generateContent(prompt);
    return result.response.text();
}


// ═══════════════════════════════════════════════════════════════
// EXPORT ALL FUNCTIONS
// ═══════════════════════════════════════════════════════════════

module.exports = {
    explainTopic,
    generateNotes,
    generateQuestions,
    analyzeDocument
};
// Now other files can: const aiService = require('./services/aiService');
// And use: aiService.explainTopic('Photosynthesis')
```

---

# 🔐 PART 8: AUTHENTICATION - Login System

## How Does Login Work?

```
1. User enters email + password
        ↓
2. Server checks database for that email
        ↓
3. If found, compare passwords (hashed)
        ↓
4. If match, create a SESSION
        ↓
5. Session ID stored in browser COOKIE
        ↓
6. Every request sends cookie, server knows who you are!
```

## What is Password Hashing?

We NEVER store passwords as plain text. Instead:

```
Password: "myPassword123"
        ↓ (Hashing with bcrypt)
Stored: "$2b$10$X9fR3HvKh8D7G..."

When user logs in:
- Hash the entered password
- Compare with stored hash
- If they match, password is correct!

Why? If database is hacked, hackers can't see real passwords!
```

## Session Explained

```javascript
// When user logs in successfully:
req.session.user = {
    id: 'abc-123-def',
    email: 'john@email.com',
    name: 'John'
};
// This data is stored on the SERVER
// Browser only gets a session ID cookie

// Later, when user visits any page:
if (req.session.user) {
    // User is logged in!
    // We can access req.session.user.id, etc.
}
```

---

# 📤 PART 9: FILE UPLOADS - How Files Are Handled

## The Upload Process

```
1. User selects a file
        ↓
2. Browser sends file as multipart/form-data
        ↓
3. Multer middleware receives it
        ↓
4. File saved to: uploads/{user-id}/{filename}
        ↓
5. Metadata saved to database (user_files table)
        ↓
6. User can view, download, or analyze it later
```

## Multer Configuration

```javascript
const multer = require('multer');
// Multer = Library for handling file uploads

const storage = multer.diskStorage({
    // Where to save files
    destination: function(req, file, cb) {
        const userFolder = `uploads/${req.session.user.id}`;
        // Each user gets their own folder
        cb(null, userFolder);
        // cb = callback, tells Multer "here's the folder"
    },
    
    // What to name the file
    filename: function(req, file, cb) {
        const uniqueName = Date.now() + '-' + file.originalname;
        // Date.now() = Current timestamp in milliseconds
        // Prevents duplicate filenames
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }  // Max 10MB
});

// Using it in a route:
router.post('/upload', upload.single('file'), async (req, res) => {
    // upload.single('file') = Expect one file named 'file'
    // req.file now contains the uploaded file info!
    
    console.log(req.file);
    // {
    //   fieldname: 'file',
    //   originalname: 'notes.pdf',
    //   filename: '1705432800000-notes.pdf',
    //   path: 'uploads/abc-123/1705432800000-notes.pdf',
    //   size: 524288
    // }
});
```

---

# 🔄 PART 10: REQUEST-RESPONSE CYCLE

## Full Journey of a Request

Let's trace what happens when a user saves a note:

```
1. USER ACTION
   - User clicks "Save Note" button
   - JavaScript runs saveNote() function

2. JAVASCRIPT SENDS REQUEST
   fetch('/notes/save', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
           title: 'My Note',
           content: 'Note content...',
           note_type: 'notes'
       })
   })

3. SERVER RECEIVES REQUEST
   - Express sees POST /notes/save
   - Routes it to notes.js
   - Middleware checks: Is user logged in? ✓

4. ROUTE HANDLER RUNS
   router.post('/save', requireAuth, async (req, res) => {
       const { title, content, note_type } = req.body;
       // ...
   })

5. DATABASE QUERY
   await pool.query('INSERT INTO saved_notes...', [...])
   - Sends SQL to PostgreSQL
   - PostgreSQL executes it
   - Returns the new note ID

6. SERVER SENDS RESPONSE
   res.json({ success: true, noteId: 'new-id-123' })

7. JAVASCRIPT RECEIVES RESPONSE
   const data = await response.json();
   if (data.success) {
       // Show success message
       // Redirect to notes page
   }

8. USER SEES RESULT
   - Page updates or redirects
   - User sees their saved note!
```

---

# 🧩 PART 11: KEY JAVASCRIPT CONCEPTS

## Async/Await

```javascript
// The Problem: Database queries take time!
// We can't just wait and freeze the app

// Solution 1: Callbacks (old way, messy)
pool.query('SELECT...', function(err, result) {
    if (err) { /* handle error */ }
    // use result
});

// Solution 2: Promises (better)
pool.query('SELECT...')
    .then(result => { /* use result */ })
    .catch(err => { /* handle error */ });

// Solution 3: Async/Await (best, cleanest)
async function getUser() {
    try {
        const result = await pool.query('SELECT...');
        return result.rows[0];
    } catch (error) {
        console.error(error);
    }
}
// await = "Wait here until this finishes"
// async = "This function contains await"
```

## Destructuring

```javascript
// Without destructuring
const title = req.body.title;
const content = req.body.content;
const type = req.body.note_type;

// With destructuring (same thing, cleaner)
const { title, content, note_type } = req.body;

// Works with arrays too
const [first, second] = [1, 2, 3];
// first = 1, second = 2
```

## Arrow Functions

```javascript
// Regular function
function add(a, b) {
    return a + b;
}

// Arrow function (same thing)
const add = (a, b) => {
    return a + b;
};

// Short arrow function (for simple returns)
const add = (a, b) => a + b;

// Used a lot in callbacks
notes.forEach(note => console.log(note.title));
```

## Template Literals

```javascript
// Old way (concatenation)
const message = 'Hello, ' + name + '! You have ' + count + ' notes.';

// Template literals (cleaner)
const message = `Hello, ${name}! You have ${count} notes.`;

// Multi-line strings
const html = `
    <div class="card">
        <h1>${title}</h1>
        <p>${content}</p>
    </div>
`;
```

---

# 📊 PART 12: OUR DATABASE TABLES EXPLAINED

## Complete Database Schema

```sql
-- ═══════════════════════════════════════════════════════════════
-- USERS TABLE
-- Stores everyone who registers
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- UUID = Unique ID, generated automatically
    
    email VARCHAR(255) UNIQUE NOT NULL,
    -- UNIQUE = No two users can have same email
    -- NOT NULL = This field is required
    
    password VARCHAR(255) NOT NULL,
    -- Hashed password, never plain text!
    
    name VARCHAR(255) NOT NULL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    -- Automatically set to current time when created
);


-- ═══════════════════════════════════════════════════════════════
-- SUBJECTS TABLE
-- Stores subjects like "Math", "Science"
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE subjects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- REFERENCES = Foreign key to users table
    -- ON DELETE CASCADE = If user is deleted, delete their subjects too
    
    name VARCHAR(255) NOT NULL,
    color VARCHAR(7) DEFAULT '#3498db',
    description TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ═══════════════════════════════════════════════════════════════
-- TOPICS TABLE
-- Stores topics within subjects
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    -- Belongs to a subject
    
    name VARCHAR(255) NOT NULL,
    description TEXT,
    difficulty INTEGER DEFAULT 1,  -- 1=Easy, 2=Medium, 3=Hard
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ═══════════════════════════════════════════════════════════════
-- AI_INTERACTIONS TABLE
-- Stores all AI conversations
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE ai_interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
    topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
    -- SET NULL = If subject/topic deleted, just set to null (don't delete interaction)
    
    interaction_type VARCHAR(50) NOT NULL,
    -- 'explanation', 'notes', 'questions', 'answer', 'analysis'
    
    prompt TEXT NOT NULL,       -- What user asked
    response TEXT NOT NULL,     -- What AI answered
    response_time INTEGER,      -- How long AI took (milliseconds)
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ═══════════════════════════════════════════════════════════════
-- SAVED_NOTES TABLE
-- Stores notes saved from AI responses
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE saved_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,      -- The actual note content (may contain HTML)
    
    note_type VARCHAR(50) DEFAULT 'notes',
    -- 'explanation', 'notes', 'questions', 'summary', 'analysis'
    
    subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
    topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
    ai_interaction_id UUID REFERENCES ai_interactions(id) ON DELETE SET NULL,
    -- Links back to the AI conversation that created this note
    
    is_favorite BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ═══════════════════════════════════════════════════════════════
-- USER_FILES TABLE
-- Stores uploaded file metadata
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE user_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
    
    original_filename VARCHAR(255) NOT NULL,  -- What user named it
    stored_filename VARCHAR(255) NOT NULL,    -- What we named it on disk
    file_path VARCHAR(500) NOT NULL,          -- Where it's stored
    file_size INTEGER NOT NULL,               -- Size in bytes
    mime_type VARCHAR(100) NOT NULL,          -- File type (application/pdf, etc.)
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

# 🎯 PART 13: COMMON PATTERNS EXPLAINED

## Pattern 1: CRUD Operations

CRUD = Create, Read, Update, Delete

Every feature follows this pattern:

```javascript
// CREATE - Add new item
router.post('/', async (req, res) => {
    await pool.query('INSERT INTO...');
});

// READ - Get items
router.get('/', async (req, res) => {
    const result = await pool.query('SELECT * FROM...');
});

// UPDATE - Modify item
router.put('/:id', async (req, res) => {
    await pool.query('UPDATE ... WHERE id = $1');
});

// DELETE - Remove item
router.delete('/:id', async (req, res) => {
    await pool.query('DELETE FROM ... WHERE id = $1');
});
```

## Pattern 2: Error Handling

```javascript
router.get('/', async (req, res) => {
    try {
        // Code that might fail
        const result = await pool.query('SELECT...');
        res.render('page', { data: result.rows });
    } catch (error) {
        // If anything in try block fails, we end up here
        console.error('Error:', error);
        res.status(500).render('errors/500');
    }
});
```

## Pattern 3: Authentication Guard

```javascript
// Middleware function
function requireAuth(req, res, next) {
    if (req.session?.user) {
        next();  // Continue to the route
    } else {
        res.redirect('/auth/login');
    }
}

// Use on routes that need login
router.get('/dashboard', requireAuth, (req, res) => {
    // Only logged-in users reach here
});
```

## Pattern 4: JSON API Response

```javascript
// For AJAX requests, return JSON instead of HTML

// Success response
res.json({ 
    success: true, 
    data: result.rows 
});

// Error response
res.status(400).json({ 
    success: false, 
    error: 'Invalid input' 
});
```

---

# 📝 PART 14: FILE-BY-FILE REFERENCE

## Quick Reference: What Each File Does

| File | Purpose |
|------|---------|
| `server.js` | Main entry point, sets up Express |
| `config/database.js` | PostgreSQL connection setup |
| `routes/auth.js` | Login, register, logout |
| `routes/ai.js` | AI assistant features |
| `routes/notes.js` | Save/view/edit notes |
| `routes/materials.js` | File upload/download |
| `routes/subjects.js` | Manage subjects |
| `routes/topics.js` | Manage topics |
| `routes/schedule.js` | Study schedule |
| `routes/reminders.js` | Reminders/notifications |
| `services/aiService.js` | Google Gemini AI wrapper |
| `services/scheduler.js` | Schedule calculation logic |
| `views/layouts/base.ejs` | Main page template |
| `views/partials/sidebar.ejs` | Navigation sidebar |
| `views/partials/topbar.ejs` | Top navigation bar |
| `database/init.js` | Creates initial tables |
| `database/add-ai-tables.js` | Migration for AI tables |
| `database/add-notes-table.js` | Migration for notes table |

---

# 🚀 PART 15: HOW TO RUN THE PROJECT

## Step 1: Install Dependencies

```bash
npm install
# Downloads all packages listed in package.json
```

## Step 2: Set Up Environment Variables

Create `.env` file:
```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=smartsched
DB_USER=postgres
DB_PASSWORD=your_password

GEMINI_API_KEY=your_google_ai_key

SESSION_SECRET=any_random_string_here
```

## Step 3: Set Up Database

```bash
# Create database in PostgreSQL first, then:
node src/database/init.js
node src/database/add-ai-tables.js
node src/database/add-notes-table.js
```

## Step 4: Start the Server

```bash
npm start
# or for development (auto-restart on changes):
npm run dev
```

## Step 5: Visit the App

Open browser: `http://localhost:3000`

---

# 🎓 PART 16: GLOSSARY

| Term | Meaning |
|------|---------|
| **API** | Way for programs to communicate |
| **Async** | Code that waits for something |
| **Await** | Pause until async operation completes |
| **Callback** | Function passed to another function |
| **CRUD** | Create, Read, Update, Delete |
| **Database** | Organized storage for data |
| **EJS** | HTML templating with JavaScript |
| **Endpoint** | URL that does something |
| **Express** | Node.js web framework |
| **Foreign Key** | Reference to another table |
| **GET** | HTTP method to retrieve data |
| **Hash** | One-way encryption |
| **HTTP** | Protocol for web communication |
| **JSON** | Data format: `{"key": "value"}` |
| **Middleware** | Code that runs between request/response |
| **Node.js** | JavaScript runtime for servers |
| **POST** | HTTP method to send data |
| **PostgreSQL** | Database software |
| **Query** | Question to the database |
| **Request** | Browser asking server for something |
| **Response** | Server's answer to request |
| **Route** | URL pattern and its handler |
| **Session** | Server's memory of logged-in user |
| **SQL** | Language for databases |
| **UUID** | Unique random identifier |

---

# 🏆 CONGRATULATIONS!

You now understand:
- ✅ How web applications work
- ✅ Node.js and Express basics
- ✅ Database concepts and SQL
- ✅ Authentication and sessions
- ✅ File uploads
- ✅ API integration (AI)
- ✅ Front-end templating with EJS
- ✅ JavaScript async patterns

**Next Steps:**
1. Try modifying small things in the code
2. Add console.log() statements to see how data flows
3. Read the official Express documentation
4. Practice writing SQL queries
5. Build your own small project!

Happy coding! 🚀
