const { Pool } = require('pg');

// Sistema de analytics y métricas para retos PLAYTEST
class ChallengesAnalytics {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
    }

    // ==================== MÉTRICAS GENERALES ====================

    async getDashboardMetrics(creatorId = null, dateRange = 30) {
        try {
            const whereClause = creatorId ? 'AND c.creator_id = $2' : '';
            const params = [`${dateRange} days`];
            if (creatorId) params.push(creatorId);

            const result = await this.pool.query(`
                SELECT 
                    COUNT(DISTINCT c.id) as total_challenges,
                    COUNT(DISTINCT CASE WHEN c.status = 'active' THEN c.id END) as active_challenges,
                    COUNT(DISTINCT CASE WHEN c.status = 'completed' THEN c.id END) as completed_challenges,
                    COUNT(DISTINCT cp.user_id) as total_participants,
                    COUNT(DISTINCT CASE WHEN cp.status = 'active' THEN cp.user_id END) as active_participants,
                    COUNT(DISTINCT CASE WHEN cp.status = 'completed' THEN cp.user_id END) as completed_participants,
                    COALESCE(SUM(c.luminarias_reserved), 0) as total_luminarias_invested,
                    COALESCE(SUM(cp.prize_awarded), 0) as total_luminarias_awarded,
                    COALESCE(AVG(
                        CASE WHEN cp.current_metrics ? 'progress_percentage' 
                        THEN (cp.current_metrics->>'progress_percentage')::decimal 
                        ELSE 0 END
                    ), 0) as average_progress,
                    COUNT(DISTINCT CASE WHEN cp.status = 'completed' THEN cp.id END)::decimal / 
                    NULLIF(COUNT(DISTINCT cp.id), 0) * 100 as completion_rate
                FROM challenges c
                LEFT JOIN challenge_participants cp ON c.id = cp.challenge_id
                WHERE c.created_at >= CURRENT_TIMESTAMP - INTERVAL $1
                ${whereClause}
            `, params);

            return result.rows[0];
        } catch (error) {
            console.error('Error getting dashboard metrics:', error);
            return {};
        }
    }

    async getChallengeTypeMetrics(creatorId = null, dateRange = 30) {
        try {
            const whereClause = creatorId ? 'AND c.creator_id = $2' : '';
            const params = [`${dateRange} days`];
            if (creatorId) params.push(creatorId);

            const result = await this.pool.query(`
                SELECT 
                    c.challenge_type,
                    COUNT(DISTINCT c.id) as total_challenges,
                    COUNT(DISTINCT cp.user_id) as total_participants,
                    COUNT(DISTINCT CASE WHEN cp.status = 'completed' THEN cp.user_id END) as completed_participants,
                    COALESCE(AVG(
                        CASE WHEN cp.current_metrics ? 'progress_percentage' 
                        THEN (cp.current_metrics->>'progress_percentage')::decimal 
                        ELSE 0 END
                    ), 0) as average_progress,
                    COUNT(DISTINCT CASE WHEN cp.status = 'completed' THEN cp.id END)::decimal / 
                    NULLIF(COUNT(DISTINCT cp.id), 0) * 100 as completion_rate,
                    COALESCE(AVG(c.prize_luminarias), 0) as average_prize,
                    COALESCE(SUM(cp.prize_awarded), 0) as total_prizes_awarded
                FROM challenges c
                LEFT JOIN challenge_participants cp ON c.id = cp.challenge_id
                WHERE c.created_at >= CURRENT_TIMESTAMP - INTERVAL $1
                ${whereClause}
                GROUP BY c.challenge_type
                ORDER BY total_challenges DESC
            `, params);

            return result.rows;
        } catch (error) {
            console.error('Error getting challenge type metrics:', error);
            return [];
        }
    }

    async getEngagementTrends(creatorId = null, dateRange = 30) {
        try {
            const whereClause = creatorId ? 'AND c.creator_id = $2' : '';
            const params = [`${dateRange} days`];
            if (creatorId) params.push(creatorId);

            const result = await this.pool.query(`
                SELECT 
                    DATE(cp.started_at) as date,
                    COUNT(DISTINCT cp.user_id) as new_participants,
                    COUNT(DISTINCT CASE WHEN cp.status = 'completed' THEN cp.user_id END) as completions,
                    COALESCE(AVG(
                        CASE WHEN cp.current_metrics ? 'progress_percentage' 
                        THEN (cp.current_metrics->>'progress_percentage')::decimal 
                        ELSE 0 END
                    ), 0) as daily_average_progress
                FROM challenge_participants cp
                JOIN challenges c ON cp.challenge_id = c.id
                WHERE cp.started_at >= CURRENT_TIMESTAMP - INTERVAL $1
                ${whereClause}
                GROUP BY DATE(cp.started_at)
                ORDER BY date DESC
            `, params);

            return result.rows;
        } catch (error) {
            console.error('Error getting engagement trends:', error);
            return [];
        }
    }

    // ==================== MÉTRICAS ESPECÍFICAS POR TIPO ====================

    async getMarathonAnalytics(creatorId = null) {
        try {
            const whereClause = creatorId ? 'AND c.creator_id = $1' : '';
            const params = creatorId ? [creatorId] : [];

            const result = await this.pool.query(`
                SELECT 
                    c.id,
                    c.title,
                    c.config,
                    COUNT(cp.id) as total_participants,
                    COUNT(CASE WHEN cp.status = 'completed' THEN 1 END) as completed,
                    COALESCE(AVG(
                        CASE WHEN cp.progress ? 'completed_blocks' 
                        THEN (cp.progress->>'completed_blocks')::decimal 
                        ELSE 0 END
                    ), 0) as avg_blocks_completed,
                    COALESCE(AVG(
                        CASE WHEN cp.progress ? 'average_score' 
                        THEN (cp.progress->>'average_score')::decimal 
                        ELSE 0 END
                    ), 0) as avg_score,
                    COALESCE(AVG(
                        CASE WHEN cp.progress ? 'total_attempts' 
                        THEN (cp.progress->>'total_attempts')::decimal 
                        ELSE 0 END
                    ), 0) as avg_attempts
                FROM challenges c
                LEFT JOIN challenge_participants cp ON c.id = cp.challenge_id
                WHERE c.challenge_type = 'marathon' ${whereClause}
                GROUP BY c.id, c.title, c.config
                ORDER BY total_participants DESC
            `, params);

            return result.rows;
        } catch (error) {
            console.error('Error getting marathon analytics:', error);
            return [];
        }
    }

    async getStreakAnalytics(creatorId = null) {
        try {
            const whereClause = creatorId ? 'AND c.creator_id = $1' : '';
            const params = creatorId ? [creatorId] : [];

            const result = await this.pool.query(`
                SELECT 
                    c.id,
                    c.title,
                    c.config,
                    COUNT(cp.id) as total_participants,
                    COUNT(CASE WHEN cp.status = 'completed' THEN 1 END) as completed,
                    COALESCE(AVG(
                        CASE WHEN cp.progress ? 'max_streak' 
                        THEN (cp.progress->>'max_streak')::decimal 
                        ELSE 0 END
                    ), 0) as avg_max_streak,
                    COALESCE(AVG(
                        CASE WHEN cp.progress ? 'current_streak' 
                        THEN (cp.progress->>'current_streak')::decimal 
                        ELSE 0 END
                    ), 0) as avg_current_streak,
                    COALESCE(AVG(
                        CASE WHEN cp.progress ? 'breaks_used' 
                        THEN (cp.progress->>'breaks_used')::decimal 
                        ELSE 0 END
                    ), 0) as avg_breaks_used
                FROM challenges c
                LEFT JOIN challenge_participants cp ON c.id = cp.challenge_id
                WHERE c.challenge_type = 'streak' ${whereClause}
                GROUP BY c.id, c.title, c.config
                ORDER BY total_participants DESC
            `, params);

            return result.rows;
        } catch (error) {
            console.error('Error getting streak analytics:', error);
            return [];
        }
    }

    async getCompetitionAnalytics(creatorId = null) {
        try {
            const whereClause = creatorId ? 'AND c.creator_id = $1' : '';
            const params = creatorId ? [creatorId] : [];

            const result = await this.pool.query(`
                SELECT 
                    c.id,
                    c.title,
                    c.config,
                    COUNT(cp.id) as total_participants,
                    COUNT(CASE WHEN cp.status = 'completed' THEN 1 END) as completed,
                    COALESCE(AVG(
                        CASE WHEN cp.progress ? 'wins' 
                        THEN (cp.progress->>'wins')::decimal 
                        ELSE 0 END
                    ), 0) as avg_wins,
                    COALESCE(AVG(
                        CASE WHEN cp.progress ? 'win_rate' 
                        THEN (cp.progress->>'win_rate')::decimal 
                        ELSE 0 END
                    ), 0) as avg_win_rate,
                    COALESCE(AVG(
                        CASE WHEN cp.progress ? 'accuracy' 
                        THEN (cp.progress->>'accuracy')::decimal 
                        ELSE 0 END
                    ), 0) as avg_accuracy
                FROM challenges c
                LEFT JOIN challenge_participants cp ON c.id = cp.challenge_id
                WHERE c.challenge_type = 'competition' ${whereClause}
                GROUP BY c.id, c.title, c.config
                ORDER BY total_participants DESC
            `, params);

            return result.rows;
        } catch (error) {
            console.error('Error getting competition analytics:', error);
            return [];
        }
    }

    // ==================== ANÁLISIS DE USUARIOS ====================

    async getUserPerformanceAnalytics(userId, dateRange = 90) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    c.challenge_type,
                    COUNT(cp.id) as participated,
                    COUNT(CASE WHEN cp.status = 'completed' THEN 1 END) as completed,
                    COUNT(CASE WHEN cp.status = 'failed' OR cp.status = 'abandoned' THEN 1 END) as failed,
                    COALESCE(AVG(
                        CASE WHEN cp.current_metrics ? 'progress_percentage' 
                        THEN (cp.current_metrics->>'progress_percentage')::decimal 
                        ELSE 0 END
                    ), 0) as avg_progress,
                    COALESCE(SUM(cp.prize_awarded), 0) as total_luminarias_earned,
                    COALESCE(AVG(
                        EXTRACT(EPOCH FROM (cp.completed_at - cp.started_at))/3600
                    ), 0) as avg_completion_time_hours
                FROM challenge_participants cp
                JOIN challenges c ON cp.challenge_id = c.id
                WHERE cp.user_id = $1 
                    AND cp.started_at >= CURRENT_TIMESTAMP - INTERVAL $2
                GROUP BY c.challenge_type
                ORDER BY participated DESC
            `, [userId, `${dateRange} days`]);

            return result.rows;
        } catch (error) {
            console.error('Error getting user performance analytics:', error);
            return [];
        }
    }

    async getTopPerformers(challengeType = null, limit = 10, dateRange = 30) {
        try {
            const typeCondition = challengeType ? 'AND c.challenge_type = $3' : '';
            const params = [limit, `${dateRange} days`];
            if (challengeType) params.push(challengeType);

            const result = await this.pool.query(`
                SELECT 
                    u.id,
                    u.nickname,
                    COUNT(cp.id) as challenges_participated,
                    COUNT(CASE WHEN cp.status = 'completed' THEN 1 END) as challenges_completed,
                    COALESCE(SUM(cp.prize_awarded), 0) as total_luminarias_earned,
                    COALESCE(AVG(
                        CASE WHEN cp.current_metrics ? 'progress_percentage' 
                        THEN (cp.current_metrics->>'progress_percentage')::decimal 
                        ELSE 0 END
                    ), 0) as avg_progress,
                    COUNT(CASE WHEN cp.status = 'completed' THEN 1 END)::decimal / 
                    NULLIF(COUNT(cp.id), 0) * 100 as completion_rate
                FROM users u
                JOIN challenge_participants cp ON u.id = cp.user_id
                JOIN challenges c ON cp.challenge_id = c.id
                WHERE cp.started_at >= CURRENT_TIMESTAMP - INTERVAL $2
                ${typeCondition}
                GROUP BY u.id, u.nickname
                HAVING COUNT(cp.id) >= 2
                ORDER BY completion_rate DESC, total_luminarias_earned DESC
                LIMIT $1
            `, params);

            return result.rows;
        } catch (error) {
            console.error('Error getting top performers:', error);
            return [];
        }
    }

    // ==================== ANÁLISIS PREDICTIVO ====================

    async predictChallengeSuccess(challengeData) {
        try {
            // Obtener datos históricos de retos similares
            const historicalData = await this.pool.query(`
                SELECT 
                    c.challenge_type,
                    c.prize_luminarias,
                    c.max_participants,
                    COUNT(cp.id) as participants,
                    COUNT(CASE WHEN cp.status = 'completed' THEN 1 END) as completed,
                    COALESCE(AVG(
                        CASE WHEN cp.current_metrics ? 'progress_percentage' 
                        THEN (cp.current_metrics->>'progress_percentage')::decimal 
                        ELSE 0 END
                    ), 0) as avg_progress
                FROM challenges c
                LEFT JOIN challenge_participants cp ON c.id = cp.challenge_id
                WHERE c.challenge_type = $1
                    AND c.status IN ('completed', 'active')
                    AND c.created_at >= CURRENT_TIMESTAMP - INTERVAL '6 months'
                GROUP BY c.id, c.challenge_type, c.prize_luminarias, c.max_participants
                HAVING COUNT(cp.id) > 0
            `, [challengeData.challenge_type]);

            if (historicalData.rows.length === 0) {
                return {
                    predicted_participants: 10,
                    predicted_completion_rate: 50,
                    confidence: 'low',
                    recommendations: ['Tipo de reto nuevo - datos limitados para predicción']
                };
            }

            const data = historicalData.rows;
            
            // Análisis simple de predicción basado en patrones históricos
            const avgParticipants = data.reduce((sum, d) => sum + d.participants, 0) / data.length;
            const avgCompletionRate = data.reduce((sum, d) => sum + (d.completed / d.participants * 100), 0) / data.length;
            
            // Factores de ajuste basados en configuración
            let participantMultiplier = 1;
            let completionMultiplier = 1;
            const recommendations = [];

            // Ajuste por premio
            const avgPrize = data.reduce((sum, d) => sum + d.prize_luminarias, 0) / data.length;
            if (challengeData.prize_luminarias > avgPrize * 1.5) {
                participantMultiplier *= 1.3;
                completionMultiplier *= 1.1;
                recommendations.push('Premio alto puede atraer más participantes');
            } else if (challengeData.prize_luminarias < avgPrize * 0.7) {
                participantMultiplier *= 0.8;
                completionMultiplier *= 0.9;
                recommendations.push('Considera aumentar el premio para mayor atracción');
            }

            // Ajuste por límite de tiempo
            if (challengeData.end_date) {
                const daysToDeadline = (new Date(challengeData.end_date) - new Date()) / (1000 * 60 * 60 * 24);
                if (daysToDeadline < 7) {
                    participantMultiplier *= 0.8;
                    completionMultiplier *= 0.7;
                    recommendations.push('Plazo corto puede reducir participación');
                } else if (daysToDeadline > 30) {
                    participantMultiplier *= 0.9;
                    completionMultiplier *= 0.8;
                    recommendations.push('Plazo muy largo puede reducir urgencia');
                }
            }

            const predictedParticipants = Math.round(avgParticipants * participantMultiplier);
            const predictedCompletionRate = Math.min(Math.round(avgCompletionRate * completionMultiplier), 100);
            
            // Determinar confianza
            let confidence = 'medium';
            if (data.length >= 10) confidence = 'high';
            if (data.length < 5) confidence = 'low';

            return {
                predicted_participants: predictedParticipants,
                predicted_completion_rate: predictedCompletionRate,
                predicted_cost: predictedParticipants * challengeData.prize_luminarias,
                confidence: confidence,
                historical_data_points: data.length,
                recommendations: recommendations
            };

        } catch (error) {
            console.error('Error predicting challenge success:', error);
            return {
                predicted_participants: 10,
                predicted_completion_rate: 50,
                confidence: 'low',
                recommendations: ['Error en predicción - usar estimaciones conservadoras']
            };
        }
    }

    async getOptimalPrizeRecommendations(challengeType, targetParticipants = 20) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    CASE 
                        WHEN c.prize_luminarias <= 50 THEN '0-50'
                        WHEN c.prize_luminarias <= 100 THEN '51-100'
                        WHEN c.prize_luminarias <= 200 THEN '101-200'
                        WHEN c.prize_luminarias <= 500 THEN '201-500'
                        ELSE '500+'
                    END as prize_range,
                    COUNT(cp.id) as total_participants,
                    COUNT(CASE WHEN cp.status = 'completed' THEN 1 END) as completed,
                    COALESCE(AVG(COUNT(cp.id)) OVER (PARTITION BY c.id), 0) as avg_participants_per_challenge,
                    COUNT(CASE WHEN cp.status = 'completed' THEN 1 END)::decimal / 
                    NULLIF(COUNT(cp.id), 0) * 100 as completion_rate
                FROM challenges c
                LEFT JOIN challenge_participants cp ON c.id = cp.challenge_id
                WHERE c.challenge_type = $1
                    AND c.created_at >= CURRENT_TIMESTAMP - INTERVAL '6 months'
                GROUP BY prize_range, c.prize_luminarias
                ORDER BY avg_participants_per_challenge DESC
            `, [challengeType]);

            return result.rows;
        } catch (error) {
            console.error('Error getting optimal prize recommendations:', error);
            return [];
        }
    }

    // ==================== MÉTRICAS DE ROI ====================

    async calculateROI(creatorId, dateRange = 30) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    SUM(c.luminarias_reserved) as total_invested,
                    SUM(cp.prize_awarded) as total_awarded,
                    COUNT(DISTINCT cp.user_id) as unique_participants,
                    COUNT(cp.id) as total_participations,
                    COUNT(CASE WHEN cp.status = 'completed' THEN 1 END) as successful_completions,
                    COALESCE(AVG(
                        CASE WHEN cp.current_metrics ? 'progress_percentage' 
                        THEN (cp.current_metrics->>'progress_percentage')::decimal 
                        ELSE 0 END
                    ), 0) as avg_engagement,
                    
                    -- Calcular métricas de valor
                    COUNT(cp.id)::decimal / NULLIF(SUM(c.luminarias_reserved), 0) * 1000 as participations_per_1000_luminarias,
                    COUNT(CASE WHEN cp.status = 'completed' THEN 1 END)::decimal / NULLIF(SUM(c.luminarias_reserved), 0) * 1000 as completions_per_1000_luminarias
                    
                FROM challenges c
                LEFT JOIN challenge_participants cp ON c.id = cp.challenge_id
                WHERE c.creator_id = $1
                    AND c.created_at >= CURRENT_TIMESTAMP - INTERVAL $2
            `, [creatorId, `${dateRange} days`]);

            const data = result.rows[0];
            
            // Calcular ROI personalizado para engagement
            const engagementROI = (data.avg_engagement / 100) * (data.unique_participants / Math.max(data.total_invested, 1)) * 100;
            
            return {
                ...data,
                engagement_roi: engagementROI,
                efficiency_score: data.participations_per_1000_luminarias || 0,
                success_rate: (data.successful_completions / Math.max(data.total_participations, 1)) * 100
            };

        } catch (error) {
            console.error('Error calculating ROI:', error);
            return {};
        }
    }

    // ==================== INFORMES AUTOMATIZADOS ====================

    async generateWeeklyReport(creatorId) {
        try {
            const [dashboardMetrics, typeMetrics, trends, roi] = await Promise.all([
                this.getDashboardMetrics(creatorId, 7),
                this.getChallengeTypeMetrics(creatorId, 7),
                this.getEngagementTrends(creatorId, 7),
                this.calculateROI(creatorId, 7)
            ]);

            const report = {
                period: 'Últimos 7 días',
                generated_at: new Date().toISOString(),
                creator_id: creatorId,
                summary: dashboardMetrics,
                by_type: typeMetrics,
                daily_trends: trends,
                roi_analysis: roi,
                recommendations: this.generateRecommendations(dashboardMetrics, typeMetrics, roi)
            };

            return report;

        } catch (error) {
            console.error('Error generating weekly report:', error);
            return null;
        }
    }

    generateRecommendations(dashboardMetrics, typeMetrics, roi) {
        const recommendations = [];

        // Análisis de tasa de completitud
        if (dashboardMetrics.completion_rate < 30) {
            recommendations.push({
                priority: 'high',
                category: 'completion_rate',
                message: 'Baja tasa de completitud. Considera reducir la dificultad o aumentar los premios.',
                action: 'Revisa la configuración de tus retos más difíciles'
            });
        }

        // Análisis de engagement
        if (dashboardMetrics.average_progress < 50) {
            recommendations.push({
                priority: 'medium',
                category: 'engagement',
                message: 'Progreso promedio bajo. Los participantes pueden estar perdiendo interés.',
                action: 'Agrega notificaciones de progreso o hitos intermedios'
            });
        }

        // Análisis por tipo de reto
        const bestType = typeMetrics.reduce((best, current) => 
            current.completion_rate > (best.completion_rate || 0) ? current : best, {});
        
        if (bestType.challenge_type) {
            recommendations.push({
                priority: 'low',
                category: 'optimization',
                message: `Los retos de tipo ${bestType.challenge_type} tienen mejor rendimiento.`,
                action: 'Considera crear más retos de este tipo'
            });
        }

        // Análisis de ROI
        if (roi.efficiency_score < 10) {
            recommendations.push({
                priority: 'medium',
                category: 'roi',
                message: 'Eficiencia de inversión baja. Pocos participantes por Luminaria invertida.',
                action: 'Optimiza los premios o mejora la promoción de tus retos'
            });
        }

        return recommendations;
    }

    // ==================== MÉTRICAS EN TIEMPO REAL ====================

    async getRealTimeMetrics(challengeId) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    c.id,
                    c.title,
                    c.status,
                    c.end_date,
                    COUNT(cp.id) as current_participants,
                    COUNT(CASE WHEN cp.status = 'active' THEN 1 END) as active_participants,
                    COUNT(CASE WHEN cp.status = 'completed' THEN 1 END) as completed_participants,
                    COALESCE(AVG(
                        CASE WHEN cp.current_metrics ? 'progress_percentage' 
                        THEN (cp.current_metrics->>'progress_percentage')::decimal 
                        ELSE 0 END
                    ), 0) as current_avg_progress,
                    
                    -- Actividad reciente (últimas 24 horas)
                    COUNT(CASE WHEN cp.started_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours' THEN 1 END) as new_participants_24h,
                    COUNT(CASE WHEN cp.completed_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours' THEN 1 END) as new_completions_24h,
                    
                    -- Tiempo restante
                    CASE 
                        WHEN c.end_date IS NOT NULL THEN 
                            EXTRACT(EPOCH FROM (c.end_date - CURRENT_TIMESTAMP))/3600
                        ELSE NULL 
                    END as hours_remaining
                    
                FROM challenges c
                LEFT JOIN challenge_participants cp ON c.id = cp.challenge_id
                WHERE c.id = $1
                GROUP BY c.id, c.title, c.status, c.end_date
            `, [challengeId]);

            return result.rows[0] || null;

        } catch (error) {
            console.error('Error getting real-time metrics:', error);
            return null;
        }
    }

    // ==================== EXPORTAR DATOS ====================

    async exportChallengeData(challengeId, format = 'json') {
        try {
            const challengeData = await this.pool.query(`
                SELECT c.*, u.nickname as creator_name
                FROM challenges c
                JOIN users u ON c.creator_id = u.id
                WHERE c.id = $1
            `, [challengeId]);

            const participantsData = await this.pool.query(`
                SELECT cp.*, u.nickname
                FROM challenge_participants cp
                JOIN users u ON cp.user_id = u.id
                WHERE cp.challenge_id = $1
                ORDER BY cp.started_at
            `, [challengeId]);

            const metricsData = await this.pool.query(`
                SELECT * FROM challenge_metrics
                WHERE challenge_id = $1
                ORDER BY metric_date
            `, [challengeId]);

            const exportData = {
                challenge: challengeData.rows[0],
                participants: participantsData.rows,
                daily_metrics: metricsData.rows,
                exported_at: new Date().toISOString()
            };

            if (format === 'csv') {
                // Convertir a CSV si se requiere
                return this.convertToCSV(exportData);
            }

            return exportData;

        } catch (error) {
            console.error('Error exporting challenge data:', error);
            return null;
        }
    }

    convertToCSV(data) {
        // Implementación simple de conversión a CSV
        const participants = data.participants;
        if (!participants.length) return '';

        const headers = Object.keys(participants[0]);
        const csvContent = [
            headers.join(','),
            ...participants.map(p => headers.map(h => p[h] || '').join(','))
        ].join('\n');

        return csvContent;
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = ChallengesAnalytics;