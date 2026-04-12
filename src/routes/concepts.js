/**
 * SmartSched Concept Graph Routes
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const aiService = require('../services/aiService');

const requireAuth = (req, res, next) => {
    if (!req.session.user) return res.redirect('/auth/login');
    next();
};

router.use(requireAuth);

/**
 * GET /concepts - Concept graph home
 */
router.get('/', async (req, res) => {
    try {
        const userId = req.session.user.id;

        const subjects = await pool.query(`
            SELECT s.*, COUNT(t.id) as topic_count
            FROM subjects s
            LEFT JOIN topics t ON s.id = t.subject_id
            WHERE s.user_id = $1 AND s.is_archived = false
            GROUP BY s.id ORDER BY s.name
        `, [userId]);

        // Get saved graphs
        const graphs = await pool.query(`
            SELECT cg.*, s.name as subject_name, s.color as subject_color
            FROM concept_graphs cg
            LEFT JOIN subjects s ON cg.subject_id = s.id
            WHERE cg.user_id = $1
            ORDER BY cg.created_at DESC
            LIMIT 20
        `, [userId]);

        res.render('concepts/index', {
            title: 'Concept Graph - SmartSched',
            page: 'concepts',
            subjects: subjects.rows,
            graphs: graphs.rows
        });
    } catch (error) {
        console.error('Concept graph error:', error);
        req.flash('error', 'Failed to load concept graph');
        res.redirect('/dashboard');
    }
});

/**
 * POST /concepts/generate - Generate a concept graph via AI
 */
router.post('/generate', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { subject_id } = req.body;

        if (!subject_id) return res.status(400).json({ error: 'Subject required' });

        const subject = await pool.query('SELECT * FROM subjects WHERE id = $1 AND user_id = $2', [subject_id, userId]);
        if (subject.rows.length === 0) return res.status(404).json({ error: 'Subject not found' });

        const topics = await pool.query('SELECT name, difficulty, importance, is_completed FROM topics WHERE subject_id = $1 ORDER BY order_index', [subject_id]);
        const topicNames = topics.rows.map(t => t.name);
        const subjectName = subject.rows[0].name;

        const prompt = `You are an expert educator. Create a concept relationship map for the subject "${subjectName}".

Topics in this subject: ${topicNames.join(', ')}

Generate a concept graph showing how these topics relate to each other. Include sub-concepts within each topic.

Return ONLY valid JSON (no markdown):
{
  "title": "Concept Map: ${subjectName}",
  "nodes": [
    {
      "id": "unique_id",
      "label": "Concept Name",
      "group": "topic_name_it_belongs_to",
      "level": 0,
      "description": "Brief description of this concept",
      "importance": "high|medium|low"
    }
  ],
  "edges": [
    {
      "from": "node_id_1",
      "to": "node_id_2",
      "label": "relationship type",
      "type": "prerequisite|related|builds_on|part_of|applies_to"
    }
  ],
  "clusters": [
    {
      "name": "Topic/Group Name",
      "color": "#hex_color",
      "description": "What this cluster covers"
    }
  ]
}

Rules:
- Create 15-40 nodes depending on complexity
- Level 0 = main topics, Level 1 = sub-concepts, Level 2 = details
- Every edge must have a meaningful relationship label
- Use the actual topic names as group names for top-level nodes
- Include cross-topic relationships (these are the most valuable)
- Each cluster should have a distinct, visually pleasing color
- Think about prerequisite chains: what must you learn first?`;

        const response = await aiService.callGemini(prompt);

        if (!response.nodes || !response.edges) {
            return res.status(500).json({ error: 'Failed to generate concept graph' });
        }

        // Save the graph
        const graphResult = await pool.query(`
            INSERT INTO concept_graphs (user_id, subject_id, title, graph_data)
            VALUES ($1, $2, $3, $4)
            RETURNING id
        `, [userId, subject_id, response.title || `${subjectName} Concept Map`, JSON.stringify(response)]);

        res.json({ success: true, graphId: graphResult.rows[0].id, graph: response });
    } catch (error) {
        console.error('Concept graph generation error:', error);
        res.status(500).json({ error: 'Failed to generate concept graph: ' + error.message });
    }
});

/**
 * GET /concepts/:id - View a saved graph
 */
router.get('/:id', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const graph = await pool.query(`
            SELECT cg.*, s.name as subject_name, s.color as subject_color
            FROM concept_graphs cg
            LEFT JOIN subjects s ON cg.subject_id = s.id
            WHERE cg.id = $1 AND cg.user_id = $2
        `, [req.params.id, userId]);

        if (graph.rows.length === 0) {
            req.flash('error', 'Graph not found');
            return res.redirect('/concepts');
        }

        const graphRow = graph.rows[0];
        // Ensure graph_data is parsed as object (handles both string and object returns)
        let graphData = graphRow.graph_data;
        if (typeof graphData === 'string') {
            try {
                graphData = JSON.parse(graphData);
            } catch (e) {
                console.error('Failed to parse graph_data:', e);
                req.flash('error', 'Graph data is corrupted');
                return res.redirect('/concepts');
            }
        }

        res.render('concepts/view', {
            title: graphRow.title + ' - SmartSched',
            page: 'concepts',
            graph: graphRow,
            graphData: graphData
        });
    } catch (error) {
        console.error('View graph error:', error);
        req.flash('error', 'Failed to load graph');
        res.redirect('/concepts');
    }
});

/**
 * DELETE /concepts/:id - Delete a graph
 */
router.delete('/:id', async (req, res) => {
    try {
        const userId = req.session.user.id;
        await pool.query('DELETE FROM concept_graphs WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete graph' });
    }
});

module.exports = router;
