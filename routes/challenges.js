const express = require('express');
const router = express.Router();
const { pool } = require('../database/connection');
const { authenticateToken } = require('../middleware/auth');

// ==================== GAME CHALLENGES (Player vs Player) ====================

// Create a game challenge (player challenges another player to a game)
router.post('/', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { challengedUserId, gameConfig } = req.body;

        if (!challengedUserId || !gameConfig) {
            return res.status(400).json({ error: 'challengedUserId and gameConfig are required' });
        }

        // Map mode to gameType
        const modeToType = {
            'Modo Clásico': 'classic',
            'Modo Contrarreloj': 'time-trial',
            'Modo Vidas': 'lives',
            'Por Niveles': 'by-levels',
            'Racha de Aciertos': 'streak',
            'Examen Simulado': 'exam',
            'Duelo': 'duel',
            'Maratón': 'marathon',
            'Trivial': 'trivial'
        };

        const gameType = modeToType[gameConfig.mode] || gameConfig.gameType || gameConfig.mode || 'classic';
        const config = gameConfig.config || {};

        // Create a game with 'waiting' status for the challenge
        const gameResult = await client.query(`
            INSERT INTO games (game_type, config, created_by, status)
            VALUES ($1, $2, $3, 'waiting')
            RETURNING id
        `, [gameType, JSON.stringify(config), req.user.id]);

        const gameId = gameResult.rows[0].id;

        // Add both players to the game
        await client.query(`
            INSERT INTO game_players (game_id, user_id, player_index, nickname)
            VALUES ($1, $2, 0, $3)
        `, [gameId, req.user.id, req.user.nickname]);

        // Get challenged user nickname
        const challengedUser = await client.query(
            'SELECT nickname FROM users WHERE id = $1',
            [challengedUserId]
        );

        await client.query(`
            INSERT INTO game_players (game_id, user_id, player_index, nickname)
            VALUES ($1, $2, 1, $3)
        `, [gameId, challengedUserId, challengedUser.rows[0]?.nickname || 'Player']);

        await client.query('COMMIT');

        res.status(201).json({
            success: true,
            challengeId: gameId,
            message: 'Challenge sent successfully'
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating game challenge:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    } finally {
        client.release();
    }
});

// ==================== GESTIÓN DE RETOS ====================

// Crear nuevo reto
router.post('/create', authenticateToken, async (req, res) => {
    try {
        const {
            title,
            description,
            challenge_type,
            config,
            requirements = {},
            prize_luminarias,
            bonus_luminarias = 0,
            max_participants,
            end_date,
            auto_accept = true
        } = req.body;

        // Validaciones básicas
        if (!title || !challenge_type || !config || prize_luminarias < 0) {
            return res.status(400).json({ 
                error: 'Datos requeridos faltantes o inválidos' 
            });
        }

        const validTypes = ['marathon', 'level', 'streak', 'competition', 'consolidation', 'temporal'];
        if (!validTypes.includes(challenge_type)) {
            return res.status(400).json({ 
                error: 'Tipo de reto inválido' 
            });
        }

        // Verificar saldo del creador
        const balanceCheck = await pool.query(`
            SELECT COALESCE(luminarias_actuales, 0) as balance
            FROM user_profiles 
            WHERE user_id = $1
        `, [req.user.id]);

        const currentBalance = balanceCheck.rows[0]?.balance || 0;
        const estimatedCost = prize_luminarias * (max_participants || 100);

        if (currentBalance < estimatedCost) {
            return res.status(400).json({
                error: 'Saldo insuficiente',
                required: estimatedCost,
                current: currentBalance
            });
        }

        // Crear el reto
        const result = await pool.query(`
            INSERT INTO challenges (
                creator_id, title, description, challenge_type, config, 
                requirements, prize_luminarias, bonus_luminarias, 
                max_participants, end_date, auto_accept, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft')
            RETURNING id, created_at
        `, [
            req.user.id, title, description, challenge_type, 
            JSON.stringify(config), JSON.stringify(requirements),
            prize_luminarias, bonus_luminarias, max_participants, 
            end_date, auto_accept
        ]);

        const challengeId = result.rows[0].id;

        res.json({
            success: true,
            challenge_id: challengeId,
            message: 'Reto creado exitosamente',
            estimated_cost: estimatedCost
        });

    } catch (error) {
        console.error('Error creating challenge:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor', 
            details: error.message 
        });
    }
});

// Activar reto (reservar Luminarias)
router.post('/:challengeId/activate', authenticateToken, async (req, res) => {
    try {
        const { challengeId } = req.params;

        // Verificar que el reto existe y pertenece al usuario
        const challengeCheck = await pool.query(`
            SELECT id, creator_id, status, prize_luminarias, max_participants, luminarias_reserved
            FROM challenges 
            WHERE id = $1 AND creator_id = $2
        `, [challengeId, req.user.id]);

        if (challengeCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Reto no encontrado' });
        }

        const challenge = challengeCheck.rows[0];

        if (challenge.status === 'active') {
            return res.status(400).json({ error: 'El reto ya está activo' });
        }

        // El trigger se encarga de la reserva de Luminarias
        await pool.query(`
            UPDATE challenges 
            SET status = 'active', start_date = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [challengeId]);

        res.json({
            success: true,
            message: 'Reto activado exitosamente',
            challenge_id: challengeId
        });

    } catch (error) {
        console.error('Error activating challenge:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor', 
            details: error.message 
        });
    }
});

// Obtener retos del creador
router.get('/my-challenges', authenticateToken, async (req, res) => {
    try {
        const { status = 'all', page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        let statusCondition = '';
        const params = [req.user.id];

        if (status !== 'all') {
            statusCondition = 'AND status = $2';
            params.push(status);
        }

        const result = await pool.query(`
            SELECT 
                c.*,
                COUNT(cp.id) as participant_count,
                COUNT(cp.id) FILTER (WHERE cp.status = 'completed') as completed_count,
                AVG(CASE 
                    WHEN cp.current_metrics ? 'progress_percentage' 
                    THEN (cp.current_metrics->>'progress_percentage')::decimal 
                    ELSE 0 
                END) as avg_progress
            FROM challenges c
            LEFT JOIN challenge_participants cp ON c.id = cp.challenge_id
            WHERE c.creator_id = $1 ${statusCondition}
            GROUP BY c.id
            ORDER BY c.created_at DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `, [...params, limit, offset]);

        res.json({
            challenges: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: result.rows.length
            }
        });

    } catch (error) {
        console.error('Error fetching challenges:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor', 
            details: error.message 
        });
    }
});

// ==================== PARTICIPACIÓN EN RETOS ====================

// Obtener retos disponibles para el usuario
router.get('/available', authenticateToken, async (req, res) => {
    try {
        const { challenge_type, page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        let typeCondition = '';
        const params = [req.user.id];

        if (challenge_type) {
            typeCondition = 'AND c.challenge_type = $2';
            params.push(challenge_type);
        }

        const result = await pool.query(`
            SELECT 
                c.id,
                c.title,
                c.description,
                c.challenge_type,
                c.prize_luminarias,
                c.bonus_luminarias,
                c.end_date,
                c.max_participants,
                COUNT(cp.id) as current_participants,
                u.nickname as creator_name,
                CASE WHEN user_cp.id IS NOT NULL THEN true ELSE false END as is_participating
            FROM challenges c
            JOIN users u ON c.creator_id = u.id
            LEFT JOIN challenge_participants cp ON c.id = cp.challenge_id AND cp.status IN ('active', 'completed')
            LEFT JOIN challenge_participants user_cp ON c.id = user_cp.challenge_id AND user_cp.user_id = $1
            WHERE c.status = 'active' 
                AND c.end_date > CURRENT_TIMESTAMP
                AND (c.max_participants IS NULL OR COUNT(cp.id) < c.max_participants)
                ${typeCondition}
            GROUP BY c.id, u.nickname, user_cp.id
            ORDER BY c.created_at DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `, [...params, limit, offset]);

        res.json({
            challenges: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Error fetching available challenges:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor', 
            details: error.message 
        });
    }
});

// Unirse a un reto
router.post('/:challengeId/join', authenticateToken, async (req, res) => {
    try {
        const { challengeId } = req.params;

        // Verificar que el reto existe y está activo
        const challengeCheck = await pool.query(`
            SELECT id, status, max_participants, requirements, end_date
            FROM challenges 
            WHERE id = $1 AND status = 'active' AND end_date > CURRENT_TIMESTAMP
        `, [challengeId]);

        if (challengeCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Reto no encontrado o no disponible' });
        }

        const challenge = challengeCheck.rows[0];

        // Verificar si ya está participando
        const participationCheck = await pool.query(`
            SELECT id FROM challenge_participants 
            WHERE challenge_id = $1 AND user_id = $2
        `, [challengeId, req.user.id]);

        if (participationCheck.rows.length > 0) {
            return res.status(400).json({ error: 'Ya estás participando en este reto' });
        }

        // Verificar límite de participantes
        if (challenge.max_participants) {
            const countResult = await pool.query(`
                SELECT COUNT(*) as count 
                FROM challenge_participants 
                WHERE challenge_id = $1 AND status IN ('active', 'completed')
            `, [challengeId]);

            if (parseInt(countResult.rows[0].count) >= challenge.max_participants) {
                return res.status(400).json({ error: 'Reto lleno' });
            }
        }

        // Unirse al reto
        await pool.query(`
            INSERT INTO challenge_participants (challenge_id, user_id, status)
            VALUES ($1, $2, 'active')
        `, [challengeId, req.user.id]);

        res.json({
            success: true,
            message: 'Te has unido al reto exitosamente'
        });

    } catch (error) {
        console.error('Error joining challenge:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor', 
            details: error.message 
        });
    }
});

// Obtener progreso del usuario en sus retos
router.get('/my-progress', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                c.id,
                c.title,
                c.challenge_type,
                c.prize_luminarias,
                c.end_date,
                cp.status,
                cp.progress,
                cp.current_metrics,
                cp.started_at,
                cp.completed_at,
                cp.prize_awarded
            FROM challenge_participants cp
            JOIN challenges c ON cp.challenge_id = c.id
            WHERE cp.user_id = $1
            ORDER BY cp.started_at DESC
        `, [req.user.id]);

        res.json({
            participations: result.rows
        });

    } catch (error) {
        console.error('Error fetching user progress:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor', 
            details: error.message 
        });
    }
});

// ==================== GESTIÓN AVANZADA ====================

// Actualizar configuración de reto
router.put('/:challengeId/config', authenticateToken, async (req, res) => {
    try {
        const { challengeId } = req.params;
        const { config, end_date, max_participants } = req.body;

        const result = await pool.query(`
            UPDATE challenges 
            SET config = $1, end_date = $2, max_participants = $3, updated_at = CURRENT_TIMESTAMP
            WHERE id = $4 AND creator_id = $5 AND status IN ('draft', 'active')
            RETURNING id
        `, [
            JSON.stringify(config), 
            end_date, 
            max_participants, 
            challengeId, 
            req.user.id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Reto no encontrado o no editable' });
        }

        res.json({
            success: true,
            message: 'Configuración actualizada exitosamente'
        });

    } catch (error) {
        console.error('Error updating challenge config:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor', 
            details: error.message 
        });
    }
});

// Cancelar reto (con reembolsos)
router.post('/:challengeId/cancel', authenticateToken, async (req, res) => {
    try {
        const { challengeId } = req.params;
        const { reason = 'Cancelado por el creador' } = req.body;

        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');

            // Verificar reto
            const challengeResult = await client.query(`
                SELECT id, creator_id, status, luminarias_reserved
                FROM challenges 
                WHERE id = $1 AND creator_id = $2
            `, [challengeId, req.user.id]);

            if (challengeResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Reto no encontrado' });
            }

            const challenge = challengeResult.rows[0];

            // Cancelar reto
            await client.query(`
                UPDATE challenges 
                SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
            `, [challengeId]);

            // Reembolsar Luminarias reservadas
            if (challenge.luminarias_reserved > 0) {
                await client.query(`
                    UPDATE user_profiles 
                    SET luminarias_actuales = luminarias_actuales + $1
                    WHERE user_id = $2
                `, [challenge.luminarias_reserved, req.user.id]);

                // Registrar reembolso
                await client.query(`
                    INSERT INTO challenge_transfers (
                        challenge_id, from_user_id, to_user_id, amount, transfer_type, reference_data
                    ) VALUES ($1, $2, $2, $3, 'refund', $4)
                `, [
                    challengeId, 
                    req.user.id, 
                    challenge.luminarias_reserved,
                    JSON.stringify({ reason: reason })
                ]);
            }

            // Notificar a participantes
            await client.query(`
                INSERT INTO challenge_notifications (user_id, challenge_id, notification_type, title, message)
                SELECT cp.user_id, $1, 'challenge_cancelled', 'Reto Cancelado', $2
                FROM challenge_participants cp
                WHERE cp.challenge_id = $1 AND cp.status = 'active'
            `, [challengeId, `El reto ha sido cancelado. Razón: ${reason}`]);

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Reto cancelado exitosamente',
                refunded: challenge.luminarias_reserved
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('Error cancelling challenge:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor', 
            details: error.message 
        });
    }
});

// Obtener detalles completos de un reto
router.get('/:challengeId/details', authenticateToken, async (req, res) => {
    try {
        const { challengeId } = req.params;

        const result = await pool.query(`
            SELECT 
                c.*,
                u.nickname as creator_name,
                COUNT(cp.id) as total_participants,
                COUNT(cp.id) FILTER (WHERE cp.status = 'completed') as completed_participants,
                COUNT(cp.id) FILTER (WHERE cp.status = 'active') as active_participants,
                AVG(CASE 
                    WHEN cp.current_metrics ? 'progress_percentage' 
                    THEN (cp.current_metrics->>'progress_percentage')::decimal 
                    ELSE 0 
                END) as avg_progress
            FROM challenges c
            JOIN users u ON c.creator_id = u.id
            LEFT JOIN challenge_participants cp ON c.id = cp.challenge_id
            WHERE c.id = $1
            GROUP BY c.id, u.nickname
        `, [challengeId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Reto no encontrado' });
        }

        res.json({
            challenge: result.rows[0]
        });

    } catch (error) {
        console.error('Error fetching challenge details:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor', 
            details: error.message 
        });
    }
});

module.exports = router;