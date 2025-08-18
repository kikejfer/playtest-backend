const { Pool } = require('pg');

// Algoritmos de cálculo automático de niveles PLAYTEST
class LevelsCalculator {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
    }

    // ==================== CÁLCULO DE CONSOLIDACIÓN ====================

    async calculateUserConsolidation(userId, blockId) {
        try {
            const result = await this.pool.query(`
                SELECT calculate_user_consolidation($1, $2) as consolidation
            `, [userId, blockId]);

            return parseFloat(result.rows[0].consolidation) || 0;
        } catch (error) {
            console.error('Error calculating user consolidation:', error);
            return 0;
        }
    }

    async calculateAllUserConsolidations(userId) {
        try {
            // Obtener todos los bloques en los que el usuario ha participado
            const blocksResult = await this.pool.query(`
                SELECT DISTINCT q.block_id
                FROM user_answers ua
                JOIN questions q ON ua.question_id = q.id
                WHERE ua.user_id = $1
            `, [userId]);

            const consolidations = {};

            for (const block of blocksResult.rows) {
                const consolidation = await this.calculateUserConsolidation(userId, block.block_id);
                consolidations[block.block_id] = consolidation;
            }

            return consolidations;
        } catch (error) {
            console.error('Error calculating all user consolidations:', error);
            return {};
        }
    }

    // ==================== CÁLCULO DE USUARIOS ACTIVOS ====================

    async calculateActiveUsersForCreator(creatorId, days = 30) {
        try {
            const result = await this.pool.query(`
                SELECT count_active_users_for_creator($1, $2) as active_users
            `, [creatorId, days]);

            return parseInt(result.rows[0].active_users) || 0;
        } catch (error) {
            console.error('Error calculating active users for creator:', error);
            return 0;
        }
    }

    async calculateActiveStudentsForTeacher(teacherId, days = 30) {
        try {
            const result = await this.pool.query(`
                SELECT count_active_students_for_teacher($1, $2) as active_students
            `, [teacherId, days]);

            return parseInt(result.rows[0].active_students) || 0;
        } catch (error) {
            console.error('Error calculating active students for teacher:', error);
            return 0;
        }
    }

    // ==================== DETERMINACIÓN DE NIVELES ====================

    async determineUserLevel(consolidationPercentage) {
        try {
            const result = await this.pool.query(`
                SELECT id, level_name, level_order, min_threshold, max_threshold, benefits
                FROM level_definitions
                WHERE level_type = 'user'
                    AND $1 >= min_threshold
                    AND (max_threshold IS NULL OR $1 <= max_threshold)
                ORDER BY level_order DESC
                LIMIT 1
            `, [consolidationPercentage]);

            if (result.rows.length === 0) {
                // Devolver nivel más bajo por defecto
                const defaultResult = await this.pool.query(`
                    SELECT id, level_name, level_order, min_threshold, max_threshold, benefits
                    FROM level_definitions
                    WHERE level_type = 'user'
                    ORDER BY level_order ASC
                    LIMIT 1
                `);
                return defaultResult.rows[0] || null;
            }

            return result.rows[0];
        } catch (error) {
            console.error('Error determining user level:', error);
            return null;
        }
    }

    async determineCreatorLevel(activeUsers) {
        try {
            const result = await this.pool.query(`
                SELECT id, level_name, level_order, min_threshold, max_threshold, weekly_luminarias, benefits
                FROM level_definitions
                WHERE level_type = 'creator'
                    AND $1 >= min_threshold
                    AND (max_threshold IS NULL OR $1 <= max_threshold)
                ORDER BY level_order DESC
                LIMIT 1
            `, [activeUsers]);

            return result.rows[0] || null;
        } catch (error) {
            console.error('Error determining creator level:', error);
            return null;
        }
    }

    async determineTeacherLevel(activeStudents) {
        try {
            const result = await this.pool.query(`
                SELECT id, level_name, level_order, min_threshold, max_threshold, weekly_luminarias, benefits
                FROM level_definitions
                WHERE level_type = 'teacher'
                    AND $1 >= min_threshold
                    AND (max_threshold IS NULL OR $1 <= max_threshold)
                ORDER BY level_order DESC
                LIMIT 1
            `, [activeStudents]);

            return result.rows[0] || null;
        } catch (error) {
            console.error('Error determining teacher level:', error);
            return null;
        }
    }

    // ==================== ACTUALIZACIÓN DE NIVELES ====================

    async updateUserLevelForBlock(userId, blockId, forceRecalculate = false) {
        try {
            // Calcular consolidación actual
            const consolidation = await this.calculateUserConsolidation(userId, blockId);
            
            // Determinar nivel correspondiente
            const newLevel = await this.determineUserLevel(consolidation);
            
            if (!newLevel) {
                console.warn(`No level found for user ${userId} block ${blockId} with consolidation ${consolidation}%`);
                return null;
            }

            // Obtener nivel actual
            const currentLevelResult = await this.pool.query(`
                SELECT current_level_id, current_metrics
                FROM user_levels
                WHERE user_id = $1 AND level_type = 'user' AND block_id = $2
            `, [userId, blockId]);

            const currentLevel = currentLevelResult.rows[0];
            const hasLevelChanged = !currentLevel || currentLevel.current_level_id !== newLevel.id;

            // Actualizar nivel si ha cambiado o si se fuerza recálculo
            if (hasLevelChanged || forceRecalculate) {
                await this.pool.query(`
                    INSERT INTO user_levels (user_id, level_type, block_id, current_level_id, current_metrics, achieved_at)
                    VALUES ($1, 'user', $2, $3, $4, CURRENT_TIMESTAMP)
                    ON CONFLICT (user_id, level_type, block_id) DO UPDATE SET
                        current_level_id = EXCLUDED.current_level_id,
                        current_metrics = EXCLUDED.current_metrics,
                        achieved_at = EXCLUDED.achieved_at,
                        last_calculated = CURRENT_TIMESTAMP
                `, [
                    userId, 
                    blockId, 
                    newLevel.id, 
                    JSON.stringify({ 
                        consolidation: consolidation,
                        calculated_at: new Date().toISOString(),
                        level_name: newLevel.level_name 
                    })
                ]);

                // Registrar progresión si hay cambio de nivel
                if (hasLevelChanged && currentLevel) {
                    await this.pool.query(`
                        INSERT INTO level_progression_history (
                            user_id, level_type, block_id, previous_level_id, new_level_id, 
                            promotion_metrics, promoted_at
                        ) VALUES ($1, 'user', $2, $3, $4, $5, CURRENT_TIMESTAMP)
                    `, [
                        userId, 
                        blockId, 
                        currentLevel.current_level_id, 
                        newLevel.id,
                        JSON.stringify({
                            consolidation: consolidation,
                            previous_consolidation: currentLevel.current_metrics?.consolidation || 0,
                            trigger: 'manual_recalculation'
                        })
                    ]);

                    console.log(`User ${userId} level updated for block ${blockId}: ${newLevel.level_name} (${consolidation}%)`);
                }

                return {
                    level: newLevel,
                    consolidation: consolidation,
                    changed: hasLevelChanged,
                    previous_level: currentLevel?.current_level_id || null
                };
            }

            return {
                level: newLevel,
                consolidation: consolidation,
                changed: false,
                previous_level: null
            };

        } catch (error) {
            console.error('Error updating user level for block:', error);
            throw error;
        }
    }

    async updateCreatorLevel(userId, forceRecalculate = false) {
        try {
            // Calcular usuarios activos
            const activeUsers = await this.calculateActiveUsersForCreator(userId);
            
            // Determinar nivel correspondiente
            const newLevel = await this.determineCreatorLevel(activeUsers);
            
            if (!newLevel) {
                console.warn(`No creator level found for user ${userId} with ${activeUsers} active users`);
                return null;
            }

            // Obtener nivel actual
            const currentLevelResult = await this.pool.query(`
                SELECT current_level_id, current_metrics
                FROM user_levels
                WHERE user_id = $1 AND level_type = 'creator'
            `, [userId]);

            const currentLevel = currentLevelResult.rows[0];
            const hasLevelChanged = !currentLevel || currentLevel.current_level_id !== newLevel.id;

            // Actualizar nivel si ha cambiado o si se fuerza recálculo
            if (hasLevelChanged || forceRecalculate) {
                await this.pool.query(`
                    INSERT INTO user_levels (user_id, level_type, current_level_id, current_metrics, achieved_at)
                    VALUES ($1, 'creator', $2, $3, CURRENT_TIMESTAMP)
                    ON CONFLICT (user_id, level_type, block_id) DO UPDATE SET
                        current_level_id = EXCLUDED.current_level_id,
                        current_metrics = EXCLUDED.current_metrics,
                        achieved_at = EXCLUDED.achieved_at,
                        last_calculated = CURRENT_TIMESTAMP
                `, [
                    userId, 
                    newLevel.id, 
                    JSON.stringify({ 
                        active_users: activeUsers,
                        calculated_at: new Date().toISOString(),
                        level_name: newLevel.level_name 
                    })
                ]);

                // Registrar progresión si hay cambio de nivel
                if (hasLevelChanged && currentLevel) {
                    await this.pool.query(`
                        INSERT INTO level_progression_history (
                            user_id, level_type, previous_level_id, new_level_id, 
                            promotion_metrics, promoted_at
                        ) VALUES ($1, 'creator', $2, $3, $4, CURRENT_TIMESTAMP)
                    `, [
                        userId, 
                        currentLevel.current_level_id, 
                        newLevel.id,
                        JSON.stringify({
                            active_users: activeUsers,
                            previous_active_users: currentLevel.current_metrics?.active_users || 0,
                            trigger: 'manual_recalculation'
                        })
                    ]);

                    console.log(`Creator ${userId} level updated: ${newLevel.level_name} (${activeUsers} active users)`);
                }

                return {
                    level: newLevel,
                    active_users: activeUsers,
                    changed: hasLevelChanged,
                    previous_level: currentLevel?.current_level_id || null
                };
            }

            return {
                level: newLevel,
                active_users: activeUsers,
                changed: false,
                previous_level: null
            };

        } catch (error) {
            console.error('Error updating creator level:', error);
            throw error;
        }
    }

    async updateTeacherLevel(userId, forceRecalculate = false) {
        try {
            // Calcular estudiantes activos
            const activeStudents = await this.calculateActiveStudentsForTeacher(userId);
            
            // Determinar nivel correspondiente
            const newLevel = await this.determineTeacherLevel(activeStudents);
            
            if (!newLevel) {
                console.warn(`No teacher level found for user ${userId} with ${activeStudents} active students`);
                return null;
            }

            // Obtener nivel actual
            const currentLevelResult = await this.pool.query(`
                SELECT current_level_id, current_metrics
                FROM user_levels
                WHERE user_id = $1 AND level_type = 'teacher'
            `, [userId]);

            const currentLevel = currentLevelResult.rows[0];
            const hasLevelChanged = !currentLevel || currentLevel.current_level_id !== newLevel.id;

            // Actualizar nivel si ha cambiado o si se fuerza recálculo
            if (hasLevelChanged || forceRecalculate) {
                await this.pool.query(`
                    INSERT INTO user_levels (user_id, level_type, current_level_id, current_metrics, achieved_at)
                    VALUES ($1, 'teacher', $2, $3, CURRENT_TIMESTAMP)
                    ON CONFLICT (user_id, level_type, block_id) DO UPDATE SET
                        current_level_id = EXCLUDED.current_level_id,
                        current_metrics = EXCLUDED.current_metrics,
                        achieved_at = EXCLUDED.achieved_at,
                        last_calculated = CURRENT_TIMESTAMP
                `, [
                    userId, 
                    newLevel.id, 
                    JSON.stringify({ 
                        active_students: activeStudents,
                        calculated_at: new Date().toISOString(),
                        level_name: newLevel.level_name 
                    })
                ]);

                // Registrar progresión si hay cambio de nivel
                if (hasLevelChanged && currentLevel) {
                    await this.pool.query(`
                        INSERT INTO level_progression_history (
                            user_id, level_type, previous_level_id, new_level_id, 
                            promotion_metrics, promoted_at
                        ) VALUES ($1, 'teacher', $2, $3, $4, CURRENT_TIMESTAMP)
                    `, [
                        userId, 
                        currentLevel.current_level_id, 
                        newLevel.id,
                        JSON.stringify({
                            active_students: activeStudents,
                            previous_active_students: currentLevel.current_metrics?.active_students || 0,
                            trigger: 'manual_recalculation'
                        })
                    ]);

                    console.log(`Teacher ${userId} level updated: ${newLevel.level_name} (${activeStudents} active students)`);
                }

                return {
                    level: newLevel,
                    active_students: activeStudents,
                    changed: hasLevelChanged,
                    previous_level: currentLevel?.current_level_id || null
                };
            }

            return {
                level: newLevel,
                active_students: activeStudents,
                changed: false,
                previous_level: null
            };

        } catch (error) {
            console.error('Error updating teacher level:', error);
            throw error;
        }
    }

    // ==================== ACTUALIZACIÓN MASIVA ====================

    async updateAllUserLevels(userId) {
        try {
            console.log(`Updating all levels for user ${userId}...`);

            const results = {
                user_levels: {},
                creator_level: null,
                teacher_level: null,
                notifications_needed: []
            };

            // Actualizar niveles de usuario por bloque
            const userBlocksResult = await this.pool.query(`
                SELECT DISTINCT q.block_id, b.title
                FROM user_answers ua
                JOIN questions q ON ua.question_id = q.id
                JOIN blocks b ON q.block_id = b.id
                WHERE ua.user_id = $1
            `, [userId]);

            for (const block of userBlocksResult.rows) {
                const updateResult = await this.updateUserLevelForBlock(userId, block.block_id, true);
                if (updateResult) {
                    results.user_levels[block.block_id] = {
                        ...updateResult,
                        block_title: block.title
                    };
                    
                    if (updateResult.changed) {
                        results.notifications_needed.push({
                            type: 'user_level_up',
                            block_id: block.block_id,
                            block_title: block.title,
                            new_level: updateResult.level.level_name,
                            consolidation: updateResult.consolidation
                        });
                    }
                }
            }

            // Actualizar nivel de creador
            const creatorResult = await this.updateCreatorLevel(userId, true);
            if (creatorResult) {
                results.creator_level = creatorResult;
                
                if (creatorResult.changed) {
                    results.notifications_needed.push({
                        type: 'creator_level_up',
                        new_level: creatorResult.level.level_name,
                        active_users: creatorResult.active_users,
                        weekly_luminarias: creatorResult.level.weekly_luminarias
                    });
                }
            }

            // Actualizar nivel de profesor
            const teacherResult = await this.updateTeacherLevel(userId, true);
            if (teacherResult) {
                results.teacher_level = teacherResult;
                
                if (teacherResult.changed) {
                    results.notifications_needed.push({
                        type: 'teacher_level_up',
                        new_level: teacherResult.level.level_name,
                        active_students: teacherResult.active_students,
                        weekly_luminarias: teacherResult.level.weekly_luminarias
                    });
                }
            }

            console.log(`Level update completed for user ${userId}. ${results.notifications_needed.length} notifications needed.`);

            return results;

        } catch (error) {
            console.error('Error updating all user levels:', error);
            throw error;
        }
    }

    // ==================== CÁLCULOS PERIÓDICOS ====================

    async runPeriodicLevelCalculations() {
        try {
            console.log('Starting periodic level calculations...');

            // Obtener usuarios que han tenido actividad reciente
            const activeUsersResult = await this.pool.query(`
                SELECT DISTINCT u.id, u.nickname
                FROM users u
                WHERE u.id IN (
                    SELECT DISTINCT ua.user_id 
                    FROM user_answers ua 
                    WHERE ua.answered_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
                )
                OR u.id IN (
                    SELECT DISTINCT g.created_by 
                    FROM games g 
                    WHERE g.created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
                )
                OR u.id IN (
                    SELECT DISTINCT b.creator_id 
                    FROM blocks b 
                    WHERE b.created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
                )
            `);

            let updatedUsers = 0;
            let levelChanges = 0;

            for (const user of activeUsersResult.rows) {
                try {
                    const results = await this.updateAllUserLevels(user.id);
                    updatedUsers++;

                    // Contar cambios de nivel
                    if (results.notifications_needed.length > 0) {
                        levelChanges += results.notifications_needed.length;
                        
                        // Aquí se pueden enviar notificaciones
                        // await this.sendLevelChangeNotifications(user.id, results.notifications_needed);
                    }

                } catch (error) {
                    console.error(`Error updating levels for user ${user.id}:`, error);
                }
            }

            console.log(`Periodic level calculations completed: ${updatedUsers} users updated, ${levelChanges} level changes`);

            return {
                users_processed: updatedUsers,
                level_changes: levelChanges,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('Error in periodic level calculations:', error);
            throw error;
        }
    }

    // ==================== MÉTRICAS Y ESTADÍSTICAS ====================

    async getLevelDistribution() {
        try {
            const result = await this.pool.query(`
                SELECT 
                    ul.level_type,
                    ld.level_name,
                    ld.level_order,
                    COUNT(ul.user_id) as user_count,
                    CASE 
                        WHEN ul.level_type = 'user' THEN COUNT(ul.user_id)
                        ELSE COUNT(DISTINCT ul.user_id)
                    END as unique_users
                FROM user_levels ul
                JOIN level_definitions ld ON ul.current_level_id = ld.id
                GROUP BY ul.level_type, ld.level_name, ld.level_order
                ORDER BY ul.level_type, ld.level_order
            `);

            const distribution = {
                creator: [],
                teacher: [],
                user: []
            };

            for (const row of result.rows) {
                distribution[row.level_type].push({
                    level_name: row.level_name,
                    level_order: row.level_order,
                    user_count: parseInt(row.user_count),
                    unique_users: parseInt(row.unique_users)
                });
            }

            return distribution;

        } catch (error) {
            console.error('Error getting level distribution:', error);
            return { creator: [], teacher: [], user: [] };
        }
    }

    async getUserCurrentLevels(userId) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    ul.level_type,
                    ul.block_id,
                    b.title as block_title,
                    ld.level_name,
                    ld.level_order,
                    ld.description,
                    ld.benefits,
                    ld.badge_config,
                    ld.weekly_luminarias,
                    ul.current_metrics,
                    ul.achieved_at,
                    ul.last_calculated
                FROM user_levels ul
                JOIN level_definitions ld ON ul.current_level_id = ld.id
                LEFT JOIN blocks b ON ul.block_id = b.id
                WHERE ul.user_id = $1
                ORDER BY ul.level_type, b.title
            `, [userId]);

            const levels = {
                creator: null,
                teacher: null,
                user: []
            };

            for (const row of result.rows) {
                const levelData = {
                    level_name: row.level_name,
                    level_order: row.level_order,
                    description: row.description,
                    benefits: row.benefits,
                    badge_config: row.badge_config,
                    weekly_luminarias: row.weekly_luminarias,
                    current_metrics: row.current_metrics,
                    achieved_at: row.achieved_at,
                    last_calculated: row.last_calculated
                };

                if (row.level_type === 'user') {
                    levels.user.push({
                        ...levelData,
                        block_id: row.block_id,
                        block_title: row.block_title
                    });
                } else {
                    levels[row.level_type] = levelData;
                }
            }

            return levels;

        } catch (error) {
            console.error('Error getting user current levels:', error);
            return { creator: null, teacher: null, user: [] };
        }
    }

    async getUserProgressionHistory(userId, limit = 20) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    lph.level_type,
                    lph.block_id,
                    b.title as block_title,
                    prev_ld.level_name as previous_level,
                    new_ld.level_name as new_level,
                    new_ld.level_order as new_level_order,
                    lph.promotion_metrics,
                    lph.promoted_at
                FROM level_progression_history lph
                LEFT JOIN level_definitions prev_ld ON lph.previous_level_id = prev_ld.id
                JOIN level_definitions new_ld ON lph.new_level_id = new_ld.id
                LEFT JOIN blocks b ON lph.block_id = b.id
                WHERE lph.user_id = $1
                ORDER BY lph.promoted_at DESC
                LIMIT $2
            `, [userId, limit]);

            return result.rows;

        } catch (error) {
            console.error('Error getting user progression history:', error);
            return [];
        }
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = LevelsCalculator;