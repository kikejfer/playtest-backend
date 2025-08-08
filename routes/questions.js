const express = require('express');
const pool = require('../database/connection');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Add question to block
router.post('/', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { blockId, textoPregunta, tema, respuestas, difficulty = 1 } = req.body;

    if (!blockId || !textoPregunta || !respuestas || respuestas.length < 2) {
      return res.status(400).json({ 
        error: 'Block ID, question text, and at least 2 answers are required' 
      });
    }

    // Check if user owns the block
    const blockCheck = await client.query(
      'SELECT creator_id FROM blocks WHERE id = $1',
      [blockId]
    );

    if (blockCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Block not found' });
    }

    if (blockCheck.rows[0].creator_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to add questions to this block' });
    }

    // Create question
    const questionResult = await client.query(
      'INSERT INTO questions (block_id, text_question, topic, difficulty) VALUES ($1, $2, $3, $4) RETURNING id',
      [blockId, textoPregunta, tema, difficulty]
    );

    const questionId = questionResult.rows[0].id;

    // Add answers
    for (const respuesta of respuestas) {
      await client.query(
        'INSERT INTO answers (question_id, answer_text, is_correct) VALUES ($1, $2, $3)',
        [questionId, respuesta.textoRespuesta, respuesta.esCorrecta]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Question added successfully',
      questionId: questionId
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error adding question:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Update question
router.put('/:id', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const questionId = req.params.id;
    const { textoPregunta, tema, respuestas, difficulty } = req.body;

    // Check if user owns the question's block
    const ownerCheck = await client.query(`
      SELECT b.creator_id 
      FROM questions q 
      JOIN blocks b ON q.block_id = b.id 
      WHERE q.id = $1
    `, [questionId]);

    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }

    if (ownerCheck.rows[0].creator_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to modify this question' });
    }

    // Update question
    await client.query(
      'UPDATE questions SET text_question = $1, topic = $2, difficulty = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
      [textoPregunta, tema, difficulty, questionId]
    );

    // Delete old answers and add new ones
    await client.query('DELETE FROM answers WHERE question_id = $1', [questionId]);

    for (const respuesta of respuestas) {
      await client.query(
        'INSERT INTO answers (question_id, answer_text, is_correct) VALUES ($1, $2, $3)',
        [questionId, respuesta.textoRespuesta, respuesta.esCorrecta]
      );
    }

    await client.query('COMMIT');

    res.json({ message: 'Question updated successfully' });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating question:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Delete question
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const questionId = req.params.id;

    // Check if user owns the question's block
    const ownerCheck = await pool.query(`
      SELECT b.creator_id 
      FROM questions q 
      JOIN blocks b ON q.block_id = b.id 
      WHERE q.id = $1
    `, [questionId]);

    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }

    if (ownerCheck.rows[0].creator_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to delete this question' });
    }

    await pool.query('DELETE FROM questions WHERE id = $1', [questionId]);

    res.json({ message: 'Question deleted successfully' });
  } catch (error) {
    console.error('Error deleting question:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;