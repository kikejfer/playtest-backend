const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

// Sistema de autenticación para WebSocket
class WebSocketAuth {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
        
        this.connectedUsers = new Map(); // userId -> Set of socket ids
        this.userSockets = new Map(); // socketId -> user info
    }

    async authenticateSocket(socket, token) {
        try {
            if (!token) {
                throw new Error('Token requerido para conexión WebSocket');
            }

            // Verificar JWT
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            
            // Verificar usuario en base de datos
            const result = await this.pool.query(
                'SELECT u.id, u.nickname, u.role FROM users u WHERE u.id = $1',
                [decoded.userId]
            );

            if (result.rows.length === 0) {
                throw new Error('Usuario no válido');
            }

            const user = result.rows[0];
            
            // Registrar conexión
            this.registerConnection(socket.id, user);
            
            return user;

        } catch (error) {
            console.error('Error autenticando WebSocket:', error);
            throw error;
        }
    }

    registerConnection(socketId, user) {
        // Registrar socket del usuario
        this.userSockets.set(socketId, user);
        
        // Agregar a la lista de conexiones del usuario
        if (!this.connectedUsers.has(user.id)) {
            this.connectedUsers.set(user.id, new Set());
        }
        this.connectedUsers.get(user.id).add(socketId);

        console.log(`🔌 Usuario ${user.nickname} (${user.id}) conectado via WebSocket [${socketId}]`);
    }

    unregisterConnection(socketId) {
        const user = this.userSockets.get(socketId);
        if (user) {
            this.userSockets.delete(socketId);
            
            if (this.connectedUsers.has(user.id)) {
                this.connectedUsers.get(user.id).delete(socketId);
                
                // Si no tiene más conexiones, remover del mapa
                if (this.connectedUsers.get(user.id).size === 0) {
                    this.connectedUsers.delete(user.id);
                }
            }

            console.log(`🔌 Usuario ${user.nickname} (${user.id}) desconectado [${socketId}]`);
        }
    }

    getUserFromSocket(socketId) {
        return this.userSockets.get(socketId);
    }

    getUserSockets(userId) {
        return this.connectedUsers.get(userId) || new Set();
    }

    isUserConnected(userId) {
        return this.connectedUsers.has(userId);
    }

    // Enviar mensaje a usuario específico
    sendToUser(io, userId, event, data) {
        const userSockets = this.getUserSockets(userId);
        userSockets.forEach(socketId => {
            io.to(socketId).emit(event, data);
        });
    }

    // Enviar mensaje a usuarios por rol
    sendToRole(io, role, event, data) {
        this.userSockets.forEach((user, socketId) => {
            if (user.role === role) {
                io.to(socketId).emit(event, data);
            }
        });
    }

    // Broadcast a todos los usuarios conectados
    broadcastToAll(io, event, data, excludeUserId = null) {
        this.userSockets.forEach((user, socketId) => {
            if (user.id !== excludeUserId) {
                io.to(socketId).emit(event, data);
            }
        });
    }

    // Obtener estadísticas de conexiones
    getConnectionStats() {
        const usersByRole = {};
        this.userSockets.forEach(user => {
            usersByRole[user.role] = (usersByRole[user.role] || 0) + 1;
        });

        return {
            total_connections: this.userSockets.size,
            unique_users: this.connectedUsers.size,
            users_by_role: usersByRole,
            connected_users: Array.from(this.connectedUsers.keys())
        };
    }

    // Autorización para diferentes eventos
    canAccessEvent(user, event) {
        const rolePermissions = {
            'admin_principal': ['*'], // Acceso total
            'admin_secundario': [
                'user_update', 'block_update', 'game_update', 
                'notification', 'challenge_update', 'level_update'
            ],
            'profesor': [
                'student_update', 'block_update', 'game_update',
                'notification', 'level_update'
            ],
            'creador': [
                'block_update', 'game_update', 'question_update',
                'notification', 'level_update', 'analytics'
            ],
            'usuario': [
                'game_update', 'notification', 'level_update', 'challenge_update'
            ]
        };

        const userPermissions = rolePermissions[user.role] || [];
        
        // Admin principal tiene acceso total
        if (userPermissions.includes('*')) {
            return true;
        }

        return userPermissions.includes(event);
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = WebSocketAuth;