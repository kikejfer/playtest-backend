const express = require('express');
const router = express.Router();
const pool = require('../database/connection');
const { authenticateToken } = require('../middleware/auth');

// ==========================================
// API ENDPOINTS - PANEL DE CREADORES
// Sistema completo de marketing y monetización
// ==========================================

// Middleware para verificar que el usuario es creador
const requireCreatorRole = async (req, res, next) => {
    try {
        // Verificar que el usuario tiene bloques públicos (es creador)
        const creatorCheck = await pool.query(
            'SELECT COUNT(*) as block_count FROM blocks WHERE creator_id = $1 AND is_public = true',
            [req.user.id]
        );
        
        if (creatorCheck.rows[0].block_count === 0) {
            return res.status(403).json({ 
                error: 'Acceso denegado: se requiere ser creador de contenido'
            });
        }
        
        req.user.isCreator = true;
        next();
    } catch (error) {
        console.error('Error verificando rol de creador:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};

// ==========================================
// PESTAÑA 1 - ANALYTICS DE MERCADO
// ==========================================

// Dashboard principal de métricas de mercado
router.get('/market-analytics/dashboard', authenticateToken, requireCreatorRole, async (req, res) => {
    try {
        const creatorId = req.user.id;
        
        // Calcular métricas automáticamente
        await pool.query('SELECT calculate_market_metrics($1)', [creatorId]);
        
        // Obtener métricas actuales
        const marketMetrics = await pool.query(`
            SELECT 
                market_rank,
                category_rank,
                market_share_percentage,
                revenue_current_month,
                revenue_last_month,
                roi_percentage,
                cpa_cost,
                ltv_average,
                active_users_count,
                retention_rate,
                engagement_score,
                satisfaction_rating,
                total_blocks,
                total_questions,
                avg_block_rating,
                total_plays
            FROM creator_market_analytics 
            WHERE creator_id = $1 
            ORDER BY date_recorded DESC 
            LIMIT 1
        `, [creatorId]);
        
        // Análisis de competidores
        const competitors = await pool.query(`
            SELECT 
                u.nickname as competitor_name,
                ca.competitor_rank,
                ca.blocks_count,
                ca.avg_rating,
                ca.estimated_revenue,
                ca.user_count,
                ca.pricing_strategy
            FROM competitor_analysis ca
            JOIN users u ON ca.competitor_id = u.id
            WHERE ca.creator_id = $1
            ORDER BY ca.competitor_rank ASC
            LIMIT 10
        `, [creatorId]);
        
        // Oportunidades de mercado
        const opportunities = await pool.query(`
            SELECT 
                opportunity_type,
                title,
                description,
                estimated_revenue_potential,
                confidence_score,
                urgency_level,
                recommended_actions
            FROM market_opportunities
            WHERE creator_id = $1 AND status = 'identified'
            ORDER BY confidence_score DESC, urgency_level DESC
            LIMIT 5
        `, [creatorId]);
        
        res.json({
            metrics: marketMetrics.rows[0] || {},
            competitors: competitors.rows,
            opportunities: opportunities.rows
        });
        
    } catch (error) {
        console.error('Error en dashboard de analytics:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Análisis de tendencias temporales
router.get('/market-analytics/trends', authenticateToken, requireCreatorRole, async (req, res) => {
    try {
        const { period = '30' } = req.query; // días
        const creatorId = req.user.id;
        
        const trends = await pool.query(`
            SELECT 
                date_recorded,
                market_rank,
                revenue_current_month,
                active_users_count,
                retention_rate,
                engagement_score,
                total_plays
            FROM creator_market_analytics
            WHERE creator_id = $1 
            AND date_recorded >= CURRENT_DATE - INTERVAL '${period} days'
            ORDER BY date_recorded ASC
        `, [creatorId]);
        
        res.json({ trends: trends.rows });
        
    } catch (error) {
        console.error('Error en análisis de tendencias:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Análisis de audiencia detallado
router.get('/market-analytics/audience', authenticateToken, requireCreatorRole, async (req, res) => {
    try {
        const creatorId = req.user.id;
        
        // Análisis demográfico de usuarios
        const audienceAnalysis = await pool.query(`
            SELECT 
                COUNT(DISTINCT up.user_id) as total_users,
                COUNT(DISTINCT CASE WHEN up.preferences->>'education_level' = 'university' THEN up.user_id END) as university_users,
                COUNT(DISTINCT CASE WHEN up.preferences->>'education_level' = 'high_school' THEN up.user_id END) as high_school_users,
                AVG(
                    CASE WHEN up.stats->>'total_sessions' IS NOT NULL 
                    THEN (up.stats->>'total_sessions')::INTEGER 
                    ELSE 0 END
                ) as avg_sessions_per_user,
                AVG(
                    CASE WHEN up.stats->>'avg_session_duration' IS NOT NULL 
                    THEN (up.stats->>'avg_session_duration')::DECIMAL 
                    ELSE 0 END
                ) as avg_session_duration
            FROM user_profiles up
            WHERE up.user_id IN (
                SELECT DISTINCT user_id 
                FROM game_sessions gs 
                JOIN blocks b ON gs.block_id = b.id 
                WHERE b.creator_id = $1
                AND gs.created_at >= NOW() - INTERVAL '30 days'
            )
        `, [creatorId]);
        
        // Patrones de actividad por horas
        const activityPatterns = await pool.query(`
            SELECT 
                EXTRACT(HOUR FROM gs.created_at) as hour_of_day,
                COUNT(*) as session_count,
                AVG(gs.score) as avg_score
            FROM game_sessions gs
            JOIN blocks b ON gs.block_id = b.id
            WHERE b.creator_id = $1
            AND gs.created_at >= NOW() - INTERVAL '30 days'
            GROUP BY EXTRACT(HOUR FROM gs.created_at)
            ORDER BY hour_of_day
        `, [creatorId]);
        
        res.json({
            audience: audienceAnalysis.rows[0] || {},
            activityPatterns: activityPatterns.rows
        });
        
    } catch (error) {
        console.error('Error en análisis de audiencia:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==========================================
// PESTAÑA 2 - MARKETING Y PROMOCIÓN
// ==========================================

// Obtener todas las campañas de marketing
router.get('/marketing/campaigns', authenticateToken, requireCreatorRole, async (req, res) => {
    try {
        const creatorId = req.user.id;
        const { status = 'active' } = req.query;
        
        const campaigns = await pool.query(`
            SELECT 
                id,
                name,
                campaign_type,
                start_date,
                end_date,
                budget,
                discount_percentage,
                discount_amount,
                coupon_code,
                max_uses,
                current_uses,
                impressions,
                clicks,
                conversions,
                revenue_generated,
                is_active
            FROM marketing_campaigns
            WHERE creator_id = $1 
            ${status !== 'all' ? 'AND is_active = $2' : ''}
            ORDER BY created_at DESC
        `, status !== 'all' ? [creatorId, status === 'active'] : [creatorId]);
        
        res.json({ campaigns: campaigns.rows });
        
    } catch (error) {
        console.error('Error obteniendo campañas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear nueva campaña de marketing
router.post('/marketing/campaigns', authenticateToken, requireCreatorRole, async (req, res) => {
    try {
        const creatorId = req.user.id;
        const {
            name,
            campaign_type,
            start_date,
            end_date,
            budget,
            discount_percentage,
            discount_amount,
            target_audience,
            bundle_blocks,
            max_uses
        } = req.body;
        
        // Generar código de cupón único
        const coupon_code = campaign_type === 'discount' ? 
            `${name.substring(0, 5).toUpperCase()}${Math.random().toString(36).substring(2, 8).toUpperCase()}` : null;
        
        const result = await pool.query(`
            INSERT INTO marketing_campaigns (
                creator_id, name, campaign_type, start_date, end_date, 
                budget, discount_percentage, discount_amount, 
                target_audience, bundle_blocks, coupon_code, max_uses
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
        `, [
            creatorId, name, campaign_type, start_date, end_date,
            budget, discount_percentage, discount_amount,
            JSON.stringify(target_audience), bundle_blocks, coupon_code, max_uses
        ]);
        
        res.status(201).json({
            message: 'Campaña creada exitosamente',
            campaign: result.rows[0]
        });
        
    } catch (error) {
        console.error('Error creando campaña:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener métricas de rendimiento de campañas
router.get('/marketing/campaigns/:id/metrics', authenticateToken, requireCreatorRole, async (req, res) => {
    try {
        const { id } = req.params;
        const creatorId = req.user.id;
        
        const campaign = await pool.query(`
            SELECT 
                *,
                CASE 
                    WHEN clicks > 0 THEN (conversions::DECIMAL / clicks) * 100 
                    ELSE 0 
                END as conversion_rate,
                CASE 
                    WHEN budget > 0 THEN (revenue_generated / budget) * 100 
                    ELSE 0 
                END as roi_percentage
            FROM marketing_campaigns
            WHERE id = $1 AND creator_id = $2
        `, [id, creatorId]);
        
        if (campaign.rows.length === 0) {
            return res.status(404).json({ error: 'Campaña no encontrada' });
        }
        
        res.json({ metrics: campaign.rows[0] });
        
    } catch (error) {
        console.error('Error obteniendo métricas de campaña:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==========================================
// PESTAÑA 3 - TORNEOS Y EVENTOS
// ==========================================

// Obtener torneos del creador
router.get('/tournaments', authenticateToken, requireCreatorRole, async (req, res) => {
    try {
        const creatorId = req.user.id;
        const { status = 'active' } = req.query;
        
        const tournaments = await pool.query(`
            SELECT 
                id,
                name,
                description,
                tournament_type,
                start_date,
                end_date,
                max_participants,
                current_participants,
                prize_structure,
                total_prize_value,
                registrations,
                active_participants,
                social_shares,
                new_users_acquired,
                conversion_rate,
                status
            FROM marketing_tournaments
            WHERE creator_id = $1
            ${status !== 'all' ? 'AND status = $2' : ''}
            ORDER BY created_at DESC
        `, status !== 'all' ? [creatorId, status] : [creatorId]);
        
        res.json({ tournaments: tournaments.rows });
        
    } catch (error) {
        console.error('Error obteniendo torneos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear nuevo torneo de marketing
router.post('/tournaments', authenticateToken, requireCreatorRole, async (req, res) => {
    try {
        const creatorId = req.user.id;
        const {
            name,
            description,
            tournament_type,
            start_date,
            end_date,
            max_participants,
            prize_structure,
            total_prize_value,
            sharing_bonus,
            referral_bonus,
            viral_multiplier
        } = req.body;
        
        const result = await pool.query(`
            INSERT INTO marketing_tournaments (
                creator_id, name, description, tournament_type, 
                start_date, end_date, max_participants, 
                prize_structure, total_prize_value,
                sharing_bonus, referral_bonus, viral_multiplier
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
        `, [
            creatorId, name, description, tournament_type,
            start_date, end_date, max_participants,
            JSON.stringify(prize_structure), total_prize_value,
            sharing_bonus, referral_bonus, viral_multiplier
        ]);
        
        res.status(201).json({
            message: 'Torneo creado exitosamente',
            tournament: result.rows[0]
        });
        
    } catch (error) {
        console.error('Error creando torneo:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==========================================
// PESTAÑA 4 - MONETIZACIÓN AVANZADA
// ==========================================

// Obtener servicios premium del creador
router.get('/monetization/services', authenticateToken, requireCreatorRole, async (req, res) => {
    try {
        const creatorId = req.user.id;
        
        const services = await pool.query(`
            SELECT 
                id,
                service_name,
                service_type,
                description,
                price,
                duration_minutes,
                max_participants,
                total_bookings,
                total_revenue,
                average_rating,
                completion_rate,
                is_active,
                featured
            FROM creator_premium_services
            WHERE creator_id = $1
            ORDER BY featured DESC, total_revenue DESC
        `, [creatorId]);
        
        res.json({ services: services.rows });
        
    } catch (error) {
        console.error('Error obteniendo servicios:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear nuevo servicio premium
router.post('/monetization/services', authenticateToken, requireCreatorRole, async (req, res) => {
    try {
        const creatorId = req.user.id;
        const {
            service_name,
            service_type,
            description,
            price,
            duration_minutes,
            max_participants,
            availability_schedule,
            included_materials,
            certification_provided
        } = req.body;
        
        const result = await pool.query(`
            INSERT INTO creator_premium_services (
                creator_id, service_name, service_type, description,
                price, duration_minutes, max_participants,
                availability_schedule, included_materials, certification_provided
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
        `, [
            creatorId, service_name, service_type, description,
            price, duration_minutes, max_participants,
            JSON.stringify(availability_schedule), JSON.stringify(included_materials),
            certification_provided
        ]);
        
        res.status(201).json({
            message: 'Servicio creado exitosamente',
            service: result.rows[0]
        });
        
    } catch (error) {
        console.error('Error creando servicio:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener reservas de servicios
router.get('/monetization/bookings', authenticateToken, requireCreatorRole, async (req, res) => {
    try {
        const creatorId = req.user.id;
        const { status = 'scheduled' } = req.query;
        
        const bookings = await pool.query(`
            SELECT 
                sb.id,
                sb.scheduled_date,
                sb.duration_minutes,
                sb.total_price,
                sb.status,
                sb.user_rating,
                sb.user_feedback,
                cps.service_name,
                u.nickname as user_nickname
            FROM service_bookings sb
            JOIN creator_premium_services cps ON sb.service_id = cps.id
            JOIN users u ON sb.user_id = u.id
            WHERE sb.creator_id = $1
            ${status !== 'all' ? 'AND sb.status = $2' : ''}
            ORDER BY sb.scheduled_date DESC
        `, status !== 'all' ? [creatorId, status] : [creatorId]);
        
        res.json({ bookings: bookings.rows });
        
    } catch (error) {
        console.error('Error obteniendo reservas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Dashboard de monetización con métricas financieras
router.get('/monetization/dashboard', authenticateToken, requireCreatorRole, async (req, res) => {
    try {
        const creatorId = req.user.id;
        
        // Métricas de servicios premium
        const serviceMetrics = await pool.query(`
            SELECT 
                COUNT(*) as total_services,
                SUM(total_revenue) as total_service_revenue,
                AVG(average_rating) as avg_service_rating,
                SUM(total_bookings) as total_bookings
            FROM creator_premium_services
            WHERE creator_id = $1 AND is_active = true
        `, [creatorId]);
        
        // Métricas de productos digitales
        const productMetrics = await pool.query(`
            SELECT 
                COUNT(*) as total_products,
                SUM(total_revenue) as total_product_revenue,
                SUM(total_sales) as total_sales
            FROM creator_digital_products
            WHERE creator_id = $1 AND is_active = true
        `, [creatorId]);
        
        // Suscripciones activas
        const subscriptionMetrics = await pool.query(`
            SELECT 
                COUNT(*) as active_subscriptions,
                SUM(monthly_price) as monthly_recurring_revenue
            FROM creator_subscriptions
            WHERE creator_id = $1 AND status = 'active'
        `, [creatorId]);
        
        // Revenue de luminarias (del sistema existente)
        const luminariaMetrics = await pool.query(`
            SELECT 
                COALESCE(actuales, 0) as current_luminarias,
                COALESCE(ganadas, 0) as total_earned,
                COALESCE(gastadas, 0) as total_spent
            FROM user_luminarias
            WHERE user_id = $1
        `, [creatorId]);
        
        res.json({
            services: serviceMetrics.rows[0] || {},
            products: productMetrics.rows[0] || {},
            subscriptions: subscriptionMetrics.rows[0] || {},
            luminarias: luminariaMetrics.rows[0] || {}
        });
        
    } catch (error) {
        console.error('Error en dashboard de monetización:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==========================================
// PESTAÑA 5 - GESTIÓN DE CONTENIDO
// ==========================================

// Analytics detallado de contenido por bloque
router.get('/content/analytics', authenticateToken, requireCreatorRole, async (req, res) => {
    try {
        const creatorId = req.user.id;
        const { period = '30' } = req.query;
        
        const contentAnalytics = await pool.query(`
            SELECT 
                b.id as block_id,
                b.name as block_name,
                ca.unique_players,
                ca.total_sessions,
                ca.avg_session_duration,
                ca.completion_rate,
                ca.questions_answered,
                ca.correct_answers,
                ca.revenue_generated,
                ca.conversions_to_premium,
                ca.date_recorded
            FROM content_analytics ca
            JOIN blocks b ON ca.block_id = b.id
            WHERE ca.creator_id = $1
            AND ca.date_recorded >= CURRENT_DATE - INTERVAL '${period} days'
            ORDER BY ca.date_recorded DESC, ca.revenue_generated DESC
        `, [creatorId]);
        
        res.json({ analytics: contentAnalytics.rows });
        
    } catch (error) {
        console.error('Error en analytics de contenido:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener sugerencias de optimización de contenido
router.get('/content/optimization-suggestions', authenticateToken, requireCreatorRole, async (req, res) => {
    try {
        const creatorId = req.user.id;
        
        // Bloques con baja tasa de finalización
        const lowCompletionBlocks = await pool.query(`
            SELECT 
                b.id,
                b.name,
                AVG(ca.completion_rate) as avg_completion_rate
            FROM blocks b
            LEFT JOIN content_analytics ca ON b.id = ca.block_id
            WHERE b.creator_id = $1 AND b.is_public = true
            GROUP BY b.id, b.name
            HAVING AVG(ca.completion_rate) < 60
            ORDER BY avg_completion_rate ASC
            LIMIT 5
        `, [creatorId]);
        
        // Bloques con alto potencial de monetización
        const highPotentialBlocks = await pool.query(`
            SELECT 
                b.id,
                b.name,
                AVG(ca.unique_players) as avg_players,
                AVG(ca.revenue_generated) as avg_revenue
            FROM blocks b
            LEFT JOIN content_analytics ca ON b.id = ca.block_id
            WHERE b.creator_id = $1 AND b.is_public = true
            GROUP BY b.id, b.name
            HAVING AVG(ca.unique_players) > 50 AND AVG(ca.revenue_generated) < 10
            ORDER BY avg_players DESC
            LIMIT 5
        `, [creatorId]);
        
        res.json({
            lowCompletion: lowCompletionBlocks.rows,
            highPotential: highPotentialBlocks.rows
        });
        
    } catch (error) {
        console.error('Error obteniendo sugerencias:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==========================================
// ANALYTICS PREDICTIVOS Y OPTIMIZACIÓN
// ==========================================

// Obtener precio óptimo sugerido para un bloque
router.get('/pricing/optimize/:blockId', authenticateToken, requireCreatorRole, async (req, res) => {
    try {
        const { blockId } = req.params;
        const creatorId = req.user.id;
        
        // Verificar que el creador posee el bloque
        const blockCheck = await pool.query(
            'SELECT id FROM blocks WHERE id = $1 AND creator_id = $2',
            [blockId, creatorId]
        );
        
        if (blockCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Acceso denegado al bloque' });
        }
        
        // Obtener configuración de pricing dinámico actual
        const pricingData = await pool.query(`
            SELECT * FROM dynamic_pricing 
            WHERE item_id = $1 AND item_type = 'block' AND creator_id = $2
        `, [blockId, creatorId]);
        
        let suggestion = {
            currentPrice: 0,
            suggestedPrice: 0,
            confidenceLevel: 0,
            reasoning: 'Análisis basado en métricas de mercado'
        };
        
        if (pricingData.rows.length > 0) {
            const pricing = pricingData.rows[0];
            suggestion = {
                currentPrice: pricing.current_price,
                suggestedPrice: pricing.optimal_price_estimate,
                confidenceLevel: pricing.conversion_rate || 0,
                reasoning: `Basado en elasticidad de precio: ${pricing.price_elasticity}`
            };
        }
        
        res.json({ pricingSuggestion: suggestion });
        
    } catch (error) {
        console.error('Error en optimización de precios:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Detectar oportunidades de mercado automáticamente
router.post('/market/detect-opportunities', authenticateToken, requireCreatorRole, async (req, res) => {
    try {
        // Ejecutar función de detección de oportunidades
        await pool.query('SELECT detect_market_opportunities()');
        
        // Obtener oportunidades para este creador
        const opportunities = await pool.query(`
            SELECT * FROM market_opportunities
            WHERE creator_id = $1 AND status = 'identified'
            ORDER BY confidence_score DESC, created_at DESC
            LIMIT 10
        `, [req.user.id]);
        
        res.json({
            message: 'Análisis de oportunidades completado',
            opportunities: opportunities.rows
        });
        
    } catch (error) {
        console.error('Error detectando oportunidades:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==========================================
// AUTOMATIZACIÓN DE MARKETING
// ==========================================

// Obtener automatizaciones activas
router.get('/automation/campaigns', authenticateToken, requireCreatorRole, async (req, res) => {
    try {
        const creatorId = req.user.id;
        
        const automations = await pool.query(`
            SELECT 
                id,
                automation_name,
                automation_type,
                trigger_conditions,
                total_triggered,
                total_conversions,
                conversion_rate,
                revenue_attributed,
                is_active
            FROM marketing_automation
            WHERE creator_id = $1
            ORDER BY revenue_attributed DESC
        `, [creatorId]);
        
        res.json({ automations: automations.rows });
        
    } catch (error) {
        console.error('Error obteniendo automatizaciones:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear nueva automatización de marketing
router.post('/automation/campaigns', authenticateToken, requireCreatorRole, async (req, res) => {
    try {
        const creatorId = req.user.id;
        const {
            automation_name,
            automation_type,
            trigger_conditions,
            target_audience,
            action_sequence,
            delay_between_actions
        } = req.body;
        
        const result = await pool.query(`
            INSERT INTO marketing_automation (
                creator_id, automation_name, automation_type,
                trigger_conditions, target_audience, action_sequence,
                delay_between_actions
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [
            creatorId, automation_name, automation_type,
            JSON.stringify(trigger_conditions), JSON.stringify(target_audience),
            JSON.stringify(action_sequence), delay_between_actions
        ]);
        
        res.status(201).json({
            message: 'Automatización creada exitosamente',
            automation: result.rows[0]
        });
        
    } catch (error) {
        console.error('Error creando automatización:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

module.exports = router;