const express = require('express');
const pool = require('../database/connection');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.nickname, u.email, u.created_at,
        up.answer_history, up.stats, up.preferences
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
      preferences: user.preferences || {}
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
      stats = profileResult.rows[0].stats || stats;
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

module.exports = router;