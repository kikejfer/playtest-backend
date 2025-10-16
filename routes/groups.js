const express = require('express');
const { pool } = require('../database/connection');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// ============================================================
// TEACHER ENDPOINTS - Group Management
// ============================================================

/**
 * POST /groups
 * Create a new group (TEACHER only)
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, description, access_code } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    // Verify user is a teacher
    const roleCheck = await pool.query(`
      SELECT r.name as role_name
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = $1 AND r.name = 'profesor'
      LIMIT 1
    `, [req.user.id]);

    if (roleCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only teachers can create groups' });
    }

    // Generate access code if not provided
    const finalAccessCode = access_code || generateAccessCode();

    // Create the group
    const result = await pool.query(`
      INSERT INTO groups (name, description, access_code, created_by)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [name, description, finalAccessCode, req.user.id]);

    console.log('✅ Group created:', result.rows[0].id, 'by teacher:', req.user.id);

    res.status(201).json({
      message: 'Group created successfully',
      group: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Error creating group:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

/**
 * GET /groups
 * Get all groups created by the current teacher
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        g.id,
        g.name,
        g.description,
        g.access_code,
        g.created_at,
        COUNT(DISTINCT gm.user_id) as member_count,
        COUNT(DISTINCT ba.block_id) as assigned_blocks_count
      FROM groups g
      LEFT JOIN group_members gm ON g.id = gm.group_id
      LEFT JOIN block_assignments ba ON g.id = ba.group_id
      WHERE g.created_by = $1
      GROUP BY g.id, g.name, g.description, g.access_code, g.created_at
      ORDER BY g.created_at DESC
    `, [req.user.id]);

    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error fetching groups:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /groups/:id
 * Get group details with members
 */
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);

    // Get group info
    const groupResult = await pool.query(`
      SELECT * FROM groups WHERE id = $1
    `, [groupId]);

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const group = groupResult.rows[0];

    // Check if user has access (creator or member)
    if (group.created_by !== req.user.id) {
      const memberCheck = await pool.query(`
        SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2
      `, [groupId, req.user.id]);

      if (memberCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Get members
    const membersResult = await pool.query(`
      SELECT
        gm.id,
        gm.user_id,
        u.nickname,
        u.email,
        gm.role_in_group,
        gm.joined_at
      FROM group_members gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = $1
      ORDER BY gm.joined_at DESC
    `, [groupId]);

    res.json({
      ...group,
      members: membersResult.rows
    });
  } catch (error) {
    console.error('❌ Error fetching group details:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /groups/:id
 * Update group details (TEACHER only - creator)
 */
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);
    const { name, description, access_code } = req.body;

    // Check ownership
    const ownerCheck = await pool.query(`
      SELECT * FROM groups WHERE id = $1 AND created_by = $2
    `, [groupId, req.user.id]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only the group creator can update it' });
    }

    const result = await pool.query(`
      UPDATE groups
      SET name = COALESCE($1, name),
          description = COALESCE($2, description),
          access_code = COALESCE($3, access_code),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *
    `, [name, description, access_code, groupId]);

    res.json({
      message: 'Group updated successfully',
      group: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Error updating group:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /groups/:id
 * Delete a group (TEACHER only - creator)
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);

    // Check ownership
    const ownerCheck = await pool.query(`
      SELECT * FROM groups WHERE id = $1 AND created_by = $2
    `, [groupId, req.user.id]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only the group creator can delete it' });
    }

    await pool.query('DELETE FROM groups WHERE id = $1', [groupId]);

    res.json({ message: 'Group deleted successfully' });
  } catch (error) {
    console.error('❌ Error deleting group:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// TEACHER ENDPOINTS - Member Management
// ============================================================

/**
 * POST /groups/:id/members
 * Add members to a group (TEACHER only)
 */
router.post('/:id/members', authenticateToken, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);
    const { user_ids } = req.body; // Array of user IDs

    if (!Array.isArray(user_ids) || user_ids.length === 0) {
      return res.status(400).json({ error: 'user_ids array is required' });
    }

    // Check ownership
    const ownerCheck = await pool.query(`
      SELECT * FROM groups WHERE id = $1 AND created_by = $2
    `, [groupId, req.user.id]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only the group creator can add members' });
    }

    // Add members (using ON CONFLICT to avoid duplicates)
    const insertPromises = user_ids.map(userId =>
      pool.query(`
        INSERT INTO group_members (group_id, user_id, role_in_group)
        VALUES ($1, $2, 'ALUMNO')
        ON CONFLICT (group_id, user_id) DO NOTHING
      `, [groupId, userId])
    );

    await Promise.all(insertPromises);

    res.json({ message: `${user_ids.length} members added to group` });
  } catch (error) {
    console.error('❌ Error adding members:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /groups/:id/members/:userId
 * Remove a member from a group (TEACHER only)
 */
router.delete('/:id/members/:userId', authenticateToken, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);
    const userId = parseInt(req.params.userId);

    // Check ownership
    const ownerCheck = await pool.query(`
      SELECT * FROM groups WHERE id = $1 AND created_by = $2
    `, [groupId, req.user.id]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only the group creator can remove members' });
    }

    await pool.query(`
      DELETE FROM group_members
      WHERE group_id = $1 AND user_id = $2
    `, [groupId, userId]);

    res.json({ message: 'Member removed from group' });
  } catch (error) {
    console.error('❌ Error removing member:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /groups/:id/members
 * Get all members of a group
 */
router.get('/:id/members', authenticateToken, async (req, res) => {
  try {
    const groupId = parseInt(req.params.id);

    // Check access (creator or member)
    const accessCheck = await pool.query(`
      SELECT * FROM groups WHERE id = $1 AND created_by = $2
      UNION
      SELECT g.* FROM groups g
      JOIN group_members gm ON g.id = gm.group_id
      WHERE g.id = $1 AND gm.user_id = $2
    `, [groupId, req.user.id]);

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(`
      SELECT
        gm.id,
        gm.user_id,
        u.nickname,
        u.email,
        gm.role_in_group,
        gm.joined_at
      FROM group_members gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = $1
      ORDER BY gm.joined_at DESC
    `, [groupId]);

    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error fetching members:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// TEACHER ENDPOINTS - Block Assignments
// ============================================================

/**
 * POST /groups/assign-block
 * Assign a block to a group or individual student (TEACHER only)
 */
router.post('/assign-block', authenticateToken, async (req, res) => {
  try {
    const { block_id, group_id, user_id, due_date, notes } = req.body;

    if (!block_id) {
      return res.status(400).json({ error: 'block_id is required' });
    }

    if (!group_id && !user_id) {
      return res.status(400).json({ error: 'Either group_id or user_id is required' });
    }

    // Verify user is a teacher
    const roleCheck = await pool.query(`
      SELECT r.name as role_name
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = $1 AND r.name = 'profesor'
      LIMIT 1
    `, [req.user.id]);

    if (roleCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only teachers can assign blocks' });
    }

    // Verify block ownership or is public
    const blockCheck = await pool.query(`
      SELECT * FROM blocks
      WHERE id = $1 AND (owner_user_id = $2 OR is_public = true)
    `, [block_id, req.user.id]);

    if (blockCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You can only assign your own blocks or public blocks' });
    }

    // Create assignment
    const result = await pool.query(`
      INSERT INTO block_assignments (block_id, assigned_by, group_id, assigned_to_user, due_date, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [block_id, req.user.id, group_id || null, user_id || null, due_date || null, notes || null]);

    console.log('✅ Block assigned:', block_id, 'by teacher:', req.user.id);

    res.status(201).json({
      message: 'Block assigned successfully',
      assignment: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Error assigning block:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

/**
 * DELETE /groups/assignments/:id
 * Remove a block assignment (TEACHER only)
 */
router.delete('/assignments/:id', authenticateToken, async (req, res) => {
  try {
    const assignmentId = parseInt(req.params.id);

    // Check if assignment was created by this teacher
    const ownerCheck = await pool.query(`
      SELECT * FROM block_assignments WHERE id = $1 AND assigned_by = $2
    `, [assignmentId, req.user.id]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only the assigner can remove this assignment' });
    }

    await pool.query('DELETE FROM block_assignments WHERE id = $1', [assignmentId]);

    res.json({ message: 'Assignment removed successfully' });
  } catch (error) {
    console.error('❌ Error removing assignment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /groups/assignments
 * Get all assignments made by this teacher
 */
router.get('/assignments', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        ba.id,
        ba.block_id,
        b.name as block_name,
        ba.group_id,
        g.name as group_name,
        ba.assigned_to_user,
        u.nickname as assigned_to_nickname,
        ba.due_date,
        ba.notes,
        ba.assigned_at
      FROM block_assignments ba
      LEFT JOIN blocks b ON ba.block_id = b.id
      LEFT JOIN groups g ON ba.group_id = g.id
      LEFT JOIN users u ON ba.assigned_to_user = u.id
      WHERE ba.assigned_by = $1
      ORDER BY ba.assigned_at DESC
    `, [req.user.id]);

    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error fetching assignments:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// STUDENT ENDPOINTS
// ============================================================

/**
 * POST /groups/join
 * Join a group using access code (STUDENT)
 */
router.post('/join', authenticateToken, async (req, res) => {
  try {
    const { access_code } = req.body;

    if (!access_code) {
      return res.status(400).json({ error: 'access_code is required' });
    }

    // Find group by access code
    const groupResult = await pool.query(`
      SELECT * FROM groups WHERE access_code = $1
    `, [access_code]);

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid access code' });
    }

    const group = groupResult.rows[0];

    // Add user to group
    await pool.query(`
      INSERT INTO group_members (group_id, user_id, role_in_group)
      VALUES ($1, $2, 'ALUMNO')
      ON CONFLICT (group_id, user_id) DO NOTHING
    `, [group.id, req.user.id]);

    console.log('✅ Student joined group:', group.id, 'user:', req.user.id);

    res.json({
      message: 'Successfully joined group',
      group: {
        id: group.id,
        name: group.name,
        description: group.description
      }
    });
  } catch (error) {
    console.error('❌ Error joining group:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /groups/my-groups
 * Get all groups the current user is a member of
 */
router.get('/my-groups', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        g.id,
        g.name,
        g.description,
        g.access_code,
        gm.role_in_group,
        gm.joined_at,
        u.nickname as teacher_nickname,
        COUNT(DISTINCT gm2.user_id) as member_count
      FROM group_members gm
      JOIN groups g ON gm.group_id = g.id
      LEFT JOIN users u ON g.created_by = u.id
      LEFT JOIN group_members gm2 ON g.id = gm2.group_id
      WHERE gm.user_id = $1
      GROUP BY g.id, g.name, g.description, g.access_code, gm.role_in_group, gm.joined_at, u.nickname
      ORDER BY gm.joined_at DESC
    `, [req.user.id]);

    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error fetching my groups:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /groups/my-assigned-blocks
 * Get all blocks assigned to the current user (via group or direct)
 */
router.get('/my-assigned-blocks', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT
        b.id,
        b.name,
        b.description,
        b.image_url,
        ba.due_date,
        ba.notes,
        ba.assigned_at,
        CASE
          WHEN ba.group_id IS NOT NULL THEN 'GROUP'
          ELSE 'INDIVIDUAL'
        END as assignment_type,
        g.name as group_name,
        u.nickname as assigned_by_nickname
      FROM block_assignments ba
      JOIN blocks b ON ba.block_id = b.id
      LEFT JOIN groups g ON ba.group_id = g.id
      LEFT JOIN users u ON ba.assigned_by = u.id
      WHERE
        ba.assigned_to_user = $1
        OR ba.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1)
      ORDER BY ba.assigned_at DESC
    `, [req.user.id]);

    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error fetching assigned blocks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Generate a random 6-character access code
 */
function generateAccessCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluded similar: I,O,0,1
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

module.exports = router;
