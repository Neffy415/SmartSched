/**
 * SmartSched Concept Graph Routes
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const aiService = require('../services/aiService');

const DEFAULT_CLUSTER_COLORS = [
    '#6366F1', '#FF6B6B', '#4ECDC4', '#FFE66D', '#95E1D3', '#C7CEEA', '#F8B195', '#355C7D'
];

function isValidHexColor(value) {
    return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value.trim());
}

function normalizeNodeId(value) {
    return String(value || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function isRateLimitedError(error) {
    const message = (error && error.message ? error.message : '').toLowerCase();
    return message.includes('rate')
        || message.includes('quota')
        || message.includes('resource_exhausted')
        || message.includes('too many requests')
        || message.includes('429');
}

function buildFallbackConceptGraph(subjectName, topicRows = [], fallbackColor = '#6366F1') {
    const topics = Array.isArray(topicRows) ? topicRows : [];
    const nodes = [];
    const edges = [];
    const clusters = [];
    const usedIds = new Set();
    const primaryColor = isValidHexColor(fallbackColor) ? fallbackColor : '#6366F1';
    const palette = [primaryColor, ...DEFAULT_CLUSTER_COLORS.filter(color => color !== primaryColor)];

    const makeUniqueId = (base) => {
        const cleanBase = normalizeNodeId(base) || 'node';
        let id = cleanBase;
        let suffix = 2;
        while (usedIds.has(id)) {
            id = `${cleanBase}-${suffix++}`;
        }
        usedIds.add(id);
        return id;
    };

    const normalizedTopics = topics
        .map((topic, index) => ({
            name: typeof topic?.name === 'string' && topic.name.trim() ? topic.name.trim() : `Topic ${index + 1}`,
            difficulty: topic?.difficulty || 'medium',
            importance: Number(topic?.importance) || 3
        }))
        .slice(0, 20);

    normalizedTopics.forEach((topic, index) => {
        const topicNodeId = makeUniqueId(`topic-${topic.name}`);
        const color = palette[index % palette.length];
        const importance = topic.importance >= 4 ? 'high' : (topic.importance <= 2 ? 'low' : 'medium');

        nodes.push({
            id: topicNodeId,
            label: topic.name,
            group: topic.name,
            level: 0,
            description: `Core topic in ${subjectName}`,
            importance
        });

        const subConcepts = [
            `Fundamentals of ${topic.name}`,
            `Key Ideas in ${topic.name}`,
            topic.difficulty === 'hard' ? `Advanced Applications of ${topic.name}` : `Applications of ${topic.name}`
        ];

        subConcepts.forEach((label, subIndex) => {
            const subId = makeUniqueId(`sub-${topic.name}-${subIndex + 1}`);
            nodes.push({
                id: subId,
                label,
                group: topic.name,
                level: 1,
                description: `${label} for structured revision`,
                importance: subIndex === 0 ? 'medium' : 'low'
            });

            edges.push({
                from: topicNodeId,
                to: subId,
                label: 'part of',
                type: 'part_of'
            });
        });

        clusters.push({
            name: topic.name,
            color,
            description: `Concepts related to ${topic.name}`
        });

        if (index > 0) {
            const prevTopic = normalizedTopics[index - 1];
            const prevTopicNodeId = nodes.find(n => n.label === prevTopic.name && n.level === 0)?.id;
            if (prevTopicNodeId) {
                edges.push({
                    from: prevTopicNodeId,
                    to: topicNodeId,
                    label: 'prerequisite',
                    type: 'prerequisite'
                });
            }
        }
    });

    if (nodes.length <= 1 && nodes.length > 0) {
        // Ensure at least one connection for vis.js usability.
        const onlyNode = nodes[0];
        const extraId = makeUniqueId(`${onlyNode.label}-overview`);
        nodes.push({
            id: extraId,
            label: `${onlyNode.label} Overview`,
            group: onlyNode.group,
            level: 1,
            description: `Overview concepts for ${onlyNode.label}`,
            importance: 'medium'
        });
        edges.push({ from: onlyNode.id, to: extraId, label: 'related', type: 'related' });
    }

    return {
        title: `Concept Map: ${subjectName}`,
        nodes,
        edges,
        clusters
    };
}

function normalizeConceptGraph(rawGraph, subjectName, topicNames = [], fallbackColor = '#6366f1') {
    const graph = rawGraph && typeof rawGraph === 'object' ? rawGraph : {};
    const topics = Array.isArray(topicNames)
        ? topicNames.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim())
        : [];

    const defaultGroup = topics[0] || subjectName || 'General';
    const topicLookup = new Map(topics.map(topic => [topic.toLowerCase(), topic]));

    const nodesInput = Array.isArray(graph.nodes) ? graph.nodes : [];
    const usedNodeIds = new Set();
    const nodes = [];

    nodesInput.forEach((node, index) => {
        const label = typeof node?.label === 'string' ? node.label.trim() : '';
        if (!label) return;

        const originalId = typeof node?.id === 'string' || typeof node?.id === 'number'
            ? String(node.id).trim()
            : '';
        const idBase = originalId || normalizeNodeId(label) || `node-${index + 1}`;
        let id = idBase;
        let suffix = 2;
        while (usedNodeIds.has(id)) {
            id = `${idBase}-${suffix++}`;
        }
        usedNodeIds.add(id);

        const rawGroup = typeof node?.group === 'string' ? node.group.trim() : '';
        const group = topicLookup.get(rawGroup.toLowerCase()) || rawGroup || defaultGroup;

        const rawLevel = Number(node?.level);
        const level = Number.isFinite(rawLevel) ? Math.max(0, Math.min(2, Math.round(rawLevel))) : 1;

        const rawImportance = typeof node?.importance === 'string' ? node.importance.toLowerCase().trim() : '';
        const importance = ['high', 'medium', 'low'].includes(rawImportance) ? rawImportance : 'medium';

        const description = typeof node?.description === 'string' && node.description.trim()
            ? node.description.trim()
            : `${label} in ${subjectName}`;

        nodes.push({ id, label, group, level, description, importance });
    });

    if (nodes.length === 0) {
        topics.forEach((topic, index) => {
            nodes.push({
                id: `topic-${index + 1}`,
                label: topic,
                group: topic,
                level: 0,
                description: `Core topic in ${subjectName}`,
                importance: 'high'
            });
        });
    }

    if (nodes.length === 0) {
        nodes.push({
            id: 'main-topic',
            label: subjectName || 'Concept Map',
            group: defaultGroup,
            level: 0,
            description: `Core topic in ${subjectName || 'this subject'}`,
            importance: 'high'
        });
    }

    const nodeIds = new Set(nodes.map(node => node.id));
    const edgeTypes = new Set(['prerequisite', 'related', 'builds_on', 'part_of', 'applies_to']);
    const edgesInput = Array.isArray(graph.edges) ? graph.edges : [];
    const edgeKeys = new Set();
    const edges = [];

    edgesInput.forEach(edge => {
        const from = typeof edge?.from === 'string' || typeof edge?.from === 'number'
            ? String(edge.from).trim()
            : '';
        const to = typeof edge?.to === 'string' || typeof edge?.to === 'number'
            ? String(edge.to).trim()
            : '';

        if (!from || !to || from === to || !nodeIds.has(from) || !nodeIds.has(to)) return;

        const rawType = typeof edge?.type === 'string' ? edge.type.toLowerCase().trim() : 'related';
        const type = edgeTypes.has(rawType) ? rawType : 'related';
        const label = typeof edge?.label === 'string' && edge.label.trim()
            ? edge.label.trim()
            : type.replace('_', ' ');
        const dedupeKey = `${from}->${to}:${type}:${label.toLowerCase()}`;

        if (edgeKeys.has(dedupeKey)) return;
        edgeKeys.add(dedupeKey);

        edges.push({ from, to, label, type });
    });

    if (edges.length === 0 && nodes.length > 1) {
        for (let i = 0; i < nodes.length - 1; i++) {
            edges.push({
                from: nodes[i].id,
                to: nodes[i + 1].id,
                label: 'related',
                type: 'related'
            });
        }
    }

    const graphClusters = Array.isArray(graph.clusters) ? graph.clusters : [];
    const normalizedClusters = [];
    const seenClusterNames = new Set();
    const primaryColor = isValidHexColor(fallbackColor) ? fallbackColor : '#6366F1';
    const palette = [primaryColor, ...DEFAULT_CLUSTER_COLORS.filter(color => color !== primaryColor)];

    const clusterNames = topics.length > 0
        ? topics
        : [...new Set(nodes.map(node => node.group).filter(Boolean))];

    clusterNames.forEach((name, index) => {
        const existing = graphClusters.find(cluster =>
            typeof cluster?.name === 'string' && cluster.name.trim().toLowerCase() === name.toLowerCase()
        );

        const clusterName = typeof existing?.name === 'string' && existing.name.trim()
            ? existing.name.trim()
            : name;
        const clusterKey = clusterName.toLowerCase();
        if (seenClusterNames.has(clusterKey)) return;
        seenClusterNames.add(clusterKey);

        const color = isValidHexColor(existing?.color) ? existing.color.trim() : palette[index % palette.length];
        const description = typeof existing?.description === 'string' && existing.description.trim()
            ? existing.description.trim()
            : `Concepts related to ${clusterName}`;

        normalizedClusters.push({ name: clusterName, color, description });
    });

    const title = typeof graph.title === 'string' && graph.title.trim()
        ? graph.title.trim()
        : `Concept Map: ${subjectName}`;

    return {
        title,
        nodes,
        edges,
        clusters: normalizedClusters
    };
}

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

        // Check if AI service is available
        if (!aiService.isConfigured()) {
            console.error('AI Service not configured - GEMINI_API_KEY not set');
            return res.status(500).json({ error: 'AI service is not configured. Please contact administrator.' });
        }

        const subject = await pool.query('SELECT * FROM subjects WHERE id = $1 AND user_id = $2', [subject_id, userId]);
        if (subject.rows.length === 0) return res.status(404).json({ error: 'Subject not found' });

        const topics = await pool.query(`
            SELECT t.name, t.difficulty, t.importance, t.is_completed
            FROM topics t
            JOIN subjects s ON s.id = t.subject_id
            WHERE t.subject_id = $1 AND s.user_id = $2
            ORDER BY t.order_index, t.name
        `, [subject_id, userId]);
        const topicNames = topics.rows.map(t => t.name);
        const subjectName = subject.rows[0].name;

        if (topicNames.length === 0) {
            return res.status(400).json({ error: 'Please add at least one topic to this subject first' });
        }

        console.log(`📊 Generating concept graph for subject: ${subjectName}, topics: ${topicNames.join(', ')}`);

        let normalizedGraph;
        let usedFallback = false;

        try {
            const response = await aiService.generateConceptGraph(subjectName, topicNames);
            normalizedGraph = normalizeConceptGraph(
                response,
                subjectName,
                topicNames,
                subject.rows[0].color || '#6366f1'
            );
        } catch (aiError) {
            if (!isRateLimitedError(aiError)) {
                throw aiError;
            }

            console.warn('⚠️ AI rate limited. Generating fallback concept graph.');
            const fallbackGraph = buildFallbackConceptGraph(subjectName, topics.rows, subject.rows[0].color || '#6366f1');
            normalizedGraph = normalizeConceptGraph(
                fallbackGraph,
                subjectName,
                topicNames,
                subject.rows[0].color || '#6366f1'
            );
            usedFallback = true;
        }

        console.log('✅ AI response received, validating...');

        if (!normalizedGraph.nodes || normalizedGraph.nodes.length === 0) {
            return res.status(500).json({ error: 'Failed to generate concept graph - no usable nodes returned' });
        }

        console.log(`✅ Concept graph validated: ${normalizedGraph.nodes.length} nodes, ${normalizedGraph.edges.length || 0} edges`);

        // Save the graph
        const graphResult = await pool.query(`
            INSERT INTO concept_graphs (user_id, subject_id, title, graph_data)
            VALUES ($1, $2, $3, $4)
            RETURNING id
            `, [userId, subject_id, normalizedGraph.title, normalizedGraph]);

        console.log(`✅ Concept graph saved with ID: ${graphResult.rows[0].id}`);

            res.json({
                success: true,
                graphId: graphResult.rows[0].id,
                graph: normalizedGraph,
                fallback: usedFallback
            });
    } catch (error) {
        console.error('❌ Concept graph generation error:', error.message);
        console.error('Stack:', error.stack);
        
        // Provide specific error messages
        if (error.message.includes('AI service')) {
            res.status(500).json({ error: 'AI service is not available. Please check GEMINI_API_KEY.' });
        } else if (error.message.includes('rate')) {
            res.status(503).json({ error: 'AI service rate limited. Please try again in a moment.' });
        } else {
            res.status(500).json({ error: 'Failed to generate concept graph: ' + error.message });
        }
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
