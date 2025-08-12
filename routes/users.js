const express = require('express');
const pool = require('../database/connection');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.nickname, u.email, u.created_at,
        up.answer_history, up.stats, up.preferences, up.loaded_blocks
      FROM users u
      LEFT JOIN user_profiles up ON u.id = up.user_id
      WHERE u.id = $1
    `, [req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    res.json({
      id: user.id,
      nickname: user.nickname,
      email: user.email,
      createdAt: user.created_at,
      answerHistory: user.answer_history || [],
      stats: user.stats || {},
      preferences: user.preferences || {},
      loadedBlocks: user.loaded_blocks || []
    });

  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { email, preferences } = req.body;

    // Update user basic info
    if (email !== undefined) {
      await pool.query(
        'UPDATE users SET email = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [email, req.user.id]
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
      answerHistory = profileResult.rows[0].answer_history || [];
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

    // Calculate consolidation stats
    const blockIds = [...new Set(gameResults.answers.map(a => a.blockId).filter(Boolean))];
    
    for (const blockId of blockIds) {
      // Get all questions for this block
      const questionsResult = await pool.query(
        'SELECT id, topic FROM questions WHERE block_id = $1',
        [blockId]
      );
      
      const questionsInBlock = questionsResult.rows;
      if (questionsInBlock.length === 0) continue;

      // Calculate block consolidation
      const correctlyAnsweredIds = new Set(
        answerHistory
          .filter(h => h.blockId === blockId && h.result === 'ACIERTO')
          .map(h => h.questionId)
      );
      
      const blockConsolidation = (correctlyAnsweredIds.size / questionsInBlock.length) * 100;
      stats.consolidation.byBlock[blockId] = blockConsolidation;

      // Calculate topic consolidation
      const topicsInBlock = [...new Set(questionsInBlock.map(q => q.topic).filter(Boolean))];
      
      for (const topicName of topicsInBlock) {
        const questionsInTopic = questionsInBlock.filter(q => q.topic === topicName);
        if (questionsInTopic.length === 0) continue;

        const correctlyAnsweredInTopic = new Set(
          answerHistory
            .filter(h => h.blockId === blockId && h.topicName === topicName && h.result === 'ACIERTO')
            .map(h => h.questionId)
        );

        const topicConsolidation = (correctlyAnsweredInTopic.size / questionsInTopic.length) * 100;
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

module.exports = router;