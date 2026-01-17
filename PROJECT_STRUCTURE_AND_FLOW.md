# SmartSched Project Structure & Flow Guide

This guide explains how all the main files and folders in your SmartSched project work together, and how data flows from user to AI and back.

---

## 1. Top-Level Structure

```
smartSched/
├── DATA_FLOW.md
├── SCHEDULER_LOGIC.md
├── package.json
├── src/
│   ├── server.js
│   ├── config/
│   │   └── database.js
│   ├── database/
│   │   ├── add-ai-tables.js
│   │   └── init.js
│   ├── public/
│   │   └── css/
│   ├── routes/
│   │   ├── ai.js
│   │   ├── analytics.js
│   │   ├── auth.js
│   │   ├── index.js
│   │   ├── materials.js
│   │   ├── reminders.js
│   │   ├── schedule.js
│   │   ├── settings.js
│   │   ├── study.js
│   │   ├── subjects.js
│   │   ├── tasks.js
│   │   └── topics.js
│   ├── services/
│   │   ├── aiService.js
│   │   └── scheduler.js
│   ├── views/
│   │   ├── landing.ejs
│   │   ├── ai/
│   │   │   ├── assistant.ejs
│   │   │   ├── history.ejs
│   │   ├── analytics/
│   │   ├── auth/
│   │   ├── dashboard/
│   │   ├── errors/
│   │   ├── layouts/
│   │   ├── materials/
│   │   ├── partials/
│   │   ├── reminders/
│   │   ├── schedule/
│   │   ├── settings/
│   │   ├── study/
│   │   ├── subjects/
│   │   ├── tasks/
│   │   ├── topics/
├── uploads/
```

---

## 2. Main Folders & Their Roles

### src/
- **server.js**: Entry point. Starts Express server, sets up middleware, connects routes.
- **config/**: Configuration files (e.g., database connection).
- **database/**: Scripts for initializing and migrating the database.
- **public/**: Static assets (CSS, images, JS for frontend).
- **routes/**: Express route handlers for each feature/module.
- **services/**: Business logic, helpers, and integrations (AI, scheduling).
- **views/**: EJS templates for rendering HTML pages.

---

## 3. How Data Flows (Step-by-Step)

### Example: User Requests AI Questions

#### 1. User Action
- User opens `/ai/assistant` page (rendered by `views/ai/assistant.ejs`).
- Selects a topic and clicks "Practice Questions".

#### 2. Frontend JS
- JS in `assistant.ejs` sends a POST request to `/ai/questions` with topic info.

#### 3. Backend Route
- `routes/ai.js` receives the request.
- Calls `services/aiService.js` to generate questions using Gemini AI.

#### 4. AI Service
- `aiService.js` builds a prompt, sends it to Gemini, parses the JSON response.
- Returns the questions data to the route.

#### 5. Route Responds
- `ai.js` sends the parsed questions data back to the frontend as JSON.

#### 6. Frontend Renders
- JS in `assistant.ejs` receives the data.
- Calls `renderQuestions(data)` to build HTML for each question.
- Displays questions, options, answers, etc.

---

## 4. Key File Connections

- **server.js** imports all route files from `routes/` and mounts them on paths.
- **routes/** files handle HTTP requests, call services, and render views or send JSON.
- **services/** files contain logic for AI, scheduling, etc. Used by routes.
- **views/** files are EJS templates. Rendered by routes for browser display.
- **public/** files are linked in EJS for styling and scripts.
- **database/** scripts are run manually for setup/migration.

---

## 5. Example: How a PDF Upload is Processed

1. User uploads a PDF on `/materials` page (`views/materials/upload.ejs`).
2. JS sends file to `/materials/upload` route (`routes/materials.js`).
3. Route saves file, extracts text (using pdf-parse), stores info in DB.
4. Route may call AI for analysis (`aiService.js`), stores AI results.
5. Route redirects to `/materials/view/:id` (renders `views/materials/view.ejs`).
6. User sees extracted text, AI analysis, and can create topics from it.

---

## 6. Database Connection
- **config/database.js**: Sets up PostgreSQL connection.
- **database/init.js, add-ai-tables.js**: Create tables (users, subjects, topics, user_files, ai_interactions, etc).
- **Routes** use DB connection to query and store data.

---

## 7. EJS Views & Rendering
- **views/ai/assistant.ejs**: Main AI assistant page. JS handles user actions, renders results.
- **views/ai/history.ejs**: Shows past AI interactions. Loops through history items, displays previews.
- **views/materials/view.ejs**: Shows uploaded material, extracted text, and AI analysis.
- **views/partials/**: Shared UI components (sidebar, topbar).

---

## 8. Services
- **aiService.js**: Handles all AI interactions (prompts, parsing, error handling).
- **scheduler.js**: Handles scheduling logic for study plans, reminders, etc.

---

## 9. How Everything Connects

- **User interacts with frontend (EJS views + JS)**
- **Frontend sends requests to backend routes (Express)**
- **Routes call services for business logic (AI, scheduling, DB)**
- **Services interact with external APIs (Gemini, OCR.space) and DB**
- **Routes send data back to frontend or render EJS views**
- **Frontend JS updates the page dynamically**

---

## 10. Quick Reference Table

| Folder/File         | Purpose/Role                                 |
|---------------------|----------------------------------------------|
| src/server.js       | Starts server, mounts routes                 |
| src/routes/         | Handles HTTP requests, calls services/views  |
| src/services/       | Business logic, AI, scheduling               |
| src/views/          | EJS templates for HTML pages                 |
| src/public/         | Static assets (CSS, JS)                      |
| src/config/         | Configuration (DB, environment)              |
| src/database/       | DB setup/migration scripts                   |
| uploads/            | Stores uploaded files                        |

---

## 11. Visual Flow Diagram (Text)

```
[User] --(browser)--> [EJS View + JS] --(HTTP request)--> [Express Route] --(calls)--> [Service] --(DB/API)--> [Service] --(returns)--> [Route] --(JSON/View)--> [Frontend]
```

---

## 12. How to Explain in a Viva
- Start with the big picture: "SmartSched is a web app for smart study scheduling and AI-powered learning."
- Show how a user action (like requesting questions) flows through the system.
- Point out how files are organized for clarity and maintainability.
- Emphasize use of AI, database, and dynamic rendering.
- Use this guide as a cheat sheet for file roles and connections.

---

**If you want a diagram or more details for any part, ask!**
