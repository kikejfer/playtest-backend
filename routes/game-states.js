const express = require('express');
const pool = require('../database/connection');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Save game state
router.post('/', authenticateToken, async (req, res) => {
    try {
        const {
            game_id,
            session_id,
            game_type,
            current_state,
            progress = {},
            auto_save = true
        } = req.body;
        
        if (!game_type || !current_state) {
            return res.status(400).json({ 
                error: 'game_type and current_state are required' 
            });
        }
        
        const result = await pool.query(`
            INSERT INTO persistent_game_states (
                user_id, game_id, session_id, game_type, 
                current_state, progress, auto_saved, last_checkpoint
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
            ON CONFLICT (user_id, game_id, session_id) DO UPDATE SET
                current_state = EXCLUDED.current_state,
                progress = EXCLUDED.progress,
                auto_saved = EXCLUDED.auto_saved,
                last_checkpoint = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            RETURNING id, last_checkpoint
        `, [
            req.user.id,
            game_id,
            session_id || `session_${Date.now()}`,
            game_type,
            current_state,
            progress,
            auto_save
        ]);
        
        res.json({
            success: true,
            state_id: result.rows[0].id,
            last_checkpoint: result.rows[0].last_checkpoint
        });
        
    } catch (error) {
        console.error('Error saving game state:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get game states
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { type, limit = 10, active_only = false } = req.query;
        
        let query = `
            SELECT id, game_id, session_id, game_type, current_state,
                   progress, auto_saved, last_checkpoint, expires_at,
                   created_at, updated_at
            FROM persistent_game_states
            WHERE user_id = $1
        `;
        const params = [req.user.id];
        
        if (type) {
            query += ` AND game_type = $${params.length + 1}`;
            params.push(type);
        }
        
        if (active_only === 'true') {
            query += ` AND expires_at > CURRENT_TIMESTAMP`;
        }
        
        query += ` ORDER BY last_checkpoint DESC LIMIT $${params.length + 1}`;
        params.push(parseInt(limit));
        
        const result = await pool.query(query, params);
        
        res.json({
            states: result.rows,
            count: result.rows.length
        });
        
    } catch (error) {
        console.error('Error fetching game states:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get specific game state
router.get('/:stateId', authenticateToken, async (req, res) => {
    try {
        const { stateId } = req.params;
        
        const result = await pool.query(`
            SELECT id, game_id, session_id, game_type, current_state,
                   progress, auto_saved, last_checkpoint, expires_at,
                   created_at, updated_at
            FROM persistent_game_states
            WHERE id = $1 AND user_id = $2
        `, [stateId, req.user.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Game state not found' });
        }
        
        res.json({
            state: result.rows[0]
        });
        
    } catch (error) {
        console.error('Error fetching game state:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Load game state by game and session
router.get('/game/:gameId/session/:sessionId', authenticateToken, async (req, res) => {
    try {
        const { gameId, sessionId } = req.params;
        
        const result = await pool.query(`
            SELECT id, game_id, session_id, game_type, current_state,
                   progress, auto_saved, last_checkpoint, expires_at,
                   created_at, updated_at
            FROM persistent_game_states
            WHERE game_id = $1 AND session_id = $2 AND user_id = $3
            ORDER BY last_checkpoint DESC
            LIMIT 1
        `, [gameId, sessionId, req.user.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Game state not found' });
        }
        
        res.json({
            state: result.rows[0]
        });
        
    } catch (error) {
        console.error('Error loading game state:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete game state
router.delete('/:stateId', authenticateToken, async (req, res) => {
    try {
        const { stateId } = req.params;
        
        const result = await pool.query(`
            DELETE FROM persistent_game_states
            WHERE id = $1 AND user_id = $2
            RETURNING id
        `, [stateId, req.user.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Game state not found' });
        }
        
        res.json({
            success: true,
            deleted_id: result.rows[0].id
        });
        
    } catch (error) {
        console.error('Error deleting game state:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Cleanup expired states
router.delete('/cleanup/expired', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            DELETE FROM persistent_game_states
            WHERE user_id = $1 AND expires_at < CURRENT_TIMESTAMP
            RETURNING id
        `, [req.user.id]);
        
        res.json({
            success: true,
            deleted_count: result.rows.length
        });
        
    } catch (error) {
        console.error('Error cleaning up expired states:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get game statistics
router.get('/stats/summary', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                game_type,
                COUNT(*) as total_saves,
                MAX(last_checkpoint) as last_save,
                AVG(EXTRACT(EPOCH FROM (expires_at - created_at))) as avg_session_length
            FROM persistent_game_states
            WHERE user_id = $1
            GROUP BY game_type
            ORDER BY total_saves DESC
        `, [req.user.id]);
        
        res.json({
            game_stats: result.rows
        });
        
    } catch (error) {
        console.error('Error fetching game statistics:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;