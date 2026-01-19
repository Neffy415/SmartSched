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
        this.genAI = null;
        this.model = null;
        this.maxRetries = 3;
        this.retryDelay = 1000;
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
            this.model = this.genAI.getGenerativeModel({ 
                model: this.modelName,
                generationConfig: {
                    temperature: 0.7,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 8192,
                }
            });
            this._configured = true;
            console.log(`✅ Gemini AI initialized with model: ${this.modelName}`);
        } catch (error) {
            this._configured = false;
            console.error('❌ Failed to initialize Gemini AI:', error.message);
        }
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
    async callGemini(prompt, retries = this.maxRetries) {
        if (!this.isAvailable()) {
            throw new Error('AI service is not available. Please configure GEMINI_API_KEY.');
        }
        
        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();
            
            // Try to parse as JSON
            return this.parseJSONResponse(text);
        } catch (error) {
            if (retries > 0 && this.isRetryableError(error)) {
                console.log(`Retrying AI call... (${this.maxRetries - retries + 1}/${this.maxRetries})`);
                await this.delay(this.retryDelay);
                return this.callGemini(prompt, retries - 1);
            }
            throw error;
        }
    }
    
    /**
     * Parse JSON from AI response, handling markdown code blocks
     */
    parseJSONResponse(text) {
        // Remove markdown code blocks if present
        let cleaned = text.trim();
        
        // Handle ```json ... ``` format
        if (cleaned.startsWith('```json')) {
            cleaned = cleaned.slice(7);
        } else if (cleaned.startsWith('```')) {
            cleaned = cleaned.slice(3);
        }
        
        if (cleaned.endsWith('```')) {
            cleaned = cleaned.slice(0, -3);
        }
        
        cleaned = cleaned.trim();
        
        try {
            return JSON.parse(cleaned);
        } catch (e) {
            // If JSON parsing fails, return as structured object
            return { 
                raw_response: text,
                parse_error: true 
            };
        }
    }
    
    /**
     * Check if error is retryable
     */
    isRetryableError(error) {
        const retryableCodes = ['RATE_LIMIT_EXCEEDED', 'INTERNAL', 'UNAVAILABLE'];
        return retryableCodes.some(code => 
            error.message?.includes(code) || error.code === code
        );
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

Generate ${numQuestions} practice questions for: "${topic}"
Difficulty: ${difficulty || 'medium'}
Question Types: ${qType === 'mixed' ? 'Mix of MCQ, short answer, and conceptual' : qType}

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
