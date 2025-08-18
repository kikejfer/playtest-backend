const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const ChallengesValidator = require('../challenges-validator');
const ChallengesNotificationSystem = require('../challenges-notifications');
const ChallengesAnalytics = require('../challenges-analytics');

// Inicializar sistemas
const validator = new ChallengesValidator();
const notificationSystem = new ChallengesNotificationSystem();
const analytics = new ChallengesAnalytics();

// ==================== VALIDACIONES Y PROGRESO ====================

// Validar progreso de un participante específico
router.post('/validate-progress/:participantId', authenticateToken, async (req, res) => {
    try {
        const { participantId } = req.params;
        
        const result = await validator.processAutomaticValidation(participantId);
        
        res.json({
            success: true,
            validation_result: result,
            updated_at: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error validating progress:', error);
        res.status(500).json({ 
            error: 'Error validando progreso', 
            details: error.message 
        });
    }
});

// Ejecutar validaciones masivas (solo administradores)
router.post('/validate-all', authenticateToken, async (req, res) => {
    try {
        // Verificar permisos de administrador
        if (req.user.nickname !== 'AdminPrincipal') {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        await validator.runPeriodicValidations();
        
        res.json({
            success: true,
            message: 'Validaciones masivas ejecutadas exitosamente'
        });

    } catch (error) {
        console.error('Error in mass validation:', error);
        res.status(500).json({ 
            error: 'Error en validaciones masivas', 
            details: error.message 
        });
    }
});

// ==================== NOTIFICACIONES ====================

// Obtener notificaciones del usuario
router.get('/notifications', authenticateToken, async (req, res) => {
    try {
        const { limit = 20, offset = 0 } = req.query;
        
        const notifications = await notificationSystem.getUserNotifications(
            req.user.id, 
            parseInt(limit), 
            parseInt(offset)
        );
        
        const unreadCount = await notificationSystem.getUnreadNotificationsCount(req.user.id);
        
        res.json({
            notifications,
            unread_count: unreadCount,
            total: notifications.length
        });

    } catch (error) {
        console.error('Error getting notifications:', error);
        res.status(500).json({ 
            error: 'Error obteniendo notificaciones', 
            details: error.message 
        });
    }
});

// Marcar notificación como leída
router.put('/notifications/:notificationId/read', authenticateToken, async (req, res) => {
    try {
        const { notificationId } = req.params;
        
        const success = await notificationSystem.markNotificationAsRead(
            notificationId, 
            req.user.id
        );
        
        if (success) {
            res.json({ success: true, message: 'Notificación marcada como leída' });
        } else {
            res.status(404).json({ error: 'Notificación no encontrada' });
        }

    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ 
            error: 'Error marcando notificación', 
            details: error.message 
        });
    }
});

// Marcar todas las notificaciones como leídas
router.put('/notifications/read-all', authenticateToken, async (req, res) => {
    try {
        const markedCount = await notificationSystem.markAllNotificationsAsRead(req.user.id);
        
        res.json({
            success: true,
            marked_count: markedCount,
            message: `${markedCount} notificaciones marcadas como leídas`
        });

    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        res.status(500).json({ 
            error: 'Error marcando notificaciones', 
            details: error.message 
        });
    }
});

// Configurar preferencias de notificaciones
router.put('/notification-preferences', authenticateToken, async (req, res) => {
    try {
        const preferences = req.body;
        
        const success = await notificationSystem.updateUserNotificationPreferences(
            req.user.id, 
            preferences
        );
        
        if (success) {
            res.json({ success: true, message: 'Preferencias actualizadas' });
        } else {
            res.status(500).json({ error: 'Error actualizando preferencias' });
        }

    } catch (error) {
        console.error('Error updating notification preferences:', error);
        res.status(500).json({ 
            error: 'Error actualizando preferencias', 
            details: error.message 
        });
    }
});

// Obtener preferencias de notificaciones
router.get('/notification-preferences', authenticateToken, async (req, res) => {
    try {
        const preferences = await notificationSystem.getUserNotificationPreferences(req.user.id);
        
        res.json({ preferences });

    } catch (error) {
        console.error('Error getting notification preferences:', error);
        res.status(500).json({ 
            error: 'Error obteniendo preferencias', 
            details: error.message 
        });
    }
});

// Enviar notificación personalizada (creadores)
router.post('/:challengeId/notify', authenticateToken, async (req, res) => {
    try {
        const { challengeId } = req.params;
        const { title, message, participant_ids = [] } = req.body;

        // Verificar que el usuario es el creador del reto
        const { Pool } = require('pg');
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });

        const challengeCheck = await pool.query(`
            SELECT creator_id FROM challenges WHERE id = $1
        `, [challengeId]);

        if (challengeCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Reto no encontrado' });
        }

        if (challengeCheck.rows[0].creator_id !== req.user.id) {
            return res.status(403).json({ error: 'Solo el creador puede enviar notificaciones' });
        }

        // Si no se especifican participantes, notificar a todos
        let userIds = participant_ids;
        if (userIds.length === 0) {
            const participantsResult = await pool.query(`
                SELECT user_id FROM challenge_participants 
                WHERE challenge_id = $1 AND status = 'active'
            `, [challengeId]);
            userIds = participantsResult.rows.map(p => p.user_id);
        }

        await notificationSystem.sendCustomNotification(
            userIds, 
            challengeId, 
            title, 
            message, 
            'creator_message'
        );

        res.json({
            success: true,
            message: `Notificación enviada a ${userIds.length} participantes`
        });

    } catch (error) {
        console.error('Error sending custom notification:', error);
        res.status(500).json({ 
            error: 'Error enviando notificación', 
            details: error.message 
        });
    }
});

// ==================== ANALYTICS ====================

// Dashboard de métricas para creadores
router.get('/analytics/dashboard', authenticateToken, async (req, res) => {
    try {
        const { date_range = 30 } = req.query;
        
        const metrics = await analytics.getDashboardMetrics(req.user.id, parseInt(date_range));
        const typeMetrics = await analytics.getChallengeTypeMetrics(req.user.id, parseInt(date_range));
        const trends = await analytics.getEngagementTrends(req.user.id, parseInt(date_range));
        const roi = await analytics.calculateROI(req.user.id, parseInt(date_range));
        
        res.json({
            summary: metrics,
            by_type: typeMetrics,
            trends: trends,
            roi_analysis: roi,
            period_days: parseInt(date_range)
        });

    } catch (error) {
        console.error('Error getting analytics dashboard:', error);
        res.status(500).json({ 
            error: 'Error obteniendo analytics', 
            details: error.message 
        });
    }
});

// Análisis específico por tipo de reto
router.get('/analytics/:challengeType', authenticateToken, async (req, res) => {
    try {
        const { challengeType } = req.params;
        let analyticsData;

        switch (challengeType) {
            case 'marathon':
                analyticsData = await analytics.getMarathonAnalytics(req.user.id);
                break;
            case 'streak':
                analyticsData = await analytics.getStreakAnalytics(req.user.id);
                break;
            case 'competition':
                analyticsData = await analytics.getCompetitionAnalytics(req.user.id);
                break;
            default:
                return res.status(400).json({ error: 'Tipo de reto no válido para analytics específico' });
        }

        res.json({
            challenge_type: challengeType,
            analytics: analyticsData
        });

    } catch (error) {
        console.error('Error getting challenge type analytics:', error);
        res.status(500).json({ 
            error: 'Error obteniendo analytics específicos', 
            details: error.message 
        });
    }
});

// Predicción de éxito para nuevo reto
router.post('/analytics/predict', authenticateToken, async (req, res) => {
    try {
        const challengeData = req.body;
        
        const prediction = await analytics.predictChallengeSuccess(challengeData);
        
        res.json({
            prediction: prediction,
            challenge_data: challengeData
        });

    } catch (error) {
        console.error('Error predicting challenge success:', error);
        res.status(500).json({ 
            error: 'Error en predicción', 
            details: error.message 
        });
    }
});

// Recomendaciones de premios óptimos
router.get('/analytics/prize-recommendations/:challengeType', authenticateToken, async (req, res) => {
    try {
        const { challengeType } = req.params;
        const { target_participants = 20 } = req.query;
        
        const recommendations = await analytics.getOptimalPrizeRecommendations(
            challengeType, 
            parseInt(target_participants)
        );
        
        res.json({
            challenge_type: challengeType,
            target_participants: parseInt(target_participants),
            recommendations: recommendations
        });

    } catch (error) {
        console.error('Error getting prize recommendations:', error);
        res.status(500).json({ 
            error: 'Error obteniendo recomendaciones', 
            details: error.message 
        });
    }
});

// Top performers
router.get('/analytics/top-performers', authenticateToken, async (req, res) => {
    try {
        const { challenge_type, limit = 10, date_range = 30 } = req.query;
        
        const topPerformers = await analytics.getTopPerformers(
            challenge_type || null, 
            parseInt(limit), 
            parseInt(date_range)
        );
        
        res.json({
            top_performers: topPerformers,
            filters: {
                challenge_type: challenge_type || 'all',
                limit: parseInt(limit),
                date_range: parseInt(date_range)
            }
        });

    } catch (error) {
        console.error('Error getting top performers:', error);
        res.status(500).json({ 
            error: 'Error obteniendo top performers', 
            details: error.message 
        });
    }
});

// Métricas en tiempo real de un reto
router.get('/:challengeId/real-time-metrics', authenticateToken, async (req, res) => {
    try {
        const { challengeId } = req.params;
        
        const metrics = await analytics.getRealTimeMetrics(challengeId);
        
        if (!metrics) {
            return res.status(404).json({ error: 'Reto no encontrado' });
        }
        
        res.json({
            challenge_id: challengeId,
            real_time_metrics: metrics,
            last_updated: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error getting real-time metrics:', error);
        res.status(500).json({ 
            error: 'Error obteniendo métricas en tiempo real', 
            details: error.message 
        });
    }
});

// Reporte semanal
router.get('/analytics/weekly-report', authenticateToken, async (req, res) => {
    try {
        const report = await analytics.generateWeeklyReport(req.user.id);
        
        if (!report) {
            return res.status(500).json({ error: 'Error generando reporte' });
        }
        
        res.json({ report });

    } catch (error) {
        console.error('Error generating weekly report:', error);
        res.status(500).json({ 
            error: 'Error generando reporte semanal', 
            details: error.message 
        });
    }
});

// Exportar datos de reto
router.get('/:challengeId/export', authenticateToken, async (req, res) => {
    try {
        const { challengeId } = req.params;
        const { format = 'json' } = req.query;
        
        const exportData = await analytics.exportChallengeData(challengeId, format);
        
        if (!exportData) {
            return res.status(404).json({ error: 'No se pudieron exportar los datos' });
        }
        
        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=challenge-${challengeId}-data.csv`);
            res.send(exportData);
        } else {
            res.json({ export_data: exportData });
        }

    } catch (error) {
        console.error('Error exporting challenge data:', error);
        res.status(500).json({ 
            error: 'Error exportando datos', 
            details: error.message 
        });
    }
});

// ==================== ANÁLISIS DE USUARIO ====================

// Analytics de rendimiento del usuario
router.get('/analytics/user/performance', authenticateToken, async (req, res) => {
    try {
        const { date_range = 90 } = req.query;
        
        const performance = await analytics.getUserPerformanceAnalytics(
            req.user.id, 
            parseInt(date_range)
        );
        
        res.json({
            user_id: req.user.id,
            performance_analytics: performance,
            period_days: parseInt(date_range)
        });

    } catch (error) {
        console.error('Error getting user performance analytics:', error);
        res.status(500).json({ 
            error: 'Error obteniendo analytics de rendimiento', 
            details: error.message 
        });
    }
});

// ==================== FUNCIONES ADMINISTRATIVAS ====================

// Ejecutar notificaciones periódicas (solo admin)
router.post('/admin/run-notifications', authenticateToken, async (req, res) => {
    try {
        if (req.user.nickname !== 'AdminPrincipal') {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        await notificationSystem.runPeriodicNotifications();
        
        res.json({
            success: true,
            message: 'Notificaciones periódicas ejecutadas'
        });

    } catch (error) {
        console.error('Error running periodic notifications:', error);
        res.status(500).json({ 
            error: 'Error ejecutando notificaciones', 
            details: error.message 
        });
    }
});

// Obtener métricas globales (solo admin)
router.get('/admin/global-metrics', authenticateToken, async (req, res) => {
    try {
        if (req.user.nickname !== 'AdminPrincipal') {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const { date_range = 30 } = req.query;
        
        const globalMetrics = await analytics.getDashboardMetrics(null, parseInt(date_range));
        const typeMetrics = await analytics.getChallengeTypeMetrics(null, parseInt(date_range));
        const topPerformers = await analytics.getTopPerformers(null, 20, parseInt(date_range));
        
        res.json({
            global_metrics: globalMetrics,
            by_type: typeMetrics,
            top_performers: topPerformers,
            period_days: parseInt(date_range)
        });

    } catch (error) {
        console.error('Error getting global metrics:', error);
        res.status(500).json({ 
            error: 'Error obteniendo métricas globales', 
            details: error.message 
        });
    }
});

module.exports = router;