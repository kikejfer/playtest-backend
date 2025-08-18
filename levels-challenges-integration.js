const LevelsCalculator = require('./levels-calculator');
const LevelsBadgeSystem = require('./levels-badges');
const LevelsNotificationSystem = require('./levels-notifications');

// Integración entre sistema de niveles y challenges
class LevelsChallengesIntegration {
    constructor() {
        this.levelsCalculator = new LevelsCalculator();
        this.badgeSystem = new LevelsBadgeSystem();
        this.notificationSystem = new LevelsNotificationSystem();
    }

    // ==================== INTEGRACIÓN CON CHALLENGES ====================

    async handleChallengeCompletion(userId, challengeData) {
        try {
            console.log(`🎯 Procesando completación de challenge para usuario ${userId}`);

            // Calcular datos de logros basados en el challenge completado
            const achievementData = await this.calculateAchievementDataFromChallenge(userId, challengeData);

            // Actualizar niveles basados en la actividad del challenge
            const levelResults = await this.updateLevelsFromChallenge(userId, challengeData);

            // Verificar y otorgar badges de logros
            const newBadges = await this.badgeSystem.checkAndAwardAchievementBadges(userId, achievementData);

            // Enviar notificaciones de nuevos logros
            for (const badge of newBadges) {
                await this.notificationSystem.sendMilestoneNotification(userId, {
                    milestone_type: 'challenge_badge',
                    achievement: badge.badge_name,
                    value: challengeData.prize_luminarias,
                    level_type: 'achievement',
                    rewards: badge.benefits
                });
            }

            // Verificar hitos especiales
            await this.checkSpecialMilestones(userId, challengeData, levelResults);

            return {
                level_changes: levelResults,
                new_badges: newBadges,
                achievement_data: achievementData
            };

        } catch (error) {
            console.error('Error handling challenge completion:', error);
            return null;
        }
    }

    async calculateAchievementDataFromChallenge(userId, challengeData) {
        try {
            const { Pool } = require('pg');
            const pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });

            // Obtener estadísticas del usuario actualizadas
            const userStats = await pool.query(`
                SELECT 
                    -- Challenges completados
                    COUNT(CASE WHEN cp.status = 'completed' THEN 1 END) as challenges_completed,
                    
                    -- Challenges este mes
                    COUNT(CASE WHEN cp.status = 'completed' 
                          AND cp.completed_at >= DATE_TRUNC('month', CURRENT_DATE) THEN 1 END) as challenges_this_month,
                    
                    -- Racha actual (días consecutivos con actividad)
                    COALESCE(MAX(streak.current_streak), 0) as current_streak,
                    
                    -- Consolidación máxima
                    COALESCE(MAX(
                        CASE WHEN ul.current_metrics ? 'consolidation' 
                        THEN (ul.current_metrics->>'consolidation')::decimal 
                        ELSE 0 END
                    ), 0) as max_consolidation,
                    
                    -- Usuarios influenciados (para creadores)
                    COALESCE(MAX(
                        CASE WHEN ul.current_metrics ? 'active_users' 
                        THEN (ul.current_metrics->>'active_users')::decimal 
                        ELSE 0 END
                    ), 0) as content_reach

                FROM challenge_participants cp
                LEFT JOIN user_levels ul ON cp.user_id = ul.user_id
                LEFT JOIN (
                    SELECT 
                        user_id,
                        COUNT(*) as current_streak
                    FROM user_activity_metrics uam
                    WHERE uam.user_id = $1 
                        AND uam.metric_date >= CURRENT_DATE - INTERVAL '30 days'
                        AND uam.is_active = true
                    GROUP BY user_id
                ) streak ON cp.user_id = streak.user_id
                WHERE cp.user_id = $1
                GROUP BY cp.user_id
            `, [userId]);

            const stats = userStats.rows[0] || {};

            // Verificar hitos específicos del challenge
            const challengeSpecificData = await this.analyzeSpecificChallenge(userId, challengeData);

            return {
                challenges_completed: parseInt(stats.challenges_completed) || 0,
                challenges_this_month: parseInt(stats.challenges_this_month) || 0,
                daily_streak: parseInt(stats.current_streak) || 0,
                consolidation: parseFloat(stats.max_consolidation) || 0,
                content_reach: parseFloat(stats.content_reach) || 0,
                blocks_completed_month: challengeSpecificData.blocks_completed || 0,
                users_helped: challengeSpecificData.users_helped || 0,
                all_max_levels: challengeSpecificData.all_max_levels || false,
                
                // Datos específicos del challenge actual
                challenge_type: challengeData.challenge_type,
                challenge_prize: challengeData.prize_luminarias,
                challenge_difficulty: this.assessChallengeDifficulty(challengeData)
            };

        } catch (error) {
            console.error('Error calculating achievement data:', error);
            return {};
        }
    }

    async analyzeSpecificChallenge(userId, challengeData) {
        try {
            const { Pool } = require('pg');
            const pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });

            const analysis = {
                blocks_completed: 0,
                users_helped: 0,
                all_max_levels: false
            };

            // Si el challenge involucraba bloques, contar completaciones
            if (challengeData.challenge_type === 'marathon' && challengeData.config?.required_blocks) {
                const blocksResult = await pool.query(`
                    SELECT COUNT(DISTINCT ul.block_id) as completed_blocks
                    FROM user_levels ul
                    WHERE ul.user_id = $1 
                        AND ul.level_type = 'user'
                        AND ul.achieved_at >= DATE_TRUNC('month', CURRENT_DATE)
                        AND ul.block_id = ANY($2)
                `, [userId, challengeData.config.required_blocks]);

                analysis.blocks_completed = parseInt(blocksResult.rows[0]?.completed_blocks) || 0;
            }

            // Verificar si es creador y ha ayudado usuarios
            if (challengeData.challenge_type === 'consolidation' || challengeData.challenge_type === 'level') {
                const helpedResult = await pool.query(`
                    SELECT COUNT(DISTINCT helped_user.id) as users_helped
                    FROM blocks b
                    JOIN questions q ON b.id = q.block_id
                    JOIN user_answers ua ON q.id = ua.question_id
                    JOIN users helped_user ON ua.user_id = helped_user.id
                    WHERE b.creator_id = $1
                        AND ua.answered_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
                        AND helped_user.id != $1
                `, [userId]);

                analysis.users_helped = parseInt(helpedResult.rows[0]?.users_helped) || 0;
            }

            // Verificar niveles máximos
            const maxLevelsResult = await pool.query(`
                SELECT 
                    COUNT(CASE WHEN ul.level_type = 'user' AND ld.level_order = 5 THEN 1 END) > 0 as max_user,
                    COUNT(CASE WHEN ul.level_type = 'creator' AND ld.level_order = 5 THEN 1 END) > 0 as max_creator,
                    COUNT(CASE WHEN ul.level_type = 'teacher' AND ld.level_order = 5 THEN 1 END) > 0 as max_teacher
                FROM user_levels ul
                JOIN level_definitions ld ON ul.current_level_id = ld.id
                WHERE ul.user_id = $1
            `, [userId]);

            const maxLevels = maxLevelsResult.rows[0];
            analysis.all_max_levels = maxLevels && maxLevels.max_user && maxLevels.max_creator && maxLevels.max_teacher;

            return analysis;

        } catch (error) {
            console.error('Error analyzing specific challenge:', error);
            return { blocks_completed: 0, users_helped: 0, all_max_levels: false };
        }
    }

    assessChallengeDifficulty(challengeData) {
        let difficulty = 'medium';

        switch (challengeData.challenge_type) {
            case 'marathon':
                const blockCount = challengeData.config?.required_blocks?.length || 1;
                const minScore = challengeData.config?.min_average_score || 50;
                if (blockCount >= 5 && minScore >= 80) difficulty = 'hard';
                else if (blockCount <= 2 && minScore <= 60) difficulty = 'easy';
                break;

            case 'streak':
                const requiredDays = challengeData.config?.required_days || 5;
                if (requiredDays >= 14) difficulty = 'hard';
                else if (requiredDays <= 3) difficulty = 'easy';
                break;

            case 'consolidation':
                const targetPercentage = challengeData.config?.target_percentage || 70;
                if (targetPercentage >= 90) difficulty = 'hard';
                else if (targetPercentage <= 60) difficulty = 'easy';
                break;

            case 'competition':
                const requiredWins = challengeData.config?.required_wins || 3;
                const minWinRate = challengeData.config?.min_win_rate || 0.5;
                if (requiredWins >= 10 && minWinRate >= 0.8) difficulty = 'hard';
                else if (requiredWins <= 3 && minWinRate <= 0.6) difficulty = 'easy';
                break;
        }

        return difficulty;
    }

    async updateLevelsFromChallenge(userId, challengeData) {
        try {
            const results = {
                level_changes: [],
                notifications_sent: []
            };

            // Si el challenge involucra consolidación, recalcular niveles de usuario
            if (challengeData.challenge_type === 'consolidation' || 
                challengeData.challenge_type === 'marathon' || 
                challengeData.challenge_type === 'level') {
                
                const allLevelResults = await this.levelsCalculator.updateAllUserLevels(userId);
                
                // Procesar cambios de nivel
                for (const [blockId, levelResult] of Object.entries(allLevelResults.user_levels || {})) {
                    if (levelResult.changed) {
                        results.level_changes.push({
                            type: 'user',
                            block_id: blockId,
                            new_level: levelResult.level.level_name,
                            consolidation: levelResult.consolidation
                        });

                        // Otorgar badge de nivel si corresponde
                        await this.badgeSystem.awardLevelBadge(userId, 'user', levelResult.level.level_name);
                    }
                }

                // Verificar cambios en niveles de creador/profesor
                if (allLevelResults.creator_level && allLevelResults.creator_level.changed) {
                    results.level_changes.push({
                        type: 'creator',
                        new_level: allLevelResults.creator_level.level.level_name,
                        active_users: allLevelResults.creator_level.active_users
                    });

                    await this.badgeSystem.awardLevelBadge(userId, 'creator', allLevelResults.creator_level.level.level_name);
                }

                if (allLevelResults.teacher_level && allLevelResults.teacher_level.changed) {
                    results.level_changes.push({
                        type: 'teacher',
                        new_level: allLevelResults.teacher_level.level.level_name,
                        active_students: allLevelResults.teacher_level.active_students
                    });

                    await this.badgeSystem.awardLevelBadge(userId, 'teacher', allLevelResults.teacher_level.level.level_name);
                }
            }

            return results;

        } catch (error) {
            console.error('Error updating levels from challenge:', error);
            return { level_changes: [], notifications_sent: [] };
        }
    }

    async checkSpecialMilestones(userId, challengeData, levelResults) {
        try {
            // Hito: Primer challenge completado
            const { Pool } = require('pg');
            const pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });

            const challengeCount = await pool.query(`
                SELECT COUNT(*) as count
                FROM challenge_participants
                WHERE user_id = $1 AND status = 'completed'
            `, [userId]);

            if (parseInt(challengeCount.rows[0].count) === 1) {
                await this.notificationSystem.sendMilestoneNotification(userId, {
                    milestone_type: 'first_challenge',
                    achievement: 'Primer Challenge Completado',
                    value: challengeData.prize_luminarias,
                    level_type: 'achievement',
                    rewards: { bonus_luminarias: 10 }
                });
            }

            // Hito: Challenge difícil completado
            if (challengeData.prize_luminarias >= 100) {
                await this.notificationSystem.sendMilestoneNotification(userId, {
                    milestone_type: 'high_value_challenge',
                    achievement: 'Challenge de Alto Valor',
                    value: challengeData.prize_luminarias,
                    level_type: 'achievement',
                    rewards: { prestige_points: 5 }
                });
            }

            // Hito: Múltiples subidas de nivel en una sesión
            if (levelResults.level_changes && levelResults.level_changes.length >= 2) {
                await this.notificationSystem.sendMilestoneNotification(userId, {
                    milestone_type: 'multi_level_up',
                    achievement: 'Progreso Múltiple',
                    value: levelResults.level_changes.length,
                    level_type: 'achievement',
                    rewards: { bonus_luminarias: levelResults.level_changes.length * 5 }
                });
            }

        } catch (error) {
            console.error('Error checking special milestones:', error);
        }
    }

    // ==================== CHALLENGE RECOMMENDATIONS ====================

    async recommendChallengesForUser(userId) {
        try {
            const userLevels = await this.levelsCalculator.getUserCurrentLevels(userId);
            const recommendations = [];

            // Recomendaciones basadas en niveles de usuario
            if (userLevels.user && userLevels.user.length > 0) {
                for (const userLevel of userLevels.user) {
                    const consolidation = userLevel.current_metrics?.consolidation || 0;
                    
                    if (consolidation < 70) {
                        recommendations.push({
                            type: 'consolidation',
                            reason: `Mejorar consolidación en ${userLevel.block_title}`,
                            suggested_config: {
                                target_block_id: userLevel.block_id,
                                target_percentage: Math.min(consolidation + 20, 95),
                                time_limit_days: 14
                            },
                            priority: 'high'
                        });
                    }
                }
            }

            // Recomendaciones para creadores
            if (userLevels.creator) {
                const activeUsers = userLevels.creator.current_metrics?.active_users || 0;
                
                if (activeUsers < 50) {
                    recommendations.push({
                        type: 'marathon',
                        reason: 'Crear contenido para atraer más usuarios',
                        suggested_config: {
                            challenge_type: 'content_creation',
                            target_users: activeUsers + 10,
                            time_limit_days: 30
                        },
                        priority: 'medium'
                    });
                }
            }

            // Recomendaciones para profesores
            if (userLevels.teacher) {
                const activeStudents = userLevels.teacher.current_metrics?.active_students || 0;
                
                if (activeStudents < 25) {
                    recommendations.push({
                        type: 'teaching',
                        reason: 'Incrementar engagement de estudiantes',
                        suggested_config: {
                            target_students: activeStudents + 5,
                            engagement_activities: true,
                            time_limit_days: 21
                        },
                        priority: 'medium'
                    });
                }
            }

            // Recomendaciones generales basadas en actividad
            const activityRecommendations = await this.getActivityBasedRecommendations(userId);
            recommendations.push(...activityRecommendations);

            return recommendations.slice(0, 5); // Máximo 5 recomendaciones

        } catch (error) {
            console.error('Error recommending challenges:', error);
            return [];
        }
    }

    async getActivityBasedRecommendations(userId) {
        try {
            const { Pool } = require('pg');
            const pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });

            const recommendations = [];

            // Verificar racha de actividad
            const streakResult = await pool.query(`
                SELECT COUNT(*) as active_days
                FROM user_activity_metrics
                WHERE user_id = $1 
                    AND metric_date >= CURRENT_DATE - INTERVAL '7 days'
                    AND is_active = true
            `, [userId]);

            const activeDays = parseInt(streakResult.rows[0]?.active_days) || 0;

            if (activeDays >= 3 && activeDays < 7) {
                recommendations.push({
                    type: 'streak',
                    reason: 'Mantener racha de actividad',
                    suggested_config: {
                        required_days: 7,
                        min_daily_sessions: 1,
                        min_daily_time_minutes: 10
                    },
                    priority: 'medium'
                });
            }

            // Verificar challenges completados recientemente
            const recentChallenges = await pool.query(`
                SELECT COUNT(*) as recent_count
                FROM challenge_participants
                WHERE user_id = $1 
                    AND status = 'completed'
                    AND completed_at >= CURRENT_DATE - INTERVAL '7 days'
            `, [userId]);

            const recentCount = parseInt(recentChallenges.rows[0]?.recent_count) || 0;

            if (recentCount === 0) {
                recommendations.push({
                    type: 'beginner',
                    reason: 'Tiempo para un nuevo desafío',
                    suggested_config: {
                        difficulty: 'easy',
                        time_limit_days: 7,
                        prize_luminarias: 25
                    },
                    priority: 'low'
                });
            }

            return recommendations;

        } catch (error) {
            console.error('Error getting activity-based recommendations:', error);
            return [];
        }
    }

    // ==================== ANÁLISIS DE RENDIMIENTO ====================

    async analyzeChallengePerformance(userId, dateRange = 30) {
        try {
            const { Pool } = require('pg');
            const pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });

            const performance = await pool.query(`
                SELECT 
                    c.challenge_type,
                    COUNT(cp.id) as attempted,
                    COUNT(CASE WHEN cp.status = 'completed' THEN 1 END) as completed,
                    COUNT(CASE WHEN cp.status = 'failed' THEN 1 END) as failed,
                    AVG(CASE WHEN cp.current_metrics ? 'progress_percentage' 
                        THEN (cp.current_metrics->>'progress_percentage')::decimal 
                        ELSE 0 END) as avg_progress,
                    SUM(cp.prize_awarded) as total_luminarias_earned,
                    AVG(EXTRACT(EPOCH FROM (cp.completed_at - cp.started_at))/3600) as avg_completion_hours
                FROM challenge_participants cp
                JOIN challenges c ON cp.challenge_id = c.id
                WHERE cp.user_id = $1 
                    AND cp.started_at >= CURRENT_TIMESTAMP - INTERVAL $2
                GROUP BY c.challenge_type
                ORDER BY completed DESC
            `, [userId, `${dateRange} days`]);

            // Calcular métricas de nivel durante el mismo período
            const levelProgress = await this.levelsCalculator.getUserProgressionHistory(userId, 10);

            return {
                challenge_performance: performance.rows,
                level_progressions: levelProgress,
                recommendations: await this.recommendChallengesForUser(userId)
            };

        } catch (error) {
            console.error('Error analyzing challenge performance:', error);
            return {
                challenge_performance: [],
                level_progressions: [],
                recommendations: []
            };
        }
    }

    async close() {
        await this.levelsCalculator.close();
        await this.badgeSystem.close();
        await this.notificationSystem.close();
    }
}

module.exports = LevelsChallengesIntegration;