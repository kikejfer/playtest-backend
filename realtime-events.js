const WebSocketAuth = require('./websocket-auth');

// Sistema de eventos en tiempo real para PLAYTEST
class RealTimeEvents {
    constructor(io) {
        this.io = io;
        this.auth = new WebSocketAuth();
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.io.on('connection', async (socket) => {
            console.log(`🔌 Nueva conexión WebSocket: ${socket.id}`);

            // Manejar autenticación inicial
            socket.on('authenticate', async (data) => {
                try {
                    const user = await this.auth.authenticateSocket(socket, data.token);
                    socket.emit('authenticated', { 
                        success: true, 
                        user: { id: user.id, nickname: user.nickname, role: user.role }
                    });

                    // Unirse a salas por rol
                    socket.join(`role_${user.role}`);
                    socket.join(`user_${user.id}`);

                    // Enviar estadísticas iniciales
                    socket.emit('connection_stats', this.auth.getConnectionStats());

                } catch (error) {
                    socket.emit('authentication_error', { error: error.message });
                    socket.disconnect();
                }
            });

            // Eventos de juegos en tiempo real
            socket.on('join_game', async (data) => {
                const user = this.auth.getUserFromSocket(socket.id);
                if (!user) return;

                socket.join(`game_${data.gameId}`);
                socket.to(`game_${data.gameId}`).emit('player_joined', {
                    userId: user.id,
                    nickname: user.nickname
                });
            });

            socket.on('game_progress', async (data) => {
                const user = this.auth.getUserFromSocket(socket.id);
                if (!user || !this.auth.canAccessEvent(user, 'game_update')) return;

                socket.to(`game_${data.gameId}`).emit('player_progress', {
                    userId: user.id,
                    progress: data.progress,
                    timestamp: Date.now()
                });
            });

            socket.on('game_completed', async (data) => {
                const user = this.auth.getUserFromSocket(socket.id);
                if (!user) return;

                this.io.to(`game_${data.gameId}`).emit('game_finished', {
                    winnerId: user.id,
                    winnerNickname: user.nickname,
                    finalScores: data.scores,
                    gameId: data.gameId
                });
            });

            // Eventos de challenges
            socket.on('challenge_progress', async (data) => {
                const user = this.auth.getUserFromSocket(socket.id);
                if (!user || !this.auth.canAccessEvent(user, 'challenge_update')) return;

                // Notificar a admins sobre progreso de challenge
                this.auth.sendToRole(this.io, 'admin_principal', 'challenge_progress_update', {
                    userId: user.id,
                    challengeId: data.challengeId,
                    progress: data.progress
                });
            });

            // Eventos de niveles
            socket.on('level_up', async (data) => {
                const user = this.auth.getUserFromSocket(socket.id);
                if (!user) return;

                // Notificar a todos los usuarios conectados sobre subida de nivel
                this.auth.broadcastToAll(this.io, 'user_level_up', {
                    userId: user.id,
                    nickname: user.nickname,
                    levelType: data.levelType,
                    newLevel: data.newLevel
                }, user.id);
            });

            // Eventos de notificaciones
            socket.on('mark_notification_read', async (data) => {
                const user = this.auth.getUserFromSocket(socket.id);
                if (!user) return;

                // Aquí se podría actualizar la base de datos
                socket.emit('notification_marked_read', { notificationId: data.notificationId });
            });

            // Eventos administrativos
            socket.on('admin_broadcast', async (data) => {
                const user = this.auth.getUserFromSocket(socket.id);
                if (!user || !this.auth.canAccessEvent(user, '*')) return;

                this.auth.broadcastToAll(this.io, 'admin_announcement', {
                    message: data.message,
                    priority: data.priority || 'medium',
                    timestamp: Date.now(),
                    from: user.nickname
                });
            });

            // Eventos de chat/comunicación
            socket.on('send_message', async (data) => {
                const user = this.auth.getUserFromSocket(socket.id);
                if (!user) return;

                if (data.type === 'support_chat') {
                    // Enviar a admins y soporte técnico
                    this.auth.sendToRole(this.io, 'admin_principal', 'support_message', {
                        from: user,
                        message: data.message,
                        ticketId: data.ticketId,
                        timestamp: Date.now()
                    });
                }
            });

            // Desconexión
            socket.on('disconnect', () => {
                this.auth.unregisterConnection(socket.id);
                console.log(`🔌 Desconexión WebSocket: ${socket.id}`);
            });
        });
    }

    // Métodos para enviar eventos desde el backend
    notifyLevelUp(userId, levelData) {
        this.auth.sendToUser(this.io, userId, 'level_up_notification', levelData);
    }

    notifyChallenge(userId, challengeData) {
        this.auth.sendToUser(this.io, userId, 'challenge_notification', challengeData);
    }

    notifyPayment(userId, paymentData) {
        this.auth.sendToUser(this.io, userId, 'payment_notification', paymentData);
    }

    broadcastSystemMaintenance(message) {
        this.auth.broadcastToAll(this.io, 'system_maintenance', {
            message,
            timestamp: Date.now()
        });
    }

    notifyAdmins(event, data) {
        this.auth.sendToRole(this.io, 'admin_principal', event, data);
    }

    // Estadísticas en tiempo real
    getStats() {
        return this.auth.getConnectionStats();
    }

    async close() {
        await this.auth.close();
    }
}

module.exports = RealTimeEvents;