const express = require('express');
const { pool } = require('../database/connection');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get games for user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT g.*,
        json_agg(
          json_build_object(
            'userId', all_players.user_id,
            'nickname', u.nickname,
            'playerIndex', all_players.player_index
          ) ORDER BY all_players.player_index
        ) as players
      FROM games g
      JOIN (
        SELECT gp.game_id
        FROM game_players gp
        WHERE gp.user_id = $1
      ) user_games ON g.id = user_games.game_id
      JOIN game_players all_players ON g.id = all_players.game_id
      JOIN users u ON all_players.user_id = u.id
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

// Get game history for user (must be before /:id route)
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT
        g.id as game_id,
        g.game_type,
        g.status,
        g.config,
        g.created_at,
        gs.score_data,
        b.name as block_name,
        b.id as block_id,
        gp.nickname,
        (SELECT COUNT(*) FROM questions q WHERE q.block_id = b.id) as total_block_questions
      FROM games g
      JOIN game_players gp ON g.id = gp.game_id
      LEFT JOIN game_scores gs ON g.id = gs.game_id
      LEFT JOIN blocks b ON CAST(b.id as TEXT) = ANY(SELECT jsonb_object_keys(g.config))
      WHERE gp.user_id = $1
      ORDER BY g.created_at DESC
      LIMIT 10
    `, [req.user.id]);

    console.log('📈 Game history query returned', result.rows.length, 'rows');
    console.log('📊 Raw history data:', result.rows);

    const history = result.rows.map(row => {
      const scoreData = row.score_data || {};
      const totalBlockQuestions = parseInt(row.total_block_questions) || 1;
      const correctAnswers = scoreData.score || 0;
      const totalAnswered = scoreData.totalAnswered || correctAnswers; // Questions actually answered
      const incorrectAnswers = Math.max(0, totalAnswered - correctAnswers); // Only count answered incorrect questions
      const blankAnswers = Math.max(0, totalBlockQuestions - totalAnswered); // Unanswered questions
      
      console.log('🎮 Processing game:', row.game_id, 'status:', row.status);
      console.log('📊 ScoreData:', scoreData);
      console.log('📊 Total questions:', totalBlockQuestions, 'Answered:', totalAnswered, 'Correct:', correctAnswers, 'Incorrect:', incorrectAnswers, 'Blank:', blankAnswers);
      
      return {
        gameId: row.game_id,
        mode: getGameModeDisplay(row.game_type),
        gameMode: getGameModeDisplay(row.game_type),
        blockName: row.block_name || 'Unknown Block',
        correct: correctAnswers,
        incorrect: incorrectAnswers,
        blank: blankAnswers,
        totalQuestions: totalBlockQuestions,
        date: row.created_at,
        createdAt: row.created_at,
        score: calculateScore(correctAnswers, totalBlockQuestions),
        status: row.status // Add status for debugging
      };
    });

    console.log('📋 Processed history:', history);
    res.json(history);
  } catch (error) {
    console.error('Error fetching game history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Save game configuration for future reference (Active Games functionality)
router.post('/configurations', authenticateToken, async (req, res) => {
  try {
    const { gameType, config, configurationMetadata } = req.body;
    
    console.log('💾 Saving game configuration for user:', req.user.id);
    
    // Save configuration to user profile for easy access
    const result = await pool.query(`
      INSERT INTO user_game_configurations (user_id, game_type, config, metadata, created_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, game_type, config) 
      DO UPDATE SET 
        metadata = EXCLUDED.metadata,
        last_used = CURRENT_TIMESTAMP,
        use_count = COALESCE(user_game_configurations.use_count, 0) + 1
      RETURNING id
    `, [req.user.id, gameType, JSON.stringify(config), JSON.stringify(configurationMetadata)]);
    
    res.status(201).json({ 
      message: 'Game configuration saved successfully',
      configId: result.rows[0]?.id 
    });
  } catch (error) {
    // If table doesn't exist, create it
    if (error.code === '42P01') {
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS user_game_configurations (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            game_type VARCHAR(50) NOT NULL,
            config JSONB NOT NULL,
            metadata JSONB,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            use_count INTEGER DEFAULT 1,
            UNIQUE(user_id, game_type, config)
          )
        `);
        
        // Retry the insert
        const result = await pool.query(`
          INSERT INTO user_game_configurations (user_id, game_type, config, metadata, created_at)
          VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
          RETURNING id
        `, [req.user.id, gameType, JSON.stringify(config), JSON.stringify(configurationMetadata)]);
        
        res.status(201).json({ 
          message: 'Game configuration saved successfully (table created)',
          configId: result.rows[0]?.id 
        });
      } catch (createError) {
        console.error('Error creating configurations table:', createError);
        res.status(500).json({ error: 'Failed to save configuration' });
      }
    } else {
      console.error('Error saving game configuration:', error);
      res.status(500).json({ error: 'Failed to save configuration' });
    }
  }
});

// Get saved game configurations for user (Active Games panel)
router.get('/configurations', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, game_type, config, metadata, created_at, last_used, use_count
      FROM user_game_configurations 
      WHERE user_id = $1 
      ORDER BY last_used DESC, use_count DESC
      LIMIT 20
    `, [req.user.id]);
    
    const configurations = result.rows.map(row => ({
      id: row.id,
      gameType: row.game_type,
      gameMode: getGameModeDisplay(row.game_type),
      config: row.config,
      metadata: row.metadata,
      createdAt: row.created_at,
      lastUsed: row.last_used,
      useCount: row.use_count || 1
    }));
    
    console.log(`📋 Returning ${configurations.length} saved configurations for user ${req.user.id}`);
    res.json(configurations);
  } catch (error) {
    if (error.code === '42P01') {
      // Table doesn't exist yet, return empty array
      console.log('💡 Configurations table does not exist yet, returning empty array');
      res.json([]);
    } else {
      console.error('Error fetching game configurations:', error);
      res.status(500).json({ error: 'Failed to fetch configurations' });
    }
  }
});

// Delete a saved game configuration
router.delete('/configurations/:id', authenticateToken, async (req, res) => {
  try {
    const configId = parseInt(req.params.id);
    
    const result = await pool.query(`
      DELETE FROM user_game_configurations 
      WHERE id = $1 AND user_id = $2
      RETURNING id
    `, [configId, req.user.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Configuration not found' });
    }
    
    res.json({ message: 'Configuration deleted successfully' });
  } catch (error) {
    console.error('Error deleting game configuration:', error);
    res.status(500).json({ error: 'Failed to delete configuration' });
  }
});

// Get specific game
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const gameId = req.params.id;

    // Handle emergency game IDs (frontend fallback mode)
    if (gameId.startsWith('emergency_')) {
      console.log(`🚨 Emergency game ID detected: ${gameId}`);
      return res.json({
        id: gameId,
        gameType: 'classic',
        mode: 'Modo Clásico',
        config: {
          blockId: null,
          questionCount: 10,
          timeLimit: 300,
          topics: []
        },
        players: [{
          userId: req.user.id,
          nickname: req.user.nickname,
          playerIndex: 0
        }],
        status: 'waiting',
        createdAt: new Date().toISOString(),
        isEmergencyGame: true
      });
    }

    // Validate that gameId is a number
    if (isNaN(parseInt(gameId))) {
      return res.status(400).json({ error: 'Invalid game ID' });
    }
    // First check if game exists at all
    const gameCheck = await pool.query('SELECT id, game_type, status FROM games WHERE id = $1', [gameId]);

    if (gameCheck.rows.length === 0) {
      console.log(`❌ Game ${gameId} does not exist in games table`);
      return res.status(404).json({ error: 'Game not found' });
    }

    console.log(`✅ Game ${gameId} exists:`, gameCheck.rows[0]);

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
      console.log(`❌ Game ${gameId} exists but has no players in game_players table`);
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

// Get game ranking/history for a specific game (for Time Trial, etc.)
router.get('/:id/ranking', authenticateToken, async (req, res) => {
  try {
    const gameId = parseInt(req.params.id);
    console.log('📊 Getting game ranking for game:', gameId, 'user:', req.user.id);

    // Check if game exists and user has access
    const gameResult = await pool.query(`
      SELECT g.id, g.game_type, g.config, g.status,
        json_agg(
          json_build_object(
            'userId', p.user_id,
            'nickname', u.nickname
          )
        ) as players
      FROM games g
      LEFT JOIN game_players p ON g.id = p.game_id
      LEFT JOIN users u ON p.user_id = u.id
      WHERE g.id = $1
      GROUP BY g.id, g.game_type, g.config, g.status
    `, [gameId]);

    if (gameResult.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // Check if user is part of this game
    const game = gameResult.rows[0];
    const isPlayerInGame = game.players.some(
      player => player.userId === req.user.id
    );

    if (!isPlayerInGame) {
      return res.status(403).json({ error: 'Not authorized to access this game ranking' });
    }

    // Get user's answer history for this specific game configuration
    const userResult = await pool.query(
      'SELECT answer_history FROM user_profiles WHERE user_id = $1',
      [req.user.id]
    );

    const answerHistory = userResult.rows[0]?.answer_history || [];
    console.log('📊 Total answer history entries:', answerHistory.length);

    // Filter answers for this specific game and calculate game sessions
    const gameAnswers = answerHistory.filter(entry => entry.gameId === gameId);
    console.log('📊 Game-specific history entries:', gameAnswers.length);

    // Group by timestamp to identify game sessions (answers within same minute are same session)
    const gameSessions = {};
    gameAnswers.forEach(answer => {
      // Round timestamp to minute to group session answers
      const sessionKey = answer.timestamp.substring(0, 16); // "YYYY-MM-DDTHH:MM"
      if (!gameSessions[sessionKey]) {
        gameSessions[sessionKey] = [];
      }
      gameSessions[sessionKey].push(answer);
    });

    // Calculate stats for each session
    const sessionStats = Object.entries(gameSessions).map(([sessionTime, answers]) => {
      const correct = answers.filter(a => a.result === 'ACIERTO').length;
      const incorrect = answers.filter(a => a.result === 'FALLO').length;
      const blank = answers.filter(a => a.result === 'BLANCO' || a.result === 'BLANK').length;
      const total = answers.length;
      
      return {
        timestamp: sessionTime,
        date: new Date(sessionTime).toISOString(),
        correct,
        incorrect,
        blank,
        total,
        percentage: total > 0 ? Math.round((correct / total) * 100) : 0
      };
    });

    // Sort by correct answers (desc) then by percentage (desc) then by date (desc)
    const ranking = sessionStats
      .sort((a, b) => {
        if (b.correct !== a.correct) return b.correct - a.correct;
        if (b.percentage !== a.percentage) return b.percentage - a.percentage;
        return new Date(b.date) - new Date(a.date);
      })
      .slice(0, 10); // Top 10

    console.log('📊 Returning ranking with', ranking.length, 'entries');
    res.json(ranking);
    
  } catch (error) {
    console.error('❌ Error fetching game ranking:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message,
      endpoint: '/games/:id/ranking'
    });
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

    // Create game with active status
    const gameResult = await client.query(
      'INSERT INTO games (game_type, config, created_by, status) VALUES ($1, $2, $3, $4) RETURNING id',
      [gameType, config, req.user.id, 'active']
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

    console.log(`🔄 Update game request - GameID: ${gameId}, UserID: ${req.user.id}`);
    console.log(`📝 Updates requested:`, JSON.stringify(updates, null, 2));

    // Check if user is part of the game
    const playerCheck = await pool.query(
      'SELECT user_id FROM game_players WHERE game_id = $1 AND user_id = $2',
      [gameId, req.user.id]
    );

    if (playerCheck.rows.length === 0) {
      console.log(`❌ User ${req.user.id} not authorized to update game ${gameId}`);
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
      // Ensure gameState is properly formatted as JSONB
      updateValues.push(typeof updates.gameState === 'string' ? updates.gameState : JSON.stringify(updates.gameState));
      paramCounter++;
    }

    if (updates.config !== undefined) {
      updateFields.push(`config = $${paramCounter}`);
      updateValues.push(typeof updates.config === 'string' ? updates.config : JSON.stringify(updates.config));
      paramCounter++;
    }

    if (updateFields.length === 0) {
      console.log(`⚠️ No valid fields to update for game ${gameId}`);
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(gameId);

    const query = `UPDATE games SET ${updateFields.join(', ')} WHERE id = $${paramCounter} RETURNING *`;

    console.log(`📊 Executing query:`, query);
    console.log(`📊 With values:`, updateValues);

    const result = await pool.query(query, updateValues);

    console.log(`✅ Game ${gameId} updated successfully`);

    res.json({
      message: 'Game updated successfully',
      game: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Error updating game:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Delete game
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const gameId = req.params.id;
    console.log(`🗑️ Delete game request - GameID: ${gameId}, UserID: ${req.user.id}`);

    // Get game details including creator and participants
    const gameCheck = await pool.query(
      'SELECT created_by FROM games WHERE id = $1',
      [gameId]
    );

    if (gameCheck.rows.length === 0) {
      console.log(`❌ Game ${gameId} not found`);
      return res.status(404).json({ error: 'Game not found' });
    }

    const game = gameCheck.rows[0];

    // Check if user is a participant in the game
    const playerCheck = await pool.query(
      'SELECT user_id FROM game_players WHERE game_id = $1 AND user_id = $2',
      [gameId, req.user.id]
    );

    console.log(`🔍 Game details:`, {
      gameId,
      created_by: game.created_by,
      requesting_user: req.user.id,
      is_participant: playerCheck.rows.length > 0
    });

    // Check if user is authorized (creator or participant)
    const isCreator = game.created_by === req.user.id;
    const isParticipant = playerCheck.rows.length > 0;
    const isAuthorized = isCreator || isParticipant;

    console.log(`🔐 Authorization check:`, {
      isCreator,
      isParticipant,
      isAuthorized
    });

    if (!isAuthorized) {
      console.log(`❌ User ${req.user.id} not authorized to delete game ${gameId}`);
      return res.status(403).json({ error: 'Not authorized to delete this game' });
    }

    await pool.query('DELETE FROM games WHERE id = $1', [gameId]);

    console.log(`✅ Game ${gameId} deleted successfully by user ${req.user.id}`);
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

    // Save the score
    await pool.query(
      'INSERT INTO game_scores (game_id, game_type, score_data) VALUES ($1, $2, $3)',
      [gameId, gameType, scoreData]
    );

    // Mark game as completed
    await pool.query(
      'UPDATE games SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['completed', gameId]
    );

    res.status(201).json({ message: 'Score saved and game completed successfully' });

  } catch (error) {
    console.error('Error saving game score:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Helper function to convert game type to display format
function getGameModeDisplay(gameType) {
  const typeToMode = {
    'classic': 'Modo Clásico',
    'time-trial': 'Modo Contrarreloj',
    'lives': 'Modo Vidas',
    'by-levels': 'Por Niveles',
    'streak': 'Racha de Aciertos',
    'exam': 'Examen Simulado',
    'duel': 'Duelo',
    'marathon': 'Maratón',
    'trivial': 'Trivial'
  };
  return typeToMode[gameType] || gameType;
}

// Helper function to calculate score (0-10 scale)
function calculateScore(correct, total) {
  if (total === 0) return 0;
  return Math.round((correct / total) * 10 * 100) / 100;
}

// Get challenges for a specific user
router.get('/challenges/:userId', authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);

    // Get games where user is a player and status is 'waiting' (pending challenges)
    const result = await pool.query(`
      SELECT g.*,
        json_agg(
          json_build_object(
            'userId', all_players.user_id,
            'nickname', u.nickname,
            'playerIndex', all_players.player_index
          ) ORDER BY all_players.player_index
        ) as players
      FROM games g
      JOIN (
        SELECT gp.game_id
        FROM game_players gp
        WHERE gp.user_id = $1
      ) user_games ON g.id = user_games.game_id
      JOIN game_players all_players ON g.id = all_players.game_id
      JOIN users u ON all_players.user_id = u.id
      WHERE g.status = 'waiting'
      GROUP BY g.id
      ORDER BY g.created_at DESC
    `, [userId]);

    const challenges = result.rows.map(game => {
      // Determine if this is an incoming or outgoing challenge
      const currentUserPlayer = game.players.find(p => p.userId === userId);
      const otherPlayer = game.players.find(p => p.userId !== userId);
      const isIncoming = game.created_by !== userId;

      return {
        id: game.id,
        gameType: game.game_type,
        mode: getGameModeDisplay(game.game_type),
        config: game.config,
        status: game.status,  // Use actual status from database instead of hardcoding 'pending'
        direction: isIncoming ? 'incoming' : 'outgoing',
        challenger: isIncoming ? otherPlayer : currentUserPlayer,
        challenged: isIncoming ? currentUserPlayer : otherPlayer,
        createdAt: game.created_at,
        players: game.players
      };
    });

    res.json(challenges);
  } catch (error) {
    console.error('Error fetching challenges:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Accept a challenge
router.post('/challenges/:id/accept', authenticateToken, async (req, res) => {
  try {
    const challengeId = parseInt(req.params.id);
    const userId = req.user.id;

    console.log(`✅ Accept challenge request - challengeId: ${challengeId}, userId: ${userId}`);

    // First check if game exists at all
    const gameExists = await pool.query('SELECT id, status, created_by FROM games WHERE id = $1', [challengeId]);
    console.log(`📊 Game exists check:`, gameExists.rows);

    // Check if user is a player
    const isPlayer = await pool.query('SELECT user_id FROM game_players WHERE game_id = $1 AND user_id = $2', [challengeId, userId]);
    console.log(`👤 User is player check:`, isPlayer.rows);

    // Check if game exists and user is a player
    const gameCheck = await pool.query(`
      SELECT g.*, gp.user_id
      FROM games g
      JOIN game_players gp ON g.id = gp.game_id
      WHERE g.id = $1 AND gp.user_id = $2 AND g.status = 'waiting'
    `, [challengeId, userId]);

    console.log(`✅ Final game check result:`, gameCheck.rows);

    if (gameCheck.rows.length === 0) {
      console.log(`❌ Challenge not found - challengeId: ${challengeId}, userId: ${userId}`);
      console.log(`Game exists:`, gameExists.rows);
      console.log(`Is player:`, isPlayer.rows);
      return res.status(404).json({ error: 'Challenge not found or already accepted' });
    }

    const game = gameCheck.rows[0];

    // Only the challenged user (not the creator) can accept
    if (game.created_by === userId) {
      console.log(`❌ User ${userId} trying to accept their own challenge ${challengeId}`);
      return res.status(403).json({ error: 'Cannot accept your own challenge' });
    }

    console.log(`🔄 Updating game ${challengeId} status to 'active' and initializing game state...`);

    // Update game status to 'active' and initialize game state for duel
    const updateResult = await pool.query(`
      UPDATE games
      SET status = 'active',
          game_state = COALESCE(game_state, '{"gameState": "playing", "turnState": "p1_ready", "round": 0}'::jsonb),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, status, game_state
    `, [challengeId]);

    console.log(`✅ Game status updated:`, updateResult.rows);

    // Fetch the complete updated game with players
    const updatedGameResult = await pool.query(`
      SELECT
        g.*,
        json_agg(
          json_build_object(
            'userId', gp.user_id,
            'nickname', u.nickname,
            'score', 0
          ) ORDER BY gp.player_index
        ) as players
      FROM games g
      LEFT JOIN game_players gp ON g.id = gp.game_id
      LEFT JOIN users u ON gp.user_id = u.id
      WHERE g.id = $1
      GROUP BY g.id
    `, [challengeId]);

    const updatedGame = updatedGameResult.rows[0];
    console.log('✅ Successfully updated game and fetched details:', updatedGame);

    res.json({
      success: true,
      message: 'Challenge accepted',
      gameId: challengeId,
      game: updatedGame
    });
  } catch (error) {
    console.error('❌ Error accepting challenge - Full error:', error);
    console.error('Error stack:', error.stack);
    console.error('Error details:', { challengeId, userId, errorMessage: error.message });
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Decline a challenge
router.post('/challenges/:id/decline', authenticateToken, async (req, res) => {
  try {
    const challengeId = parseInt(req.params.id);
    const userId = req.user.id;

    console.log(`🚫 Decline challenge request - challengeId: ${challengeId}, userId: ${userId}`);

    // First check if game exists at all
    const gameExists = await pool.query('SELECT id, status, created_by FROM games WHERE id = $1', [challengeId]);
    console.log(`📊 Game exists check:`, gameExists.rows);

    // Check if user is a player
    const isPlayer = await pool.query('SELECT user_id FROM game_players WHERE game_id = $1 AND user_id = $2', [challengeId, userId]);
    console.log(`👤 User is player check:`, isPlayer.rows);

    // Check if game exists and user is a player
    const gameCheck = await pool.query(`
      SELECT g.*, gp.user_id
      FROM games g
      JOIN game_players gp ON g.id = gp.game_id
      WHERE g.id = $1 AND gp.user_id = $2 AND g.status = 'waiting'
    `, [challengeId, userId]);

    console.log(`✅ Final game check result:`, gameCheck.rows);

    if (gameCheck.rows.length === 0) {
      console.log(`❌ Challenge not found - challengeId: ${challengeId}, userId: ${userId}`);
      return res.status(404).json({ error: 'Challenge not found or already processed' });
    }

    const game = gameCheck.rows[0];

    // Only the challenged user (not the creator) can decline
    if (game.created_by === userId) {
      return res.status(403).json({ error: 'Cannot decline your own challenge' });
    }

    // Delete the game (or mark as declined)
    await pool.query('DELETE FROM games WHERE id = $1', [challengeId]);

    res.json({
      success: true,
      message: 'Challenge declined'
    });
  } catch (error) {
    console.error('Error declining challenge:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Abandon a game (mark as loss for abandoner)
router.post('/:id/abandon', authenticateToken, async (req, res) => {
  try {
    const gameId = parseInt(req.params.id);
    const userId = req.user.id;

    console.log(`🏳️ Abandon game request - gameId: ${gameId}, userId: ${userId}`);

    // Get game and player info - check both active and completed status
    const gameResult = await pool.query(`
      SELECT g.*, gp.player_index
      FROM games g
      JOIN game_players gp ON g.id = gp.game_id
      WHERE g.id = $1 AND gp.user_id = $2
    `, [gameId, userId]);

    if (gameResult.rows.length === 0) {
      console.log(`❌ Game not found - gameId: ${gameId}, userId: ${userId}`);
      return res.status(404).json({ error: 'Game not found' });
    }

    const game = gameResult.rows[0];

    // If game is already completed, just return success (scores already saved)
    if (game.status === 'completed') {
      console.log(`⚠️ Game already completed - gameId: ${gameId}`);
      return res.json({
        success: true,
        message: 'Game already completed',
        game: game
      });
    }

    // Only proceed with abandon if game is still active
    if (game.status !== 'active') {
      console.log(`❌ Game status is ${game.status}, cannot abandon`);
      return res.status(400).json({ error: 'Game is not active' });
    }

    const abandonerIndex = game.player_index;
    const winnerIndex = abandonerIndex === 0 ? 1 : 0;

    // Get winner info
    const winnerResult = await pool.query(`
      SELECT user_id, nickname
      FROM game_players gp
      JOIN users u ON gp.user_id = u.id
      WHERE gp.game_id = $1 AND gp.player_index = $2
    `, [gameId, winnerIndex]);

    const winner = winnerResult.rows[0];

    // Update game state to abandoned
    const updatedGame = await pool.query(`
      UPDATE games
      SET status = 'completed',
          game_state = jsonb_set(
            COALESCE(game_state, '{}'::jsonb),
            '{gameState}',
            '"abandoned"'
          ) || jsonb_build_object('winner', $1, 'winnerId', $2, 'abandonedBy', $3),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *
    `, [winner.nickname, winner.user_id, userId, gameId]);

    console.log(`✅ Game abandoned - winner: ${winner.nickname} (userId: ${winner.user_id}), abandoner userId: ${userId}`);

    res.json({
      success: true,
      message: 'Game abandoned',
      game: updatedGame.rows[0],
      winner: winner.nickname
    });
  } catch (error) {
    console.error('❌ Error abandoning game:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Get game history for a specific user
router.get('/history/:userId', authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    
    console.log(`Fetching game history for user ${userId}`);
    
    // Get complete game history with scores and block information
    // Use a subquery to get only the user's games, then join to get all needed info
    const result = await pool.query(`
      WITH user_games AS (
        SELECT DISTINCT g.id, g.game_type, g.status, g.config, g.created_at
        FROM games g
        JOIN game_players gp ON g.id = gp.game_id
        WHERE gp.user_id = $1 AND g.status = 'completed'
        ORDER BY g.created_at DESC
        LIMIT 10
      )
      SELECT
        ug.id as game_id,
        ug.game_type,
        ug.status,
        ug.config,
        ug.created_at,
        gs.score_data,
        b.name as block_name,
        b.id as block_id,
        gp.nickname,
        gp.player_index,
        (SELECT COUNT(*) FROM questions q WHERE q.block_id = b.id) as total_block_questions
      FROM user_games ug
      LEFT JOIN game_scores gs ON ug.id = gs.game_id
      LEFT JOIN blocks b ON CAST(b.id as TEXT) = ANY(SELECT jsonb_object_keys(ug.config))
      LEFT JOIN game_players gp ON ug.id = gp.game_id AND gp.user_id = $1
      ORDER BY ug.created_at DESC
    `, [userId]);

    console.log(`Found ${result.rows.length} completed games for user ${userId}`);

    const history = await Promise.all(result.rows.map(async (row) => {
      const scoreData = row.score_data || {};
      const config = row.config || {};

      // Handle duel games differently
      if (row.game_type === 'duel') {
        // Determine which player is the current user (player_index 0 = p1, 1 = p2)
        const isPlayer1 = row.player_index === 0;
        const playerScore = isPlayer1 ? (scoreData.scores?.p1 || 0) : (scoreData.scores?.p2 || 0);
        const opponentScore = isPlayer1 ? (scoreData.scores?.p2 || 0) : (scoreData.scores?.p1 || 0);
        const playerName = isPlayer1 ? scoreData.p1 : scoreData.p2;
        const opponentName = isPlayer1 ? scoreData.p2 : scoreData.p1;
        const rounds = scoreData.rounds || 0;

        // Calculate result from player's perspective
        const totalQuestions = rounds * 2; // Each round has 2 questions (one per player)
        const playerAnsweredRounds = Math.min(rounds, playerScore); // Approx questions they answered correctly
        const incorrect = Math.max(0, rounds - playerScore); // Questions they got wrong
        const blank = 0; // Duels don't have blanks tracked separately

        return {
          gameId: row.game_id,
          blockName: opponentName ? `vs ${opponentName}` : 'Duelo',
          mode: getGameModeDisplay(row.game_type),
          correct: playerScore,
          incorrect: incorrect,
          blank: blank,
          total: rounds,
          score: playerScore > opponentScore ? 10 : (playerScore === opponentScore ? 5 : 0),
          opponent: opponentName || null,
          date: row.created_at
        };
      }

      const correctAnswers = scoreData.score || 0;
      const totalAnswered = scoreData.totalAnswered || correctAnswers;

      // CRITICAL: Calculate questions based on game configuration, not total block questions
      let configuredQuestions = parseInt(row.total_block_questions) || 1; // Default fallback
      
      try {
        // If game has configuration with specific topics, calculate questions for those topics only
        if (config && Object.keys(config).length > 0) {
          let totalConfigQuestions = 0;
          
          // Iterate through each block in the configuration
          for (const [blockId, blockConfig] of Object.entries(config)) {
            if (blockConfig) {
              if (blockConfig.topics === 'all') {
                // If all topics are selected, use all block questions
                totalConfigQuestions += parseInt(row.total_block_questions) || 0;
              } else if (Array.isArray(blockConfig.topics)) {
                // Need to query the actual block questions to count topics
                try {
                  const blockQuestionsResult = await pool.query(
                    'SELECT COUNT(*) as count FROM questions WHERE block_id = $1 AND tema = ANY($2)',
                    [parseInt(blockId), blockConfig.topics]
                  );
                  const topicQuestionCount = parseInt(blockQuestionsResult.rows[0]?.count) || 0;
                  totalConfigQuestions += topicQuestionCount;
                  console.log(`📊 Block ${blockId}: Found ${topicQuestionCount} questions for topics [${blockConfig.topics.join(', ')}]`);
                } catch (queryError) {
                  console.warn(`⚠️ Failed to count questions for block ${blockId}, topics:`, blockConfig.topics, queryError.message);
                  // Fallback: estimate based on percentage of topics
                  const estimatedQuestions = Math.round((parseInt(row.total_block_questions) || 0) * blockConfig.topics.length / 10);
                  totalConfigQuestions += estimatedQuestions;
                }
              }
            }
          }
          
          if (totalConfigQuestions > 0) {
            configuredQuestions = totalConfigQuestions;
            console.log(`📊 Game ${row.game_id}: Using configured questions (${configuredQuestions}) instead of total block questions (${row.total_block_questions})`);
          }
        }
      } catch (configError) {
        console.warn(`⚠️ Error calculating configured questions for game ${row.game_id}, using block total:`, configError.message);
      }
      
      const incorrectAnswers = Math.max(0, totalAnswered - correctAnswers);
      const blankAnswers = Math.max(0, configuredQuestions - totalAnswered);
      
      return {
        gameId: row.game_id,
        blockName: row.block_name || 'Unknown Block',
        mode: getGameModeDisplay(row.game_type),
        correct: correctAnswers,
        incorrect: incorrectAnswers,
        blank: blankAnswers,
        total: configuredQuestions, // Use configured questions instead of total block questions
        score: calculateScore(correctAnswers, configuredQuestions), // CRITICAL: Score based on configured questions
        opponent: null, // Could be extended for multiplayer games
        date: row.created_at
      };
    }));

    console.log(`Returning ${history.length} history entries`);
    res.json(history);
  } catch (error) {
    console.error('Error fetching game history:', error);
    console.error('Error details:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// === GAME CONFIGURATIONS (Active Games) ENDPOINTS ===
// Save game configuration for Active Games panel
router.post('/configurations', authenticateToken, async (req, res) => {
  try {
    const { gameType, config, configurationMetadata } = req.body;
    const userId = req.user.userId;

    // Auto-create table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS game_configurations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        game_type VARCHAR(50) NOT NULL,
        config JSONB NOT NULL,
        configuration_metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    const result = await pool.query(
      'INSERT INTO game_configurations (user_id, game_type, config, configuration_metadata) VALUES ($1, $2, $3, $4) RETURNING *',
      [userId, gameType, config, configurationMetadata]
    );

    console.log('✅ Game configuration saved:', result.rows[0].id);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error saving game configuration:', error);
    res.status(500).json({ error: 'Failed to save game configuration', details: error.message });
  }
});

// Get all game configurations for current user
router.get('/configurations', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Auto-create table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS game_configurations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        game_type VARCHAR(50) NOT NULL,
        config JSONB NOT NULL,
        configuration_metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    const result = await pool.query(
      'SELECT * FROM game_configurations WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    console.log('✅ Fetched game configurations:', result.rows.length, 'configurations for user', userId);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error fetching game configurations:', error);
    res.status(500).json({ error: 'Failed to fetch game configurations', details: error.message });
  }
});

// Delete a specific game configuration
router.delete('/configurations/:configId', authenticateToken, async (req, res) => {
  try {
    const { configId } = req.params;
    const userId = req.user.userId;

    const result = await pool.query(
      'DELETE FROM game_configurations WHERE id = $1 AND user_id = $2 RETURNING *',
      [configId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Configuration not found' });
    }

    console.log('✅ Game configuration deleted:', configId);
    res.json({ message: 'Configuration deleted successfully' });
  } catch (error) {
    console.error('❌ Error deleting game configuration:', error);
    res.status(500).json({ error: 'Failed to delete game configuration', details: error.message });
  }
});

// Debug route to check table structure
router.get('/debug/tables', authenticateToken, async (req, res) => {
  try {
    // Check games table structure
    const gamesStructure = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'games'
    `);
    
    // Check game_scores table structure  
    const scoresStructure = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'game_scores'
    `);
    
    // Check if tables exist and have data
    const gamesCount = await pool.query('SELECT COUNT(*) FROM games');
    const scoresCount = await pool.query('SELECT COUNT(*) FROM game_scores');
    
    res.json({
      games_structure: gamesStructure.rows,
      scores_structure: scoresStructure.rows,
      games_count: gamesCount.rows[0].count,
      scores_count: scoresCount.rows[0].count
    });
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
