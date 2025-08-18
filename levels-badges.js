const { Pool } = require('pg');

// Sistema de badges y beneficios para niveles PLAYTEST
class LevelsBadgeSystem {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
    }

    // ==================== GESTIÓN DE BADGES ====================

    async createBadgeDefinitions() {
        try {
            console.log('📛 Creando definiciones de badges...');

            // Badges para usuarios (consolidación)
            const userBadges = [
                {
                    badge_type: 'user_level',
                    level_name: 'Aprendiz',
                    name: 'Primer Paso',
                    description: 'Has comenzado tu viaje de aprendizaje',
                    icon: 'rookie-shield',
                    color: '#6B7280',
                    rarity: 'common',
                    benefits: { encouragement_message: true }
                },
                {
                    badge_type: 'user_level',
                    level_name: 'Explorador',
                    name: 'Explorador Curioso',
                    description: 'Demuestras curiosidad por aprender más',
                    icon: 'explorer-compass',
                    color: '#3B82F6',
                    rarity: 'common',
                    benefits: { hint_access: true, exploration_rewards: 5 }
                },
                {
                    badge_type: 'user_level',
                    level_name: 'Estratega',
                    name: 'Mente Estratégica',
                    description: 'Dominas las estrategias de aprendizaje',
                    icon: 'strategy-crown',
                    color: '#8B5CF6',
                    rarity: 'uncommon',
                    benefits: { advanced_strategies: true, bonus_points: 10 }
                },
                {
                    badge_type: 'user_level',
                    level_name: 'Sabio',
                    name: 'Sabiduría Ancestral',
                    description: 'Posees conocimiento profundo y experiencia',
                    icon: 'wisdom-owl',
                    color: '#F59E0B',
                    rarity: 'rare',
                    benefits: { mentor_access: true, wisdom_bonus: 20, special_challenges: true }
                },
                {
                    badge_type: 'user_level',
                    level_name: 'Gran Maestro',
                    name: 'Gran Maestro',
                    description: 'Has alcanzado la maestría absoluta',
                    icon: 'grandmaster-star',
                    color: '#EF4444',
                    rarity: 'legendary',
                    benefits: { mastery_rewards: 50, legendary_status: true, exclusive_content: true }
                }
            ];

            // Badges para creadores
            const creatorBadges = [
                {
                    badge_type: 'creator_level',
                    level_name: 'Semilla',
                    name: 'Semilla Creativa',
                    description: 'Tus primeras creaciones están germinando',
                    icon: 'seed-sprout',
                    color: '#10B981',
                    rarity: 'common',
                    benefits: { creator_tools: 'basic', community_access: true }
                },
                {
                    badge_type: 'creator_level',
                    level_name: 'Chispa',
                    name: 'Chispa de Inspiración',
                    description: 'Tu creatividad comienza a brillar',
                    icon: 'spark-fire',
                    color: '#F59E0B',
                    rarity: 'common',
                    benefits: { creator_tools: 'intermediate', analytics_basic: true }
                },
                {
                    badge_type: 'creator_level',
                    level_name: 'Constructor',
                    name: 'Arquitecto del Conocimiento',
                    description: 'Construyes experiencias de aprendizaje sólidas',
                    icon: 'architect-hammer',
                    color: '#3B82F6',
                    rarity: 'uncommon',
                    benefits: { creator_tools: 'advanced', analytics_full: true, template_library: true }
                },
                {
                    badge_type: 'creator_level',
                    level_name: 'Orador',
                    name: 'Voz Influyente',
                    description: 'Tu mensaje llega a una audiencia amplia',
                    icon: 'speaker-megaphone',
                    color: '#8B5CF6',
                    rarity: 'rare',
                    benefits: { influencer_tools: true, priority_support: true, featured_content: true }
                },
                {
                    badge_type: 'creator_level',
                    level_name: 'Visionario',
                    name: 'Visionario Digital',
                    description: 'Lideras el futuro del aprendizaje',
                    icon: 'visionary-eye',
                    color: '#EF4444',
                    rarity: 'legendary',
                    benefits: { beta_features: true, direct_feedback: true, revenue_share: true }
                }
            ];

            // Badges para profesores
            const teacherBadges = [
                {
                    badge_type: 'teacher_level',
                    level_name: 'Guía',
                    name: 'Guía Sabio',
                    description: 'Iluminas el camino del aprendizaje',
                    icon: 'guide-lantern',
                    color: '#10B981',
                    rarity: 'common',
                    benefits: { student_management: 'basic', progress_tracking: true }
                },
                {
                    badge_type: 'teacher_level',
                    level_name: 'Instructor',
                    name: 'Instructor Experto',
                    description: 'Tu enseñanza marca la diferencia',
                    icon: 'instructor-book',
                    color: '#3B82F6',
                    rarity: 'common',
                    benefits: { student_management: 'advanced', custom_assignments: true }
                },
                {
                    badge_type: 'teacher_level',
                    level_name: 'Consejero',
                    name: 'Consejero de Sabiduría',
                    description: 'Aconsejas con sabiduría y experiencia',
                    icon: 'counselor-scales',
                    color: '#8B5CF6',
                    rarity: 'uncommon',
                    benefits: { mentoring_tools: true, advanced_reports: true, collaboration_features: true }
                },
                {
                    badge_type: 'teacher_level',
                    level_name: 'Erudito',
                    name: 'Erudito Académico',
                    description: 'Tu conocimiento es vasto y profundo',
                    icon: 'scholar-scroll',
                    color: '#F59E0B',
                    rarity: 'rare',
                    benefits: { research_tools: true, academic_network: true, publication_rights: true }
                },
                {
                    badge_type: 'teacher_level',
                    level_name: 'Maestro Jedi',
                    name: 'Maestro Jedi',
                    description: 'Has alcanzado la maestría en la enseñanza',
                    icon: 'jedi-lightsaber',
                    color: '#EF4444',
                    rarity: 'legendary',
                    benefits: { jedi_powers: true, institutional_partnership: true, legacy_building: true }
                }
            ];

            // Badges especiales de logros
            const achievementBadges = [
                {
                    badge_type: 'achievement',
                    name: 'Perfeccionista',
                    description: 'Alcanzaste 100% de consolidación en un bloque',
                    icon: 'perfect-diamond',
                    color: '#EF4444',
                    rarity: 'rare',
                    trigger_condition: { consolidation: 100, block_completion: true },
                    benefits: { perfectionist_rewards: 25, prestige_points: 10 }
                },
                {
                    badge_type: 'achievement',
                    name: 'Maratonista',
                    description: 'Completaste 10 bloques en un mes',
                    icon: 'marathon-trophy',
                    color: '#F59E0B',
                    rarity: 'uncommon',
                    trigger_condition: { blocks_per_month: 10 },
                    benefits: { endurance_bonus: 15, marathon_perks: true }
                },
                {
                    badge_type: 'achievement',
                    name: 'Racha de Fuego',
                    description: 'Mantuviste actividad diaria por 30 días',
                    icon: 'fire-streak',
                    color: '#EF4444',
                    rarity: 'rare',
                    trigger_condition: { daily_streak: 30 },
                    benefits: { streak_multiplier: 1.5, daily_rewards: 5 }
                },
                {
                    badge_type: 'achievement',
                    name: 'Mentor Comunitario',
                    description: 'Ayudaste a 50 usuarios a subir de nivel',
                    icon: 'mentor-helping-hands',
                    color: '#8B5CF6',
                    rarity: 'epic',
                    trigger_condition: { users_helped: 50 },
                    benefits: { mentor_status: true, community_rewards: 100 }
                },
                {
                    badge_type: 'achievement',
                    name: 'Innovador',
                    description: 'Creaste contenido usado por más de 1000 usuarios',
                    icon: 'innovator-lightbulb',
                    color: '#10B981',
                    rarity: 'epic',
                    trigger_condition: { content_reach: 1000 },
                    benefits: { innovation_bonus: 200, featured_creator: true }
                },
                {
                    badge_type: 'achievement',
                    name: 'Leyenda de PLAYTEST',
                    description: 'Alcanzaste el nivel máximo en los tres tipos',
                    icon: 'legend-crown',
                    color: '#F59E0B',
                    rarity: 'legendary',
                    trigger_condition: { all_max_levels: true },
                    benefits: { legend_status: true, lifetime_benefits: true, hall_of_fame: true }
                }
            ];

            const allBadges = [...userBadges, ...creatorBadges, ...teacherBadges, ...achievementBadges];

            for (const badge of allBadges) {
                await this.pool.query(`
                    INSERT INTO badge_definitions (
                        badge_type, level_name, name, description, icon, color, rarity,
                        trigger_condition, benefits, created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
                    ON CONFLICT (name) DO UPDATE SET
                        description = EXCLUDED.description,
                        benefits = EXCLUDED.benefits,
                        trigger_condition = EXCLUDED.trigger_condition
                `, [
                    badge.badge_type,
                    badge.level_name || null,
                    badge.name,
                    badge.description,
                    badge.icon,
                    badge.color,
                    badge.rarity,
                    JSON.stringify(badge.trigger_condition || {}),
                    JSON.stringify(badge.benefits)
                ]);
            }

            console.log(`✅ ${allBadges.length} definiciones de badges creadas`);

        } catch (error) {
            console.error('Error creating badge definitions:', error);
            throw error;
        }
    }

    async awardLevelBadge(userId, levelType, levelName) {
        try {
            // Buscar badge correspondiente al nivel
            const badgeResult = await this.pool.query(`
                SELECT * FROM badge_definitions 
                WHERE badge_type = $1 AND level_name = $2
            `, [`${levelType}_level`, levelName]);

            if (badgeResult.rows.length === 0) {
                console.log(`No badge found for ${levelType} level ${levelName}`);
                return null;
            }

            const badge = badgeResult.rows[0];

            // Verificar si el usuario ya tiene este badge
            const existingBadge = await this.pool.query(`
                SELECT id FROM user_badges 
                WHERE user_id = $1 AND badge_id = $2
            `, [userId, badge.id]);

            if (existingBadge.rows.length > 0) {
                return null; // Ya tiene el badge
            }

            // Otorgar badge
            const result = await this.pool.query(`
                INSERT INTO user_badges (user_id, badge_id, earned_at, metadata)
                VALUES ($1, $2, CURRENT_TIMESTAMP, $3)
                RETURNING id
            `, [
                userId,
                badge.id,
                JSON.stringify({
                    level_type: levelType,
                    level_name: levelName,
                    earned_date: new Date().toISOString()
                })
            ]);

            // Activar beneficios del badge
            await this.activateBadgeBenefits(userId, badge);

            console.log(`🏆 Badge "${badge.name}" otorgado a usuario ${userId}`);

            return {
                badge_id: result.rows[0].id,
                badge_name: badge.name,
                badge_description: badge.description,
                benefits: badge.benefits
            };

        } catch (error) {
            console.error('Error awarding level badge:', error);
            return null;
        }
    }

    async checkAndAwardAchievementBadges(userId, achievementData) {
        try {
            // Obtener badges de logros que podrían aplicar
            const achievementBadges = await this.pool.query(`
                SELECT * FROM badge_definitions 
                WHERE badge_type = 'achievement'
            `);

            const awardedBadges = [];

            for (const badge of achievementBadges.rows) {
                const condition = badge.trigger_condition || {};
                let shouldAward = false;

                // Verificar si ya tiene el badge
                const existingBadge = await this.pool.query(`
                    SELECT id FROM user_badges 
                    WHERE user_id = $1 AND badge_id = $2
                `, [userId, badge.id]);

                if (existingBadge.rows.length > 0) {
                    continue; // Ya tiene el badge
                }

                // Evaluar condiciones específicas
                if (condition.consolidation && achievementData.consolidation >= condition.consolidation) {
                    shouldAward = true;
                }

                if (condition.daily_streak && achievementData.daily_streak >= condition.daily_streak) {
                    shouldAward = true;
                }

                if (condition.blocks_per_month && achievementData.blocks_completed_month >= condition.blocks_per_month) {
                    shouldAward = true;
                }

                if (condition.users_helped && achievementData.users_helped >= condition.users_helped) {
                    shouldAward = true;
                }

                if (condition.content_reach && achievementData.content_reach >= condition.content_reach) {
                    shouldAward = true;
                }

                if (condition.all_max_levels && achievementData.all_max_levels) {
                    shouldAward = true;
                }

                if (shouldAward) {
                    const badgeAwarded = await this.awardAchievementBadge(userId, badge, achievementData);
                    if (badgeAwarded) {
                        awardedBadges.push(badgeAwarded);
                    }
                }
            }

            return awardedBadges;

        } catch (error) {
            console.error('Error checking achievement badges:', error);
            return [];
        }
    }

    async awardAchievementBadge(userId, badge, achievementData) {
        try {
            const result = await this.pool.query(`
                INSERT INTO user_badges (user_id, badge_id, earned_at, metadata)
                VALUES ($1, $2, CURRENT_TIMESTAMP, $3)
                RETURNING id
            `, [
                userId,
                badge.id,
                JSON.stringify({
                    achievement_data: achievementData,
                    earned_date: new Date().toISOString()
                })
            ]);

            // Activar beneficios del badge
            await this.activateBadgeBenefits(userId, badge);

            console.log(`🎖️ Badge de logro "${badge.name}" otorgado a usuario ${userId}`);

            return {
                badge_id: result.rows[0].id,
                badge_name: badge.name,
                badge_description: badge.description,
                rarity: badge.rarity,
                benefits: badge.benefits
            };

        } catch (error) {
            console.error('Error awarding achievement badge:', error);
            return null;
        }
    }

    // ==================== GESTIÓN DE BENEFICIOS ====================

    async activateBadgeBenefits(userId, badge) {
        try {
            const benefits = badge.benefits || {};

            for (const [benefitType, benefitValue] of Object.entries(benefits)) {
                await this.pool.query(`
                    INSERT INTO user_level_benefits (
                        user_id, level_type, benefit_type, benefit_data, 
                        is_active, activated_at
                    ) VALUES ($1, $2, $3, $4, true, CURRENT_TIMESTAMP)
                    ON CONFLICT (user_id, benefit_type) DO UPDATE SET
                        benefit_data = EXCLUDED.benefit_data,
                        is_active = true,
                        activated_at = EXCLUDED.activated_at
                `, [
                    userId,
                    badge.badge_type,
                    benefitType,
                    JSON.stringify({
                        value: benefitValue,
                        source: 'badge',
                        badge_name: badge.name
                    })
                ]);
            }

            console.log(`✅ Beneficios del badge "${badge.name}" activados para usuario ${userId}`);

        } catch (error) {
            console.error('Error activating badge benefits:', error);
        }
    }

    async getUserBadges(userId) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    ub.id as user_badge_id,
                    ub.earned_at,
                    ub.metadata,
                    bd.name,
                    bd.description,
                    bd.icon,
                    bd.color,
                    bd.rarity,
                    bd.badge_type,
                    bd.level_name,
                    bd.benefits
                FROM user_badges ub
                JOIN badge_definitions bd ON ub.badge_id = bd.id
                WHERE ub.user_id = $1
                ORDER BY ub.earned_at DESC
            `, [userId]);

            return result.rows;

        } catch (error) {
            console.error('Error getting user badges:', error);
            return [];
        }
    }

    async getUserActiveBenefits(userId) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    benefit_type,
                    benefit_data,
                    activated_at,
                    expires_at
                FROM user_level_benefits
                WHERE user_id = $1 
                    AND is_active = true
                    AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
                ORDER BY activated_at DESC
            `, [userId]);

            return result.rows;

        } catch (error) {
            console.error('Error getting user active benefits:', error);
            return [];
        }
    }

    async getBadgeStatistics() {
        try {
            const result = await this.pool.query(`
                SELECT 
                    bd.badge_type,
                    bd.rarity,
                    bd.name,
                    COUNT(ub.id) as earned_count,
                    COUNT(DISTINCT ub.user_id) as unique_earners,
                    MIN(ub.earned_at) as first_earned,
                    MAX(ub.earned_at) as last_earned
                FROM badge_definitions bd
                LEFT JOIN user_badges ub ON bd.id = ub.badge_id
                GROUP BY bd.id, bd.badge_type, bd.rarity, bd.name
                ORDER BY bd.badge_type, earned_count DESC
            `);

            return result.rows;

        } catch (error) {
            console.error('Error getting badge statistics:', error);
            return [];
        }
    }

    // ==================== SISTEMA DE COLECCIÓN ====================

    async getUserBadgeCollection(userId) {
        try {
            // Obtener badges obtenidos
            const earnedBadges = await this.getUserBadges(userId);

            // Obtener todos los badges disponibles para mostrar progreso
            const allBadges = await this.pool.query(`
                SELECT 
                    id,
                    badge_type,
                    level_name,
                    name,
                    description,
                    icon,
                    color,
                    rarity,
                    trigger_condition
                FROM badge_definitions
                ORDER BY badge_type, 
                    CASE 
                        WHEN badge_type LIKE '%_level' THEN 
                            (SELECT level_order FROM level_definitions WHERE level_name = badge_definitions.level_name LIMIT 1)
                        ELSE 0 
                    END
            `);

            const collection = {
                earned: earnedBadges,
                available: allBadges.rows,
                statistics: {
                    total_earned: earnedBadges.length,
                    total_available: allBadges.rows.length,
                    completion_percentage: (earnedBadges.length / allBadges.rows.length * 100).toFixed(1),
                    rarity_counts: this.calculateRarityCount(earnedBadges)
                }
            };

            return collection;

        } catch (error) {
            console.error('Error getting user badge collection:', error);
            return { earned: [], available: [], statistics: {} };
        }
    }

    calculateRarityCount(badges) {
        const counts = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
        
        for (const badge of badges) {
            if (counts.hasOwnProperty(badge.rarity)) {
                counts[badge.rarity]++;
            }
        }

        return counts;
    }

    async getBadgeLeaderboard(badgeType = null, limit = 50) {
        try {
            const whereClause = badgeType ? 'AND bd.badge_type = $2' : '';
            const params = [limit];
            if (badgeType) params.push(badgeType);

            const result = await this.pool.query(`
                SELECT 
                    u.id,
                    u.nickname,
                    COUNT(ub.id) as total_badges,
                    COUNT(CASE WHEN bd.rarity = 'legendary' THEN 1 END) as legendary_badges,
                    COUNT(CASE WHEN bd.rarity = 'epic' THEN 1 END) as epic_badges,
                    COUNT(CASE WHEN bd.rarity = 'rare' THEN 1 END) as rare_badges,
                    MAX(ub.earned_at) as latest_badge_earned
                FROM users u
                JOIN user_badges ub ON u.id = ub.user_id
                JOIN badge_definitions bd ON ub.badge_id = bd.id
                WHERE 1=1 ${whereClause}
                GROUP BY u.id, u.nickname
                ORDER BY 
                    legendary_badges DESC,
                    epic_badges DESC,
                    rare_badges DESC,
                    total_badges DESC
                LIMIT $1
            `, params);

            return result.rows;

        } catch (error) {
            console.error('Error getting badge leaderboard:', error);
            return [];
        }
    }

    // ==================== FUNCIONES DE UTILIDAD ====================

    async calculateAchievementData(userId) {
        try {
            // Calcular métricas para badges de logros
            const consolidationResult = await this.pool.query(`
                SELECT MAX(
                    CASE WHEN ul.current_metrics ? 'consolidation' 
                    THEN (ul.current_metrics->>'consolidation')::decimal 
                    ELSE 0 END
                ) as max_consolidation
                FROM user_levels ul
                WHERE ul.user_id = $1 AND ul.level_type = 'user'
            `, [userId]);

            const streakResult = await this.pool.query(`
                SELECT MAX(
                    CASE WHEN uam.metric_date >= CURRENT_DATE - INTERVAL '30 days' 
                    THEN 1 ELSE 0 END
                ) as current_streak
                FROM user_activity_metrics uam
                WHERE uam.user_id = $1
                GROUP BY uam.metric_date
                HAVING COUNT(*) > 0
            `, [userId]);

            const blocksThisMonthResult = await this.pool.query(`
                SELECT COUNT(DISTINCT ul.block_id) as blocks_this_month
                FROM user_levels ul
                WHERE ul.user_id = $1 
                    AND ul.level_type = 'user'
                    AND ul.achieved_at >= DATE_TRUNC('month', CURRENT_DATE)
            `, [userId]);

            const contentReachResult = await this.pool.query(`
                SELECT COALESCE(SUM(
                    CASE WHEN ul.current_metrics ? 'active_users' 
                    THEN (ul.current_metrics->>'active_users')::decimal 
                    ELSE 0 END
                ), 0) as content_reach
                FROM user_levels ul
                WHERE ul.user_id = $1 AND ul.level_type = 'creator'
            `, [userId]);

            const maxLevelsResult = await this.pool.query(`
                SELECT 
                    COUNT(CASE WHEN ul.level_type = 'user' AND ld.level_order = 5 THEN 1 END) > 0 as max_user,
                    COUNT(CASE WHEN ul.level_type = 'creator' AND ld.level_order = 5 THEN 1 END) > 0 as max_creator,
                    COUNT(CASE WHEN ul.level_type = 'teacher' AND ld.level_order = 5 THEN 1 END) > 0 as max_teacher
                FROM user_levels ul
                JOIN level_definitions ld ON ul.current_level_id = ld.id
                WHERE ul.user_id = $1
            `, [userId]);

            const maxLevels = maxLevelsResult.rows[0];
            const allMaxLevels = maxLevels.max_user && maxLevels.max_creator && maxLevels.max_teacher;

            return {
                consolidation: parseFloat(consolidationResult.rows[0]?.max_consolidation) || 0,
                daily_streak: 0, // Simplificado por ahora
                blocks_completed_month: parseInt(blocksThisMonthResult.rows[0]?.blocks_this_month) || 0,
                content_reach: parseFloat(contentReachResult.rows[0]?.content_reach) || 0,
                users_helped: 0, // Requiere implementación adicional
                all_max_levels: allMaxLevels
            };

        } catch (error) {
            console.error('Error calculating achievement data:', error);
            return {};
        }
    }

    async cleanupExpiredBenefits() {
        try {
            const result = await this.pool.query(`
                UPDATE user_level_benefits 
                SET is_active = false 
                WHERE expires_at IS NOT NULL 
                    AND expires_at <= CURRENT_TIMESTAMP 
                    AND is_active = true
                RETURNING id
            `);

            console.log(`🧹 ${result.rows.length} beneficios expirados desactivados`);
            return result.rows.length;

        } catch (error) {
            console.error('Error cleaning up expired benefits:', error);
            return 0;
        }
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = LevelsBadgeSystem;