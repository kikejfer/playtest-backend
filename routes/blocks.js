const express = require('express');
const pool = require('../database/connection');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get all blocks with questions
router.get('/', authenticateToken, async (req, res) => {
  try {
    const blocksResult = await pool.query(`
      SELECT b.*, u.nickname as creator_nickname,
        COUNT(q.id) as question_count
      FROM blocks b
      LEFT JOIN users u ON b.creator_id = u.id
      LEFT JOIN questions q ON b.id = q.block_id
      WHERE b.is_public = true OR b.creator_id = $1
      GROUP BY b.id, u.nickname
      ORDER BY b.created_at DESC
    `, [req.user.id]);

    const blocks = [];
    
    for (const block of blocksResult.rows) {
      // Get questions for this block
      const questionsResult = await pool.query(`
        SELECT q.*, 
          json_agg(
            json_build_object(
              'id', a.id,
              'answerText', a.answer_text,
              'isCorrect', a.is_correct
            )
          ) as answers
        FROM questions q
        LEFT JOIN answers a ON q.id = a.question_id
        WHERE q.block_id = $1
        GROUP BY q.id
        ORDER BY q.created_at
      `, [block.id]);

      const questions = questionsResult.rows.map(q => ({
        id: q.id,
        textoPregunta: q.text_question,
        tema: q.topic,
        bloqueId: q.block_id,
        difficulty: q.difficulty,
        respuestas: q.answers.filter(a => a.id !== null).map(a => ({
          textoRespuesta: a.answerText,
          esCorrecta: a.isCorrect
        }))
      }));

      blocks.push({
        id: block.id,
        name: block.name,
        description: block.description,
        creatorId: block.creator_id,
        creatorNickname: block.creator_nickname,
        isPublic: block.is_public,
        questionCount: parseInt(block.question_count),
        questions: questions
      });
    }

    res.json(blocks);
  } catch (error) {
    console.error('Error fetching blocks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new block
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, description, isPublic = true } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Block name is required' });
    }

    const result = await pool.query(
      'INSERT INTO blocks (name, description, creator_id, is_public) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, description, req.user.id, isPublic]
    );

    res.status(201).json({
      message: 'Block created successfully',
      block: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating block:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update block
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const blockId = req.params.id;
    const { name, description, isPublic } = req.body;

    // Check if user owns the block
    const ownerCheck = await pool.query(
      'SELECT creator_id FROM blocks WHERE id = $1',
      [blockId]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Block not found' });
    }

    if (ownerCheck.rows[0].creator_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to modify this block' });
    }

    const result = await pool.query(
      'UPDATE blocks SET name = $1, description = $2, is_public = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING *',
      [name, description, isPublic, blockId]
    );

    res.json({
      message: 'Block updated successfully',
      block: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating block:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete block
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const blockId = req.params.id;

    // Check if user owns the block
    const ownerCheck = await pool.query(
      'SELECT creator_id FROM blocks WHERE id = $1',
      [blockId]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Block not found' });
    }

    if (ownerCheck.rows[0].creator_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to delete this block' });
    }

    await pool.query('DELETE FROM blocks WHERE id = $1', [blockId]);

    res.json({ message: 'Block deleted successfully' });
  } catch (error) {
    console.error('Error deleting block:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;