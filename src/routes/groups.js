const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../config/database');
const aiService = require('../services/aiService');

// Auth middleware
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        req.flash('error', 'Please login to access this page');
        return res.redirect('/auth/login');
    }
    next();
};
router.use(requireAuth);

// Helper: check membership
async function checkMembership(groupId, userId) {
    const result = await db.query(
        'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
    );
    return result.rows[0] || null;
}

// Helper: generate invite code
function generateInviteCode() {
    return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// ============================================
// GET /groups - List all groups user belongs to
// ============================================
router.get('/', async (req, res) => {
    try {
        const userId = req.session.user.id;

        const groupsResult = await db.query(`
            SELECT sg.*, gm.role,
                   u.full_name as creator_name,
                   (SELECT COUNT(*) FROM group_members WHERE group_id = sg.id) as member_count,
                   (SELECT COUNT(*) FROM group_shared_items WHERE group_id = sg.id) as shared_count,
                   (SELECT COUNT(*) FROM group_messages WHERE group_id = sg.id) as message_count
            FROM study_groups sg
            JOIN group_members gm ON sg.id = gm.group_id AND gm.user_id = $1
            JOIN users u ON sg.created_by = u.id
            ORDER BY sg.updated_at DESC
        `, [userId]);

        res.render('groups/index', {
            title: 'Study Groups - SmartSched',
            page: 'groups',
            groups: groupsResult.rows
        });
    } catch (error) {
        console.error('Error fetching groups:', error);
        req.flash('error', 'Failed to load groups');
        res.redirect('/dashboard');
    }
});

// ============================================
// GET /groups/create - Show create group form
// ============================================
router.get('/create', (req, res) => {
    res.render('groups/form', {
        title: 'Create Study Group - SmartSched',
        page: 'groups',
        group: null,
        errors: []
    });
});

// ============================================
// POST /groups/create - Create a new group
// ============================================
router.post('/create', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { name, description } = req.body;

        if (!name || name.trim().length < 2) {
            return res.render('groups/form', {
                title: 'Create Study Group - SmartSched',
                page: 'groups',
                group: req.body,
                errors: [{ msg: 'Group name must be at least 2 characters' }]
            });
        }

        // Generate unique invite code
        let inviteCode;
        let codeExists = true;
        while (codeExists) {
            inviteCode = generateInviteCode();
            const check = await db.query('SELECT id FROM study_groups WHERE invite_code = $1', [inviteCode]);
            codeExists = check.rows.length > 0;
        }

        // Create the group
        const groupResult = await db.query(`
            INSERT INTO study_groups (name, description, invite_code, created_by)
            VALUES ($1, $2, $3, $4)
            RETURNING id
        `, [name.trim(), description?.trim() || null, inviteCode, userId]);

        const groupId = groupResult.rows[0].id;

        // Add creator as admin
        await db.query(`
            INSERT INTO group_members (group_id, user_id, role)
            VALUES ($1, $2, 'admin')
        `, [groupId, userId]);

        req.flash('success', `Group "${name.trim()}" created! Invite code: ${inviteCode}`);
        res.redirect(`/groups/${groupId}`);
    } catch (error) {
        console.error('Error creating group:', error);
        req.flash('error', 'Failed to create group');
        res.redirect('/groups');
    }
});

// ============================================
// POST /groups/join - Join a group via invite code
// ============================================
router.post('/join', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { invite_code } = req.body;

        if (!invite_code || invite_code.trim().length === 0) {
            req.flash('error', 'Please enter an invite code');
            return res.redirect('/groups');
        }

        const code = invite_code.trim().toUpperCase();

        // Find group by invite code
        const groupResult = await db.query(
            'SELECT id, name FROM study_groups WHERE invite_code = $1',
            [code]
        );

        if (groupResult.rows.length === 0) {
            req.flash('error', 'Invalid invite code. No group found.');
            return res.redirect('/groups');
        }

        const group = groupResult.rows[0];

        // Check if already a member
        const existing = await checkMembership(group.id, userId);
        if (existing) {
            req.flash('error', 'You are already a member of this group');
            return res.redirect(`/groups/${group.id}`);
        }

        // Join the group
        await db.query(`
            INSERT INTO group_members (group_id, user_id, role)
            VALUES ($1, $2, 'member')
        `, [group.id, userId]);

        req.flash('success', `You joined "${group.name}"!`);
        res.redirect(`/groups/${group.id}`);
    } catch (error) {
        console.error('Error joining group:', error);
        req.flash('error', 'Failed to join group');
        res.redirect('/groups');
    }
});

// ============================================
// GET /groups/:id - View group detail
// ============================================
router.get('/:id', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const groupId = req.params.id;

        // Check membership
        const membership = await checkMembership(groupId, userId);
        if (!membership) {
            req.flash('error', 'You are not a member of this group');
            return res.redirect('/groups');
        }

        // Get group info
        const groupResult = await db.query(`
            SELECT sg.*, u.full_name as creator_name
            FROM study_groups sg
            JOIN users u ON sg.created_by = u.id
            WHERE sg.id = $1
        `, [groupId]);

        if (groupResult.rows.length === 0) {
            req.flash('error', 'Group not found');
            return res.redirect('/groups');
        }

        const group = groupResult.rows[0];

        // Get members
        const membersResult = await db.query(`
            SELECT gm.*, u.full_name, u.email, u.avatar_url
            FROM group_members gm
            JOIN users u ON gm.user_id = u.id
            WHERE gm.group_id = $1
            ORDER BY gm.role DESC, gm.joined_at ASC
        `, [groupId]);

        // Get shared items with details
        const sharedResult = await db.query(`
            SELECT gsi.*,
                   u.full_name as shared_by_name,
                   CASE gsi.item_type
                       WHEN 'note' THEN (SELECT title FROM saved_notes WHERE id = gsi.item_id)
                       WHEN 'flashcard_set' THEN (SELECT title FROM flashcard_sets WHERE id = gsi.item_id)
                       WHEN 'material' THEN (SELECT original_name FROM user_files WHERE id = gsi.item_id)
                   END as item_title
            FROM group_shared_items gsi
            JOIN users u ON gsi.user_id = u.id
            WHERE gsi.group_id = $1
            ORDER BY gsi.shared_at DESC
        `, [groupId]);

        // Get messages (latest 50)
        const messagesResult = await db.query(`
            SELECT gm.*, u.full_name, u.avatar_url
            FROM group_messages gm
            JOIN users u ON gm.user_id = u.id
            WHERE gm.group_id = $1
            ORDER BY gm.created_at ASC
            LIMIT 50
        `, [groupId]);

        // Get AI Q&A queries (latest 30)
        const aiQueriesResult = await db.query(`
            SELECT gaq.*, u.full_name
            FROM group_ai_queries gaq
            JOIN users u ON gaq.user_id = u.id
            WHERE gaq.group_id = $1
            ORDER BY gaq.created_at DESC
            LIMIT 30
        `, [groupId]);

        // Get user's shareable items for the share modal
        const notesResult = await db.query(
            'SELECT id, title FROM saved_notes WHERE user_id = $1 ORDER BY created_at DESC',
            [userId]
        );
        const flashcardSetsResult = await db.query(
            'SELECT id, title FROM flashcard_sets WHERE user_id = $1 ORDER BY created_at DESC',
            [userId]
        );
        const materialsResult = await db.query(
            'SELECT id, original_name as title FROM user_files WHERE user_id = $1 ORDER BY created_at DESC',
            [userId]
        );

        // Get already shared item IDs so we don't show duplicates
        const alreadyShared = sharedResult.rows.map(i => i.item_id);

        res.render('groups/view', {
            title: `${group.name} - SmartSched`,
            page: 'groups',
            group,
            membership,
            members: membersResult.rows,
            sharedItems: sharedResult.rows.filter(i => i.item_title),
            messages: messagesResult.rows,
            userNotes: notesResult.rows.filter(n => !alreadyShared.includes(n.id)),
            userFlashcards: flashcardSetsResult.rows.filter(f => !alreadyShared.includes(f.id)),
            userMaterials: materialsResult.rows.filter(m => !alreadyShared.includes(m.id)),
            aiQueries: aiQueriesResult.rows,
            userId
        });
    } catch (error) {
        console.error('Error loading group:', error);
        req.flash('error', 'Failed to load group');
        res.redirect('/groups');
    }
});

// ============================================
// POST /groups/:id/share - Share an item to group
// ============================================
router.post('/:id/share', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const groupId = req.params.id;
        const { item_type, item_id } = req.body;

        // Check membership
        const membership = await checkMembership(groupId, userId);
        if (!membership) {
            return res.status(403).json({ error: 'Not a member' });
        }

        // Validate item_type
        if (!['note', 'flashcard_set', 'material'].includes(item_type)) {
            return res.status(400).json({ error: 'Invalid item type' });
        }

        // Verify item belongs to user
        let ownerCheck;
        if (item_type === 'note') {
            ownerCheck = await db.query('SELECT id FROM saved_notes WHERE id = $1 AND user_id = $2', [item_id, userId]);
        } else if (item_type === 'flashcard_set') {
            ownerCheck = await db.query('SELECT id FROM flashcard_sets WHERE id = $1 AND user_id = $2', [item_id, userId]);
        } else {
            ownerCheck = await db.query('SELECT id FROM user_files WHERE id = $1 AND user_id = $2', [item_id, userId]);
        }

        if (ownerCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Item not found or not yours' });
        }

        // Check if already shared
        const existing = await db.query(
            'SELECT id FROM group_shared_items WHERE group_id = $1 AND item_type = $2 AND item_id = $3',
            [groupId, item_type, item_id]
        );
        if (existing.rows.length > 0) {
            req.flash('error', 'This item is already shared in the group');
            return res.redirect(`/groups/${groupId}`);
        }

        await db.query(`
            INSERT INTO group_shared_items (group_id, user_id, item_type, item_id)
            VALUES ($1, $2, $3, $4)
        `, [groupId, userId, item_type, item_id]);

        // Update group timestamp
        await db.query('UPDATE study_groups SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [groupId]);

        req.flash('success', 'Item shared with the group!');
        res.redirect(`/groups/${groupId}`);
    } catch (error) {
        console.error('Error sharing item:', error);
        req.flash('error', 'Failed to share item');
        res.redirect(`/groups/${req.params.id}`);
    }
});

// ============================================
// POST /groups/:id/unshare - Remove shared item
// ============================================
router.post('/:id/unshare', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const groupId = req.params.id;
        const { shared_item_id } = req.body;

        const membership = await checkMembership(groupId, userId);
        if (!membership) {
            return res.status(403).json({ error: 'Not a member' });
        }

        // Only the person who shared it or admin can unshare
        const item = await db.query('SELECT user_id FROM group_shared_items WHERE id = $1 AND group_id = $2', [shared_item_id, groupId]);
        if (item.rows.length === 0) {
            req.flash('error', 'Shared item not found');
            return res.redirect(`/groups/${groupId}`);
        }

        if (item.rows[0].user_id !== userId && membership.role !== 'admin') {
            req.flash('error', 'Only the sharer or admin can remove this');
            return res.redirect(`/groups/${groupId}`);
        }

        await db.query('DELETE FROM group_shared_items WHERE id = $1', [shared_item_id]);
        req.flash('success', 'Item removed from group');
        res.redirect(`/groups/${groupId}`);
    } catch (error) {
        console.error('Error unsharing item:', error);
        req.flash('error', 'Failed to remove item');
        res.redirect(`/groups/${req.params.id}`);
    }
});

// ============================================
// POST /groups/:id/message - Post a message
// ============================================
router.post('/:id/message', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const groupId = req.params.id;
        const { message } = req.body;

        const membership = await checkMembership(groupId, userId);
        if (!membership) {
            return res.status(403).json({ error: 'Not a member' });
        }

        if (!message || message.trim().length === 0) {
            req.flash('error', 'Message cannot be empty');
            return res.redirect(`/groups/${groupId}`);
        }

        if (message.trim().length > 2000) {
            req.flash('error', 'Message too long (max 2000 characters)');
            return res.redirect(`/groups/${groupId}`);
        }

        await db.query(`
            INSERT INTO group_messages (group_id, user_id, message)
            VALUES ($1, $2, $3)
        `, [groupId, userId, message.trim()]);

        await db.query('UPDATE study_groups SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [groupId]);

        res.redirect(`/groups/${groupId}#discussion`);
    } catch (error) {
        console.error('Error posting message:', error);
        req.flash('error', 'Failed to post message');
        res.redirect(`/groups/${req.params.id}`);
    }
});

// ============================================
// POST /groups/:id/message/:msgId/delete - Delete a message
// ============================================
router.post('/:id/message/:msgId/delete', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const groupId = req.params.id;
        const msgId = req.params.msgId;

        const membership = await checkMembership(groupId, userId);
        if (!membership) {
            return res.status(403).json({ error: 'Not a member' });
        }

        // Only author or admin can delete
        const msg = await db.query('SELECT user_id FROM group_messages WHERE id = $1 AND group_id = $2', [msgId, groupId]);
        if (msg.rows.length === 0) {
            req.flash('error', 'Message not found');
            return res.redirect(`/groups/${groupId}`);
        }

        if (msg.rows[0].user_id !== userId && membership.role !== 'admin') {
            req.flash('error', 'You can only delete your own messages');
            return res.redirect(`/groups/${groupId}`);
        }

        await db.query('DELETE FROM group_messages WHERE id = $1', [msgId]);
        req.flash('success', 'Message deleted');
        res.redirect(`/groups/${groupId}#discussion`);
    } catch (error) {
        console.error('Error deleting message:', error);
        req.flash('error', 'Failed to delete message');
        res.redirect(`/groups/${req.params.id}`);
    }
});

// ============================================
// POST /groups/:id/leave - Leave a group
// ============================================
router.post('/:id/leave', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const groupId = req.params.id;

        const membership = await checkMembership(groupId, userId);
        if (!membership) {
            req.flash('error', 'You are not in this group');
            return res.redirect('/groups');
        }

        // If admin and only admin, delete the group
        if (membership.role === 'admin') {
            const adminCount = await db.query(
                "SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND role = 'admin'",
                [groupId]
            );
            const memberCount = await db.query(
                'SELECT COUNT(*) FROM group_members WHERE group_id = $1',
                [groupId]
            );

            if (parseInt(adminCount.rows[0].count) === 1 && parseInt(memberCount.rows[0].count) > 1) {
                req.flash('error', 'You are the only admin. Promote another member before leaving, or delete the group.');
                return res.redirect(`/groups/${groupId}`);
            }

            // If only person in group, delete it
            if (parseInt(memberCount.rows[0].count) === 1) {
                await db.query('DELETE FROM study_groups WHERE id = $1', [groupId]);
                req.flash('success', 'Group deleted (you were the only member)');
                return res.redirect('/groups');
            }
        }

        await db.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
        req.flash('success', 'You left the group');
        res.redirect('/groups');
    } catch (error) {
        console.error('Error leaving group:', error);
        req.flash('error', 'Failed to leave group');
        res.redirect('/groups');
    }
});

// ============================================
// POST /groups/:id/remove-member - Remove a member (admin only)
// ============================================
router.post('/:id/remove-member', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const groupId = req.params.id;
        const { member_user_id } = req.body;

        const membership = await checkMembership(groupId, userId);
        if (!membership || membership.role !== 'admin') {
            req.flash('error', 'Only admins can remove members');
            return res.redirect(`/groups/${groupId}`);
        }

        if (member_user_id === userId) {
            req.flash('error', 'You cannot remove yourself. Use Leave instead.');
            return res.redirect(`/groups/${groupId}`);
        }

        await db.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, member_user_id]);
        req.flash('success', 'Member removed');
        res.redirect(`/groups/${groupId}`);
    } catch (error) {
        console.error('Error removing member:', error);
        req.flash('error', 'Failed to remove member');
        res.redirect(`/groups/${req.params.id}`);
    }
});

// ============================================
// POST /groups/:id/delete - Delete group (admin only)
// ============================================
router.post('/:id/delete', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const groupId = req.params.id;

        const membership = await checkMembership(groupId, userId);
        if (!membership || membership.role !== 'admin') {
            req.flash('error', 'Only admins can delete the group');
            return res.redirect(`/groups/${groupId}`);
        }

        await db.query('DELETE FROM study_groups WHERE id = $1', [groupId]);
        req.flash('success', 'Group deleted');
        res.redirect('/groups');
    } catch (error) {
        console.error('Error deleting group:', error);
        req.flash('error', 'Failed to delete group');
        res.redirect('/groups');
    }
});

// ============================================
// GET /groups/:id/item/:type/:itemId - View shared item
// ============================================
router.get('/:id/item/:type/:itemId', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const groupId = req.params.id;
        const itemType = req.params.type;
        const itemId = req.params.itemId;

        // Check membership
        const membership = await checkMembership(groupId, userId);
        if (!membership) {
            req.flash('error', 'You are not a member of this group');
            return res.redirect('/groups');
        }

        // Check item is shared in group
        const sharedCheck = await db.query(
            'SELECT id FROM group_shared_items WHERE group_id = $1 AND item_type = $2 AND item_id = $3',
            [groupId, itemType, itemId]
        );
        if (sharedCheck.rows.length === 0) {
            req.flash('error', 'This item is not shared in this group');
            return res.redirect(`/groups/${groupId}`);
        }

        // Get group name for breadcrumb
        const groupResult = await db.query('SELECT name FROM study_groups WHERE id = $1', [groupId]);
        const groupName = groupResult.rows[0]?.name || 'Group';

        if (itemType === 'note') {
            const noteResult = await db.query(`
                SELECT sn.*, s.name as subject_name, s.color as subject_color, t.name as topic_name
                FROM saved_notes sn
                LEFT JOIN subjects s ON sn.subject_id = s.id
                LEFT JOIN topics t ON sn.topic_id = t.id
                WHERE sn.id = $1
            `, [itemId]);

            if (noteResult.rows.length === 0) {
                req.flash('error', 'Note not found');
                return res.redirect(`/groups/${groupId}`);
            }

            return res.render('groups/view-note', {
                title: `${noteResult.rows[0].title} - SmartSched`,
                page: 'groups',
                note: noteResult.rows[0],
                groupId,
                groupName
            });
        }

        if (itemType === 'flashcard_set') {
            const setResult = await db.query(`
                SELECT fs.*, s.name as subject_name, s.color as subject_color
                FROM flashcard_sets fs
                LEFT JOIN subjects s ON fs.subject_id = s.id
                WHERE fs.id = $1
            `, [itemId]);

            if (setResult.rows.length === 0) {
                req.flash('error', 'Flashcard set not found');
                return res.redirect(`/groups/${groupId}`);
            }

            const cardsResult = await db.query(
                'SELECT * FROM flashcards WHERE set_id = $1 ORDER BY created_at',
                [itemId]
            );

            return res.render('groups/view-flashcards', {
                title: `${setResult.rows[0].title} - SmartSched`,
                page: 'groups',
                flashcardSet: setResult.rows[0],
                cards: cardsResult.rows,
                groupId,
                groupName
            });
        }

        if (itemType === 'material') {
            const fileResult = await db.query(
                'SELECT * FROM user_files WHERE id = $1',
                [itemId]
            );

            if (fileResult.rows.length === 0) {
                req.flash('error', 'Material not found');
                return res.redirect(`/groups/${groupId}`);
            }

            return res.render('groups/view-material', {
                title: `${fileResult.rows[0].original_name} - SmartSched`,
                page: 'groups',
                material: fileResult.rows[0],
                groupId,
                groupName
            });
        }

        req.flash('error', 'Invalid item type');
        res.redirect(`/groups/${groupId}`);
    } catch (error) {
        console.error('Error viewing shared item:', error);
        req.flash('error', 'Failed to load item');
        res.redirect(`/groups/${req.params.id}`);
    }
});

// ============================================
// GET /groups/:id/edit - Edit group (admin only)
// ============================================
router.get('/:id/edit', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const groupId = req.params.id;

        const membership = await checkMembership(groupId, userId);
        if (!membership || membership.role !== 'admin') {
            req.flash('error', 'Only admins can edit the group');
            return res.redirect(`/groups/${groupId}`);
        }

        const groupResult = await db.query('SELECT * FROM study_groups WHERE id = $1', [groupId]);
        if (groupResult.rows.length === 0) {
            req.flash('error', 'Group not found');
            return res.redirect('/groups');
        }

        res.render('groups/form', {
            title: 'Edit Group - SmartSched',
            page: 'groups',
            group: groupResult.rows[0],
            errors: []
        });
    } catch (error) {
        console.error('Error loading edit form:', error);
        req.flash('error', 'Failed to load form');
        res.redirect('/groups');
    }
});

// ============================================
// POST /groups/:id/edit - Update group (admin only)
// ============================================
router.post('/:id/edit', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const groupId = req.params.id;
        const { name, description } = req.body;

        const membership = await checkMembership(groupId, userId);
        if (!membership || membership.role !== 'admin') {
            req.flash('error', 'Only admins can edit the group');
            return res.redirect(`/groups/${groupId}`);
        }

        if (!name || name.trim().length < 2) {
            const groupResult = await db.query('SELECT * FROM study_groups WHERE id = $1', [groupId]);
            return res.render('groups/form', {
                title: 'Edit Group - SmartSched',
                page: 'groups',
                group: { ...groupResult.rows[0], ...req.body },
                errors: [{ msg: 'Group name must be at least 2 characters' }]
            });
        }

        await db.query(`
            UPDATE study_groups SET name = $1, description = $2, updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
        `, [name.trim(), description?.trim() || null, groupId]);

        req.flash('success', 'Group updated!');
        res.redirect(`/groups/${groupId}`);
    } catch (error) {
        console.error('Error updating group:', error);
        req.flash('error', 'Failed to update group');
        res.redirect(`/groups/${req.params.id}`);
    }
});

// ============================================
// POST /groups/:id/ask - Ask AI a question (shared with group)
// ============================================
router.post('/:id/ask', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const groupId = req.params.id;
        const { question } = req.body;

        const membership = await checkMembership(groupId, userId);
        if (!membership) {
            return res.status(403).json({ error: 'Not a member' });
        }

        if (!question || question.trim().length === 0) {
            req.flash('error', 'Please enter a question');
            return res.redirect(`/groups/${groupId}#ai-qa`);
        }

        if (question.trim().length > 1000) {
            req.flash('error', 'Question too long (max 1000 characters)');
            return res.redirect(`/groups/${groupId}#ai-qa`);
        }

        if (!aiService.isConfigured()) {
            req.flash('error', 'AI service is currently unavailable');
            return res.redirect(`/groups/${groupId}#ai-qa`);
        }

        // Get group name for context
        const groupResult = await db.query('SELECT name, description FROM study_groups WHERE id = $1', [groupId]);
        const group = groupResult.rows[0];

        const prompt = `You are a helpful study assistant for a study group called "${group.name}"${group.description ? ` (${group.description})` : ''}.

A student asks: "${question.trim()}"

Provide a clear, helpful, and educational answer. Use simple language. If the question is about a specific topic, give a thorough but concise explanation. Format your response using markdown for readability (use **bold**, *italic*, bullet points, numbered lists, etc. as appropriate).

Keep your answer focused and under 800 words.`;

        const result = await aiService.callGemini(prompt, { requireJson: false });
        const responseText = result.raw_response || (typeof result === 'string' ? result : JSON.stringify(result));

        await db.query(`
            INSERT INTO group_ai_queries (group_id, user_id, question, response)
            VALUES ($1, $2, $3, $4)
        `, [groupId, userId, question.trim(), responseText]);

        await db.query('UPDATE study_groups SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [groupId]);

        req.flash('success', 'AI answered your question!');
        res.redirect(`/groups/${groupId}#ai-qa`);
    } catch (error) {
        console.error('Error with AI query:', error);
        req.flash('error', 'AI failed to respond. Please try again.');
        res.redirect(`/groups/${req.params.id}#ai-qa`);
    }
});

// ============================================
// POST /groups/:id/ai-query/:queryId/delete - Delete AI Q&A
// ============================================
router.post('/:id/ai-query/:queryId/delete', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const groupId = req.params.id;
        const queryId = req.params.queryId;

        const membership = await checkMembership(groupId, userId);
        if (!membership) {
            return res.status(403).json({ error: 'Not a member' });
        }

        // Only author or admin can delete
        const query = await db.query('SELECT user_id FROM group_ai_queries WHERE id = $1 AND group_id = $2', [queryId, groupId]);
        if (query.rows.length === 0) {
            req.flash('error', 'Query not found');
            return res.redirect(`/groups/${groupId}#ai-qa`);
        }

        if (query.rows[0].user_id !== userId && membership.role !== 'admin') {
            req.flash('error', 'You can only delete your own queries');
            return res.redirect(`/groups/${groupId}#ai-qa`);
        }

        await db.query('DELETE FROM group_ai_queries WHERE id = $1', [queryId]);
        req.flash('success', 'AI query deleted');
        res.redirect(`/groups/${groupId}#ai-qa`);
    } catch (error) {
        console.error('Error deleting AI query:', error);
        req.flash('error', 'Failed to delete query');
        res.redirect(`/groups/${req.params.id}#ai-qa`);
    }
});

module.exports = router;
