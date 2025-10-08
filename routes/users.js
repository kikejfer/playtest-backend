const express = require('express');
const { pool } = require('../database/connection');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    // DEBUG: Log incoming request data
    console.log('🔍 DEBUG /profile endpoint - req.user:', {
      id: req.user.id,
      nickname: req.user.nickname,
      roles: req.user.roles
    });

    const result = await pool.query(`
      SELECT u.id, u.nickname, u.email, u.first_name, u.last_name, u.created_at,
        up.answer_history, up.stats, up.preferences, up.loaded_blocks
      FROM users u
      LEFT JOIN user_profiles up ON u.id = up.user_id
      WHERE u.id = $1
    `, [req.user.id]);

    // DEBUG: Log SQL query result
    console.log('🔍 DEBUG SQL Query result:', {
      rowCount: result.rows.length,
      rawData: result.rows[0]
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    
    // DEBUG: Log the specific fields we're returning
    console.log('🔍 DEBUG Profile response data:', {
      id: user.id,
      nickname: user.nickname,
      first_name_raw: user.first_name,
      last_name_raw: user.last_name,
      first_name_mapped: user.first_name,
      last_name_mapped: user.last_name
    });

    // Get user roles from JWT token
    const userRoles = req.user.roles || [];
    
    const response = {
      id: user.id,
      nickname: user.nickname,
      email: user.email,
      // Support both camelCase and snake_case for compatibility
      firstName: user.first_name,
      lastName: user.last_name,
      first_name: user.first_name,
      last_name: user.last_name,
      createdAt: user.created_at,
      created_at: user.created_at,
      roles: userRoles,
      answerHistory: user.answer_history || [],
      stats: user.stats || {},
      preferences: user.preferences || {},
      loadedBlocks: user.loaded_blocks || []
    };

    // DEBUG: Log final response
    console.log('🔍 DEBUG Final response:', response);
    
    res.json(response);

  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { email, firstName, lastName, first_name, last_name, preferences } = req.body;
    
    // Support both camelCase and snake_case field names
    const finalFirstName = firstName || first_name;
    const finalLastName = lastName || last_name;

    // Update user basic info
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    if (email !== undefined) {
      updateFields.push(`email = $${paramIndex++}`);
      updateValues.push(email);
    }
    if (finalFirstName !== undefined) {
      updateFields.push(`first_name = $${paramIndex++}`);
      updateValues.push(finalFirstName);
    }
    if (finalLastName !== undefined) {
      updateFields.push(`last_name = $${paramIndex++}`);
      updateValues.push(finalLastName);
    }

    if (updateFields.length > 0) {
      updateFields.push('updated_at = CURRENT_TIMESTAMP');
      updateValues.push(req.user.id);
      
      await pool.query(
        `UPDATE users SET ${updateFields.join(', ')} WHERE id = $${paramIndex}`,
        updateValues
      );
    }

    // Update user profile
    if (preferences !== undefined) {
      await pool.query(`
        INSERT INTO user_profiles (user_id, preferences) 
        VALUES ($1, $2) 
        ON CONFLICT (user_id) 
        DO UPDATE SET preferences = $2, updated_at = CURRENT_TIMESTAMP
      `, [req.user.id, preferences]);
    }

    res.json({ message: 'Profile updated successfully' });

  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user stats (called after games)
router.post('/stats', authenticateToken, async (req, res) => {
  try {
    const { gameResults, gameType } = req.body;

    if (!gameResults || !gameResults.answers) {
      return res.status(400).json({ error: 'Game results are required' });
    }

    // Get current user profile
    let profileResult = await pool.query(
      'SELECT answer_history, stats FROM user_profiles WHERE user_id = $1',
      [req.user.id]
    );

    let answerHistory = [];
    let stats = { consolidation: { byQuestion: {}, byTopic: {}, byBlock: {} } };

    if (profileResult.rows.length > 0) {
      const rawHistory = profileResult.rows[0].answer_history;
      // CRITICAL: Ensure answer_history is always an array
      answerHistory = Array.isArray(rawHistory) ? rawHistory : [];

      const dbStats = profileResult.rows[0].stats || {};

      // Ensure stats has the correct structure
      stats = {
        consolidation: {
          byQuestion: dbStats.consolidation?.byQuestion || {},
          byTopic: dbStats.consolidation?.byTopic || {},
          byBlock: dbStats.consolidation?.byBlock || {}
        }
      };
    }

    // Add new answers to history
    for (const answer of gameResults.answers) {
      const { blockId, questionId, topicName, result, responseTime } = answer;
      
      answerHistory.unshift({
        gameId: req.body.gameId,
        questionId,
        blockId,
        topicName,
        result,
        responseTime,
        timestamp: new Date().toISOString()
      });
    }

    // Keep only last 1000 answers
    answerHistory = answerHistory.slice(0, 1000);

    // Calculate consolidation stats with improved algorithm
    const blockIds = [...new Set(gameResults.answers.map(a => a.blockId).filter(Boolean))];
    
    for (const blockId of blockIds) {
      // Get all questions for this block
      const questionsResult = await pool.query(
        'SELECT id, topic FROM questions WHERE block_id = $1',
        [blockId]
      );
      
      const questionsInBlock = questionsResult.rows;
      if (questionsInBlock.length === 0) continue;

      // Calculate block consolidation with weighted scoring
      let totalBlockConsolidation = 0;
      
      for (const question of questionsInBlock) {
        const questionAnswers = answerHistory.filter(h => 
          h.blockId === blockId && h.questionId === question.id
        ).slice(0, 10); // Consider last 10 attempts
        
        if (questionAnswers.length === 0) {
          // Question never attempted = 0% consolidation
          totalBlockConsolidation += 0;
        } else {
          const consolidation = calculateQuestionConsolidation(questionAnswers);
          totalBlockConsolidation += consolidation;
        }
      }
      
      const blockConsolidation = (totalBlockConsolidation / questionsInBlock.length);
      stats.consolidation.byBlock[blockId] = blockConsolidation;

      // Calculate topic consolidation
      const topicsInBlock = [...new Set(questionsInBlock.map(q => q.topic).filter(Boolean))];
      
      for (const topicName of topicsInBlock) {
        const questionsInTopic = questionsInBlock.filter(q => q.topic === topicName);
        if (questionsInTopic.length === 0) continue;

        let totalTopicConsolidation = 0;
        
        for (const question of questionsInTopic) {
          const questionAnswers = answerHistory.filter(h => 
            h.blockId === blockId && h.questionId === question.id && h.topicName === topicName
          ).slice(0, 10); // Consider last 10 attempts
          
          if (questionAnswers.length === 0) {
            totalTopicConsolidation += 0;
          } else {
            const consolidation = calculateQuestionConsolidation(questionAnswers);
            totalTopicConsolidation += consolidation;
          }
        }

        const topicConsolidation = (totalTopicConsolidation / questionsInTopic.length);
        const topicKey = `${blockId}_${topicName}`;
        stats.consolidation.byTopic[topicKey] = topicConsolidation;
      }
    }

    // Update user profile
    await pool.query(`
      INSERT INTO user_profiles (user_id, answer_history, stats) 
      VALUES ($1, $2, $3) 
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        answer_history = $2, 
        stats = $3, 
        updated_at = CURRENT_TIMESTAMP
    `, [req.user.id, JSON.stringify(answerHistory), JSON.stringify(stats)]);

    res.json({ message: 'Stats updated successfully' });

  } catch (error) {
    console.error('Error updating user stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add block to user's loaded blocks (legacy compatibility endpoint)
router.post('/blocks/:blockId', authenticateToken, async (req, res) => {
  try {
    const blockId = parseInt(req.params.blockId);
    
    // Check if block exists
    const blockResult = await pool.query(
      'SELECT id FROM blocks WHERE id = $1',
      [blockId]
    );
    
    if (blockResult.rows.length === 0) {
      return res.status(404).json({ error: 'Block not found' });
    }
    
    // Get current loaded blocks
    const userResult = await pool.query(
      'SELECT loaded_blocks FROM user_profiles WHERE user_id = $1',
      [req.user.id]
    );
    
    let loadedBlocks = userResult.rows[0]?.loaded_blocks || [];
    
    // Ensure loadedBlocks is an array
    if (!Array.isArray(loadedBlocks)) {
      console.warn('⚠️ loaded_blocks is not an array, converting:', loadedBlocks);
      loadedBlocks = [];
    }
    
    // Add block if not already loaded
    if (!loadedBlocks.includes(blockId)) {
      loadedBlocks.push(blockId);
      
      // Update user profile
      await pool.query(`
        INSERT INTO user_profiles (user_id, loaded_blocks, stats, answer_history, preferences) 
        VALUES ($1, $2::jsonb, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb) 
        ON CONFLICT (user_id) 
        DO UPDATE SET loaded_blocks = $2::jsonb, updated_at = CURRENT_TIMESTAMP
      `, [req.user.id, JSON.stringify(loadedBlocks)]);
    }
    
    res.json({ 
      message: 'Block added to user successfully',
      loadedBlocks: loadedBlocks
    });
    
  } catch (error) {
    console.error('Error adding block to user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all users (for competition mode user listing)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.nickname, u.email, u.created_at,
        up.loaded_blocks
      FROM users u
      LEFT JOIN user_profiles up ON u.id = up.user_id
      WHERE u.id != $1
      ORDER BY u.nickname
    `, [req.user.id]);

    const users = result.rows.map(user => ({
      id: user.id,
      nickname: user.nickname,
      email: user.email,
      createdAt: user.created_at,
      loadedBlocks: user.loaded_blocks || []
    }));

    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all user profiles (for challenge matching)
router.get('/profiles', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.nickname, up.loaded_blocks, up.stats
      FROM users u
      LEFT JOIN user_profiles up ON u.id = up.user_id
      WHERE u.id != $1
      ORDER BY u.nickname
    `, [req.user.id]);

    const profiles = {};
    result.rows.forEach(user => {
      profiles[user.id] = {
        id: user.id,
        nickname: user.nickname,
        loadedBlocks: user.loaded_blocks || [],
        stats: user.stats || {}
      };
    });

    res.json(profiles);
  } catch (error) {
    console.error('Error fetching user profiles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to calculate question consolidation based on answer history
function calculateQuestionConsolidation(questionAnswers) {
  if (questionAnswers.length === 0) return 0;
  
  // Sort by timestamp (most recent first)
  questionAnswers.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  let consolidationScore = 0;
  const now = new Date();
  
  for (let i = 0; i < questionAnswers.length; i++) {
    const answer = questionAnswers[i];
    const answerDate = new Date(answer.timestamp);
    const daysAgo = (now - answerDate) / (1000 * 60 * 60 * 24);
    
    // Weight calculation: more recent answers weigh more
    const recencyWeight = Math.max(0.1, 1 / (1 + daysAgo / 30)); // Decay over 30 days
    
    // Position weight: first attempt weighs more than later attempts
    const positionWeight = Math.max(0.3, 1 / (1 + i * 0.5));
    
    if (answer.result === 'ACIERTO') {
      consolidationScore += 20 * recencyWeight * positionWeight;
    } else if (answer.result === 'FALLO') {
      consolidationScore -= 5 * recencyWeight * positionWeight;
    }
    // BLANK answers don't affect the score directly
  }
  
  // Normalize to 0-100 scale
  consolidationScore = Math.max(0, Math.min(100, consolidationScore));
  
  // Bonus for consistency: if last 3 answers are correct, add bonus
  const lastThreeAnswers = questionAnswers.slice(0, 3);
  if (lastThreeAnswers.length >= 2 && 
      lastThreeAnswers.every(a => a.result === 'ACIERTO')) {
    consolidationScore = Math.min(100, consolidationScore + 15);
  }
  
  return consolidationScore;
}

// Get user roles
router.get('/roles', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.name
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = $1
      ORDER BY r.name
    `, [req.user.id]);

    const roleNames = result.rows.map(row => row.name);
    res.json(roleNames);

  } catch (error) {
    console.error('Error fetching user roles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user roles
router.put('/update-roles', authenticateToken, async (req, res) => {
  try {
    const { roles } = req.body;

    if (!Array.isArray(roles)) {
      return res.status(400).json({ error: 'Roles must be an array' });
    }

    console.log(`🎭 Updating roles for user ${req.user.id}:`, roles);

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get current user roles for security checks
      const currentRoles = await client.query(`
        SELECT r.name
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = $1
      `, [req.user.id]);

      const currentRoleNames = currentRoles.rows.map(r => r.name);
      const isAdminPrincipal = currentRoleNames.some(role => 
        role.includes('administrador_principal')
      );
      const isAdminSecundario = currentRoleNames.some(role => 
        role.includes('administrador_secundario')
      );

      // Check if user is trying to add NEW admin roles they don't already have
      const newAdminRoles = roles.filter(role => 
        (role.includes('administrador') || role.includes('admin')) &&
        !currentRoleNames.includes(role)
      );

      if (newAdminRoles.length > 0 && !isAdminPrincipal) {
        await client.query('ROLLBACK');
        return res.status(403).json({ 
          error: `Only principal administrators can assign new admin roles: ${newAdminRoles.join(', ')}` 
        });
      }

      // Prevent admin secundario from removing their own admin role
      if (isAdminSecundario && !isAdminPrincipal) {
        const stillHasAdminRole = roles.some(role => 
          role.includes('administrador_secundario')
        );
        
        if (!stillHasAdminRole) {
          await client.query('ROLLBACK');
          return res.status(403).json({ 
            error: 'Secondary administrators cannot remove their own admin role. Only principal administrators can modify admin roles.' 
          });
        }
      }

      // Remove all current roles for this user
      await client.query('DELETE FROM user_roles WHERE user_id = $1', [req.user.id]);

      // Add new roles
      if (roles.length > 0) {
        // First, get all valid role IDs
        const validRoles = await client.query(`
          SELECT id, name FROM roles WHERE name = ANY($1)
        `, [roles]);

        if (validRoles.rows.length !== roles.length) {
          const validRoleNames = validRoles.rows.map(r => r.name);
          const invalidRoles = roles.filter(r => !validRoleNames.includes(r));
          await client.query('ROLLBACK');
          return res.status(400).json({ 
            error: `Invalid roles: ${invalidRoles.join(', ')}` 
          });
        }

        // Insert new role assignments
        for (const roleRow of validRoles.rows) {
          await client.query(`
            INSERT INTO user_roles (user_id, role_id) 
            VALUES ($1, $2)
          `, [req.user.id, roleRow.id]);
        }

        console.log(`✅ User ${req.user.id} roles updated to:`, roles);
      } else {
        console.log(`✅ User ${req.user.id} roles cleared (no roles assigned)`);
      }

      await client.query('COMMIT');
      res.json({ 
        message: 'Roles updated successfully', 
        roles: roles 
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Error updating user roles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Change user password
router.put('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long' });
    }

    // Get user's current password hash
    const userResult = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const bcrypt = require('bcrypt');
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);

    if (!isCurrentPasswordValid) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    // Hash new password and update
    const saltRounds = 12;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashedNewPassword, req.user.id]
    );

    res.json({ message: 'Password changed successfully' });

  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user roles - endpoint for role-selection.html
router.put('/me/roles', authenticateToken, async (req, res) => {
  try {
    const { roles } = req.body;

    if (!Array.isArray(roles)) {
      return res.status(400).json({ error: 'Roles must be an array' });
    }

    console.log(`🎭 Updating roles for user ${req.user.id}:`, roles);

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Remove all current roles for this user
      await client.query('DELETE FROM user_roles WHERE user_id = $1', [req.user.id]);

      // Add new roles
      if (roles.length > 0) {
        // First, get all valid role IDs
        const validRoles = await client.query(`
          SELECT id, name FROM roles WHERE name = ANY($1)
        `, [roles]);

        if (validRoles.rows.length !== roles.length) {
          const validRoleNames = validRoles.rows.map(r => r.name);
          const invalidRoles = roles.filter(r => !validRoleNames.includes(r));
          await client.query('ROLLBACK');
          return res.status(400).json({ 
            error: `Invalid roles: ${invalidRoles.join(', ')}` 
          });
        }

        // Insert new role assignments
        for (const roleRow of validRoles.rows) {
          await client.query(`
            INSERT INTO user_roles (user_id, role_id) 
            VALUES ($1, $2)
          `, [req.user.id, roleRow.id]);
        }

        console.log(`✅ User ${req.user.id} roles updated to:`, roles);
      } else {
        console.log(`✅ User ${req.user.id} roles cleared (no roles assigned)`);
      }

      await client.query('COMMIT');

      // Generate new JWT token with updated roles
      const jwt = require('jsonwebtoken');
      const newToken = jwt.sign(
        { 
          id: req.user.id, 
          nickname: req.user.nickname,
          roles: roles 
        },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      console.log('✅ Generated new token with roles:', roles);
      
      res.json({ 
        message: 'Roles updated successfully', 
        roles: roles,
        token: newToken // Send updated token back to frontend
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Error updating user roles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user ID by nickname - NEW endpoint for admin-panel-helper
router.post('/get-id', async (req, res) => {
  try {
    const { nickname } = req.body;

    // Validate input
    if (!nickname) {
      return res.status(400).json({ error: 'Nickname is required' });
    }

    console.log(`🔍 GET-ID endpoint - Looking up user ID for nickname: "${nickname}"`);

    // Query users table to find ID by nickname
    const result = await pool.query(`
      SELECT id FROM users WHERE nickname = $1
    `, [nickname]);

    if (result.rows.length === 0) {
      console.log(`❌ GET-ID endpoint - User not found for nickname: "${nickname}"`);
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = result.rows[0].id;
    console.log(`✅ GET-ID endpoint - Found user ID ${userId} for nickname: "${nickname}"`);

    res.json({
      id: userId,
      nickname: nickname
    });

  } catch (error) {
    console.error('Error getting user ID by nickname:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;