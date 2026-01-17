/**
 * SmartSched Materials Routes
 * Phase 4: File Upload & Material Analysis
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const aiService = require('../services/aiService');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const pdfParse = require('pdf-parse');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../uploads', req.session.user.id);
        try {
            await fs.mkdir(uploadDir, { recursive: true });
            cb(null, uploadDir);
        } catch (error) {
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, `${uniqueSuffix}${ext}`);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        'application/pdf',
        'text/plain',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/png',
        'image/jpeg',
        'image/jpg'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Allowed: PDF, TXT, DOC, DOCX, PNG, JPG'), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Middleware to check authentication
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(401).json({ error: 'Please log in to access materials' });
        }
        return res.redirect('/auth/login');
    }
    next();
};

router.use(requireAuth);

// ==========================================
// GET /materials - List all materials
// ==========================================
router.get('/', async (req, res) => {
    try {
        const { subject_id } = req.query;

        let whereClause = 'WHERE uf.user_id = $1';
        const params = [req.session.user.id];

        if (subject_id) {
            whereClause += ' AND uf.subject_id = $2';
            params.push(subject_id);
        }

        const filesResult = await pool.query(`
            SELECT uf.*, 
                   uf.original_name as original_filename,
                   uf.filename as stored_filename,
                   s.name as subject_name, 
                   s.color as subject_color,
                   (SELECT COUNT(*) FROM file_topics ft WHERE ft.file_id = uf.id) as linked_topics
            FROM user_files uf
            LEFT JOIN subjects s ON uf.subject_id = s.id
            ${whereClause}
            ORDER BY uf.created_at DESC
        `, params);

        // Get subjects for filter
        const subjectsResult = await pool.query(`
            SELECT id, name, color FROM subjects 
            WHERE user_id = $1 AND is_archived = false
            ORDER BY name
        `, [req.session.user.id]);

        // Get storage stats
        const statsResult = await pool.query(`
            SELECT 
                COUNT(*) as total_files,
                COALESCE(SUM(file_size), 0) as total_size,
                COUNT(CASE WHEN is_processed = true THEN 1 END) as processed_files
            FROM user_files
            WHERE user_id = $1
        `, [req.session.user.id]);

        res.render('materials/index', {
            title: 'Study Materials - SmartSched',
            page: 'materials',
            materials: filesResult.rows,
            subjects: subjectsResult.rows,
            stats: statsResult.rows[0],
            selectedSubject: subject_id,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading materials:', error);
        req.flash('error_msg', 'Failed to load materials');
        res.redirect('/dashboard');
    }
});

// ==========================================
// GET /materials/upload - Upload form
// ==========================================
router.get('/upload', async (req, res) => {
    try {
        const subjectsResult = await pool.query(`
            SELECT s.id, s.name, s.color,
                   json_agg(
                       json_build_object('id', t.id, 'name', t.name)
                       ORDER BY t.name
                   ) FILTER (WHERE t.id IS NOT NULL) as topics
            FROM subjects s
            LEFT JOIN topics t ON t.subject_id = s.id
            WHERE s.user_id = $1 AND s.is_archived = false
            GROUP BY s.id
            ORDER BY s.name
        `, [req.session.user.id]);

        res.render('materials/upload', {
            title: 'Upload Material - SmartSched',
            page: 'materials',
            subjects: subjectsResult.rows,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading upload form:', error);
        req.flash('error_msg', 'Failed to load upload form');
        res.redirect('/materials');
    }
});

// ==========================================
// POST /materials/upload - Upload file
// ==========================================
router.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            req.flash('error_msg', 'Please select a file to upload');
            return res.redirect('/materials/upload');
        }

        const { subject_id, description } = req.body;

        // Determine file type from extension
        const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
        const fileType = ext || 'unknown';

        // Insert file record (matching actual database schema)
        const fileResult = await pool.query(`
            INSERT INTO user_files 
            (user_id, subject_id, filename, original_name, file_path, file_type, file_size, mime_type, is_processed)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)
            RETURNING *
        `, [
            req.session.user.id,
            subject_id || null,
            req.file.filename,
            req.file.originalname,
            req.file.path,
            fileType,
            req.file.size,
            req.file.mimetype
        ]);

        const fileId = fileResult.rows[0].id;

        // Start async text extraction
        extractTextFromFile(fileId, req.file.path, req.file.mimetype);

        req.flash('success_msg', 'File uploaded successfully! Text extraction in progress.');
        res.redirect('/materials');
    } catch (error) {
        console.error('Error uploading file:', error);
        req.flash('error_msg', 'Failed to upload file: ' + error.message);
        res.redirect('/materials/upload');
    }
});

// ==========================================
// POST /materials/analyze/:id - Analyze material with AI
// ==========================================
router.post('/analyze/:id', async (req, res) => {
    try {
        const fileResult = await pool.query(`
            SELECT uf.*, s.name as subject_name
            FROM user_files uf
            LEFT JOIN subjects s ON uf.subject_id = s.id
            WHERE uf.id = $1 AND uf.user_id = $2
        `, [req.params.id, req.session.user.id]);

        if (fileResult.rows.length === 0) {
            return res.status(404).json({ error: 'File not found' });
        }

        const file = fileResult.rows[0];

        if (!file.extracted_text) {
            return res.status(400).json({ 
                error: 'Text not yet extracted. Please wait for processing to complete.' 
            });
        }

        if (!aiService.isAvailable()) {
            return res.status(503).json({ 
                error: 'AI service is currently unavailable.' 
            });
        }

        // Analyze with AI
        const analysis = await aiService.analyzeSyllabus(file.extracted_text, {
            subjectName: file.subject_name
        });

        // Save analysis as AI interaction
        await pool.query(`
            INSERT INTO ai_interactions 
            (user_id, subject_id, interaction_type, prompt, response)
            VALUES ($1, $2, 'analysis', $3, $4)
        `, [
            req.session.user.id,
            file.subject_id,
            `Analyzed file: ${file.original_filename}`,
            JSON.stringify(analysis)
        ]);

        // Update file status to analyzed
        await pool.query(`
            UPDATE user_files SET status = 'analyzed', ai_analysis = $1
            WHERE id = $2
        `, [JSON.stringify(analysis), req.params.id]);

        // Auto-create topics if analysis has topics and file has a subject
        let createdTopics = 0;
        if (analysis.topics && Array.isArray(analysis.topics) && file.subject_id) {
            for (const topic of analysis.topics) {
                try {
                    // Check if topic already exists
                    const existingTopic = await pool.query(`
                        SELECT id FROM topics 
                        WHERE subject_id = $1 AND LOWER(name) = LOWER($2)
                    `, [file.subject_id, topic.name]);

                    if (existingTopic.rows.length === 0) {
                        // Create new topic
                        const newTopic = await pool.query(`
                            INSERT INTO topics 
                            (subject_id, name, description, difficulty, estimated_hours, importance, is_completed)
                            VALUES ($1, $2, $3, $4, $5, $6, false)
                            RETURNING id
                        `, [
                            file.subject_id,
                            topic.name,
                            topic.description || '',
                            topic.difficulty || 'medium',
                            topic.estimated_hours || 1,
                            topic.importance || 3
                        ]);

                        // Link topic to file
                        await pool.query(`
                            INSERT INTO file_topics (file_id, topic_id)
                            VALUES ($1, $2)
                            ON CONFLICT DO NOTHING
                        `, [req.params.id, newTopic.rows[0].id]);

                        createdTopics++;
                    }
                } catch (topicError) {
                    console.error('Error creating topic:', topicError);
                }
            }
        }

        res.json({
            success: true,
            data: analysis,
            topicsCreated: createdTopics
        });
    } catch (error) {
        console.error('Error analyzing material:', error);
        res.status(500).json({ error: 'Failed to analyze material' });
    }
});

// ==========================================
// POST /materials/summarize/:id - Summarize material
// ==========================================
router.post('/summarize/:id', async (req, res) => {
    try {
        const fileResult = await pool.query(`
            SELECT uf.*, s.name as subject_name
            FROM user_files uf
            LEFT JOIN subjects s ON uf.subject_id = s.id
            WHERE uf.id = $1 AND uf.user_id = $2
        `, [req.params.id, req.session.user.id]);

        if (fileResult.rows.length === 0) {
            return res.status(404).json({ error: 'File not found' });
        }

        const file = fileResult.rows[0];

        if (!file.extracted_text) {
            return res.status(400).json({ 
                error: 'Text not yet extracted. Please wait for processing to complete.' 
            });
        }

        if (!aiService.isAvailable()) {
            return res.status(503).json({ 
                error: 'AI service is currently unavailable.' 
            });
        }

        // Summarize with AI
        const summary = await aiService.summarizeMaterial(file.extracted_text);

        // Save as AI interaction
        await pool.query(`
            INSERT INTO ai_interactions 
            (user_id, subject_id, interaction_type, prompt, response)
            VALUES ($1, $2, 'summary', $3, $4)
        `, [
            req.session.user.id,
            file.subject_id,
            `Summarized: ${file.original_filename}`,
            JSON.stringify(summary)
        ]);

        // Save summary to file record
        await pool.query(`
            UPDATE user_files SET ai_summary = $1
            WHERE id = $2
        `, [JSON.stringify(summary), req.params.id]);

        res.json({
            success: true,
            data: summary
        });
    } catch (error) {
        console.error('Error summarizing material:', error);
        res.status(500).json({ error: 'Failed to summarize material' });
    }
});

// ==========================================
// POST /materials/create-topics/:id - Create topics from analysis
// ==========================================
router.post('/create-topics/:id', async (req, res) => {
    try {
        // Get the file and its AI analysis
        const fileResult = await pool.query(`
            SELECT uf.*, s.name as subject_name
            FROM user_files uf
            LEFT JOIN subjects s ON uf.subject_id = s.id
            WHERE uf.id = $1 AND uf.user_id = $2
        `, [req.params.id, req.session.user.id]);

        if (fileResult.rows.length === 0) {
            return res.status(404).json({ error: 'File not found' });
        }

        const file = fileResult.rows[0];

        if (!file.subject_id) {
            return res.status(400).json({ error: 'File must be linked to a subject first' });
        }

        if (!file.ai_analysis) {
            return res.status(400).json({ error: 'Please analyze the file first' });
        }

        // Parse the AI analysis
        let analysis;
        try {
            analysis = typeof file.ai_analysis === 'string' 
                ? JSON.parse(file.ai_analysis) 
                : file.ai_analysis;
        } catch (e) {
            return res.status(400).json({ error: 'Invalid analysis data' });
        }

        if (!analysis.topics || !Array.isArray(analysis.topics) || analysis.topics.length === 0) {
            return res.status(400).json({ error: 'No topics found in analysis' });
        }

        const createdTopics = [];

        for (const topic of analysis.topics) {
            // Check if topic already exists
            const existingTopic = await pool.query(`
                SELECT id FROM topics 
                WHERE subject_id = $1 AND LOWER(name) = LOWER($2)
            `, [file.subject_id, topic.name]);

            if (existingTopic.rows.length === 0) {
                const result = await pool.query(`
                    INSERT INTO topics 
                    (subject_id, name, description, difficulty, importance, estimated_hours, is_completed)
                    VALUES ($1, $2, $3, $4, $5, $6, false)
                    RETURNING *
                `, [
                    file.subject_id,
                    topic.name,
                    topic.description || null,
                    topic.difficulty || 'medium',
                    topic.importance || 3,
                    topic.estimated_hours || 1
                ]);

                if (result.rows.length > 0) {
                    createdTopics.push(result.rows[0]);

                    // Link topic to file
                    await pool.query(`
                        INSERT INTO file_topics (file_id, topic_id)
                        VALUES ($1, $2)
                        ON CONFLICT DO NOTHING
                    `, [req.params.id, result.rows[0].id]);
                }
            }
        }

        res.json({
            success: true,
            created: createdTopics.length,
            topics: createdTopics
        });
    } catch (error) {
        console.error('Error creating topics:', error);
        res.status(500).json({ error: 'Failed to create topics' });
    }
});

// ==========================================
// GET /materials/:id - View material details
// ==========================================
router.get('/:id', async (req, res) => {
    try {
        const fileResult = await pool.query(`
            SELECT uf.*, s.name as subject_name, s.color as subject_color
            FROM user_files uf
            LEFT JOIN subjects s ON uf.subject_id = s.id
            WHERE uf.id = $1 AND uf.user_id = $2
        `, [req.params.id, req.session.user.id]);

        if (fileResult.rows.length === 0) {
            req.flash('error_msg', 'Material not found');
            return res.redirect('/materials');
        }

        // Get linked topics
        const topicsResult = await pool.query(`
            SELECT t.*, s.name as subject_name
            FROM file_topics ft
            JOIN topics t ON ft.topic_id = t.id
            JOIN subjects s ON t.subject_id = s.id
            WHERE ft.file_id = $1
            ORDER BY t.name
        `, [req.params.id]);

        // Get AI analyses for this file
        const analysesResult = await pool.query(`
            SELECT * FROM ai_interactions
            WHERE user_id = $1 
              AND interaction_type IN ('analysis', 'summary')
              AND prompt LIKE $2
            ORDER BY created_at DESC
        `, [req.session.user.id, `%${fileResult.rows[0].original_filename}%`]);

        res.render('materials/view', {
            title: `${fileResult.rows[0].original_filename} - SmartSched`,
            page: 'materials',
            material: fileResult.rows[0],
            linkedTopics: topicsResult.rows,
            analyses: analysesResult.rows,
            aiAvailable: aiService.isAvailable(),
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading material:', error);
        req.flash('error_msg', 'Failed to load material');
        res.redirect('/materials');
    }
});

// ==========================================
// DELETE /materials/:id - Delete material
// ==========================================
router.delete('/:id', async (req, res) => {
    try {
        const fileResult = await pool.query(`
            SELECT * FROM user_files WHERE id = $1 AND user_id = $2
        `, [req.params.id, req.session.user.id]);

        if (fileResult.rows.length === 0) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Delete physical file
        try {
            await fs.unlink(fileResult.rows[0].file_path);
        } catch (e) {
            console.warn('Could not delete physical file:', e.message);
        }

        // Delete database record (cascades to file_topics)
        await pool.query('DELETE FROM user_files WHERE id = $1', [req.params.id]);

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting material:', error);
        res.status(500).json({ error: 'Failed to delete material' });
    }
});

// POST route for delete (for form submissions)
router.post('/:id/delete', async (req, res) => {
    try {
        const fileResult = await pool.query(`
            SELECT * FROM user_files WHERE id = $1 AND user_id = $2
        `, [req.params.id, req.session.user.id]);

        if (fileResult.rows.length === 0) {
            req.flash('error_msg', 'File not found');
            return res.redirect('/materials');
        }

        // Delete physical file
        try {
            await fs.unlink(fileResult.rows[0].file_path);
        } catch (e) {
            console.warn('Could not delete physical file:', e.message);
        }

        // Delete database record
        await pool.query('DELETE FROM user_files WHERE id = $1', [req.params.id]);

        req.flash('success_msg', 'Material deleted successfully');
        res.redirect('/materials');
    } catch (error) {
        console.error('Error deleting material:', error);
        req.flash('error_msg', 'Failed to delete material');
        res.redirect('/materials');
    }
});

// ==========================================
// Helper function: Extract text from files
// ==========================================
async function extractTextFromFile(fileId, filePath, mimeType) {
    try {
        let extractedText = '';

        if (mimeType === 'application/pdf') {
            const dataBuffer = await fs.readFile(filePath);
            const { PDFParse } = require('pdf-parse');
            const parser = new PDFParse({ data: dataBuffer });
            await parser.load();
            const result = await parser.getText();
            // getText() returns { pages: [{ text, num }, ...] }
            extractedText = result.pages.map(p => p.text).join('\n\n');
        } else if (mimeType === 'text/plain') {
            extractedText = await fs.readFile(filePath, 'utf8');
        } else if (mimeType.startsWith('image/')) {
            // Use OCR.space API for image text extraction
            extractedText = await extractTextFromImage(filePath);
        } else {
            // For DOC/DOCX, basic extraction
            // In production, you'd use mammoth or similar
            extractedText = '[Document file - text extraction pending]';
        }

        // Update database
        await pool.query(`
            UPDATE user_files 
            SET extracted_text = $1, is_processed = true
            WHERE id = $2
        `, [extractedText, fileId]);

        console.log(`✅ Text extracted for file ${fileId}`);
    } catch (error) {
        console.error(`❌ Error extracting text for file ${fileId}:`, error);
        
        await pool.query(`
            UPDATE user_files 
            SET is_processed = true, processing_error = $1
            WHERE id = $2
        `, [error.message, fileId]);
    }
}

// ==========================================
// Helper function: OCR.space API for images
// ==========================================
async function extractTextFromImage(filePath) {
    const ocrApiKey = process.env.OCR_SPACE_API_KEY;
    
    if (!ocrApiKey) {
        console.warn('⚠️ OCR_SPACE_API_KEY not set. Image OCR disabled.');
        return '[Image file - OCR not configured. Add OCR_SPACE_API_KEY to .env]';
    }

    try {
        const imageBuffer = await fs.readFile(filePath);
        const base64Image = imageBuffer.toString('base64');
        const mimeType = filePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
        
        const formData = new URLSearchParams();
        formData.append('apikey', ocrApiKey);
        formData.append('base64Image', `data:${mimeType};base64,${base64Image}`);
        formData.append('language', 'eng');
        formData.append('isOverlayRequired', 'false');
        formData.append('OCREngine', '2'); // Engine 2 is better for handwriting

        const response = await fetch('https://api.ocr.space/parse/image', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.IsErroredOnProcessing) {
            console.error('OCR.space error:', result.ErrorMessage);
            return `[OCR Error: ${result.ErrorMessage?.[0] || 'Unknown error'}]`;
        }

        if (result.ParsedResults && result.ParsedResults.length > 0) {
            const extractedText = result.ParsedResults.map(r => r.ParsedText).join('\n');
            console.log(`✅ OCR.space extracted ${extractedText.length} characters`);
            return extractedText || '[No text found in image]';
        }

        return '[No text found in image]';
    } catch (error) {
        console.error('OCR.space API error:', error);
        return `[OCR failed: ${error.message}]`;
    }
}

module.exports = router;
