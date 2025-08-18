const { Pool } = require('pg');

// Sistema de notificaciones para niveles PLAYTEST
class LevelsNotificationSystem {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
    }

    // ==================== NOTIFICACIONES DE CAMBIO DE NIVEL ====================

    async sendLevelUpNotification(userId, levelChange) {
        try {
            const { level_type, new_level, previous_level, block_id, block_title, consolidation, active_users, active_students, weekly_luminarias } = levelChange;

            let title, message, icon, actionUrl;

            switch (level_type) {
                case 'user':
                    title = `🎉 ¡Nivel ${new_level} alcanzado!`;
                    message = `Has alcanzado el nivel ${new_level} en el bloque "${block_title}" con ${consolidation}% de consolidación.`;
                    icon = 'level-up-user';
                    actionUrl = `/blocks/${block_id}/progress`;
                    break;

                case 'creator':
                    title = `🌟 ¡Nuevo nivel de Creador: ${new_level}!`;
                    message = `Has alcanzado el nivel ${new_level} como creador con ${active_users} usuarios activos. Ganarás ${weekly_luminarias} Luminarias semanales.`;
                    icon = 'level-up-creator';
                    actionUrl = '/creator/dashboard';
                    break;

                case 'teacher':
                    title = `👨‍🏫 ¡Nuevo nivel de Profesor: ${new_level}!`;
                    message = `Has alcanzado el nivel ${new_level} como profesor con ${active_students} estudiantes activos. Ganarás ${weekly_luminarias} Luminarias semanales.`;
                    icon = 'level-up-teacher';
                    actionUrl = '/teacher/dashboard';
                    break;
            }

            const notificationData = {
                user_id: userId,
                notification_type: 'level_up',
                title: title,
                message: message,
                data: {
                    level_type: level_type,
                    new_level: new_level,
                    previous_level: previous_level,
                    block_id: block_id,
                    block_title: block_title,
                    consolidation: consolidation,
                    active_users: active_users,
                    active_students: active_students,
                    weekly_luminarias: weekly_luminarias,
                    action_url: actionUrl
                },
                icon: icon,
                priority: 'high'
            };

            await this.createNotification(notificationData);

            // Enviar notificación push si está habilitada
            await this.sendPushNotification(userId, title, message, notificationData.data);

            console.log(`Notificación de subida de nivel enviada a usuario ${userId}: ${title}`);

        } catch (error) {
            console.error('Error sending level up notification:', error);
        }
    }

    async sendWeeklyPaymentNotification(userId, paymentData) {
        try {
            const { level_type, level_name, base_amount, bonus_amount, total_amount, week_start, week_end } = paymentData;

            const title = `💰 Pago semanal recibido`;
            const message = `Has recibido ${total_amount} Luminarias por tu nivel ${level_name} (${base_amount} base${bonus_amount > 0 ? ` + ${bonus_amount} bonus` : ''}).`;

            const notificationData = {
                user_id: userId,
                notification_type: 'weekly_payment',
                title: title,
                message: message,
                data: {
                    level_type: level_type,
                    level_name: level_name,
                    base_amount: base_amount,
                    bonus_amount: bonus_amount,
                    total_amount: total_amount,
                    week_start: week_start,
                    week_end: week_end,
                    action_url: '/profile/payments'
                },
                icon: 'payment-received',
                priority: 'medium'
            };

            await this.createNotification(notificationData);

            console.log(`Notificación de pago semanal enviada a usuario ${userId}: ${total_amount} Luminarias`);

        } catch (error) {
            console.error('Error sending weekly payment notification:', error);
        }
    }

    async sendLevelProgressNotification(userId, progressData) {
        try {
            const { level_type, current_level, progress_to_next, next_level, threshold_difference, block_title } = progressData;

            if (progress_to_next < 80) return; // Solo notificar cuando esté cerca del siguiente nivel

            let title, message;

            switch (level_type) {
                case 'user':
                    title = `📈 ¡Cerca del siguiente nivel!`;
                    message = `Estás al ${progress_to_next}% del nivel ${next_level} en "${block_title}". ¡Solo necesitas ${threshold_difference}% más de consolidación!`;
                    break;

                case 'creator':
                    title = `🎯 Cerca del siguiente nivel de Creador`;
                    message = `Estás al ${progress_to_next}% del nivel ${next_level}. Necesitas ${threshold_difference} usuarios activos más.`;
                    break;

                case 'teacher':
                    title = `🎓 Cerca del siguiente nivel de Profesor`;
                    message = `Estás al ${progress_to_next}% del nivel ${next_level}. Necesitas ${threshold_difference} estudiantes activos más.`;
                    break;
            }

            const notificationData = {
                user_id: userId,
                notification_type: 'level_progress',
                title: title,
                message: message,
                data: {
                    level_type: level_type,
                    current_level: current_level,
                    next_level: next_level,
                    progress_percentage: progress_to_next,
                    threshold_difference: threshold_difference,
                    block_title: block_title,
                    action_url: level_type === 'user' ? `/blocks/${progressData.block_id}/progress` : `/${level_type}/dashboard`
                },
                icon: 'progress-alert',
                priority: 'low'
            };

            await this.createNotification(notificationData);

        } catch (error) {
            console.error('Error sending level progress notification:', error);
        }
    }

    async sendMilestoneNotification(userId, milestoneData) {
        try {
            const { milestone_type, achievement, value, level_type, rewards } = milestoneData;

            let title, message;

            switch (milestone_type) {
                case 'first_level_up':
                    title = '🏆 ¡Primer nivel alcanzado!';
                    message = `¡Felicitaciones! Has alcanzado tu primer nivel como ${level_type}. ${achievement}`;
                    break;

                case 'consolidation_milestone':
                    title = '📚 Hito de consolidación';
                    message = `¡Excelente! Has alcanzado ${value}% de consolidación promedio en tus bloques.`;
                    break;

                case 'activity_milestone':
                    title = '⚡ Hito de actividad';
                    message = `¡Impresionante! Has logrado ${value} ${level_type === 'creator' ? 'usuarios activos' : 'estudiantes activos'}.`;
                    break;

                case 'streak_milestone':
                    title = '🔥 Racha de nivel manttenida';
                    message = `Has mantenido tu nivel ${achievement} durante ${value} semanas consecutivas.`;
                    break;
            }

            const notificationData = {
                user_id: userId,
                notification_type: 'milestone',
                title: title,
                message: message,
                data: {
                    milestone_type: milestone_type,
                    achievement: achievement,
                    value: value,
                    level_type: level_type,
                    rewards: rewards,
                    action_url: '/profile/achievements'
                },
                icon: 'milestone-achieved',
                priority: 'medium'
            };

            await this.createNotification(notificationData);

            console.log(`Notificación de hito enviada a usuario ${userId}: ${title}`);

        } catch (error) {
            console.error('Error sending milestone notification:', error);
        }
    }

    // ==================== GESTIÓN DE NOTIFICACIONES ====================

    async createNotification(notificationData) {
        try {
            // Verificar preferencias del usuario
            const preferences = await this.getUserNotificationPreferences(notificationData.user_id);
            
            if (!this.shouldSendNotification(notificationData.notification_type, preferences)) {
                return false;
            }

            const result = await this.pool.query(`
                INSERT INTO user_notifications (
                    user_id, notification_type, title, message, data, icon, priority, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
                RETURNING id
            `, [
                notificationData.user_id,
                notificationData.notification_type,
                notificationData.title,
                notificationData.message,
                JSON.stringify(notificationData.data),
                notificationData.icon,
                notificationData.priority
            ]);

            return result.rows[0].id;

        } catch (error) {
            console.error('Error creating notification:', error);
            return false;
        }
    }

    async getUserNotifications(userId, limit = 20, offset = 0) {
        try {
            const result = await this.pool.query(`
                SELECT *
                FROM user_notifications
                WHERE user_id = $1
                ORDER BY created_at DESC
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
            const result = await this.pool.query(`
                UPDATE user_notifications 
                SET read_at = CURRENT_TIMESTAMP 
                WHERE id = $1 AND user_id = $2 AND read_at IS NULL
                RETURNING id
            `, [notificationId, userId]);

            return result.rows.length > 0;

        } catch (error) {
            console.error('Error marking notification as read:', error);
            return false;
        }
    }

    async markAllNotificationsAsRead(userId) {
        try {
            const result = await this.pool.query(`
                UPDATE user_notifications 
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
                FROM user_notifications
                WHERE user_id = $1 AND read_at IS NULL
            `, [userId]);

            return parseInt(result.rows[0].count);

        } catch (error) {
            console.error('Error getting unread notifications count:', error);
            return 0;
        }
    }

    // ==================== PREFERENCIAS DE NOTIFICACIONES ====================

    async getUserNotificationPreferences(userId) {
        try {
            const result = await this.pool.query(`
                SELECT preferences
                FROM user_notification_preferences
                WHERE user_id = $1
            `, [userId]);

            if (result.rows.length === 0) {
                // Crear preferencias por defecto
                const defaultPreferences = {
                    level_up: true,
                    weekly_payment: true,
                    level_progress: true,
                    milestone: true,
                    push_notifications: true,
                    email_notifications: false
                };

                await this.pool.query(`
                    INSERT INTO user_notification_preferences (user_id, preferences)
                    VALUES ($1, $2)
                `, [userId, JSON.stringify(defaultPreferences)]);

                return defaultPreferences;
            }

            return result.rows[0].preferences;

        } catch (error) {
            console.error('Error getting user notification preferences:', error);
            return {
                level_up: true,
                weekly_payment: true,
                level_progress: true,
                milestone: true,
                push_notifications: true,
                email_notifications: false
            };
        }
    }

    async updateUserNotificationPreferences(userId, preferences) {
        try {
            await this.pool.query(`
                INSERT INTO user_notification_preferences (user_id, preferences)
                VALUES ($1, $2)
                ON CONFLICT (user_id) DO UPDATE SET
                    preferences = EXCLUDED.preferences,
                    updated_at = CURRENT_TIMESTAMP
            `, [userId, JSON.stringify(preferences)]);

            return true;

        } catch (error) {
            console.error('Error updating user notification preferences:', error);
            return false;
        }
    }

    shouldSendNotification(notificationType, preferences) {
        return preferences[notificationType] !== false;
    }

    // ==================== NOTIFICACIONES PUSH ====================

    async sendPushNotification(userId, title, message, data) {
        try {
            // Obtener tokens de push del usuario
            const tokensResult = await this.pool.query(`
                SELECT push_token, platform
                FROM user_push_tokens
                WHERE user_id = $1 AND is_active = true
            `, [userId]);

            if (tokensResult.rows.length === 0) {
                return false;
            }

            // Simular envío de notificación push (aquí integrarías con FCM, APNS, etc.)
            for (const tokenData of tokensResult.rows) {
                console.log(`📱 Push notification enviada a ${tokenData.platform}:`, {
                    title,
                    message,
                    token: tokenData.push_token.substring(0, 20) + '...',
                    data
                });
            }

            return true;

        } catch (error) {
            console.error('Error sending push notification:', error);
            return false;
        }
    }

    // ==================== NOTIFICACIONES PERIÓDICAS ====================

    async runPeriodicNotifications() {
        try {
            console.log('🔔 Ejecutando notificaciones periódicas de niveles...');

            // Notificar usuarios cerca del siguiente nivel
            await this.notifyUsersNearLevelUp();

            // Notificar usuarios inactivos con recordatorios
            await this.sendInactivityReminders();

            // Notificar hitos semanales
            await this.sendWeeklyMilestones();

            console.log('✅ Notificaciones periódicas completadas');

        } catch (error) {
            console.error('Error running periodic notifications:', error);
        }
    }

    async notifyUsersNearLevelUp() {
        try {
            // Usuarios cerca del siguiente nivel (consolidación)
            const usersNearLevel = await this.pool.query(`
                SELECT 
                    ul.user_id,
                    ul.block_id,
                    b.title as block_title,
                    ul.current_metrics,
                    ld.level_name as current_level,
                    next_ld.level_name as next_level,
                    next_ld.min_threshold as next_threshold
                FROM user_levels ul
                JOIN level_definitions ld ON ul.current_level_id = ld.id
                JOIN blocks b ON ul.block_id = b.id
                LEFT JOIN level_definitions next_ld ON next_ld.level_type = 'user' 
                    AND next_ld.level_order = ld.level_order + 1
                WHERE ul.level_type = 'user'
                    AND next_ld.id IS NOT NULL
                    AND (ul.current_metrics->>'consolidation')::decimal >= next_ld.min_threshold - 10
                    AND (ul.current_metrics->>'consolidation')::decimal < next_ld.min_threshold
                    AND ul.last_calculated >= CURRENT_TIMESTAMP - INTERVAL '7 days'
            `);

            for (const user of usersNearLevel.rows) {
                const currentConsolidation = parseFloat(user.current_metrics.consolidation) || 0;
                const needed = user.next_threshold - currentConsolidation;
                const progress = (currentConsolidation / user.next_threshold) * 100;

                await this.sendLevelProgressNotification(user.user_id, {
                    level_type: 'user',
                    current_level: user.current_level,
                    next_level: user.next_level,
                    progress_to_next: Math.round(progress),
                    threshold_difference: Math.round(needed),
                    block_id: user.block_id,
                    block_title: user.block_title
                });
            }

            console.log(`📊 Notificados ${usersNearLevel.rows.length} usuarios cerca del siguiente nivel`);

        } catch (error) {
            console.error('Error notifying users near level up:', error);
        }
    }

    async sendInactivityReminders() {
        try {
            // Usuarios con niveles pero sin actividad reciente
            const inactiveUsers = await this.pool.query(`
                SELECT DISTINCT 
                    ul.user_id,
                    u.nickname,
                    ul.level_type,
                    ld.level_name,
                    ul.last_calculated
                FROM user_levels ul
                JOIN users u ON ul.user_id = u.id
                JOIN level_definitions ld ON ul.current_level_id = ld.id
                WHERE ul.last_calculated < CURRENT_TIMESTAMP - INTERVAL '14 days'
                    AND ul.level_type IN ('creator', 'teacher')
                    AND ld.weekly_luminarias > 0
            `);

            for (const user of inactiveUsers.rows) {
                const daysSinceActivity = Math.floor((new Date() - new Date(user.last_calculated)) / (1000 * 60 * 60 * 24));

                await this.createNotification({
                    user_id: user.user_id,
                    notification_type: 'inactivity_reminder',
                    title: '⏰ Recordatorio de actividad',
                    message: `No has tenido actividad como ${user.level_type} en ${daysSinceActivity} días. Tu nivel ${user.level_name} podría verse afectado.`,
                    data: {
                        level_type: user.level_type,
                        level_name: user.level_name,
                        days_inactive: daysSinceActivity,
                        action_url: `/${user.level_type}/dashboard`
                    },
                    icon: 'reminder',
                    priority: 'low'
                });
            }

            console.log(`⏰ Enviados ${inactiveUsers.rows.length} recordatorios de inactividad`);

        } catch (error) {
            console.error('Error sending inactivity reminders:', error);
        }
    }

    async sendWeeklyMilestones() {
        try {
            // Buscar usuarios que han mantenido su nivel durante varias semanas
            const weeklyStreaks = await this.pool.query(`
                SELECT 
                    user_id,
                    level_type,
                    current_level_id,
                    COUNT(*) as weeks_maintained
                FROM weekly_luminarias_payments
                WHERE week_start_date >= CURRENT_TIMESTAMP - INTERVAL '8 weeks'
                    AND payment_status = 'paid'
                GROUP BY user_id, level_type, current_level_id
                HAVING COUNT(*) >= 4
            `);

            for (const streak of weeklyStreaks.rows) {
                if ([4, 8, 12, 24].includes(streak.weeks_maintained)) {
                    const levelResult = await this.pool.query(`
                        SELECT level_name FROM level_definitions WHERE id = $1
                    `, [streak.current_level_id]);

                    if (levelResult.rows.length > 0) {
                        await this.sendMilestoneNotification(streak.user_id, {
                            milestone_type: 'streak_milestone',
                            achievement: levelResult.rows[0].level_name,
                            value: streak.weeks_maintained,
                            level_type: streak.level_type,
                            rewards: { bonus_luminarias: streak.weeks_maintained * 5 }
                        });
                    }
                }
            }

            console.log(`🏆 Enviadas notificaciones de hitos semanales`);

        } catch (error) {
            console.error('Error sending weekly milestones:', error);
        }
    }

    // ==================== CLEANUP Y MANTENIMIENTO ====================

    async cleanupOldNotifications(daysOld = 90) {
        try {
            const result = await this.pool.query(`
                DELETE FROM user_notifications
                WHERE created_at < CURRENT_TIMESTAMP - INTERVAL $1
                RETURNING id
            `, [`${daysOld} days`]);

            console.log(`🧹 Eliminadas ${result.rows.length} notificaciones antiguas (>${daysOld} días)`);

            return result.rows.length;

        } catch (error) {
            console.error('Error cleaning up old notifications:', error);
            return 0;
        }
    }

    async getNotificationStats() {
        try {
            const result = await this.pool.query(`
                SELECT 
                    notification_type,
                    COUNT(*) as total_sent,
                    COUNT(CASE WHEN read_at IS NOT NULL THEN 1 END) as total_read,
                    COUNT(CASE WHEN read_at IS NOT NULL THEN 1 END)::decimal / COUNT(*) * 100 as read_rate
                FROM user_notifications
                WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
                GROUP BY notification_type
                ORDER BY total_sent DESC
            `);

            return result.rows;

        } catch (error) {
            console.error('Error getting notification stats:', error);
            return [];
        }
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = LevelsNotificationSystem;