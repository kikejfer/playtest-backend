const { Pool } = require('pg');

// Sistema de notificaciones avanzado para retos
class ChallengesNotificationSystem {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
    }

    // ==================== TIPOS DE NOTIFICACIONES ====================

    async sendNewChallengeNotification(challengeId, eligibleUsers = []) {
        try {
            const challenge = await this.getChallengeData(challengeId);
            if (!challenge) return;

            const title = '🆕 Nuevo Reto Disponible';
            const message = `¡Nuevo reto "${challenge.title}" disponible! Premio: ${challenge.prize_luminarias} 💎 Luminarias`;
            
            const notificationData = {
                challenge_id: challengeId,
                type: 'new_challenge',
                prize: challenge.prize_luminarias,
                end_date: challenge.end_date
            };

            if (eligibleUsers.length > 0) {
                // Notificar solo a usuarios específicos
                for (const userId of eligibleUsers) {
                    await this.createNotification(userId, challengeId, 'new_challenge', title, message, notificationData);
                }
            } else {
                // Notificar a todos los usuarios activos
                await this.notifyAllActiveUsers(challengeId, 'new_challenge', title, message, notificationData);
            }

            console.log(`New challenge notification sent for challenge ${challengeId}`);

        } catch (error) {
            console.error('Error sending new challenge notification:', error);
        }
    }

    async sendDeadlineReminderNotifications() {
        try {
            // Buscar retos que expiran en las próximas 24 horas
            const upcomingDeadlines = await this.pool.query(`
                SELECT DISTINCT c.id, c.title, c.end_date, c.prize_luminarias,
                       cp.user_id, cp.progress, cp.current_metrics
                FROM challenges c
                JOIN challenge_participants cp ON c.id = cp.challenge_id
                WHERE c.status = 'active' 
                    AND cp.status = 'active'
                    AND c.end_date > CURRENT_TIMESTAMP
                    AND c.end_date <= CURRENT_TIMESTAMP + INTERVAL '24 hours'
                    AND NOT EXISTS (
                        SELECT 1 FROM challenge_notifications cn 
                        WHERE cn.user_id = cp.user_id 
                            AND cn.challenge_id = c.id 
                            AND cn.notification_type = 'deadline_reminder'
                            AND cn.sent_at > CURRENT_TIMESTAMP - INTERVAL '23 hours'
                    )
            `);

            for (const reminder of upcomingDeadlines.rows) {
                const hoursLeft = Math.ceil((new Date(reminder.end_date) - new Date()) / (1000 * 60 * 60));
                const progress = reminder.current_metrics?.progress_percentage || 0;
                
                const title = '⏰ Recordatorio de Fecha Límite';
                const message = `El reto "${reminder.title}" expira en ${hoursLeft} horas. Tu progreso actual: ${Math.round(progress)}%`;
                
                const notificationData = {
                    hours_left: hoursLeft,
                    current_progress: progress,
                    prize_at_stake: reminder.prize_luminarias
                };

                await this.createNotification(
                    reminder.user_id, 
                    reminder.id, 
                    'deadline_reminder', 
                    title, 
                    message, 
                    notificationData
                );
            }

            console.log(`Sent ${upcomingDeadlines.rows.length} deadline reminder notifications`);

        } catch (error) {
            console.error('Error sending deadline reminders:', error);
        }
    }

    async sendProgressMilestoneNotifications() {
        try {
            // Buscar participantes que han alcanzado hitos importantes
            const milestones = await this.pool.query(`
                SELECT cp.id, cp.user_id, cp.challenge_id, cp.current_metrics,
                       c.title, c.prize_luminarias, c.challenge_type
                FROM challenge_participants cp
                JOIN challenges c ON cp.challenge_id = c.id
                WHERE cp.status = 'active'
                    AND c.status = 'active'
                    AND cp.current_metrics ? 'progress_percentage'
                    AND (cp.current_metrics->>'progress_percentage')::decimal >= 25
                    AND NOT EXISTS (
                        SELECT 1 FROM challenge_notifications cn 
                        WHERE cn.user_id = cp.user_id 
                            AND cn.challenge_id = cp.challenge_id 
                            AND cn.notification_type LIKE 'milestone_%'
                            AND cn.sent_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'
                    )
            `);

            for (const milestone of milestones.rows) {
                const progress = parseFloat(milestone.current_metrics.progress_percentage);
                let milestoneType = null;
                let title = '';
                let message = '';

                if (progress >= 75 && progress < 100) {
                    milestoneType = 'milestone_75';
                    title = '🎯 ¡Casi lo logras!';
                    message = `¡Estás al 75% en "${milestone.title}"! Solo un poco más para ganar ${milestone.prize_luminarias} 💎`;
                } else if (progress >= 50 && progress < 75) {
                    milestoneType = 'milestone_50';
                    title = '🚀 ¡Mitad del camino!';
                    message = `¡Has completado el 50% de "${milestone.title}"! ¡Sigue así!`;
                } else if (progress >= 25 && progress < 50) {
                    milestoneType = 'milestone_25';
                    title = '💪 ¡Buen progreso!';
                    message = `¡Has alcanzado el 25% en "${milestone.title}"! ¡Excelente inicio!`;
                }

                if (milestoneType) {
                    const notificationData = {
                        milestone_percentage: Math.round(progress),
                        challenge_type: milestone.challenge_type,
                        prize_amount: milestone.prize_luminarias
                    };

                    await this.createNotification(
                        milestone.user_id,
                        milestone.challenge_id,
                        milestoneType,
                        title,
                        message,
                        notificationData
                    );
                }
            }

            console.log(`Sent ${milestones.rows.length} milestone notifications`);

        } catch (error) {
            console.error('Error sending milestone notifications:', error);
        }
    }

    async sendInactivityReminders() {
        try {
            // Buscar participantes inactivos en retos activos
            const inactiveParticipants = await this.pool.query(`
                SELECT cp.user_id, cp.challenge_id, c.title, c.prize_luminarias,
                       cp.current_metrics, cp.started_at,
                       EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - cp.started_at))/3600 as hours_since_start
                FROM challenge_participants cp
                JOIN challenges c ON cp.challenge_id = c.id
                WHERE cp.status = 'active'
                    AND c.status = 'active'
                    AND c.end_date > CURRENT_TIMESTAMP + INTERVAL '24 hours'
                    AND cp.started_at < CURRENT_TIMESTAMP - INTERVAL '2 days'
                    AND (
                        cp.current_metrics ? 'progress_percentage' = false 
                        OR (cp.current_metrics->>'progress_percentage')::decimal < 10
                    )
                    AND NOT EXISTS (
                        SELECT 1 FROM challenge_notifications cn 
                        WHERE cn.user_id = cp.user_id 
                            AND cn.challenge_id = cp.challenge_id 
                            AND cn.notification_type = 'inactivity_reminder'
                            AND cn.sent_at > CURRENT_TIMESTAMP - INTERVAL '47 hours'
                    )
            `);

            for (const participant of inactiveParticipants.rows) {
                const title = '😴 ¡No olvides tu reto!';
                const message = `Llevas ${Math.floor(participant.hours_since_start)} horas sin progreso en "${participant.title}". ¡${participant.prize_luminarias} 💎 te esperan!`;
                
                const notificationData = {
                    hours_inactive: Math.floor(participant.hours_since_start),
                    current_progress: participant.current_metrics?.progress_percentage || 0,
                    prize_amount: participant.prize_luminarias
                };

                await this.createNotification(
                    participant.user_id,
                    participant.challenge_id,
                    'inactivity_reminder',
                    title,
                    message,
                    notificationData
                );
            }

            console.log(`Sent ${inactiveParticipants.rows.length} inactivity reminders`);

        } catch (error) {
            console.error('Error sending inactivity reminders:', error);
        }
    }

    async sendCompletionCelebrations() {
        try {
            // Buscar completaciones recientes sin notificación
            const recentCompletions = await this.pool.query(`
                SELECT cp.user_id, cp.challenge_id, c.title, cp.prize_awarded,
                       c.challenge_type, cp.completed_at
                FROM challenge_participants cp
                JOIN challenges c ON cp.challenge_id = c.id
                WHERE cp.status = 'completed'
                    AND cp.completed_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'
                    AND NOT EXISTS (
                        SELECT 1 FROM challenge_notifications cn 
                        WHERE cn.user_id = cp.user_id 
                            AND cn.challenge_id = cp.challenge_id 
                            AND cn.notification_type = 'completion_celebration'
                    )
            `);

            for (const completion of recentCompletions.rows) {
                const title = '🎉 ¡Reto Completado!';
                const message = `¡Felicidades! Has completado "${completion.title}" y ganado ${completion.prize_awarded} 💎 Luminarias`;
                
                const notificationData = {
                    challenge_type: completion.challenge_type,
                    prize_earned: completion.prize_awarded,
                    completion_time: completion.completed_at
                };

                await this.createNotification(
                    completion.user_id,
                    completion.challenge_id,
                    'completion_celebration',
                    title,
                    message,
                    notificationData
                );
            }

            console.log(`Sent ${recentCompletions.rows.length} completion celebrations`);

        } catch (error) {
            console.error('Error sending completion celebrations:', error);
        }
    }

    async sendStreakBreakAlerts() {
        try {
            // Buscar retos de streak con riesgo de ruptura
            const streakRisks = await this.pool.query(`
                SELECT cp.user_id, cp.challenge_id, c.title, c.config,
                       cp.current_metrics, cp.started_at
                FROM challenge_participants cp
                JOIN challenges c ON cp.challenge_id = c.id
                WHERE cp.status = 'active'
                    AND c.status = 'active'
                    AND c.challenge_type = 'streak'
                    AND cp.current_metrics ? 'last_activity_date'
                    AND (cp.current_metrics->>'last_activity_date')::date < CURRENT_DATE
                    AND NOT EXISTS (
                        SELECT 1 FROM challenge_notifications cn 
                        WHERE cn.user_id = cp.user_id 
                            AND cn.challenge_id = cp.challenge_id 
                            AND cn.notification_type = 'streak_break_alert'
                            AND cn.sent_at > CURRENT_TIMESTAMP - INTERVAL '23 hours'
                    )
            `);

            for (const risk of streakRisks.rows) {
                const lastActivityDate = new Date(risk.current_metrics.last_activity_date);
                const daysSinceActivity = Math.floor((new Date() - lastActivityDate) / (1000 * 60 * 60 * 24));
                const allowedBreaks = risk.config?.allowed_breaks || 1;
                
                if (daysSinceActivity >= 1) {
                    const title = '🔥 ¡Tu racha está en riesgo!';
                    const message = `Llevas ${daysSinceActivity} día${daysSinceActivity > 1 ? 's' : ''} sin actividad en "${risk.title}". ¡No pierdas tu racha!`;
                    
                    const notificationData = {
                        days_inactive: daysSinceActivity,
                        allowed_breaks: allowedBreaks,
                        current_streak: risk.current_metrics?.current_streak || 0
                    };

                    await this.createNotification(
                        risk.user_id,
                        risk.challenge_id,
                        'streak_break_alert',
                        title,
                        message,
                        notificationData
                    );
                }
            }

            console.log(`Sent ${streakRisks.rows.length} streak break alerts`);

        } catch (error) {
            console.error('Error sending streak break alerts:', error);
        }
    }

    async sendCustomNotification(userIds, challengeId, title, message, type = 'custom', data = {}) {
        try {
            for (const userId of userIds) {
                await this.createNotification(userId, challengeId, type, title, message, data);
            }
            
            console.log(`Sent custom notification to ${userIds.length} users`);

        } catch (error) {
            console.error('Error sending custom notification:', error);
        }
    }

    // ==================== FUNCIONES DE SOPORTE ====================

    async createNotification(userId, challengeId, type, title, message, data = {}) {
        try {
            await this.pool.query(`
                INSERT INTO challenge_notifications (
                    user_id, challenge_id, notification_type, title, message, data
                ) VALUES ($1, $2, $3, $4, $5, $6)
            `, [userId, challengeId, type, title, message, JSON.stringify(data)]);

            // Enviar notificación push si está habilitada
            await this.sendPushNotification(userId, title, message, data);

        } catch (error) {
            console.error('Error creating notification:', error);
        }
    }

    async notifyAllActiveUsers(challengeId, type, title, message, data = {}) {
        try {
            // Obtener usuarios activos (han iniciado sesión en los últimos 30 días)
            const activeUsers = await this.pool.query(`
                SELECT DISTINCT u.id
                FROM users u
                LEFT JOIN games g ON u.id = g.created_by
                WHERE g.created_at > CURRENT_TIMESTAMP - INTERVAL '30 days'
                   OR u.id IN (
                       SELECT DISTINCT user_id 
                       FROM challenge_participants 
                       WHERE started_at > CURRENT_TIMESTAMP - INTERVAL '30 days'
                   )
            `);

            for (const user of activeUsers.rows) {
                await this.createNotification(user.id, challengeId, type, title, message, data);
            }

        } catch (error) {
            console.error('Error notifying all active users:', error);
        }
    }

    async sendPushNotification(userId, title, message, data = {}) {
        try {
            // Aquí se implementaría la lógica de push notifications
            // Por ejemplo, usando Firebase Cloud Messaging, OneSignal, etc.
            
            // Simulación de envío de push notification
            console.log(`Push notification sent to user ${userId}: ${title}`);
            
            // En una implementación real:
            // 1. Obtener token de dispositivo del usuario
            // 2. Enviar notificación push usando el servicio elegido
            // 3. Manejar errores y tokens expirados

        } catch (error) {
            console.error('Error sending push notification:', error);
        }
    }

    async getChallengeData(challengeId) {
        try {
            const result = await this.pool.query(`
                SELECT * FROM challenges WHERE id = $1
            `, [challengeId]);

            return result.rows[0] || null;
        } catch (error) {
            console.error('Error getting challenge data:', error);
            return null;
        }
    }

    // ==================== API ENDPOINTS ====================

    async getUserNotifications(userId, limit = 20, offset = 0) {
        try {
            const result = await this.pool.query(`
                SELECT cn.*, c.title as challenge_title
                FROM challenge_notifications cn
                LEFT JOIN challenges c ON cn.challenge_id = c.id
                WHERE cn.user_id = $1
                ORDER BY cn.sent_at DESC
                LIMIT $2 OFFSET $3
            `, [userId, limit, offset]);

            return result.rows;
        } catch (error) {
            console.error('Error getting user notifications:', error);
            return [];
        }
    }

    async markNotificationAsRead(notificationId, userId) {
        try {
            await this.pool.query(`
                UPDATE challenge_notifications 
                SET read_at = CURRENT_TIMESTAMP
                WHERE id = $1 AND user_id = $2 AND read_at IS NULL
            `, [notificationId, userId]);

            return true;
        } catch (error) {
            console.error('Error marking notification as read:', error);
            return false;
        }
    }

    async markAllNotificationsAsRead(userId) {
        try {
            const result = await this.pool.query(`
                UPDATE challenge_notifications 
                SET read_at = CURRENT_TIMESTAMP
                WHERE user_id = $1 AND read_at IS NULL
                RETURNING id
            `, [userId]);

            return result.rows.length;
        } catch (error) {
            console.error('Error marking all notifications as read:', error);
            return 0;
        }
    }

    async getUnreadNotificationsCount(userId) {
        try {
            const result = await this.pool.query(`
                SELECT COUNT(*) as count
                FROM challenge_notifications
                WHERE user_id = $1 AND read_at IS NULL
            `, [userId]);

            return parseInt(result.rows[0].count) || 0;
        } catch (error) {
            console.error('Error getting unread notifications count:', error);
            return 0;
        }
    }

    // ==================== SISTEMA DE CRON/SCHEDULER ====================

    async runPeriodicNotifications() {
        try {
            console.log('Running periodic notifications...');

            // Ejecutar todos los tipos de notificaciones automáticas
            await Promise.all([
                this.sendDeadlineReminderNotifications(),
                this.sendProgressMilestoneNotifications(),
                this.sendInactivityReminders(),
                this.sendCompletionCelebrations(),
                this.sendStreakBreakAlerts()
            ]);

            console.log('Periodic notifications completed');

        } catch (error) {
            console.error('Error in periodic notifications:', error);
        }
    }

    // ==================== CONFIGURACIÓN DE PREFERENCIAS ====================

    async updateUserNotificationPreferences(userId, preferences) {
        try {
            // Crear tabla de preferencias si no existe
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS user_notification_preferences (
                    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    email_notifications BOOLEAN DEFAULT true,
                    push_notifications BOOLEAN DEFAULT true,
                    deadline_reminders BOOLEAN DEFAULT true,
                    milestone_notifications BOOLEAN DEFAULT true,
                    inactivity_reminders BOOLEAN DEFAULT true,
                    completion_celebrations BOOLEAN DEFAULT true,
                    new_challenge_alerts BOOLEAN DEFAULT true,
                    streak_break_alerts BOOLEAN DEFAULT true,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Actualizar o insertar preferencias
            await this.pool.query(`
                INSERT INTO user_notification_preferences (user_id, email_notifications, push_notifications, 
                    deadline_reminders, milestone_notifications, inactivity_reminders, completion_celebrations,
                    new_challenge_alerts, streak_break_alerts)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (user_id) DO UPDATE SET
                    email_notifications = EXCLUDED.email_notifications,
                    push_notifications = EXCLUDED.push_notifications,
                    deadline_reminders = EXCLUDED.deadline_reminders,
                    milestone_notifications = EXCLUDED.milestone_notifications,
                    inactivity_reminders = EXCLUDED.inactivity_reminders,
                    completion_celebrations = EXCLUDED.completion_celebrations,
                    new_challenge_alerts = EXCLUDED.new_challenge_alerts,
                    streak_break_alerts = EXCLUDED.streak_break_alerts,
                    updated_at = CURRENT_TIMESTAMP
            `, [
                userId,
                preferences.email_notifications !== false,
                preferences.push_notifications !== false,
                preferences.deadline_reminders !== false,
                preferences.milestone_notifications !== false,
                preferences.inactivity_reminders !== false,
                preferences.completion_celebrations !== false,
                preferences.new_challenge_alerts !== false,
                preferences.streak_break_alerts !== false
            ]);

            return true;
        } catch (error) {
            console.error('Error updating notification preferences:', error);
            return false;
        }
    }

    async getUserNotificationPreferences(userId) {
        try {
            const result = await this.pool.query(`
                SELECT * FROM user_notification_preferences WHERE user_id = $1
            `, [userId]);

            return result.rows[0] || {
                email_notifications: true,
                push_notifications: true,
                deadline_reminders: true,
                milestone_notifications: true,
                inactivity_reminders: true,
                completion_celebrations: true,
                new_challenge_alerts: true,
                streak_break_alerts: true
            };
        } catch (error) {
            console.error('Error getting notification preferences:', error);
            return {};
        }
    }

    // ==================== EMAIL NOTIFICATIONS ====================

    async sendEmailNotification(userId, title, message, data = {}) {
        try {
            // Obtener datos del usuario
            const userResult = await this.pool.query(`
                SELECT u.email, u.nickname, unp.email_notifications
                FROM users u
                LEFT JOIN user_notification_preferences unp ON u.id = unp.user_id
                WHERE u.id = $1
            `, [userId]);

            const user = userResult.rows[0];
            if (!user || !user.email || user.email_notifications === false) {
                return false;
            }

            // Aquí se implementaría el envío de email
            // Por ejemplo, usando SendGrid, AWS SES, Nodemailer, etc.
            
            console.log(`Email notification sent to ${user.email}: ${title}`);
            
            // En una implementación real:
            // 1. Configurar servicio de email
            // 2. Crear template HTML atractivo
            // 3. Enviar email con datos personalizados
            // 4. Manejar errores y bounces

            return true;
        } catch (error) {
            console.error('Error sending email notification:', error);
            return false;
        }
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = ChallengesNotificationSystem;