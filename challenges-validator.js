const { Pool } = require('pg');

// Sistema de validaciones y transferencias automáticas para retos
class ChallengesValidator {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
    }

    // ==================== VALIDADORES POR TIPO DE RETO ====================

    async validateMarathonChallenge(participantId, challengeConfig) {
        try {
            const participant = await this.getParticipantData(participantId);
            const { required_blocks, min_average_score, max_attempts_per_block, must_complete_all } = challengeConfig;

            let completedBlocks = 0;
            let totalScore = 0;
            let totalAttempts = 0;
            let blocksProgress = {};

            for (const blockId of required_blocks) {
                // Obtener historial de juegos del usuario en este bloque
                const gameHistory = await this.pool.query(`
                    SELECT 
                        g.id,
                        g.created_at,
                        gs.score,
                        gs.correct_answers,
                        gs.total_questions
                    FROM games g
                    JOIN game_players gp ON g.id = gp.game_id
                    LEFT JOIN game_scores gs ON g.id = gs.game_id AND gs.user_id = gp.user_id
                    WHERE gp.user_id = $1 
                        AND g.config ? $2
                        AND g.status = 'completed'
                        AND g.created_at > $3
                    ORDER BY g.created_at DESC
                `, [participant.user_id, blockId.toString(), participant.started_at]);

                const attempts = gameHistory.rows.length;
                totalAttempts += attempts;

                if (attempts > 0) {
                    const bestScore = Math.max(...gameHistory.rows.map(g => g.score || 0));
                    totalScore += bestScore;
                    
                    if (bestScore >= min_average_score && attempts <= max_attempts_per_block) {
                        completedBlocks++;
                    }

                    blocksProgress[blockId] = {
                        attempts: attempts,
                        best_score: bestScore,
                        completed: bestScore >= min_average_score && attempts <= max_attempts_per_block
                    };
                } else {
                    blocksProgress[blockId] = {
                        attempts: 0,
                        best_score: 0,
                        completed: false
                    };
                }
            }

            const averageScore = required_blocks.length > 0 ? totalScore / required_blocks.length : 0;
            const isCompleted = must_complete_all ? 
                (completedBlocks === required_blocks.length) : 
                (completedBlocks > 0 && averageScore >= min_average_score);

            return {
                isCompleted,
                progress: {
                    completed_blocks: completedBlocks,
                    total_blocks: required_blocks.length,
                    average_score: averageScore,
                    total_attempts: totalAttempts,
                    blocks_progress: blocksProgress,
                    progress_percentage: (completedBlocks / required_blocks.length) * 100
                }
            };

        } catch (error) {
            console.error('Error validating marathon challenge:', error);
            throw error;
        }
    }

    async validateLevelChallenge(participantId, challengeConfig) {
        try {
            const participant = await this.getParticipantData(participantId);
            const { target_levels, min_consolidation_per_block, level_mapping } = challengeConfig;

            let levelsAchieved = 0;
            let levelProgress = {};

            for (const [blockId, targetLevel] of Object.entries(target_levels)) {
                // Obtener consolidación actual del usuario en el bloque
                const consolidationResult = await this.pool.query(`
                    SELECT 
                        COALESCE(AVG(
                            CASE WHEN ua.is_correct THEN 100.0 ELSE 0.0 END
                        ), 0) as consolidation_percentage
                    FROM user_answers ua
                    JOIN questions q ON ua.question_id = q.id
                    WHERE ua.user_id = $1 
                        AND q.block_id = $2
                        AND ua.answered_at > $3
                `, [participant.user_id, blockId, participant.started_at]);

                const consolidation = consolidationResult.rows[0]?.consolidation_percentage || 0;
                const targetLevelNum = level_mapping[targetLevel] || 1;
                const currentLevelNum = this.calculateLevelFromConsolidation(consolidation);

                const levelAchieved = currentLevelNum >= targetLevelNum && consolidation >= min_consolidation_per_block;
                
                if (levelAchieved) {
                    levelsAchieved++;
                }

                levelProgress[blockId] = {
                    current_level: currentLevelNum,
                    target_level: targetLevelNum,
                    consolidation: consolidation,
                    achieved: levelAchieved
                };
            }

            const totalTargets = Object.keys(target_levels).length;
            const isCompleted = levelsAchieved === totalTargets;

            return {
                isCompleted,
                progress: {
                    levels_achieved: levelsAchieved,
                    total_targets: totalTargets,
                    level_progress: levelProgress,
                    progress_percentage: (levelsAchieved / totalTargets) * 100
                }
            };

        } catch (error) {
            console.error('Error validating level challenge:', error);
            throw error;
        }
    }

    async validateStreakChallenge(participantId, challengeConfig) {
        try {
            const participant = await this.getParticipantData(participantId);
            const { 
                required_days, 
                min_daily_sessions, 
                min_daily_time_minutes, 
                min_daily_questions,
                allowed_breaks = 1 
            } = challengeConfig;

            // Obtener actividad diaria desde el inicio del reto
            const dailyActivity = await this.pool.query(`
                SELECT 
                    DATE(g.created_at) as activity_date,
                    COUNT(DISTINCT g.id) as sessions,
                    SUM(EXTRACT(EPOCH FROM (g.updated_at - g.created_at))/60) as total_minutes,
                    COUNT(ua.id) as questions_answered
                FROM games g
                JOIN game_players gp ON g.id = gp.game_id
                LEFT JOIN user_answers ua ON ua.user_id = gp.user_id 
                    AND ua.answered_at >= g.created_at 
                    AND ua.answered_at <= g.updated_at
                WHERE gp.user_id = $1 
                    AND g.created_at >= $2
                    AND g.status = 'completed'
                GROUP BY DATE(g.created_at)
                ORDER BY activity_date
            `, [participant.user_id, participant.started_at]);

            let currentStreak = 0;
            let maxStreak = 0;
            let breaksUsed = 0;
            let lastActivityDate = null;
            const dailyProgress = {};

            for (const activity of dailyActivity.rows) {
                const date = activity.activity_date;
                const sessions = parseInt(activity.sessions);
                const minutes = parseFloat(activity.total_minutes) || 0;
                const questions = parseInt(activity.questions_answered) || 0;

                const dayCompleted = sessions >= min_daily_sessions && 
                                   minutes >= min_daily_time_minutes && 
                                   questions >= min_daily_questions;

                dailyProgress[date] = {
                    sessions,
                    minutes: Math.round(minutes),
                    questions,
                    completed: dayCompleted
                };

                if (dayCompleted) {
                    if (lastActivityDate) {
                        const daysDiff = (new Date(date) - new Date(lastActivityDate)) / (1000 * 60 * 60 * 24);
                        if (daysDiff === 1) {
                            currentStreak++;
                        } else if (daysDiff > 1 && daysDiff <= 2 && breaksUsed < allowed_breaks) {
                            // Permitir un día de gracia
                            breaksUsed++;
                            currentStreak++;
                        } else {
                            currentStreak = 1;
                        }
                    } else {
                        currentStreak = 1;
                    }
                    
                    maxStreak = Math.max(maxStreak, currentStreak);
                    lastActivityDate = date;
                }
            }

            const isCompleted = maxStreak >= required_days;

            return {
                isCompleted,
                progress: {
                    current_streak: currentStreak,
                    max_streak: maxStreak,
                    required_days: required_days,
                    breaks_used: breaksUsed,
                    allowed_breaks: allowed_breaks,
                    daily_progress: dailyProgress,
                    progress_percentage: Math.min((maxStreak / required_days) * 100, 100)
                }
            };

        } catch (error) {
            console.error('Error validating streak challenge:', error);
            throw error;
        }
    }

    async validateCompetitionChallenge(participantId, challengeConfig) {
        try {
            const participant = await this.getParticipantData(participantId);
            const { 
                required_wins, 
                game_modes = ['duelo', 'trivial'], 
                min_win_rate = 0.6,
                min_accuracy = 0.7 
            } = challengeConfig;

            // Obtener historial de juegos competitivos
            const gamesResult = await this.pool.query(`
                SELECT 
                    g.id,
                    g.game_type,
                    g.created_at,
                    gs.score as user_score,
                    gs.correct_answers,
                    gs.total_questions,
                    CASE 
                        WHEN gs.score = (
                            SELECT MAX(gs2.score) 
                            FROM game_scores gs2 
                            WHERE gs2.game_id = g.id
                        ) THEN true 
                        ELSE false 
                    END as won
                FROM games g
                JOIN game_players gp ON g.id = gp.game_id
                JOIN game_scores gs ON g.id = gs.game_id AND gs.user_id = gp.user_id
                WHERE gp.user_id = $1 
                    AND g.game_type = ANY($2)
                    AND g.status = 'completed'
                    AND g.created_at >= $3
                    AND (SELECT COUNT(*) FROM game_players gp2 WHERE gp2.game_id = g.id) > 1
                ORDER BY g.created_at DESC
            `, [participant.user_id, game_modes, participant.started_at]);

            const games = gamesResult.rows;
            const totalGames = games.length;
            const wins = games.filter(g => g.won).length;
            const winRate = totalGames > 0 ? wins / totalGames : 0;
            
            const totalQuestions = games.reduce((sum, g) => sum + (g.total_questions || 0), 0);
            const correctAnswers = games.reduce((sum, g) => sum + (g.correct_answers || 0), 0);
            const accuracy = totalQuestions > 0 ? correctAnswers / totalQuestions : 0;

            const isCompleted = wins >= required_wins && winRate >= min_win_rate && accuracy >= min_accuracy;

            return {
                isCompleted,
                progress: {
                    wins: wins,
                    required_wins: required_wins,
                    total_games: totalGames,
                    win_rate: winRate,
                    accuracy: accuracy,
                    recent_games: games.slice(0, 10),
                    progress_percentage: Math.min((wins / required_wins) * 100, 100)
                }
            };

        } catch (error) {
            console.error('Error validating competition challenge:', error);
            throw error;
        }
    }

    async validateConsolidationChallenge(participantId, challengeConfig) {
        try {
            const participant = await this.getParticipantData(participantId);
            const { target_block_id, target_percentage, specific_topics = [] } = challengeConfig;

            let topicCondition = '';
            const params = [participant.user_id, target_block_id, participant.started_at];

            if (specific_topics.length > 0) {
                topicCondition = 'AND q.topic = ANY($4)';
                params.push(specific_topics);
            }

            const consolidationResult = await this.pool.query(`
                SELECT 
                    COALESCE(AVG(
                        CASE WHEN ua.is_correct THEN 100.0 ELSE 0.0 END
                    ), 0) as current_percentage,
                    COUNT(ua.id) as total_answers,
                    COUNT(ua.id) FILTER (WHERE ua.is_correct) as correct_answers,
                    COUNT(DISTINCT q.topic) as topics_covered
                FROM user_answers ua
                JOIN questions q ON ua.question_id = q.id
                WHERE ua.user_id = $1 
                    AND q.block_id = $2
                    AND ua.answered_at >= $3
                    ${topicCondition}
            `, params);

            const result = consolidationResult.rows[0];
            const currentPercentage = parseFloat(result.current_percentage) || 0;
            const isCompleted = currentPercentage >= target_percentage;

            return {
                isCompleted,
                progress: {
                    current_percentage: currentPercentage,
                    target_percentage: target_percentage,
                    total_answers: parseInt(result.total_answers) || 0,
                    correct_answers: parseInt(result.correct_answers) || 0,
                    topics_covered: parseInt(result.topics_covered) || 0,
                    progress_percentage: Math.min((currentPercentage / target_percentage) * 100, 100)
                }
            };

        } catch (error) {
            console.error('Error validating consolidation challenge:', error);
            throw error;
        }
    }

    async validateTemporalChallenge(participantId, challengeConfig) {
        try {
            const { objectives, weights = {} } = challengeConfig;
            let totalProgress = 0;
            let totalWeight = 0;
            const objectiveResults = {};

            for (const objective of objectives) {
                const weight = weights[objective.id] || 1;
                totalWeight += weight;

                let objectiveProgress = 0;

                switch (objective.type) {
                    case 'blocks_completed':
                        const blocksResult = await this.validateMarathonChallenge(participantId, {
                            required_blocks: objective.target_blocks,
                            min_average_score: objective.min_score || 70,
                            max_attempts_per_block: 999,
                            must_complete_all: false
                        });
                        objectiveProgress = blocksResult.progress.progress_percentage;
                        break;

                    case 'games_won':
                        const gamesResult = await this.validateCompetitionChallenge(participantId, {
                            required_wins: objective.target_wins,
                            game_modes: objective.game_modes || ['duelo', 'trivial'],
                            min_win_rate: 0,
                            min_accuracy: 0
                        });
                        objectiveProgress = gamesResult.progress.progress_percentage;
                        break;

                    case 'streak_maintained':
                        const streakResult = await this.validateStreakChallenge(participantId, {
                            required_days: objective.target_days,
                            min_daily_sessions: objective.min_sessions || 1,
                            min_daily_time_minutes: objective.min_minutes || 15,
                            min_daily_questions: objective.min_questions || 10
                        });
                        objectiveProgress = streakResult.progress.progress_percentage;
                        break;
                }

                objectiveResults[objective.id] = {
                    progress: objectiveProgress,
                    weight: weight,
                    completed: objectiveProgress >= 100
                };

                totalProgress += objectiveProgress * weight;
            }

            const averageProgress = totalWeight > 0 ? totalProgress / totalWeight : 0;
            const isCompleted = averageProgress >= 100;

            return {
                isCompleted,
                progress: {
                    average_progress: averageProgress,
                    objective_results: objectiveResults,
                    progress_percentage: Math.min(averageProgress, 100)
                }
            };

        } catch (error) {
            console.error('Error validating temporal challenge:', error);
            throw error;
        }
    }

    // ==================== FUNCIONES DE SOPORTE ====================

    async getParticipantData(participantId) {
        const result = await this.pool.query(`
            SELECT cp.*, c.challenge_type, c.config
            FROM challenge_participants cp
            JOIN challenges c ON cp.challenge_id = c.id
            WHERE cp.id = $1
        `, [participantId]);

        if (result.rows.length === 0) {
            throw new Error('Participante no encontrado');
        }

        return result.rows[0];
    }

    calculateLevelFromConsolidation(consolidation) {
        if (consolidation >= 95) return 5; // Maestro
        if (consolidation >= 85) return 4; // Experto
        if (consolidation >= 75) return 3; // Avanzado
        if (consolidation >= 60) return 2; // Intermedio
        return 1; // Principiante
    }

    // ==================== SISTEMA DE TRANSFERENCIAS ====================

    async processAutomaticValidation(participantId) {
        try {
            const participant = await this.getParticipantData(participantId);
            const challengeConfig = participant.config;

            let validationResult;

            switch (participant.challenge_type) {
                case 'marathon':
                    validationResult = await this.validateMarathonChallenge(participantId, challengeConfig);
                    break;
                case 'level':
                    validationResult = await this.validateLevelChallenge(participantId, challengeConfig);
                    break;
                case 'streak':
                    validationResult = await this.validateStreakChallenge(participantId, challengeConfig);
                    break;
                case 'competition':
                    validationResult = await this.validateCompetitionChallenge(participantId, challengeConfig);
                    break;
                case 'consolidation':
                    validationResult = await this.validateConsolidationChallenge(participantId, challengeConfig);
                    break;
                case 'temporal':
                    validationResult = await this.validateTemporalChallenge(participantId, challengeConfig);
                    break;
                default:
                    throw new Error('Tipo de reto no válido');
            }

            // Actualizar progreso
            await this.pool.query(`
                UPDATE challenge_participants 
                SET 
                    progress = $1,
                    current_metrics = $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $3
            `, [
                JSON.stringify(validationResult.progress),
                JSON.stringify(validationResult.progress),
                participantId
            ]);

            // Si está completado, procesar premio
            if (validationResult.isCompleted && participant.status !== 'completed') {
                await this.awardPrize(participantId);
            }

            return validationResult;

        } catch (error) {
            console.error('Error in automatic validation:', error);
            throw error;
        }
    }

    async awardPrize(participantId) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');

            // Obtener datos del participante y reto
            const participantResult = await client.query(`
                SELECT cp.*, c.prize_luminarias, c.bonus_luminarias, c.creator_id
                FROM challenge_participants cp
                JOIN challenges c ON cp.challenge_id = c.id
                WHERE cp.id = $1 AND cp.status = 'active'
            `, [participantId]);

            if (participantResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return;
            }

            const participant = participantResult.rows[0];
            const totalPrize = participant.prize_luminarias + (participant.bonus_luminarias || 0);

            // Transferir premio al usuario
            await client.query(`
                UPDATE user_profiles 
                SET 
                    luminarias_actuales = COALESCE(luminarias_actuales, 0) + $1,
                    luminarias_ganadas = COALESCE(luminarias_ganadas, 0) + $1
                WHERE user_id = $2
            `, [totalPrize, participant.user_id]);

            // Registrar transferencia
            await client.query(`
                INSERT INTO challenge_transfers (
                    challenge_id, from_user_id, to_user_id, amount, transfer_type, reference_data
                ) VALUES ($1, $2, $3, $4, 'award', $5)
            `, [
                participant.challenge_id,
                participant.creator_id,
                participant.user_id,
                totalPrize,
                JSON.stringify({ participant_id: participantId })
            ]);

            // Marcar como completado
            await client.query(`
                UPDATE challenge_participants 
                SET 
                    status = 'completed',
                    completed_at = CURRENT_TIMESTAMP,
                    prize_awarded = $1
                WHERE id = $2
            `, [totalPrize, participantId]);

            // Enviar notificación
            await client.query(`
                INSERT INTO challenge_notifications (
                    user_id, challenge_id, notification_type, title, message, data
                ) VALUES ($1, $2, 'challenge_completed', 'Reto Completado', $3, $4)
            `, [
                participant.user_id,
                participant.challenge_id,
                `¡Felicidades! Has completado el reto y ganado ${totalPrize} Luminarias.`,
                JSON.stringify({ prize_awarded: totalPrize })
            ]);

            await client.query('COMMIT');

            console.log(`Prize awarded: ${totalPrize} Luminarias to user ${participant.user_id} for challenge ${participant.challenge_id}`);

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error awarding prize:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Función para ejecutar validaciones periódicas
    async runPeriodicValidations() {
        try {
            console.log('Running periodic challenge validations...');

            const activeParticipants = await this.pool.query(`
                SELECT cp.id
                FROM challenge_participants cp
                JOIN challenges c ON cp.challenge_id = c.id
                WHERE cp.status = 'active' 
                    AND c.status = 'active'
                    AND c.end_date > CURRENT_TIMESTAMP
            `);

            let processed = 0;
            let completed = 0;

            for (const participant of activeParticipants.rows) {
                try {
                    const result = await this.processAutomaticValidation(participant.id);
                    processed++;
                    if (result.isCompleted) {
                        completed++;
                    }
                } catch (error) {
                    console.error(`Error validating participant ${participant.id}:`, error);
                }
            }

            console.log(`Validation complete: ${processed} processed, ${completed} completed`);

        } catch (error) {
            console.error('Error in periodic validations:', error);
        }
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = ChallengesValidator;