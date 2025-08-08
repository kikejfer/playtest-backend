const express = require('express');
const pool = require('../database/connection');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get games for user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT g.*, 
        json_agg(
          json_build_object(
            'userId', gp.user_id,
            'nickname', gp.nickname,
            'playerIndex', gp.player_index
          ) ORDER BY gp.player_index
        ) as players
      FROM games g
      JOIN game_players gp ON g.id = gp.game_id
      WHERE gp.user_id = $1
      GROUP BY g.id
      ORDER BY g.created_at DESC
    `, [req.user.id]);

    const games = result.rows.map(game => ({
      id: game.id,
      gameType: game.game_type,
      status: game.status,
      config: game.config,
      gameState: game.game_state,
      players: game.players,
      createdAt: game.created_at,
      updatedAt: game.updated_at
    }));

    res.json(games);
  } catch (error) {
    console.error('Error fetching games:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get specific game
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const gameId = req.params.id;

    const gameResult = await pool.query(`
      SELECT g.*, 
        json_agg(
          json_build_object(
            'userId', gp.user_id,
            'nickname', gp.nickname,
            'playerIndex', gp.player_index
          ) ORDER BY gp.player_index
        ) as players
      FROM games g
      JOIN game_players gp ON g.id = gp.game_id
      WHERE g.id = $1
      GROUP BY g.id
    `, [gameId]);

    if (gameResult.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // Check if user is part of this game
    const isPlayerInGame = gameResult.rows[0].players.some(
      player => player.userId === req.user.id
    );

    if (!isPlayerInGame) {
      return res.status(403).json({ error: 'Not authorized to access this game' });
    }

    const game = gameResult.rows[0];
    res.json({
      id: game.id,
      gameType: game.game_type,
      status: game.status,
      config: game.config,
      gameState: game.game_state,
      players: game.players,
      createdAt: game.created_at,
      updatedAt: game.updated_at
    });

  } catch (error) {
    console.error('Error fetching game:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new game
router.post('/', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { gameType, config, players } = req.body;

    if (!gameType || !players || players.length === 0) {
      return res.status(400).json({ 
        error: 'Game type and players are required' 
      });
    }

    // Create game
    const gameResult = await client.query(
      'INSERT INTO games (game_type, config, created_by) VALUES ($1, $2, $3) RETURNING id',
      [gameType, config, req.user.id]
    );

    const gameId = gameResult.rows[0].id;

    // Add players
    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      await client.query(
        'INSERT INTO game_players (game_id, user_id, player_index, nickname) VALUES ($1, $2, $3, $4)',
        [gameId, player.userId, i, player.nickname]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Game created successfully',
      gameId: gameId
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating game:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Update game state
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const gameId = req.params.id;
    const updates = req.body;

    // Check if user is part of the game
    const playerCheck = await pool.query(
      'SELECT user_id FROM game_players WHERE game_id = $1 AND user_id = $2',
      [gameId, req.user.id]
    );

    if (playerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to update this game' });
    }

    // Build update query dynamically
    const updateFields = [];
    const updateValues = [];
    let paramCounter = 1;

    if (updates.status !== undefined) {
      updateFields.push(`status = $${paramCounter}`);
      updateValues.push(updates.status);
      paramCounter++;
    }

    if (updates.gameState !== undefined) {
      updateFields.push(`game_state = $${paramCounter}`);
      updateValues.push(updates.gameState);
      paramCounter++;
    }

    if (updates.config !== undefined) {
      updateFields.push(`config = $${paramCounter}`);
      updateValues.push(updates.config);
      paramCounter++;
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(gameId);

    const query = `UPDATE games SET ${updateFields.join(', ')} WHERE id = $${paramCounter} RETURNING *`;

    const result = await pool.query(query, updateValues);

    res.json({
      message: 'Game updated successfully',
      game: result.rows[0]
    });

  } catch (error) {
    console.error('Error updating game:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete game
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const gameId = req.params.id;

    // Check if user created the game
    const creatorCheck = await pool.query(
      'SELECT created_by FROM games WHERE id = $1',
      [gameId]
    );

    if (creatorCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }

    if (creatorCheck.rows[0].created_by !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to delete this game' });
    }

    await pool.query('DELETE FROM games WHERE id = $1', [gameId]);

    res.json({ message: 'Game deleted successfully' });

  } catch (error) {
    console.error('Error deleting game:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Save game score
router.post('/:id/scores', authenticateToken, async (req, res) => {
  try {
    const gameId = req.params.id;
    const { scoreData, gameType } = req.body;

    // Check if user is part of the game
    const playerCheck = await pool.query(
      'SELECT user_id FROM game_players WHERE game_id = $1 AND user_id = $2',
      [gameId, req.user.id]
    );

    if (playerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to save score for this game' });
    }

    await pool.query(
      'INSERT INTO game_scores (game_id, game_type, score_data) VALUES ($1, $2, $3)',
      [gameId, gameType, scoreData]
    );

    res.status(201).json({ message: 'Score saved successfully' });

  } catch (error) {
    console.error('Error saving game score:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;