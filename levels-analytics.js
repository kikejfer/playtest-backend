const { Pool } = require('pg');

// Sistema de analytics y estadísticas para niveles PLAYTEST
class LevelsAnalytics {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
    }

    // ==================== DASHBOARD DE MÉTRICAS ====================

    async getDashboardMetrics(dateRange = 30) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    COUNT(DISTINCT ul.user_id) as total_users_with_levels,
                    COUNT(DISTINCT CASE WHEN ul.level_type = 'creator' THEN ul.user_id END) as active_creators,
                    COUNT(DISTINCT CASE WHEN ul.level_type = 'teacher' THEN ul.user_id END) as active_teachers,
                    COUNT(DISTINCT CASE WHEN ul.level_type = 'user' THEN ul.user_id END) as users_with_progress,
                    
                    -- Progresión reciente
                    COUNT(DISTINCT CASE WHEN lph.promoted_at >= CURRENT_TIMESTAMP - INTERVAL $1 THEN lph.user_id END) as recent_level_ups,
                    
                    -- Métricas de consolidación
                    COALESCE(AVG(
                        CASE WHEN ul.level_type = 'user' AND ul.current_metrics ? 'consolidation' 
                        THEN (ul.current_metrics->>'consolidation')::decimal 
                        ELSE NULL END
                    ), 0) as avg_user_consolidation,
                    
                    -- Métricas de actividad
                    COALESCE(AVG(
                        CASE WHEN ul.level_type = 'creator' AND ul.current_metrics ? 'active_users' 
                        THEN (ul.current_metrics->>'active_users')::decimal 
                        ELSE NULL END
                    ), 0) as avg_creator_active_users,
                    
                    COALESCE(AVG(
                        CASE WHEN ul.level_type = 'teacher' AND ul.current_metrics ? 'active_students' 
                        THEN (ul.current_metrics->>'active_students')::decimal 
                        ELSE NULL END
                    ), 0) as avg_teacher_active_students,
                    
                    -- Pagos
                    COALESCE(SUM(wlp.total_amount), 0) as total_luminarias_distributed,
                    COUNT(DISTINCT wlp.user_id) as users_receiving_payments
                    
                FROM user_levels ul
                LEFT JOIN level_progression_history lph ON ul.user_id = lph.user_id
                LEFT JOIN weekly_luminarias_payments wlp ON ul.user_id = wlp.user_id 
                    AND wlp.week_start_date >= CURRENT_TIMESTAMP - INTERVAL $1
                WHERE ul.last_calculated >= CURRENT_TIMESTAMP - INTERVAL $1
            `, [`${dateRange} days`]);

            return result.rows[0];

        } catch (error) {
            console.error('Error getting dashboard metrics:', error);
            return {};
        }
    }

    async getLevelDistributionMetrics() {
        try {
            const result = await this.pool.query(`
                SELECT 
                    ul.level_type,
                    ld.level_name,
                    ld.level_order,
                    COUNT(ul.user_id) as user_count,
                    ROUND(COUNT(ul.user_id) * 100.0 / SUM(COUNT(ul.user_id)) OVER (PARTITION BY ul.level_type), 2) as percentage,
                    COALESCE(AVG(ld.weekly_luminarias), 0) as avg_weekly_payment
                FROM user_levels ul
                JOIN level_definitions ld ON ul.current_level_id = ld.id
                GROUP BY ul.level_type, ld.level_name, ld.level_order, ld.weekly_luminarias
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
                    percentage: parseFloat(row.percentage),
                    avg_weekly_payment: parseFloat(row.avg_weekly_payment)
                });
            }

            return distribution;

        } catch (error) {
            console.error('Error getting level distribution metrics:', error);
            return { creator: [], teacher: [], user: [] };
        }
    }

    async getProgressionTrends(dateRange = 90) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    DATE(lph.promoted_at) as date,
                    lph.level_type,
                    COUNT(*) as level_ups,
                    COUNT(DISTINCT lph.user_id) as unique_users,
                    COUNT(CASE WHEN prev_ld.level_order < new_ld.level_order THEN 1 END) as promotions,
                    COUNT(CASE WHEN prev_ld.level_order > new_ld.level_order THEN 1 END) as demotions
                FROM level_progression_history lph
                LEFT JOIN level_definitions prev_ld ON lph.previous_level_id = prev_ld.id
                JOIN level_definitions new_ld ON lph.new_level_id = new_ld.id
                WHERE lph.promoted_at >= CURRENT_TIMESTAMP - INTERVAL $1
                GROUP BY DATE(lph.promoted_at), lph.level_type
                ORDER BY date DESC, lph.level_type
            `, [`${dateRange} days`]);

            return result.rows;

        } catch (error) {
            console.error('Error getting progression trends:', error);
            return [];
        }
    }

    // ==================== ANÁLISIS DE RENDIMIENTO ====================

    async getTopPerformers(levelType = null, metric = 'consolidation', limit = 20) {
        try {
            let query;
            let params = [limit];

            switch (levelType) {
                case 'user':
                    if (metric === 'consolidation') {
                        query = `
                            SELECT 
                                u.id,
                                u.nickname,
                                COUNT(ul.id) as total_blocks,
                                COALESCE(AVG(
                                    CASE WHEN ul.current_metrics ? 'consolidation' 
                                    THEN (ul.current_metrics->>'consolidation')::decimal 
                                    ELSE 0 END
                                ), 0) as avg_consolidation,
                                COUNT(CASE WHEN ld.level_order >= 4 THEN 1 END) as expert_blocks,
                                MAX(ld.level_order) as highest_level
                            FROM users u
                            JOIN user_levels ul ON u.id = ul.user_id
                            JOIN level_definitions ld ON ul.current_level_id = ld.id
                            WHERE ul.level_type = 'user'
                            GROUP BY u.id, u.nickname
                            HAVING COUNT(ul.id) >= 3
                            ORDER BY avg_consolidation DESC, expert_blocks DESC
                            LIMIT $1
                        `;
                    }
                    break;

                case 'creator':
                    query = `
                        SELECT 
                            u.id,
                            u.nickname,
                            ld.level_name,
                            ld.level_order,
                            COALESCE((ul.current_metrics->>'active_users')::decimal, 0) as active_users,
                            ul.achieved_at,
                            COALESCE(SUM(wlp.total_amount), 0) as total_earned
                        FROM users u
                        JOIN user_levels ul ON u.id = ul.user_id
                        JOIN level_definitions ld ON ul.current_level_id = ld.id
                        LEFT JOIN weekly_luminarias_payments wlp ON u.id = wlp.user_id AND wlp.level_type = 'creator'
                        WHERE ul.level_type = 'creator'
                        GROUP BY u.id, u.nickname, ld.level_name, ld.level_order, ul.current_metrics, ul.achieved_at
                        ORDER BY ld.level_order DESC, active_users DESC
                        LIMIT $1
                    `;
                    break;

                case 'teacher':
                    query = `
                        SELECT 
                            u.id,
                            u.nickname,
                            ld.level_name,
                            ld.level_order,
                            COALESCE((ul.current_metrics->>'active_students')::decimal, 0) as active_students,
                            ul.achieved_at,
                            COALESCE(SUM(wlp.total_amount), 0) as total_earned
                        FROM users u
                        JOIN user_levels ul ON u.id = ul.user_id
                        JOIN level_definitions ld ON ul.current_level_id = ld.id
                        LEFT JOIN weekly_luminarias_payments wlp ON u.id = wlp.user_id AND wlp.level_type = 'teacher'
                        WHERE ul.level_type = 'teacher'
                        GROUP BY u.id, u.nickname, ld.level_name, ld.level_order, ul.current_metrics, ul.achieved_at
                        ORDER BY ld.level_order DESC, active_students DESC
                        LIMIT $1
                    `;
                    break;

                default:
                    // Ranking global mixto
                    query = `
                        SELECT 
                            u.id,
                            u.nickname,
                            ul.level_type,
                            ld.level_name,
                            ld.level_order,
                            ul.current_metrics,
                            ul.achieved_at,
                            COALESCE(SUM(wlp.total_amount), 0) as total_earned
                        FROM users u
                        JOIN user_levels ul ON u.id = ul.user_id
                        JOIN level_definitions ld ON ul.current_level_id = ld.id
                        LEFT JOIN weekly_luminarias_payments wlp ON u.id = wlp.user_id
                        WHERE ul.level_type IN ('creator', 'teacher')
                        GROUP BY u.id, u.nickname, ul.level_type, ld.level_name, ld.level_order, ul.current_metrics, ul.achieved_at
                        ORDER BY ld.level_order DESC, ul.achieved_at ASC
                        LIMIT $1
                    `;
            }

            const result = await this.pool.query(query, params);
            return result.rows;

        } catch (error) {
            console.error('Error getting top performers:', error);
            return [];
        }
    }

    async getUserProgressAnalytics(userId) {
        try {
            // Progresión histórica
            const progressionResult = await this.pool.query(`
                SELECT 
                    lph.level_type,
                    lph.promoted_at,
                    prev_ld.level_name as previous_level,
                    new_ld.level_name as new_level,
                    new_ld.level_order as new_level_order,
                    lph.promotion_metrics
                FROM level_progression_history lph
                LEFT JOIN level_definitions prev_ld ON lph.previous_level_id = prev_ld.id
                JOIN level_definitions new_ld ON lph.new_level_id = new_ld.id
                WHERE lph.user_id = $1
                ORDER BY lph.promoted_at DESC
                LIMIT 50
            `, [userId]);

            // Estado actual
            const currentResult = await this.pool.query(`
                SELECT 
                    ul.level_type,
                    ul.block_id,
                    b.title as block_title,
                    ld.level_name,
                    ld.level_order,
                    ul.current_metrics,
                    ul.achieved_at,
                    ul.last_calculated
                FROM user_levels ul
                JOIN level_definitions ld ON ul.current_level_id = ld.id
                LEFT JOIN blocks b ON ul.block_id = b.id
                WHERE ul.user_id = $1
                ORDER BY ul.level_type, b.title
            `, [userId]);

            // Métricas de actividad
            const activityResult = await this.pool.query(`
                SELECT 
                    DATE(uam.metric_date) as date,
                    uam.block_id,
                    SUM(uam.sessions_count) as total_sessions,
                    SUM(uam.questions_answered) as total_questions,
                    SUM(uam.correct_answers) as total_correct,
                    AVG(uam.consolidation_percentage) as avg_consolidation
                FROM user_activity_metrics uam
                WHERE uam.user_id = $1
                    AND uam.metric_date >= CURRENT_TIMESTAMP - INTERVAL '30 days'
                GROUP BY DATE(uam.metric_date), uam.block_id
                ORDER BY date DESC
            `, [userId]);

            // Pagos recibidos
            const paymentsResult = await this.pool.query(`
                SELECT 
                    wlp.level_type,
                    wlp.week_start_date,
                    wlp.total_amount,
                    wlp.base_amount,
                    wlp.bonus_amount,
                    ld.level_name
                FROM weekly_luminarias_payments wlp
                JOIN level_definitions ld ON wlp.level_id = ld.id
                WHERE wlp.user_id = $1
                    AND wlp.payment_status = 'paid'
                ORDER BY wlp.week_start_date DESC
                LIMIT 20
            `, [userId]);

            return {
                progression_history: progressionResult.rows,
                current_levels: currentResult.rows,
                activity_metrics: activityResult.rows,
                payment_history: paymentsResult.rows
            };

        } catch (error) {
            console.error('Error getting user progress analytics:', error);
            return {};
        }
    }

    // ==================== ANÁLISIS FINANCIERO ====================

    async getPaymentAnalytics(dateRange = 90) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    wlp.level_type,
                    ld.level_name,
                    COUNT(wlp.id) as payment_count,
                    SUM(wlp.base_amount) as total_base_amount,
                    SUM(wlp.bonus_amount) as total_bonus_amount,
                    SUM(wlp.total_amount) as total_amount,
                    AVG(wlp.total_amount) as avg_payment,
                    COUNT(DISTINCT wlp.user_id) as unique_recipients,
                    COUNT(CASE WHEN wlp.payment_status = 'paid' THEN 1 END) as successful_payments,
                    COUNT(CASE WHEN wlp.payment_status = 'failed' THEN 1 END) as failed_payments
                FROM weekly_luminarias_payments wlp
                JOIN level_definitions ld ON wlp.level_id = ld.id
                WHERE wlp.created_at >= CURRENT_TIMESTAMP - INTERVAL $1
                GROUP BY wlp.level_type, ld.level_name, ld.level_order
                ORDER BY wlp.level_type, ld.level_order
            `, [`${dateRange} days`]);

            return result.rows;

        } catch (error) {
            console.error('Error getting payment analytics:', error);
            return [];
        }
    }

    async getPaymentTrends(dateRange = 90) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    DATE(wlp.week_start_date) as week_start,
                    wlp.level_type,
                    COUNT(wlp.id) as payment_count,
                    SUM(wlp.total_amount) as total_amount,
                    COUNT(DISTINCT wlp.user_id) as unique_users,
                    AVG(wlp.total_amount) as avg_payment,
                    COUNT(CASE WHEN wlp.payment_status = 'paid' THEN 1 END) as successful_count
                FROM weekly_luminarias_payments wlp
                WHERE wlp.week_start_date >= CURRENT_TIMESTAMP - INTERVAL $1
                GROUP BY DATE(wlp.week_start_date), wlp.level_type
                ORDER BY week_start DESC, wlp.level_type
            `, [`${dateRange} days`]);

            return result.rows;

        } catch (error) {
            console.error('Error getting payment trends:', error);
            return [];
        }
    }

    async getLuminariasROI() {
        try {
            const result = await this.pool.query(`
                SELECT 
                    ul.level_type,
                    COUNT(DISTINCT ul.user_id) as active_users,
                    COALESCE(SUM(wlp.total_amount), 0) as total_luminarias_distributed,
                    
                    -- Métricas de actividad generada
                    CASE 
                        WHEN ul.level_type = 'creator' THEN 
                            COALESCE(SUM((ul.current_metrics->>'active_users')::decimal), 0)
                        WHEN ul.level_type = 'teacher' THEN 
                            COALESCE(SUM((ul.current_metrics->>'active_students')::decimal), 0)
                        ELSE 0
                    END as total_users_influenced,
                    
                    -- ROI simplificado
                    CASE 
                        WHEN COALESCE(SUM(wlp.total_amount), 0) > 0 THEN
                            CASE 
                                WHEN ul.level_type = 'creator' THEN 
                                    COALESCE(SUM((ul.current_metrics->>'active_users')::decimal), 0) / SUM(wlp.total_amount) * 100
                                WHEN ul.level_type = 'teacher' THEN 
                                    COALESCE(SUM((ul.current_metrics->>'active_students')::decimal), 0) / SUM(wlp.total_amount) * 100
                                ELSE 0
                            END
                        ELSE 0
                    END as users_per_100_luminarias
                    
                FROM user_levels ul
                LEFT JOIN weekly_luminarias_payments wlp ON ul.user_id = wlp.user_id 
                    AND wlp.level_type = ul.level_type
                    AND wlp.payment_status = 'paid'
                WHERE ul.level_type IN ('creator', 'teacher')
                GROUP BY ul.level_type
            `);

            return result.rows;

        } catch (error) {
            console.error('Error getting Luminarias ROI:', error);
            return [];
        }
    }

    // ==================== PREDICCIONES Y PROYECCIONES ====================

    async predictLevelProgression(userId, levelType, blockId = null) {
        try {
            // Obtener histórico de progresión del usuario
            const historicalData = await this.pool.query(`
                SELECT 
                    lph.promoted_at,
                    prev_ld.level_order as prev_order,
                    new_ld.level_order as new_order,
                    lph.promotion_metrics
                FROM level_progression_history lph
                LEFT JOIN level_definitions prev_ld ON lph.previous_level_id = prev_ld.id
                JOIN level_definitions new_ld ON lph.new_level_id = new_ld.id
                WHERE lph.user_id = $1 
                    AND lph.level_type = $2
                    ${blockId ? 'AND lph.block_id = $3' : ''}
                ORDER BY lph.promoted_at DESC
                LIMIT 10
            `, blockId ? [userId, levelType, blockId] : [userId, levelType]);

            // Obtener nivel actual
            const currentLevel = await this.pool.query(`
                SELECT 
                    ld.level_order,
                    ld.level_name,
                    ul.current_metrics,
                    ul.last_calculated
                FROM user_levels ul
                JOIN level_definitions ld ON ul.current_level_id = ld.id
                WHERE ul.user_id = $1 
                    AND ul.level_type = $2
                    ${blockId ? 'AND ul.block_id = $3' : ''}
            `, blockId ? [userId, levelType, blockId] : [userId, levelType]);

            if (currentLevel.rows.length === 0) {
                return { prediction: 'No data available' };
            }

            const current = currentLevel.rows[0];
            const progressionHistory = historicalData.rows;

            // Análisis simple de tendencia
            let prediction = 'stable';
            let timeToNextLevel = null;
            let confidence = 'low';

            if (progressionHistory.length >= 2) {
                const recentProgressions = progressionHistory.slice(0, 3);
                const avgTimeBetweenLevels = this.calculateAverageTimeBetweenLevels(recentProgressions);
                
                if (avgTimeBetweenLevels && avgTimeBetweenLevels < 30) { // Menos de 30 días promedio
                    prediction = 'rapid_growth';
                    timeToNextLevel = avgTimeBetweenLevels;
                    confidence = 'medium';
                } else if (avgTimeBetweenLevels && avgTimeBetweenLevels < 90) {
                    prediction = 'steady_growth';
                    timeToNextLevel = avgTimeBetweenLevels;
                    confidence = 'medium';
                }

                if (progressionHistory.length >= 5) {
                    confidence = 'high';
                }
            }

            // Factores que afectan la predicción
            const factors = this.analyzePredictionFactors(current, levelType);

            return {
                current_level: current.level_name,
                current_order: current.level_order,
                prediction: prediction,
                estimated_days_to_next_level: timeToNextLevel,
                confidence: confidence,
                factors: factors,
                data_points: progressionHistory.length
            };

        } catch (error) {
            console.error('Error predicting level progression:', error);
            return { prediction: 'Error in prediction' };
        }
    }

    calculateAverageTimeBetweenLevels(progressions) {
        if (progressions.length < 2) return null;

        const timeDifferences = [];
        for (let i = 0; i < progressions.length - 1; i++) {
            const current = new Date(progressions[i].promoted_at);
            const previous = new Date(progressions[i + 1].promoted_at);
            const diffDays = Math.abs(current - previous) / (1000 * 60 * 60 * 24);
            timeDifferences.push(diffDays);
        }

        return timeDifferences.reduce((sum, diff) => sum + diff, 0) / timeDifferences.length;
    }

    analyzePredictionFactors(currentLevel, levelType) {
        const factors = [];
        const metrics = currentLevel.current_metrics || {};

        switch (levelType) {
            case 'user':
                const consolidation = metrics.consolidation || 0;
                if (consolidation >= 90) {
                    factors.push({ factor: 'High consolidation', impact: 'positive' });
                } else if (consolidation < 50) {
                    factors.push({ factor: 'Low consolidation', impact: 'negative' });
                }
                break;

            case 'creator':
                const activeUsers = metrics.active_users || 0;
                if (activeUsers > 100) {
                    factors.push({ factor: 'Large user base', impact: 'positive' });
                } else if (activeUsers < 10) {
                    factors.push({ factor: 'Small user base', impact: 'negative' });
                }
                break;

            case 'teacher':
                const activeStudents = metrics.active_students || 0;
                if (activeStudents > 50) {
                    factors.push({ factor: 'Many active students', impact: 'positive' });
                } else if (activeStudents < 5) {
                    factors.push({ factor: 'Few active students', impact: 'negative' });
                }
                break;
        }

        // Factor de actividad reciente
        const daysSinceUpdate = Math.floor((new Date() - new Date(currentLevel.last_calculated)) / (1000 * 60 * 60 * 24));
        if (daysSinceUpdate > 14) {
            factors.push({ factor: 'Inactive recently', impact: 'negative' });
        } else if (daysSinceUpdate < 3) {
            factors.push({ factor: 'Very active', impact: 'positive' });
        }

        return factors;
    }

    // ==================== REPORTES AUTOMATIZADOS ====================

    async generateMonthlyReport() {
        try {
            const [
                dashboardMetrics,
                levelDistribution,
                progressionTrends,
                paymentAnalytics,
                luminariasROI
            ] = await Promise.all([
                this.getDashboardMetrics(30),
                this.getLevelDistributionMetrics(),
                this.getProgressionTrends(30),
                this.getPaymentAnalytics(30),
                this.getLuminariasROI()
            ]);

            const report = {
                period: 'Últimos 30 días',
                generated_at: new Date().toISOString(),
                summary: dashboardMetrics,
                level_distribution: levelDistribution,
                progression_trends: progressionTrends,
                payment_analytics: paymentAnalytics,
                roi_analysis: luminariasROI,
                recommendations: this.generateRecommendations(dashboardMetrics, levelDistribution, paymentAnalytics)
            };

            return report;

        } catch (error) {
            console.error('Error generating monthly report:', error);
            return null;
        }
    }

    generateRecommendations(dashboardMetrics, levelDistribution, paymentAnalytics) {
        const recommendations = [];

        // Análisis de distribución de usuarios
        const totalCreators = dashboardMetrics.active_creators || 0;
        const totalTeachers = dashboardMetrics.active_teachers || 0;
        
        if (totalCreators < 10) {
            recommendations.push({
                category: 'User Growth',
                priority: 'high',
                message: 'Pocas personas con nivel de creador. Considera incentivar la creación de contenido.',
                action: 'Crear campañas para promover la creación de bloques'
            });
        }

        if (totalTeachers < 5) {
            recommendations.push({
                category: 'User Growth',
                priority: 'medium',
                message: 'Pocas personas con nivel de profesor. Promover uso educativo.',
                action: 'Crear programas de adopción para instituciones educativas'
            });
        }

        // Análisis de consolidación
        const avgConsolidation = dashboardMetrics.avg_user_consolidation || 0;
        if (avgConsolidation < 60) {
            recommendations.push({
                category: 'Learning Effectiveness',
                priority: 'high',
                message: 'Consolidación promedio baja. Los usuarios necesitan más apoyo.',
                action: 'Implementar tutoriales y sistemas de ayuda mejorados'
            });
        }

        // Análisis de actividad
        const avgCreatorUsers = dashboardMetrics.avg_creator_active_users || 0;
        if (avgCreatorUsers < 20) {
            recommendations.push({
                category: 'Engagement',
                priority: 'medium',
                message: 'Pocos usuarios activos por creador. Mejorar visibilidad del contenido.',
                action: 'Implementar sistema de recomendaciones y descubrimiento'
            });
        }

        // Análisis financiero
        const totalLuminarias = dashboardMetrics.total_luminarias_distributed || 0;
        if (totalLuminarias > 10000) {
            recommendations.push({
                category: 'Economics',
                priority: 'low',
                message: 'Alto gasto en Luminarias. Evaluar ROI del sistema de niveles.',
                action: 'Revisar estructura de pagos y métricas de éxito'
            });
        }

        return recommendations;
    }

    // ==================== UTILIDADES ====================

    async exportAnalyticsData(format = 'json', dateRange = 30) {
        try {
            const data = await this.generateMonthlyReport();
            
            if (format === 'csv') {
                return this.convertToCSV(data);
            }

            return data;

        } catch (error) {
            console.error('Error exporting analytics data:', error);
            return null;
        }
    }

    convertToCSV(data) {
        // Implementación básica de conversión a CSV
        const csvLines = [];
        
        // Header
        csvLines.push('Metric,Value');
        
        // Dashboard metrics
        if (data.summary) {
            Object.entries(data.summary).forEach(([key, value]) => {
                csvLines.push(`${key},${value}`);
            });
        }

        return csvLines.join('\n');
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = LevelsAnalytics;