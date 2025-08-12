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
        blockName: row.block_name || 'Unknown Block',
        correct: correctAnswers,
        incorrect: incorrectAnswers,
        blank: blankAnswers,
        date: row.created_at,
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

// Get specific game
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const gameId = req.params.id;
    
    // Validate that gameId is a number
    if (isNaN(parseInt(gameId))) {
      return res.status(400).json({ error: 'Invalid game ID' });
    }
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
    
    // For now, return empty array as challenges are not fully implemented
    // In the future, this could query a challenges table
    const challenges = [];
    
    res.json(challenges);
  } catch (error) {
    console.error('Error fetching challenges:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get game history for a specific user
router.get('/history/:userId', authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    
    console.log(`Fetching game history for user ${userId}`);
    
    // Get complete game history with scores and block information
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
      WHERE gp.user_id = $1 AND g.status = 'completed'
      ORDER BY g.created_at DESC
      LIMIT 10
    `, [userId]);

    console.log(`Found ${result.rows.length} completed games for user ${userId}`);

    const history = result.rows.map(row => {
      const scoreData = row.score_data || {};
      const config = row.config || {};
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
            if (blockConfig && blockConfig.topics && Array.isArray(blockConfig.topics)) {
              // Count questions only for configured topics
              totalConfigQuestions += blockConfig.topics.reduce((sum, topic) => {
                return sum + (topic.questionCount || 0);
              }, 0);
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
    });

    console.log(`Returning ${history.length} history entries`);
    res.json(history);
  } catch (error) {
    console.error('Error fetching game history:', error);
    console.error('Error details:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ error: 'Internal server error', details: error.message });
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
