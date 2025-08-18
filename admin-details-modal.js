// Sistema de modales de detalles completos para paneles admin
class AdminDetailsModal {
    constructor() {
        this.currentModal = null;
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // Cerrar modal con ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.currentModal) {
                this.closeModal();
            }
        });

        // Cerrar modal clickeando fuera
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                this.closeModal();
            }
        });
    }

    // Modal para detalles completos de bloque
    showBlockDetailsModal(blockData) {
        const modalContent = `
            <div class="modal-overlay" id="blockDetailsModal">
                <div class="modal-container">
                    <div class="modal-header">
                        <h2>📊 Detalles Completos del Bloque</h2>
                        <button class="modal-close" onclick="adminDetailsModal.closeModal()">×</button>
                    </div>
                    
                    <div class="modal-body">
                        <div class="details-grid">
                            <!-- Información Básica -->
                            <div class="detail-section">
                                <h3>📋 Información Básica</h3>
                                <div class="detail-item">
                                    <label>ID:</label>
                                    <span>${blockData.id}</span>
                                </div>
                                <div class="detail-item">
                                    <label>Título:</label>
                                    <span>${blockData.title}</span>
                                </div>
                                <div class="detail-item">
                                    <label>Descripción:</label>
                                    <span class="description-text">${blockData.description || 'Sin descripción'}</span>
                                </div>
                                <div class="detail-item">
                                    <label>Categoría:</label>
                                    <span class="category-badge">${blockData.category}</span>
                                </div>
                                <div class="detail-item">
                                    <label>Dificultad:</label>
                                    <span class="difficulty-badge difficulty-${blockData.difficulty.toLowerCase()}">${blockData.difficulty}</span>
                                </div>
                                <div class="detail-item">
                                    <label>Visibilidad:</label>
                                    <span class="visibility-badge ${blockData.visibility}">${blockData.visibility}</span>
                                </div>
                            </div>

                            <!-- Información del Creador -->
                            <div class="detail-section">
                                <h3>👤 Creador</h3>
                                <div class="creator-info">
                                    <div class="creator-avatar">
                                        <img src="/api/users/${blockData.creator_id}/avatar" 
                                             onerror="this.src='https://via.placeholder.com/40x40/2196F3/white?text=${blockData.creator_nickname.charAt(0).toUpperCase()}'"
                                             alt="Avatar">
                                    </div>
                                    <div class="creator-details">
                                        <div class="detail-item">
                                            <label>Nickname:</label>
                                            <span>${blockData.creator_nickname}</span>
                                        </div>
                                        <div class="detail-item">
                                            <label>Nivel Creador:</label>
                                            <span class="level-badge">${blockData.creator_level || 'Sin nivel'}</span>
                                        </div>
                                        <div class="detail-item">
                                            <label>Bloques Totales:</label>
                                            <span>${blockData.creator_total_blocks || 0}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Estadísticas -->
                            <div class="detail-section">
                                <h3>📈 Estadísticas</h3>
                                <div class="stats-grid">
                                    <div class="stat-card">
                                        <div class="stat-number">${blockData.questions_count || 0}</div>
                                        <div class="stat-label">Preguntas</div>
                                    </div>
                                    <div class="stat-card">
                                        <div class="stat-number">${blockData.games_played || 0}</div>
                                        <div class="stat-label">Juegos Jugados</div>
                                    </div>
                                    <div class="stat-card">
                                        <div class="stat-number">${blockData.total_players || 0}</div>
                                        <div class="stat-label">Jugadores Únicos</div>
                                    </div>
                                    <div class="stat-card">
                                        <div class="stat-number">${blockData.success_rate || 0}%</div>
                                        <div class="stat-label">Tasa de Éxito</div>
                                    </div>
                                </div>
                            </div>

                            <!-- Fechas y Actividad -->
                            <div class="detail-section">
                                <h3>📅 Fechas y Actividad</h3>
                                <div class="detail-item">
                                    <label>Creado:</label>
                                    <span>${this.formatDate(blockData.created_at)}</span>
                                </div>
                                <div class="detail-item">
                                    <label>Última Modificación:</label>
                                    <span>${this.formatDate(blockData.updated_at)}</span>
                                </div>
                                <div class="detail-item">
                                    <label>Último Juego:</label>
                                    <span>${blockData.last_game_at ? this.formatDate(blockData.last_game_at) : 'Nunca'}</span>
                                </div>
                                <div class="detail-item">
                                    <label>Actividad Reciente:</label>
                                    <span class="activity-indicator ${blockData.is_active ? 'active' : 'inactive'}">
                                        ${blockData.is_active ? '🟢 Activo' : '🔴 Inactivo'}
                                    </span>
                                </div>
                            </div>

                            <!-- Temas -->
                            <div class="detail-section">
                                <h3>🏷️ Temas del Bloque</h3>
                                <div class="topics-container">
                                    ${blockData.topics ? blockData.topics.map(topic => 
                                        `<span class="topic-tag">${topic}</span>`
                                    ).join('') : '<span class="no-topics">Sin temas definidos</span>'}
                                </div>
                            </div>

                            <!-- Métricas Avanzadas -->
                            <div class="detail-section full-width">
                                <h3>📊 Métricas Avanzadas</h3>
                                <div class="advanced-metrics">
                                    <div class="metric-row">
                                        <label>Dificultad Promedio Percibida:</label>
                                        <div class="metric-bar">
                                            <div class="metric-fill" style="width: ${blockData.perceived_difficulty || 0}%"></div>
                                            <span class="metric-value">${blockData.perceived_difficulty || 0}%</span>
                                        </div>
                                    </div>
                                    <div class="metric-row">
                                        <label>Tiempo Promedio por Pregunta:</label>
                                        <span class="metric-value">${blockData.avg_time_per_question || 0}s</span>
                                    </div>
                                    <div class="metric-row">
                                        <label>Retención de Jugadores:</label>
                                        <div class="metric-bar">
                                            <div class="metric-fill" style="width: ${blockData.player_retention || 0}%"></div>
                                            <span class="metric-value">${blockData.player_retention || 0}%</span>
                                        </div>
                                    </div>
                                    <div class="metric-row">
                                        <label>Puntuación Promedio:</label>
                                        <span class="metric-value">${blockData.avg_score || 0}/100</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="adminDetailsModal.closeModal()">Cerrar</button>
                        <button class="btn btn-primary" onclick="adminDetailsModal.editBlock(${blockData.id})">Editar Bloque</button>
                        <button class="btn btn-warning" onclick="adminDetailsModal.managePermissions(${blockData.id})">Gestionar Permisos</button>
                        <button class="btn btn-info" onclick="adminDetailsModal.exportBlockData(${blockData.id})">Exportar Datos</button>
                    </div>
                </div>
            </div>
        `;

        this.showModal(modalContent);
    }

    // Modal para detalles completos de usuario
    showUserDetailsModal(userData) {
        const modalContent = `
            <div class="modal-overlay" id="userDetailsModal">
                <div class="modal-container large">
                    <div class="modal-header">
                        <h2>👤 Detalles Completos del Usuario</h2>
                        <button class="modal-close" onclick="adminDetailsModal.closeModal()">×</button>
                    </div>
                    
                    <div class="modal-body">
                        <div class="user-details-grid">
                            <!-- Perfil -->
                            <div class="detail-section">
                                <h3>👤 Perfil</h3>
                                <div class="user-profile">
                                    <div class="user-avatar-large">
                                        <img src="/api/users/${userData.id}/avatar" 
                                             onerror="this.src='https://via.placeholder.com/80x80/2196F3/white?text=${userData.nickname.charAt(0).toUpperCase()}'"
                                             alt="Avatar">
                                    </div>
                                    <div class="user-info">
                                        <div class="detail-item">
                                            <label>ID:</label>
                                            <span>${userData.id}</span>
                                        </div>
                                        <div class="detail-item">
                                            <label>Nickname:</label>
                                            <span class="nickname">${userData.nickname}</span>
                                        </div>
                                        <div class="detail-item">
                                            <label>Email:</label>
                                            <span>${userData.email}</span>
                                        </div>
                                        <div class="detail-item">
                                            <label>Nombre Completo:</label>
                                            <span>${userData.first_name || ''} ${userData.last_name || ''}</span>
                                        </div>
                                        <div class="detail-item">
                                            <label>Estado:</label>
                                            <span class="status-badge ${userData.is_active ? 'active' : 'inactive'}">
                                                ${userData.is_active ? '🟢 Activo' : '🔴 Inactivo'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Roles y Permisos -->
                            <div class="detail-section">
                                <h3>🔐 Roles y Permisos</h3>
                                <div class="roles-container">
                                    ${userData.roles ? userData.roles.map(role => 
                                        `<span class="role-badge role-${role.name}">${role.display_name}</span>`
                                    ).join('') : '<span class="no-roles">Sin roles asignados</span>'}
                                </div>
                                <div class="permissions-summary">
                                    <h4>Permisos Principales:</h4>
                                    <ul class="permissions-list">
                                        ${userData.permissions ? userData.permissions.slice(0, 5).map(perm => 
                                            `<li>✅ ${perm}</li>`
                                        ).join('') : '<li>Sin permisos específicos</li>'}
                                    </ul>
                                </div>
                            </div>

                            <!-- Niveles -->
                            <div class="detail-section">
                                <h3>🏆 Niveles</h3>
                                <div class="levels-container">
                                    <div class="level-item">
                                        <label>Usuario:</label>
                                        <span class="level-badge user-level">${userData.user_level || 'Sin nivel'}</span>
                                    </div>
                                    <div class="level-item">
                                        <label>Creador:</label>
                                        <span class="level-badge creator-level">${userData.creator_level || 'Sin nivel'}</span>
                                    </div>
                                    <div class="level-item">
                                        <label>Profesor:</label>
                                        <span class="level-badge teacher-level">${userData.teacher_level || 'Sin nivel'}</span>
                                    </div>
                                </div>
                            </div>

                            <!-- Estadísticas de Actividad -->
                            <div class="detail-section">
                                <h3>📊 Estadísticas</h3>
                                <div class="stats-grid">
                                    <div class="stat-card">
                                        <div class="stat-number">${userData.luminarias || 0}</div>
                                        <div class="stat-label">Luminarias</div>
                                    </div>
                                    <div class="stat-card">
                                        <div class="stat-number">${userData.blocks_created || 0}</div>
                                        <div class="stat-label">Bloques Creados</div>
                                    </div>
                                    <div class="stat-card">
                                        <div class="stat-number">${userData.games_played || 0}</div>
                                        <div class="stat-label">Juegos Jugados</div>
                                    </div>
                                    <div class="stat-card">
                                        <div class="stat-number">${userData.avg_score || 0}</div>
                                        <div class="stat-label">Puntuación Media</div>
                                    </div>
                                </div>
                            </div>

                            <!-- Actividad Reciente -->
                            <div class="detail-section full-width">
                                <h3>🕒 Actividad Reciente</h3>
                                <div class="activity-timeline">
                                    ${userData.recent_activity ? userData.recent_activity.map(activity => `
                                        <div class="activity-item">
                                            <div class="activity-icon">${this.getActivityIcon(activity.type)}</div>
                                            <div class="activity-content">
                                                <span class="activity-description">${activity.description}</span>
                                                <span class="activity-time">${this.formatDate(activity.timestamp)}</span>
                                            </div>
                                        </div>
                                    `).join('') : '<p class="no-activity">Sin actividad reciente</p>'}
                                </div>
                            </div>

                            <!-- Fechas Importantes -->
                            <div class="detail-section">
                                <h3>📅 Fechas</h3>
                                <div class="detail-item">
                                    <label>Registro:</label>
                                    <span>${this.formatDate(userData.created_at)}</span>
                                </div>
                                <div class="detail-item">
                                    <label>Último Acceso:</label>
                                    <span>${userData.last_login_at ? this.formatDate(userData.last_login_at) : 'Nunca'}</span>
                                </div>
                                <div class="detail-item">
                                    <label>Última Actividad:</label>
                                    <span>${userData.last_activity_at ? this.formatDate(userData.last_activity_at) : 'Desconocida'}</span>
                                </div>
                            </div>

                            <!-- Configuración de Cuenta -->
                            <div class="detail-section">
                                <h3>⚙️ Configuración</h3>
                                <div class="detail-item">
                                    <label>Email Verificado:</label>
                                    <span class="${userData.email_verified ? 'verified' : 'unverified'}">
                                        ${userData.email_verified ? '✅ Verificado' : '❌ No verificado'}
                                    </span>
                                </div>
                                <div class="detail-item">
                                    <label>2FA Activado:</label>
                                    <span class="${userData.two_factor_enabled ? 'enabled' : 'disabled'}">
                                        ${userData.two_factor_enabled ? '🔒 Activado' : '🔓 Desactivado'}
                                    </span>
                                </div>
                                <div class="detail-item">
                                    <label>Notificaciones:</label>
                                    <span class="${userData.notifications_enabled ? 'enabled' : 'disabled'}">
                                        ${userData.notifications_enabled ? '🔔 Activadas' : '🔕 Desactivadas'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="adminDetailsModal.closeModal()">Cerrar</button>
                        <button class="btn btn-primary" onclick="adminDetailsModal.editUser(${userData.id})">Editar Usuario</button>
                        <button class="btn btn-warning" onclick="adminDetailsModal.manageUserRoles(${userData.id})">Gestionar Roles</button>
                        <button class="btn btn-info" onclick="adminDetailsModal.viewUserHistory(${userData.id})">Ver Historial</button>
                        <button class="btn btn-danger" onclick="adminDetailsModal.suspendUser(${userData.id})">Suspender</button>
                    </div>
                </div>
            </div>
        `;

        this.showModal(modalContent);
    }

    // Modal para detalles de ticket de soporte
    showTicketDetailsModal(ticketData) {
        const modalContent = `
            <div class="modal-overlay" id="ticketDetailsModal">
                <div class="modal-container">
                    <div class="modal-header">
                        <h2>🎫 Detalles del Ticket #${ticketData.id}</h2>
                        <button class="modal-close" onclick="adminDetailsModal.closeModal()">×</button>
                    </div>
                    
                    <div class="modal-body">
                        <div class="ticket-details">
                            <!-- Header del Ticket -->
                            <div class="ticket-header">
                                <div class="ticket-title">
                                    <h3>${ticketData.title}</h3>
                                    <span class="ticket-status status-${ticketData.status}">${ticketData.status}</span>
                                    <span class="ticket-priority priority-${ticketData.priority}">${ticketData.priority}</span>
                                </div>
                                <div class="ticket-meta">
                                    <span>Creado: ${this.formatDate(ticketData.created_at)}</span>
                                    <span>Por: ${ticketData.created_by_name}</span>
                                </div>
                            </div>

                            <!-- Descripción -->
                            <div class="ticket-description">
                                <h4>Descripción:</h4>
                                <div class="description-content">${ticketData.description}</div>
                            </div>

                            <!-- Conversación -->
                            <div class="ticket-conversation">
                                <h4>Conversación:</h4>
                                <div class="conversation-messages">
                                    ${ticketData.messages ? ticketData.messages.map(message => `
                                        <div class="message-item ${message.from_admin ? 'admin-message' : 'user-message'}">
                                            <div class="message-header">
                                                <strong>${message.author_name}</strong>
                                                <span class="message-time">${this.formatDate(message.created_at)}</span>
                                            </div>
                                            <div class="message-content">${message.content}</div>
                                            ${message.attachments ? `
                                                <div class="message-attachments">
                                                    ${message.attachments.map(att => `
                                                        <a href="${att.url}" target="_blank" class="attachment-link">
                                                            📎 ${att.filename}
                                                        </a>
                                                    `).join('')}
                                                </div>
                                            ` : ''}
                                        </div>
                                    `).join('') : '<p>Sin mensajes</p>'}
                                </div>
                            </div>

                            <!-- Responder -->
                            <div class="ticket-response">
                                <h4>Responder al Ticket:</h4>
                                <textarea id="ticketResponse" placeholder="Escribe tu respuesta..."></textarea>
                                <div class="response-actions">
                                    <select id="newTicketStatus">
                                        <option value="open">Abierto</option>
                                        <option value="in_progress">En Progreso</option>
                                        <option value="waiting_user">Esperando Usuario</option>
                                        <option value="resolved">Resuelto</option>
                                        <option value="closed">Cerrado</option>
                                    </select>
                                    <button class="btn btn-primary" onclick="adminDetailsModal.respondToTicket(${ticketData.id})">
                                        Enviar Respuesta
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="adminDetailsModal.closeModal()">Cerrar</button>
                        <button class="btn btn-warning" onclick="adminDetailsModal.escalateTicket(${ticketData.id})">Escalar</button>
                        <button class="btn btn-info" onclick="adminDetailsModal.exportTicket(${ticketData.id})">Exportar</button>
                    </div>
                </div>
            </div>
        `;

        this.showModal(modalContent);
    }

    // Mostrar modal genérico
    showModal(content) {
        // Remover modal existente
        this.closeModal();

        // Crear nuevo modal
        const modalElement = document.createElement('div');
        modalElement.innerHTML = content;
        document.body.appendChild(modalElement);

        this.currentModal = modalElement;

        // Animación de entrada
        setTimeout(() => {
            const overlay = modalElement.querySelector('.modal-overlay');
            if (overlay) {
                overlay.classList.add('active');
            }
        }, 10);
    }

    // Cerrar modal actual
    closeModal() {
        if (this.currentModal) {
            const overlay = this.currentModal.querySelector('.modal-overlay');
            if (overlay) {
                overlay.classList.remove('active');
                setTimeout(() => {
                    this.currentModal.remove();
                    this.currentModal = null;
                }, 300);
            } else {
                this.currentModal.remove();
                this.currentModal = null;
            }
        }
    }

    // Utilidades
    formatDate(dateString) {
        if (!dateString) return 'No disponible';
        
        const date = new Date(dateString);
        const now = new Date();
        const diffTime = now - date;
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return `Hoy ${date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
        } else if (diffDays === 1) {
            return `Ayer ${date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
        } else if (diffDays < 7) {
            return `Hace ${diffDays} días`;
        } else {
            return date.toLocaleDateString('es-ES');
        }
    }

    getActivityIcon(activityType) {
        const icons = {
            'login': '🚪',
            'game_played': '🎮',
            'block_created': '📝',
            'comment_posted': '💬',
            'level_up': '⬆️',
            'purchase': '💰',
            'achievement': '🏆'
        };
        return icons[activityType] || '📌';
    }

    // Acciones del modal
    editBlock(blockId) {
        // Implementar edición de bloque
        console.log('Editando bloque:', blockId);
        this.closeModal();
    }

    editUser(userId) {
        // Implementar edición de usuario
        console.log('Editando usuario:', userId);
        this.closeModal();
    }

    managePermissions(blockId) {
        // Implementar gestión de permisos
        console.log('Gestionando permisos del bloque:', blockId);
    }

    manageUserRoles(userId) {
        // Implementar gestión de roles de usuario
        console.log('Gestionando roles del usuario:', userId);
    }

    respondToTicket(ticketId) {
        const response = document.getElementById('ticketResponse').value;
        const newStatus = document.getElementById('newTicketStatus').value;
        
        if (!response.trim()) {
            alert('Por favor escribe una respuesta');
            return;
        }

        // Implementar envío de respuesta
        console.log('Respondiendo al ticket:', ticketId, response, newStatus);
        this.closeModal();
    }

    exportBlockData(blockId) {
        // Implementar exportación de datos del bloque
        console.log('Exportando datos del bloque:', blockId);
    }

    exportTicket(ticketId) {
        // Implementar exportación del ticket
        console.log('Exportando ticket:', ticketId);
    }
}

// Inicializar sistema de modales
const adminDetailsModal = new AdminDetailsModal();

// CSS adicional para los modales
const modalStyles = `
<style>
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 10000;
    opacity: 0;
    transition: opacity 0.3s ease;
}

.modal-overlay.active {
    opacity: 1;
}

.modal-container {
    background: white;
    border-radius: 12px;
    max-width: 800px;
    max-height: 90vh;
    width: 90%;
    overflow: hidden;
    transform: scale(0.9);
    transition: transform 0.3s ease;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.modal-overlay.active .modal-container {
    transform: scale(1);
}

.modal-container.large {
    max-width: 1200px;
}

.modal-header {
    background: #f8f9fa;
    padding: 20px;
    border-bottom: 1px solid #dee2e6;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.modal-header h2 {
    margin: 0;
    color: #333;
    font-size: 1.5rem;
}

.modal-close {
    background: none;
    border: none;
    font-size: 24px;
    cursor: pointer;
    color: #666;
    padding: 0;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: background-color 0.2s;
}

.modal-close:hover {
    background: #e9ecef;
}

.modal-body {
    padding: 20px;
    max-height: 60vh;
    overflow-y: auto;
}

.modal-footer {
    background: #f8f9fa;
    padding: 15px 20px;
    border-top: 1px solid #dee2e6;
    display: flex;
    gap: 10px;
    justify-content: flex-end;
}

.details-grid, .user-details-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 20px;
}

.detail-section {
    background: #f8f9fa;
    padding: 15px;
    border-radius: 8px;
    border: 1px solid #e9ecef;
}

.detail-section.full-width {
    grid-column: 1 / -1;
}

.detail-section h3 {
    margin-top: 0;
    margin-bottom: 15px;
    color: #495057;
    font-size: 1.1rem;
}

.detail-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
    padding: 8px 0;
    border-bottom: 1px solid #e9ecef;
}

.detail-item:last-child {
    border-bottom: none;
    margin-bottom: 0;
}

.detail-item label {
    font-weight: 600;
    color: #6c757d;
    min-width: 120px;
}

.stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 15px;
}

.stat-card {
    background: white;
    padding: 15px;
    border-radius: 8px;
    text-align: center;
    border: 1px solid #e9ecef;
}

.stat-number {
    font-size: 1.8rem;
    font-weight: bold;
    color: #2196F3;
    margin-bottom: 5px;
}

.stat-label {
    font-size: 0.9rem;
    color: #6c757d;
}

.category-badge, .difficulty-badge, .visibility-badge, .level-badge, .role-badge, .status-badge {
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 500;
}

.difficulty-facil { background: #d4edda; color: #155724; }
.difficulty-medio { background: #fff3cd; color: #856404; }
.difficulty-dificil { background: #f8d7da; color: #721c24; }

.visibility-public { background: #d1ecf1; color: #0c5460; }
.visibility-private { background: #f8d7da; color: #721c24; }

.status-badge.active { background: #d4edda; color: #155724; }
.status-badge.inactive { background: #f8d7da; color: #721c24; }

.topics-container {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.topic-tag {
    background: #e7f3ff;
    color: #0066cc;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 0.8rem;
}

.metric-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
}

.metric-bar {
    position: relative;
    background: #e9ecef;
    height: 20px;
    width: 150px;
    border-radius: 10px;
    overflow: hidden;
}

.metric-fill {
    background: #28a745;
    height: 100%;
    transition: width 0.3s ease;
}

.metric-value {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 0.8rem;
    font-weight: 500;
}

.user-profile {
    display: flex;
    gap: 15px;
    align-items: center;
}

.user-avatar-large img {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    object-fit: cover;
}

.activity-timeline {
    max-height: 300px;
    overflow-y: auto;
}

.activity-item {
    display: flex;
    gap: 10px;
    margin-bottom: 15px;
    padding-bottom: 15px;
    border-bottom: 1px solid #e9ecef;
}

.activity-icon {
    font-size: 1.2rem;
    min-width: 30px;
}

.activity-content {
    flex: 1;
}

.activity-description {
    display: block;
    margin-bottom: 5px;
}

.activity-time {
    font-size: 0.8rem;
    color: #6c757d;
}

.ticket-conversation {
    margin: 20px 0;
}

.conversation-messages {
    max-height: 300px;
    overflow-y: auto;
    border: 1px solid #e9ecef;
    border-radius: 8px;
    padding: 15px;
}

.message-item {
    margin-bottom: 15px;
    padding: 10px;
    border-radius: 8px;
}

.admin-message {
    background: #e7f3ff;
    margin-left: 20px;
}

.user-message {
    background: #f8f9fa;
    margin-right: 20px;
}

.message-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
}

.message-time {
    font-size: 0.8rem;
    color: #6c757d;
}

.ticket-response textarea {
    width: 100%;
    min-height: 100px;
    padding: 10px;
    border: 1px solid #ced4da;
    border-radius: 4px;
    resize: vertical;
    font-family: inherit;
}

.response-actions {
    display: flex;
    gap: 10px;
    margin-top: 10px;
    align-items: center;
}

.btn {
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
    transition: background-color 0.2s;
}

.btn-primary { background: #007bff; color: white; }
.btn-secondary { background: #6c757d; color: white; }
.btn-warning { background: #ffc107; color: #212529; }
.btn-danger { background: #dc3545; color: white; }
.btn-info { background: #17a2b8; color: white; }

.btn:hover {
    opacity: 0.9;
}
</style>
`;

// Inyectar estilos
document.head.insertAdjacentHTML('beforeend', modalStyles);