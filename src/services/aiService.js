/**
 * SmartSched AI Service
 * Phase 4: Gemini AI Integration
 * 
 * Provides AI-powered features:
 * - Topic explanations
 * - Notes generation
 * - Practice questions
 * - Material analysis
 * - Topic complexity estimation
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

class AIService {
    constructor() {
        this.apiKey = process.env.GEMINI_API_KEY;
        this.modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
        this.modelFallbacks = (process.env.GEMINI_FALLBACK_MODELS || 'gemini-1.5-flash,gemini-1.5-flash-8b')
            .split(',')
            .map(m => m.trim())
            .filter(m => m && m !== this.modelName);
        this.genAI = null;
        this.model = null;
        this.modelCache = new Map();
        this.maxRetries = Math.max(1, parseInt(process.env.GEMINI_MAX_RETRIES, 10) || 4);
        this.retryDelay = Math.max(500, parseInt(process.env.GEMINI_RETRY_DELAY_MS, 10) || 1200);
        this.maxRetryDelay = Math.max(this.retryDelay, parseInt(process.env.GEMINI_MAX_RETRY_DELAY_MS, 10) || 20000);
        this.cacheTtlMs = Math.max(0, parseInt(process.env.GEMINI_CACHE_TTL_MS, 10) || 300000);
        this.maxCacheEntries = Math.max(10, parseInt(process.env.GEMINI_CACHE_MAX_ENTRIES, 10) || 200);
        this.responseCache = new Map();
        this.inflightRequests = new Map();
        this._configured = false;
        
        if (this.apiKey) {
            this.initialize();
        } else {
            console.warn('⚠️ GEMINI_API_KEY not set. AI features will be disabled.');
        }
    }

    /**
     * Check if AI service is properly configured
     */
    isConfigured() {
        return this._configured && this.model !== null;
    }
    
    /**
     * Initialize Gemini AI client
     */
    initialize() {
        try {
            this.genAI = new GoogleGenerativeAI(this.apiKey);
            this.model = this.createModel(this.modelName);
            this.modelCache.set(this.modelName, this.model);
            this._configured = true;
            console.log(`✅ Gemini AI initialized with model: ${this.modelName}`);
        } catch (error) {
            this._configured = false;
            console.error('❌ Failed to initialize Gemini AI:', error.message);
        }
    }

    /**
     * Create a model client instance for a specific model name.
     */
    createModel(modelName) {
        return this.genAI.getGenerativeModel({
            model: modelName,
            generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 8192,
            }
        });
    }

    /**
     * Reuse model instances to avoid repeatedly creating clients.
     */
    getOrCreateModel(modelName) {
        if (modelName === this.modelName && this.model) {
            return this.model;
        }

        if (this.modelCache.has(modelName)) {
            return this.modelCache.get(modelName);
        }

        const model = this.createModel(modelName);
        this.modelCache.set(modelName, model);
        return model;
    }
    
    /**
     * Check if AI service is available
     */
    isAvailable() {
        return this.model !== null;
    }
    
    /**
     * Core method to call Gemini API with retry logic
     */
    async callGemini(prompt, optionsOrRetries = {}, retries = this.maxRetries) {
        let options = {};

        // Backward compatibility for old call signature: callGemini(prompt, retries)
        if (typeof optionsOrRetries === 'number') {
            retries = optionsOrRetries;
        } else if (optionsOrRetries && typeof optionsOrRetries === 'object') {
            options = optionsOrRetries;
        }

        const { requireJson = true } = options;

        if (!this.isAvailable()) {
            throw new Error('AI service is not available. Please configure GEMINI_API_KEY.');
        }

        const cacheKey = this.buildCacheKey(prompt, requireJson);
        const cached = this.getCachedResponse(cacheKey);
        if (cached) {
            return cached;
        }

        if (this.inflightRequests.has(cacheKey)) {
            return this.cloneData(await this.inflightRequests.get(cacheKey));
        }

        const requestPromise = this.callWithModelFallback(prompt, { requireJson, retries });
        this.inflightRequests.set(cacheKey, requestPromise);

        try {
            const response = await requestPromise;
            this.setCachedResponse(cacheKey, response);
            return this.cloneData(response);
        } finally {
            this.inflightRequests.delete(cacheKey);
        }
    }

    /**
     * Try primary and fallback Gemini models.
     */
    async callWithModelFallback(prompt, { requireJson, retries }) {
        const modelsToTry = [this.modelName, ...this.modelFallbacks];
        let lastError = null;

        for (let i = 0; i < modelsToTry.length; i++) {
            const modelName = modelsToTry[i];
            try {
                return await this.callModelWithRetries(modelName, prompt, { requireJson, retries });
            } catch (error) {
                lastError = error;
                const hasNextModel = i < modelsToTry.length - 1;

                if (hasNextModel && (this.isRateLimitError(error) || this.isModelUnavailableError(error))) {
                    console.warn(`⚠️ Model ${modelName} unavailable or rate-limited. Trying fallback model...`);
                    continue;
                }

                throw error;
            }
        }

        if (lastError && this.isRateLimitError(lastError)) {
            throw new Error('AI rate limit reached. Please try again shortly.');
        }

        throw lastError || new Error('AI request failed');
    }

    /**
     * Call one specific model with retry/backoff.
     */
    async callModelWithRetries(modelName, prompt, { requireJson, retries }) {
        const model = this.getOrCreateModel(modelName);

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const text = await this.generateText(model, prompt, requireJson);

                if (!requireJson) {
                    return { raw_response: text };
                }

                const parsed = this.parseJSONResponse(text);
                if (parsed && parsed.parse_error) {
                    throw new Error('AI returned invalid JSON response');
                }

                return parsed;
            } catch (error) {
                const canRetry = attempt < retries && this.isRetryableError(error);
                if (!canRetry) {
                    throw error;
                }

                const delayMs = this.getRetryDelayMs(error, attempt);
                console.warn(`Retrying AI call with ${modelName} in ${delayMs}ms (${attempt + 1}/${retries})`);
                await this.delay(delayMs);
            }
        }

        throw new Error('AI request failed after retries');
    }

    /**
     * Execute model request and return text response.
     */
    async generateText(model, prompt, requireJson) {
        let result;

        if (requireJson) {
            try {
                result = await model.generateContent({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseMimeType: 'application/json'
                    }
                });
            } catch (jsonModeError) {
                // Fallback to plain generation if JSON mode is unsupported for this model
                if (!this.isResponseMimeTypeError(jsonModeError)) {
                    throw jsonModeError;
                }
                result = await model.generateContent(prompt);
            }
        } else {
            result = await model.generateContent(prompt);
        }

        const response = await result.response;
        return response.text();
    }
    
    /**
     * Parse JSON from AI response, handling markdown code blocks and conversational text
     */
    parseJSONResponse(text) {
        let cleaned = (text || '').trim();

        if (!cleaned) {
            return {
                raw_response: text,
                parse_error: true
            };
        }

        // Remove BOM if present
        cleaned = cleaned.replace(/^\uFEFF/, '');
        
        // Try to extract JSON from markdown code blocks anywhere in the text
        const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/;
        const codeBlockRegex = /```\s*([\s\S]*?)\s*```/;
        
        let match = cleaned.match(jsonBlockRegex);
        if (match) {
            cleaned = match[1];
        } else {
            match = cleaned.match(codeBlockRegex);
            if (match) {
                cleaned = match[1];
            } else {
                // Attempt to find the first '{' or '[' and the last '}' or ']'
                const firstCurly = cleaned.indexOf('{');
                const lastCurly = cleaned.lastIndexOf('}');
                const firstSquare = cleaned.indexOf('[');
                const lastSquare = cleaned.lastIndexOf(']');
                
                const first = (firstCurly !== -1 && (firstSquare === -1 || firstCurly < firstSquare)) ? firstCurly : firstSquare;
                const last = (lastCurly !== -1 && (lastSquare === -1 || lastCurly > lastSquare)) ? lastCurly : lastSquare;
                
                if (first !== -1 && last !== -1 && last > first) {
                    cleaned = cleaned.substring(first, last + 1);
                }
            }
        }
        
        cleaned = cleaned.trim();
        
        try {
            return JSON.parse(cleaned);
        } catch (e) {
            const repaired = this.repairCommonJSONIssues(cleaned);
            if (repaired !== cleaned) {
                try {
                    return JSON.parse(repaired);
                } catch (_) {
                    // Fall through to parse_error response
                }
            }

            // If JSON parsing fails, return as structured object
            console.error('Failed to parse AI JSON response:', e.message);
            console.error('Cleaned string that failed:', cleaned.substring(0, 100) + '...');
            return { 
                raw_response: text,
                parse_error: true 
            };
        }
    }

    /**
     * Minimal JSON repair for common LLM formatting mistakes.
     */
    repairCommonJSONIssues(text) {
        return text
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/,\s*([}\]])/g, '$1')
            .trim();
    }

    /**
     * Detect JSON mode compatibility errors in Gemini responses.
     */
    isResponseMimeTypeError(error) {
        const message = (error && error.message ? error.message : '').toLowerCase();
        return message.includes('responsemimetype')
            || message.includes('response mime type')
            || message.includes('generationconfig')
            || message.includes('json mode');
    }

    /**
     * Identify provider rate limit / quota errors.
     */
    isRateLimitError(error) {
        const message = (error && error.message ? error.message : '').toLowerCase();
        const code = String(error && error.code ? error.code : '').toLowerCase();
        const status = Number(error && (error.status || error.statusCode));

        return status === 429
            || code.includes('rate_limit')
            || code.includes('resource_exhausted')
            || message.includes('rate limit')
            || message.includes('too many requests')
            || message.includes('resource_exhausted')
            || message.includes('quota')
            || message.includes('429');
    }

    /**
     * Detect temporary model availability issues.
     */
    isModelUnavailableError(error) {
        const message = (error && error.message ? error.message : '').toLowerCase();
        const status = Number(error && (error.status || error.statusCode));

        return status === 503
            || status === 500
            || status === 504
            || message.includes('unavailable')
            || message.includes('overloaded')
            || message.includes('internal');
    }
    
    /**
     * Check if error is retryable
     */
    isRetryableError(error) {
        const message = (error && error.message ? error.message : '').toLowerCase();
        const status = Number(error && (error.status || error.statusCode));

        return this.isRateLimitError(error)
            || this.isModelUnavailableError(error)
            || status === 408
            || message.includes('timeout')
            || message.includes('deadline exceeded')
            || message.includes('temporarily unavailable');
    }

    /**
     * Exponential backoff with jitter, respecting explicit retry-after hints when present.
     */
    getRetryDelayMs(error, attempt) {
        const hinted = this.extractRetryAfterMs(error);
        if (hinted !== null) {
            return hinted;
        }

        const exponential = Math.min(this.maxRetryDelay, this.retryDelay * Math.pow(2, attempt));
        const jitter = Math.floor(Math.random() * 500);
        return Math.min(this.maxRetryDelay, exponential + jitter);
    }

    /**
     * Parse retry-after durations from error messages.
     */
    extractRetryAfterMs(error) {
        const message = (error && error.message ? error.message : '').toLowerCase();
        const match = message.match(/retry after\s*(\d+)\s*(ms|millisecond|milliseconds|s|sec|secs|second|seconds)?/i);

        if (!match) return null;

        const value = parseInt(match[1], 10);
        if (!Number.isFinite(value) || value < 0) return null;

        const unit = (match[2] || 's').toLowerCase();
        if (unit.startsWith('ms') || unit.startsWith('millisecond')) {
            return Math.min(this.maxRetryDelay, value);
        }

        return Math.min(this.maxRetryDelay, value * 1000);
    }

    /**
     * Build cache key for deduplicating repeated prompts.
     */
    buildCacheKey(prompt, requireJson) {
        return `${requireJson ? 'json' : 'text'}:${prompt}`;
    }

    getCachedResponse(cacheKey) {
        if (this.cacheTtlMs <= 0 || !this.responseCache.has(cacheKey)) {
            return null;
        }

        const item = this.responseCache.get(cacheKey);
        if (!item || Date.now() > item.expiresAt) {
            this.responseCache.delete(cacheKey);
            return null;
        }

        return this.cloneData(item.value);
    }

    setCachedResponse(cacheKey, value) {
        if (this.cacheTtlMs <= 0) return;

        if (this.responseCache.size >= this.maxCacheEntries) {
            const oldestKey = this.responseCache.keys().next().value;
            if (oldestKey) this.responseCache.delete(oldestKey);
        }

        this.responseCache.set(cacheKey, {
            value: this.cloneData(value),
            expiresAt: Date.now() + this.cacheTtlMs
        });
    }

    cloneData(value) {
        if (value === null || value === undefined) return value;
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_) {
            return value;
        }
    }
    
    /**
     * Delay utility for retries
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * Generate a detailed explanation for a topic
     */
    async generateExplanation(topic, context = {}) {
        const { subjectName, difficulty, additionalContext } = context;
        
        const prompt = `You are an expert academic tutor specializing in ${subjectName || 'education'}.

Explain the topic: "${topic}"
${difficulty ? `Difficulty Level: ${difficulty}` : ''}
${additionalContext ? `Additional Context: ${additionalContext}` : ''}

Provide a comprehensive yet accessible explanation suitable for a student.

Return ONLY valid JSON in this exact format (no markdown, no code blocks):
{
    "title": "The topic title",
    "core_explanation": "A detailed 2-3 paragraph explanation of the core concept",
    "key_points": [
        "Key point 1",
        "Key point 2",
        "Key point 3",
        "Key point 4",
        "Key point 5"
    ],
    "example": "A practical real-world example that illustrates the concept",
    "analogy": "A simple analogy to help understand the concept",
    "common_mistakes": [
        "Common mistake or misconception 1",
        "Common mistake or misconception 2"
    ],
    "summary": "A brief 1-2 sentence summary"
}`;

        return this.callGemini(prompt);
    }
    
    /**
     * Generate concise exam-oriented notes
     */
    async generateNotes(topic, context = {}) {
        const { subjectName, materialText, focusAreas } = context;
        
        const prompt = `You are an expert academic note-maker specializing in ${subjectName || 'education'}.

Create concise, exam-oriented study notes for: "${topic}"
${materialText ? `\nReference Material:\n${materialText.substring(0, 3000)}` : ''}
${focusAreas ? `Focus Areas: ${focusAreas}` : ''}

Return ONLY valid JSON in this exact format (no markdown, no code blocks):
{
    "topic": "The topic name",
    "overview": "A brief 2-3 sentence overview",
    "bullet_points": [
        "Key point 1 - concise and memorable",
        "Key point 2 - concise and memorable",
        "Key point 3 - concise and memorable",
        "Key point 4 - concise and memorable",
        "Key point 5 - concise and memorable"
    ],
    "definitions": [
        {
            "term": "Important term 1",
            "definition": "Clear definition"
        },
        {
            "term": "Important term 2",
            "definition": "Clear definition"
        }
    ],
    "important_formulas": [
        "Formula 1 (if applicable)",
        "Formula 2 (if applicable)"
    ],
    "diagrams_needed": [
        "Description of helpful diagram 1",
        "Description of helpful diagram 2"
    ],
    "exam_tips": [
        "Tip 1 for remembering/answering questions",
        "Tip 2 for remembering/answering questions"
    ],
    "quick_revision": "A super brief 2-3 line revision summary"
}`;

        return this.callGemini(prompt);
    }
    
    /**
     * Generate practice questions with answers
     */
    async generateQuestions(topic, context = {}) {
        const { subjectName, difficulty, questionType, count } = context;
        const numQuestions = count || 5;
        const qType = questionType || 'mixed';
        
        const prompt = `You are an expert examiner for ${subjectName || 'academic subjects'}.

Generate ${numQuestions} practice questions for: "${topic}
Difficulty: ${difficulty || 'medium'}
Question Types: ${qType === 'mixed' ? 'Mix of MCQ, short answer, and conceptual' : qType}
You MAY include markdown tables in the question text when data comparison or lookup questions are appropriate. Keep answer options as plain text only (no tables in options).

Return ONLY valid JSON in this exact format (no markdown, no code blocks):
{
    "topic": "The topic name",
    "difficulty": "${difficulty || 'medium'}",
    "questions": [
        {
            "id": 1,
            "type": "mcq",
            "question": "The question text?",
            "options": ["Option A", "Option B", "Option C", "Option D"],
            "correct_answer": "Option A",
            "explanation": "Why this is the correct answer"
        },
        {
            "id": 2,
            "type": "short_answer",
            "question": "The question text?",
            "expected_answer": "The model answer",
            "key_points": ["Point that should be covered 1", "Point 2"],
            "explanation": "Additional explanation"
        },
        {
            "id": 3,
            "type": "true_false",
            "question": "Statement to evaluate",
            "correct_answer": true,
            "explanation": "Why this is true/false"
        }
    ],
    "study_tips": "Tips based on these questions"
}`;

        return this.callGemini(prompt);
    }
    
    /**
     * Analyze uploaded syllabus/material and extract topics
     */
    async analyzeSyllabus(text, context = {}) {
        const { subjectName } = context;
        
        // Limit text to prevent token overflow
        const truncatedText = text.substring(0, 8000);
        
        const prompt = `You are an expert curriculum analyst.

Analyze this syllabus/study material for ${subjectName || 'a subject'} and extract structured topic information.

MATERIAL:
${truncatedText}

Return ONLY valid JSON in this exact format (no markdown, no code blocks):
{
    "subject_detected": "The subject name if identifiable",
    "total_topics": 5,
    "estimated_total_hours": 20,
    "topics": [
        {
            "name": "Topic 1 name",
            "description": "Brief description",
            "subtopics": ["Subtopic 1", "Subtopic 2"],
            "difficulty": "easy|medium|hard",
            "importance": 4,
            "estimated_hours": 3,
            "prerequisites": ["Any prerequisite topics"],
            "keywords": ["keyword1", "keyword2"]
        }
    ],
    "suggested_order": ["Topic to study first", "Second topic", "etc"],
    "exam_focus_areas": ["Area likely to appear in exams"],
    "additional_resources": ["Suggested resource 1", "Suggested resource 2"]
}`;

        return this.callGemini(prompt);
    }
    
    /**
     * Estimate complexity and study parameters for a topic
     */
    async estimateTopicComplexity(topicName, context = {}) {
        const { subjectName, description, studentLevel } = context;
        
        const prompt = `You are an expert educational analyst.

Estimate the complexity and study requirements for this topic:
Topic: "${topicName}"
${subjectName ? `Subject: ${subjectName}` : ''}
${description ? `Description: ${description}` : ''}
${studentLevel ? `Student Level: ${studentLevel}` : 'Student Level: undergraduate'}

Return ONLY valid JSON in this exact format (no markdown, no code blocks):
{
    "topic": "${topicName}",
    "difficulty": "easy|medium|hard",
    "complexity_score": 7,
    "estimated_hours": 2.5,
    "importance": 4,
    "cognitive_load": "low|medium|high",
    "prerequisites": ["List of prerequisite concepts"],
    "learning_objectives": [
        "What student should know after studying"
    ],
    "suggested_approach": "How to approach learning this topic",
    "practice_needed": "Amount of practice: minimal|moderate|extensive",
    "revision_frequency": "How often to revise: daily|weekly|before_exam"
}`;

        return this.callGemini(prompt);
    }
    
    /**
     * Answer a student's question about a topic
     */
    async answerQuestion(question, context = {}) {
        const { topicName, subjectName, previousContext } = context;
        
        const prompt = `You are a friendly and knowledgeable academic tutor.

Student's Question: "${question}"
${topicName ? `Related Topic: ${topicName}` : ''}
${subjectName ? `Subject: ${subjectName}` : ''}
${previousContext ? `Previous Context: ${previousContext}` : ''}

Provide a clear, educational answer that helps the student understand.

Return ONLY valid JSON in this exact format (no markdown, no code blocks):
{
    "question": "${question}",
    "answer": "A clear, comprehensive answer",
    "key_takeaways": [
        "Main point 1",
        "Main point 2"
    ],
    "related_concepts": ["Concept 1", "Concept 2"],
    "further_reading": "What to study next for deeper understanding",
    "confidence": "high|medium|low"
}`;

        return this.callGemini(prompt);
    }

    /**
     * Generate concept graph data for a subject.
     */
    async generateConceptGraph(subjectName, topicNames = []) {
        const safeSubject = subjectName || 'General Subject';
        const safeTopics = Array.isArray(topicNames)
            ? topicNames.filter(t => typeof t === 'string' && t.trim()).slice(0, 40)
            : [];

        const prompt = `You are an expert educator and curriculum designer.

Create a concept graph for the subject "${safeSubject}" using these topics:
${safeTopics.join(', ')}

Return ONLY valid JSON with this structure:
{
    "title": "Concept Map: ${safeSubject}",
    "nodes": [
        {
            "id": "unique_id",
            "label": "Concept Name",
            "group": "topic_name",
            "level": 0,
            "description": "Brief description",
            "importance": "high|medium|low"
        }
    ],
    "edges": [
        {
            "from": "node_id_1",
            "to": "node_id_2",
            "label": "relationship label",
            "type": "prerequisite|related|builds_on|part_of|applies_to"
        }
    ],
    "clusters": [
        {
            "name": "Cluster Name",
            "color": "#RRGGBB",
            "description": "Cluster summary"
        }
    ]
}

Rules:
- Create 12-30 nodes depending on topic complexity
- Use concise, meaningful labels
- Use top-level topics as groups for level 0 concepts
- Include cross-topic edges
- Ensure node IDs are unique and referenced correctly in edges
- Respond with JSON only`;

        return this.callGemini(prompt, { requireJson: true });
    }
    
    /**
     * Generate a study plan based on topics and deadlines
     */
    async generateStudyPlan(topics, context = {}) {
        const { examDate, dailyHours, preferences } = context;
        
        const topicsList = topics.map(t => 
            `- ${t.name} (Difficulty: ${t.difficulty || 'medium'}, Hours: ${t.estimated_hours || 1})`
        ).join('\n');
        
        const prompt = `You are an expert study planner and learning coach.

Create an optimized study plan for these topics:
${topicsList}

${examDate ? `Exam Date: ${examDate}` : ''}
${dailyHours ? `Available Study Hours per Day: ${dailyHours}` : 'Available Study Hours per Day: 4'}
${preferences ? `Preferences: ${preferences}` : ''}

Return ONLY valid JSON in this exact format (no markdown, no code blocks):
{
    "total_topics": ${topics.length},
    "total_estimated_hours": 20,
    "recommended_daily_hours": 3,
    "plan_duration_days": 7,
    "strategy": "Brief description of the study strategy",
    "daily_schedule": [
        {
            "day": 1,
            "focus_topics": ["Topic 1", "Topic 2"],
            "hours": 3,
            "activities": ["Read chapter", "Make notes", "Practice problems"]
        }
    ],
    "revision_days": [5, 7],
    "tips": [
        "Study tip 1",
        "Study tip 2"
    ],
    "warnings": ["Any concerns about the timeline"]
}`;

        return this.callGemini(prompt);
    }
    
    /**
     * Summarize uploaded text/material
     */
    async summarizeMaterial(text, context = {}) {
        const truncatedText = text.substring(0, 10000);
        
        const prompt = `You are an expert at creating concise academic summaries.

Summarize the following study material:

${truncatedText}

Return ONLY valid JSON in this exact format (no markdown, no code blocks):
{
    "title": "Detected title or main topic",
    "word_count_original": ${text.split(' ').length},
    "summary": "A comprehensive 3-4 paragraph summary",
    "key_concepts": [
        "Concept 1",
        "Concept 2",
        "Concept 3"
    ],
    "important_terms": [
        {
            "term": "Term 1",
            "definition": "Brief definition"
        }
    ],
    "main_arguments": [
        "Main argument or point 1",
        "Main argument or point 2"
    ],
    "conclusion": "Brief conclusion or takeaway"
}`;

        return this.callGemini(prompt);
    }

    /**
     * Generate flashcards from topic and notes
     * Phase 5: AI Flashcards Module
     */
    async generateFlashcards(topicName, notesContent = '', cardCount = 10) {
        const contextText = notesContent 
            ? `\n\nUse the following notes as context:\n${notesContent.substring(0, 8000)}`
            : '';

        const prompt = `You are an expert educator creating study flashcards for active recall learning.

Generate ${cardCount} high-quality flashcards for the topic: "${topicName}"${contextText}

Create flashcards that:
- Test key concepts, definitions, and relationships
- Use clear, concise language
- Include a mix of recall and understanding questions
- Progress from basic to more complex concepts
- Are suitable for spaced repetition study

Return ONLY valid JSON in this exact format (no markdown, no code blocks):
{
    "flashcards": [
        {
            "front": "Question or prompt text",
            "back": "Answer or explanation"
        }
    ]
}`;

        const result = await this.callGemini(prompt);
        return result.flashcards || [];
    }

    /**
     * Generate practice quiz questions
     * Phase 5: Practice Quiz Module
     */
    async generateQuiz(topicName, context = '', questionCount = 5, difficulty = 'medium') {
        const contextText = context 
            ? `\n\nContext material:\n${context.substring(0, 6000)}`
            : '';

        const prompt = `You are an expert test creator designing multiple-choice quiz questions.

Generate ${questionCount} ${difficulty}-difficulty multiple-choice questions for: "${topicName}"${contextText}

Create questions that:
- Test understanding, not just memorization
- Have exactly 4 options (A, B, C, D)
- Have only ONE correct answer
- Include plausible distractors
- Cover different aspects of the topic
- Include brief explanations for the correct answer
- You MAY include markdown tables in the question text when data comparison, lookup, or analysis questions are appropriate. Tables will be rendered properly in the UI.
- Keep all answer OPTIONS as plain text only — no tables, no HTML, no markdown formatting in options.
- If using a table in the question, format it as a standard markdown table with | and --- separators.

Return ONLY valid JSON in this exact format (no markdown, no code blocks):
{
    "questions": [
        {
            "question": "Question text here?",
            "options": {
                "A": "First option",
                "B": "Second option",
                "C": "Third option",
                "D": "Fourth option"
            },
            "correct": "A",
            "explanation": "Brief explanation of why this is correct"
        }
    ]
}`;

        const result = await this.callGemini(prompt);
        return result.questions || [];
    }
}

// Export singleton instance
module.exports = new AIService();
