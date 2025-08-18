const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const LevelsCalculator = require('../levels-calculator');
const LevelsPaymentSystem = require('../levels-payments');
const LevelsNotificationSystem = require('../levels-notifications');

// Inicializar sistemas
const calculator = new LevelsCalculator();
const paymentSystem = new LevelsPaymentSystem();
const notificationSystem = new LevelsNotificationSystem();

// ==================== CONSULTA DE NIVELES ====================

// Obtener niveles actuales del usuario
router.get('/my-levels', authenticateToken, async (req, res) => {
    try {
        const userLevels = await calculator.getUserCurrentLevels(req.user.id);
        
        res.json({
            user_id: req.user.id,
            levels: userLevels
        });

    } catch (error) {
        console.error('Error getting user levels:', error);
        res.status(500).json({ 
            error: 'Error obteniendo niveles', 
            details: error.message 
        });
    }
});

// Obtener historial de progresión
router.get('/my-progression', authenticateToken, async (req, res) => {
    try {
        const { limit = 20 } = req.query;
        
        const progression = await calculator.getUserProgressionHistory(req.user.id, parseInt(limit));
        
        res.json({
            user_id: req.user.id,
            progression_history: progression
        });

    } catch (error) {
        console.error('Error getting user progression:', error);
        res.status(500).json({ 
            error: 'Error obteniendo historial', 
            details: error.message 
        });
    }
});

// Obtener distribución global de niveles
router.get('/distribution', authenticateToken, async (req, res) => {
    try {
        const distribution = await calculator.getLevelDistribution();
        
        res.json({ level_distribution: distribution });

    } catch (error) {
        console.error('Error getting level distribution:', error);
        res.status(500).json({ 
            error: 'Error obteniendo distribución', 
            details: error.message 
        });
    }
});

// Obtener definiciones de niveles
router.get('/definitions', authenticateToken, async (req, res) => {
    try {
        const { level_type } = req.query;
        
        const { Pool } = require('pg');
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });

        const whereClause = level_type ? 'WHERE level_type = $1' : '';
        const params = level_type ? [level_type] : [];

        const result = await pool.query(`
            SELECT * FROM level_definitions 
            ${whereClause}
            ORDER BY level_type, level_order
        `, params);

        res.json({ level_definitions: result.rows });

    } catch (error) {
        console.error('Error getting level definitions:', error);
        res.status(500).json({ 
            error: 'Error obteniendo definiciones', 
            details: error.message 
        });
    }
});

// ==================== CÁLCULOS Y ACTUALIZACIONES ====================

// Recalcular niveles del usuario
router.post('/recalculate', authenticateToken, async (req, res) => {
    try {
        const results = await calculator.updateAllUserLevels(req.user.id);
        
        // Enviar notificaciones si hay cambios
        for (const notification of results.notifications_needed) {
            await notificationSystem.sendLevelUpNotification(req.user.id, notification);
        }
        
        res.json({
            message: 'Niveles recalculados exitosamente',
            results: results
        });

    } catch (error) {
        console.error('Error recalculating levels:', error);
        res.status(500).json({ 
            error: 'Error recalculando niveles', 
            details: error.message 
        });
    }
});

// Recalcular nivel específico por bloque (solo usuarios)
router.post('/recalculate/:blockId', authenticateToken, async (req, res) => {
    try {
        const { blockId } = req.params;
        
        const result = await calculator.updateUserLevelForBlock(req.user.id, parseInt(blockId), true);
        
        if (result && result.changed) {
            await notificationSystem.sendLevelUpNotification(req.user.id, {
                level_type: 'user',
                new_level: result.level.level_name,
                previous_level: result.previous_level,
                block_id: blockId,
                consolidation: result.consolidation
            });
        }
        
        res.json({
            message: 'Nivel de bloque recalculado',
            result: result
        });

    } catch (error) {
        console.error('Error recalculating block level:', error);
        res.status(500).json({ 
            error: 'Error recalculando nivel de bloque', 
            details: error.message 
        });
    }
});

// ==================== PAGOS Y RECOMPENSAS ====================

// Obtener historial de pagos
router.get('/payments', authenticateToken, async (req, res) => {
    try {
        const { limit = 10 } = req.query;
        
        const payments = await paymentSystem.getPaymentHistory(req.user.id, parseInt(limit));
        
        res.json({ payment_history: payments });

    } catch (error) {
        console.error('Error getting payment history:', error);
        res.status(500).json({ 
            error: 'Error obteniendo historial de pagos', 
            details: error.message 
        });
    }
});

// Obtener pagos pendientes
router.get('/payments/pending', authenticateToken, async (req, res) => {
    try {
        // Verificar si es administrador
        if (req.user.nickname !== 'AdminPrincipal') {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const pendingPayments = await paymentSystem.getPendingPayments();
        
        res.json({ pending_payments: pendingPayments });

    } catch (error) {
        console.error('Error getting pending payments:', error);
        res.status(500).json({ 
            error: 'Error obteniendo pagos pendientes', 
            details: error.message 
        });
    }
});

// Procesar pagos semanales (solo admin)
router.post('/payments/process-weekly', authenticateToken, async (req, res) => {
    try {
        if (req.user.nickname !== 'AdminPrincipal') {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const { week_start } = req.body;
        const weekStart = week_start ? new Date(week_start) : null;

        const results = await paymentSystem.processWeeklyPayments(weekStart);
        
        // Enviar notificaciones de pago
        for (const payment of results.payments) {
            if (payment.status === 'paid') {
                await notificationSystem.sendWeeklyPaymentNotification(payment.user_id, payment);
            }
        }
        
        res.json({
            message: 'Pagos semanales procesados',
            results: results
        });

    } catch (error) {
        console.error('Error processing weekly payments:', error);
        res.status(500).json({ 
            error: 'Error procesando pagos semanales', 
            details: error.message 
        });
    }
});

// Reintentar pagos fallidos (solo admin)
router.post('/payments/retry-failed', authenticateToken, async (req, res) => {
    try {
        if (req.user.nickname !== 'AdminPrincipal') {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const { week_start } = req.body;
        const weekStart = new Date(week_start);

        const retryResults = await paymentSystem.retryFailedPayments(weekStart);
        
        res.json({
            message: 'Reintentos de pagos completados',
            retry_results: retryResults
        });

    } catch (error) {
        console.error('Error retrying failed payments:', error);
        res.status(500).json({ 
            error: 'Error reintentando pagos', 
            details: error.message 
        });
    }
});

// ==================== NOTIFICACIONES ====================

// Obtener notificaciones de niveles
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
            notifications: notifications,
            unread_count: unreadCount
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
        
        const success = await notificationSystem.markNotificationAsRead(notificationId, req.user.id);
        
        if (success) {
            res.json({ message: 'Notificación marcada como leída' });
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
            message: `${markedCount} notificaciones marcadas como leídas`,
            marked_count: markedCount
        });

    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        res.status(500).json({ 
            error: 'Error marcando notificaciones', 
            details: error.message 
        });
    }
});

// Obtener preferencias de notificaciones
router.get('/notifications/preferences', authenticateToken, async (req, res) => {
    try {
        const preferences = await notificationSystem.getUserNotificationPreferences(req.user.id);
        
        res.json({ preferences: preferences });

    } catch (error) {
        console.error('Error getting notification preferences:', error);
        res.status(500).json({ 
            error: 'Error obteniendo preferencias', 
            details: error.message 
        });
    }
});

// Actualizar preferencias de notificaciones
router.put('/notifications/preferences', authenticateToken, async (req, res) => {
    try {
        const preferences = req.body;
        
        const success = await notificationSystem.updateUserNotificationPreferences(req.user.id, preferences);
        
        if (success) {
            res.json({ message: 'Preferencias actualizadas' });
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

// ==================== ESTADÍSTICAS Y RANKINGS ====================

// Obtener ranking de usuarios por tipo de nivel
router.get('/rankings/:levelType', authenticateToken, async (req, res) => {
    try {
        const { levelType } = req.params;
        const { limit = 50 } = req.query;
        
        const { Pool } = require('pg');
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });

        let query;
        let params = [levelType, parseInt(limit)];

        if (levelType === 'user') {
            query = `
                SELECT 
                    u.id,
                    u.nickname,
                    COUNT(ul.id) as total_levels,
                    COALESCE(AVG(
                        CASE WHEN ul.current_metrics ? 'consolidation' 
                        THEN (ul.current_metrics->>'consolidation')::decimal 
                        ELSE 0 END
                    ), 0) as avg_consolidation,
                    COUNT(CASE WHEN ld.level_order >= 4 THEN 1 END) as expert_levels,
                    MAX(ld.level_order) as highest_level_order
                FROM users u
                JOIN user_levels ul ON u.id = ul.user_id
                JOIN level_definitions ld ON ul.current_level_id = ld.id
                WHERE ul.level_type = $1
                GROUP BY u.id, u.nickname
                ORDER BY avg_consolidation DESC, expert_levels DESC
                LIMIT $2
            `;
        } else {
            query = `
                SELECT 
                    u.id,
                    u.nickname,
                    ld.level_name,
                    ld.level_order,
                    ld.weekly_luminarias,
                    ul.current_metrics,
                    ul.achieved_at
                FROM users u
                JOIN user_levels ul ON u.id = ul.user_id
                JOIN level_definitions ld ON ul.current_level_id = ld.id
                WHERE ul.level_type = $1
                ORDER BY ld.level_order DESC, ul.achieved_at ASC
                LIMIT $2
            `;
        }

        const result = await pool.query(query, params);
        
        res.json({
            level_type: levelType,
            ranking: result.rows
        });

    } catch (error) {
        console.error('Error getting level rankings:', error);
        res.status(500).json({ 
            error: 'Error obteniendo rankings', 
            details: error.message 
        });
    }
});

// Obtener estadísticas del usuario
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        const { Pool } = require('pg');
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });

        // Estadísticas básicas
        const basicStats = await pool.query(`
            SELECT 
                COUNT(CASE WHEN ul.level_type = 'user' THEN 1 END) as user_levels_count,
                COUNT(CASE WHEN ul.level_type = 'creator' THEN 1 END) as is_creator,
                COUNT(CASE WHEN ul.level_type = 'teacher' THEN 1 END) as is_teacher,
                COALESCE(SUM(wlp.total_amount), 0) as total_luminarias_earned
            FROM user_levels ul
            LEFT JOIN weekly_luminarias_payments wlp ON ul.user_id = wlp.user_id
            WHERE ul.user_id = $1
        `, [req.user.id]);

        // Progresión reciente
        const recentProgression = await pool.query(`
            SELECT COUNT(*) as recent_level_ups
            FROM level_progression_history lph
            WHERE lph.user_id = $1 
                AND lph.promoted_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
        `, [req.user.id]);

        // Consolidación promedio
        const avgConsolidation = await pool.query(`
            SELECT COALESCE(AVG(
                CASE WHEN ul.current_metrics ? 'consolidation' 
                THEN (ul.current_metrics->>'consolidation')::decimal 
                ELSE 0 END
            ), 0) as avg_consolidation
            FROM user_levels ul
            WHERE ul.user_id = $1 AND ul.level_type = 'user'
        `, [req.user.id]);

        const stats = {
            ...basicStats.rows[0],
            recent_level_ups: parseInt(recentProgression.rows[0].recent_level_ups),
            avg_consolidation: parseFloat(avgConsolidation.rows[0].avg_consolidation)
        };

        res.json({ user_stats: stats });

    } catch (error) {
        console.error('Error getting user stats:', error);
        res.status(500).json({ 
            error: 'Error obteniendo estadísticas', 
            details: error.message 
        });
    }
});

// ==================== FUNCIONES ADMINISTRATIVAS ====================

// Ejecutar cálculos periódicos (solo admin)
router.post('/admin/run-calculations', authenticateToken, async (req, res) => {
    try {
        if (req.user.nickname !== 'AdminPrincipal') {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const results = await calculator.runPeriodicLevelCalculations();
        
        res.json({
            message: 'Cálculos periódicos ejecutados',
            results: results
        });

    } catch (error) {
        console.error('Error running periodic calculations:', error);
        res.status(500).json({ 
            error: 'Error ejecutando cálculos', 
            details: error.message 
        });
    }
});

// Ejecutar notificaciones periódicas (solo admin)
router.post('/admin/run-notifications', authenticateToken, async (req, res) => {
    try {
        if (req.user.nickname !== 'AdminPrincipal') {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        await notificationSystem.runPeriodicNotifications();
        
        res.json({
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

// Obtener resumen semanal de pagos (solo admin)
router.get('/admin/weekly-summary/:weekStart', authenticateToken, async (req, res) => {
    try {
        if (req.user.nickname !== 'AdminPrincipal') {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const { weekStart } = req.params;
        const summary = await paymentSystem.getWeeklyPaymentSummary(new Date(weekStart));
        
        res.json({ weekly_summary: summary });

    } catch (error) {
        console.error('Error getting weekly summary:', error);
        res.status(500).json({ 
            error: 'Error obteniendo resumen semanal', 
            details: error.message 
        });
    }
});

// Limpiar notificaciones antiguas (solo admin)
router.post('/admin/cleanup-notifications', authenticateToken, async (req, res) => {
    try {
        if (req.user.nickname !== 'AdminPrincipal') {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const { days_old = 90 } = req.body;
        const cleanedCount = await notificationSystem.cleanupOldNotifications(parseInt(days_old));
        
        res.json({
            message: 'Limpieza completada',
            notifications_deleted: cleanedCount
        });

    } catch (error) {
        console.error('Error cleaning up notifications:', error);
        res.status(500).json({ 
            error: 'Error en limpieza', 
            details: error.message 
        });
    }
});

// Estadísticas de notificaciones (solo admin)
router.get('/admin/notification-stats', authenticateToken, async (req, res) => {
    try {
        if (req.user.nickname !== 'AdminPrincipal') {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const stats = await notificationSystem.getNotificationStats();
        
        res.json({ notification_stats: stats });

    } catch (error) {
        console.error('Error getting notification stats:', error);
        res.status(500).json({ 
            error: 'Error obteniendo estadísticas', 
            details: error.message 
        });
    }
});

module.exports = router;