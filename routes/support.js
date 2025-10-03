const express = require('express');
const { pool } = require('../database/connection');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// ==================== ENDPOINTS DE DASHBOARD Y MÉTRICAS ====================

// Dashboard principal con métricas en tiempo real
router.get('/dashboard/metrics', authenticateToken, async (req, res) => {
    try {
        // Verificar permisos de agente/admin
        if (!req.user.role || !['agent', 'admin', 'super_admin'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Acceso denegado. Solo agentes y administradores.' });
        }

        const metricsResult = await pool.query('SELECT * FROM support_dashboard_metrics');
        const metrics = metricsResult.rows[0];

        // Obtener tendencias de los últimos 7 días
        const trendsResult = await pool.query(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as tickets_created,
                COUNT(CASE WHEN status IN ('resolved', 'closed') THEN 1 END) as tickets_resolved
            FROM support_tickets 
            WHERE created_at >= NOW() - INTERVAL '7 days'
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        `);

        // Tipos de problemas más frecuentes
        const categoriesResult = await pool.query(`
            SELECT 
                sc.name as category_name,
                sc.color,
                COUNT(st.id) as ticket_count,
                AVG(CASE WHEN st.resolved_at IS NOT NULL 
                    THEN EXTRACT(EPOCH FROM (st.resolved_at - st.created_at)) / 3600 
                    ELSE NULL END) as avg_resolution_hours
            FROM support_categories sc
            LEFT JOIN support_tickets st ON sc.id = st.category_id
            WHERE st.created_at >= NOW() - INTERVAL '30 days' OR st.created_at IS NULL
            GROUP BY sc.id, sc.name, sc.color
            ORDER BY ticket_count DESC
            LIMIT 10
        `);

        // Alertas automáticas
        const alertsResult = await pool.query(`
            SELECT 
                'escalated' as alert_type,
                'Tickets Escalados Pendientes' as title,
                COUNT(*) as count,
                'critical' as severity
            FROM support_tickets 
            WHERE escalation_level > 0 AND status NOT IN ('resolved', 'closed')
            
            UNION ALL
            
            SELECT 
                'sla_risk' as alert_type,
                'Tickets en Riesgo de SLA' as title,
                COUNT(*) as count,
                'warning' as severity
            FROM support_tickets 
            WHERE status IN ('open', 'in_progress') 
              AND created_at < NOW() - INTERVAL '20 hours'
              AND escalation_level = 0
            
            UNION ALL
            
            SELECT 
                'high_volume' as alert_type,
                'Pico de Tickets Hoy' as title,
                COUNT(*) as count,
                CASE WHEN COUNT(*) > 50 THEN 'critical' 
                     WHEN COUNT(*) > 30 THEN 'warning' 
                     ELSE 'info' END as severity
            FROM support_tickets 
            WHERE created_at >= CURRENT_DATE
        `);

        res.json({
            metrics,
            trends: trendsResult.rows,
            categories: categoriesResult.rows,
            alerts: alertsResult.rows.filter(alert => alert.count > 0)
        });

    } catch (error) {
        console.error('Error obteniendo métricas del dashboard:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==================== ENDPOINTS DE TICKETS ====================

// Obtener lista de tickets con filtros avanzados
router.get('/tickets', authenticateToken, async (req, res) => {
    try {
        const {
            status,
            priority,
            category_id,
            assigned_to,
            escalation_level,
            group_id,
            search,
            limit = 50,
            offset = 0,
            sort_by = 'created_at',
            sort_order = 'DESC'
        } = req.query;

        let query = `
            SELECT 
                st.*,
                sc.name as category_name,
                sc.color as category_color,
                u.nickname as user_nickname,
                ua.nickname as assigned_nickname,
                stg.group_name,
                stg.total_tickets as group_total_tickets,
                (SELECT COUNT(*) FROM support_comments WHERE ticket_id = st.id) as comments_count,
                CASE 
                    WHEN st.due_date IS NOT NULL AND st.due_date < NOW() AND st.status NOT IN ('resolved', 'closed')
                    THEN true 
                    ELSE false 
                END as is_overdue
            FROM support_tickets st
            LEFT JOIN support_categories sc ON st.category_id = sc.id
            LEFT JOIN users u ON st.user_id = u.id
            LEFT JOIN users ua ON st.assigned_to = ua.id
            LEFT JOIN support_ticket_groups stg ON st.group_id = stg.id
            WHERE 1=1
        `;

        const params = [];
        let paramIndex = 1;

        // Filtros dinámicos
        if (status) {
            query += ` AND st.status = $${paramIndex}`;
            params.push(status);
            paramIndex++;
        }

        if (priority) {
            query += ` AND st.priority = $${paramIndex}`;
            params.push(priority);
            paramIndex++;
        }

        if (category_id) {
            query += ` AND st.category_id = $${paramIndex}`;
            params.push(category_id);
            paramIndex++;
        }

        if (assigned_to) {
            query += ` AND st.assigned_to = $${paramIndex}`;
            params.push(assigned_to);
            paramIndex++;
        }

        if (escalation_level) {
            query += ` AND st.escalation_level = $${paramIndex}`;
            params.push(escalation_level);
            paramIndex++;
        }

        if (group_id) {
            query += ` AND st.group_id = $${paramIndex}`;
            params.push(group_id);
            paramIndex++;
        }

        // Búsqueda de texto completo
        if (search) {
            query += ` AND (
                st.subject ILIKE $${paramIndex} OR 
                st.description ILIKE $${paramIndex} OR
                st.ticket_number ILIKE $${paramIndex} OR
                u.nickname ILIKE $${paramIndex}
            )`;
            params.push(`%${search}%`);
            paramIndex++;
        }

        // Ordenamiento
        const allowedSortFields = ['created_at', 'updated_at', 'priority', 'status', 'escalation_level'];
        const allowedSortOrders = ['ASC', 'DESC'];
        
        const safeSortBy = allowedSortFields.includes(sort_by) ? sort_by : 'created_at';
        const safeSortOrder = allowedSortOrders.includes(sort_order.toUpperCase()) ? sort_order.toUpperCase() : 'DESC';

        query += ` ORDER BY st.${safeSortBy} ${safeSortOrder}`;
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);

        // Obtener total para paginación
        let countQuery = `
            SELECT COUNT(*) as total
            FROM support_tickets st
            LEFT JOIN users u ON st.user_id = u.id
            WHERE 1=1
        `;

        const countParams = [];
        let countParamIndex = 1;

        // Aplicar los mismos filtros para el conteo
        if (status) {
            countQuery += ` AND st.status = $${countParamIndex}`;
            countParams.push(status);
            countParamIndex++;
        }

        if (priority) {
            countQuery += ` AND st.priority = $${countParamIndex}`;
            countParams.push(priority);
            countParamIndex++;
        }

        if (category_id) {
            countQuery += ` AND st.category_id = $${countParamIndex}`;
            countParams.push(category_id);
            countParamIndex++;
        }

        if (assigned_to) {
            countQuery += ` AND st.assigned_to = $${countParamIndex}`;
            countParams.push(assigned_to);
            countParamIndex++;
        }

        if (escalation_level) {
            countQuery += ` AND st.escalation_level = $${countParamIndex}`;
            countParams.push(escalation_level);
            countParamIndex++;
        }

        if (group_id) {
            countQuery += ` AND st.group_id = $${countParamIndex}`;
            countParams.push(group_id);
            countParamIndex++;
        }

        if (search) {
            countQuery += ` AND (
                st.subject ILIKE $${countParamIndex} OR 
                st.description ILIKE $${countParamIndex} OR
                st.ticket_number ILIKE $${countParamIndex} OR
                u.nickname ILIKE $${countParamIndex}
            )`;
            countParams.push(`%${search}%`);
            countParamIndex++;
        }

        const countResult = await pool.query(countQuery, countParams);

        res.json({
            tickets: result.rows,
            pagination: {
                total: parseInt(countResult.rows[0].total),
                limit: parseInt(limit),
                offset: parseInt(offset),
                pages: Math.ceil(countResult.rows[0].total / limit)
            }
        });

    } catch (error) {
        console.error('Error obteniendo tickets:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear nuevo ticket
router.post('/tickets', authenticateToken, async (req, res) => {
    try {
        const {
            subject,
            description,
            category_id,
            priority = 'medium',
            browser_info = {},
            device_info = {},
            error_logs,
            screenshot_urls = []
        } = req.body;

        if (!subject || !description) {
            return res.status(400).json({ error: 'Título y descripción son requeridos' });
        }

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Crear el ticket
            const ticketResult = await client.query(`
                INSERT INTO support_tickets (
                    user_id, user_email, user_nickname, subject, description, 
                    category_id, priority, browser_info, device_info, 
                    error_logs, screenshot_urls
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                RETURNING *
            `, [
                req.user.id,
                req.user.email,
                req.user.nickname,
                subject,
                description,
                category_id,
                priority,
                JSON.stringify(browser_info),
                JSON.stringify(device_info),
                error_logs,
                screenshot_urls
            ]);

            const ticket = ticketResult.rows[0];

            // Crear comentario inicial automático
            await client.query(`
                INSERT INTO support_comments (
                    ticket_id, user_id, user_type, content, is_automated
                ) VALUES ($1, $2, $3, $4, $5)
            `, [
                ticket.id,
                req.user.id,
                'system',
                `Ticket creado automáticamente. Usuario: ${req.user.nickname} (${req.user.email})`,
                true
            ]);

            await client.query('COMMIT');

            // El trigger se encargará de la agrupación automática
            
            res.status(201).json({
                success: true,
                ticket: ticket,
                message: 'Ticket creado exitosamente'
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('Error creando ticket:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener detalles de un ticket específico
router.get('/tickets/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const ticketResult = await pool.query(`
            SELECT 
                st.*,
                sc.name as category_name,
                sc.color as category_color,
                u.nickname as user_nickname,
                ua.nickname as assigned_nickname,
                stg.group_name,
                stg.total_tickets as group_total_tickets,
                stg.id as group_id
            FROM support_tickets st
            LEFT JOIN support_categories sc ON st.category_id = sc.id
            LEFT JOIN users u ON st.user_id = u.id
            LEFT JOIN users ua ON st.assigned_to = ua.id
            LEFT JOIN support_ticket_groups stg ON st.group_id = stg.id
            WHERE st.id = $1
        `, [id]);

        if (ticketResult.rows.length === 0) {
            return res.status(404).json({ error: 'Ticket no encontrado' });
        }

        const ticket = ticketResult.rows[0];

        // Obtener comentarios del ticket
        const commentsResult = await pool.query(`
            SELECT 
                sc.*,
                u.nickname as user_nickname,
                st.name as template_name
            FROM support_comments sc
            LEFT JOIN users u ON sc.user_id = u.id
            LEFT JOIN support_templates st ON sc.template_id = st.id
            WHERE sc.ticket_id = $1
            ORDER BY sc.created_at ASC
        `, [id]);

        // Si el ticket pertenece a un grupo, obtener tickets relacionados
        let relatedTickets = [];
        if (ticket.group_id) {
            const relatedResult = await pool.query(`
                SELECT 
                    id, ticket_number, subject, status, priority, 
                    user_nickname, created_at, is_group_master
                FROM support_tickets 
                WHERE group_id = $1 AND id != $2
                ORDER BY is_group_master DESC, created_at ASC
                LIMIT 10
            `, [ticket.group_id, id]);
            relatedTickets = relatedResult.rows;
        }

        res.json({
            ticket,
            comments: commentsResult.rows,
            related_tickets: relatedTickets
        });

    } catch (error) {
        console.error('Error obteniendo detalles del ticket:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==================== ENDPOINTS DE AGRUPACIÓN INTELIGENTE ====================

// Obtener grupos de tickets activos
router.get('/groups', authenticateToken, async (req, res) => {
    try {
        const {
            status = 'active',
            category_id,
            priority,
            assigned_to,
            limit = 20,
            offset = 0
        } = req.query;

        let query = `
            SELECT 
                stg.*,
                sc.name as category_name,
                sc.color as category_color,
                ua.nickname as assigned_nickname,
                COUNT(st.id) as actual_tickets,
                COUNT(DISTINCT st.user_id) as unique_users,
                MIN(st.created_at) as first_ticket_date,
                MAX(st.created_at) as last_ticket_date,
                AVG(CASE WHEN st.resolved_at IS NOT NULL 
                    THEN EXTRACT(EPOCH FROM (st.resolved_at - st.created_at)) / 3600 
                    ELSE NULL END) as avg_resolution_hours
            FROM support_ticket_groups stg
            LEFT JOIN support_categories sc ON stg.common_category_id = sc.id
            LEFT JOIN users ua ON stg.assigned_to = ua.id
            LEFT JOIN support_tickets st ON st.group_id = stg.id
            WHERE stg.group_status = $1
        `;

        const params = [status];
        let paramIndex = 2;

        if (category_id) {
            query += ` AND stg.common_category_id = $${paramIndex}`;
            params.push(category_id);
            paramIndex++;
        }

        if (priority) {
            query += ` AND stg.group_priority = $${paramIndex}`;
            params.push(priority);
            paramIndex++;
        }

        if (assigned_to) {
            query += ` AND stg.assigned_to = $${paramIndex}`;
            params.push(assigned_to);
            paramIndex++;
        }

        query += ` 
            GROUP BY stg.id, sc.name, sc.color, ua.nickname
            ORDER BY last_ticket_date DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);

        res.json({
            groups: result.rows
        });

    } catch (error) {
        console.error('Error obteniendo grupos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Gestión masiva de tickets en un grupo
router.post('/groups/:groupId/bulk-action', authenticateToken, async (req, res) => {
    try {
        // Verificar permisos de agente/admin
        if (!req.user.role || !['agent', 'admin', 'super_admin'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const { groupId } = req.params;
        const {
            action, // 'assign', 'update_status', 'add_comment', 'close', 'escalate'
            assigned_to,
            status,
            comment_content,
            template_id,
            ticket_ids = [] // Si está vacío, aplica a todos los tickets del grupo
        } = req.body;

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Obtener tickets del grupo (o específicos si se especificaron IDs)
            let ticketQuery = `
                SELECT id FROM support_tickets 
                WHERE group_id = $1
            `;
            const ticketParams = [groupId];

            if (ticket_ids.length > 0) {
                ticketQuery += ` AND id = ANY($2)`;
                ticketParams.push(ticket_ids);
            } else {
                ticketQuery += ` AND status NOT IN ('closed')`;
            }

            const ticketsResult = await client.query(ticketQuery, ticketParams);
            const targetTickets = ticketsResult.rows.map(row => row.id);

            if (targetTickets.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'No se encontraron tickets para procesar' });
            }

            let updatedCount = 0;

            // Ejecutar acción según el tipo
            switch (action) {
                case 'assign':
                    if (!assigned_to) {
                        throw new Error('assigned_to es requerido para asignar');
                    }
                    
                    await client.query(`
                        UPDATE support_tickets 
                        SET assigned_to = $1, assigned_at = NOW(), updated_at = NOW()
                        WHERE id = ANY($2)
                    `, [assigned_to, targetTickets]);

                    // Actualizar grupo también
                    await client.query(`
                        UPDATE support_ticket_groups 
                        SET assigned_to = $1, assigned_at = NOW(), updated_at = NOW()
                        WHERE id = $2
                    `, [assigned_to, groupId]);

                    updatedCount = targetTickets.length;
                    break;

                case 'update_status':
                    if (!status) {
                        throw new Error('status es requerido para actualizar estado');
                    }

                    await client.query(`
                        UPDATE support_tickets 
                        SET status = $1, 
                            resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() ELSE resolved_at END,
                            closed_at = CASE WHEN $1 = 'closed' THEN NOW() ELSE closed_at END,
                            updated_at = NOW()
                        WHERE id = ANY($2)
                    `, [status, targetTickets]);

                    updatedCount = targetTickets.length;
                    break;

                case 'add_comment':
                    if (!comment_content) {
                        throw new Error('comment_content es requerido para agregar comentario');
                    }

                    for (const ticketId of targetTickets) {
                        await client.query(`
                            INSERT INTO support_comments (
                                ticket_id, user_id, user_type, content, template_id
                            ) VALUES ($1, $2, $3, $4, $5)
                        `, [ticketId, req.user.id, 'agent', comment_content, template_id]);
                    }

                    updatedCount = targetTickets.length;
                    break;

                case 'close':
                    await client.query(`
                        UPDATE support_tickets 
                        SET status = 'closed', closed_at = NOW(), updated_at = NOW()
                        WHERE id = ANY($1)
                    `, [targetTickets]);

                    // Actualizar grupo si todos los tickets están cerrados
                    const remainingTickets = await client.query(`
                        SELECT COUNT(*) as count
                        FROM support_tickets 
                        WHERE group_id = $1 AND status NOT IN ('closed')
                    `, [groupId]);

                    if (remainingTickets.rows[0].count == 0) {
                        await client.query(`
                            UPDATE support_ticket_groups 
                            SET group_status = 'resolved', resolved_at = NOW(), updated_at = NOW()
                            WHERE id = $1
                        `, [groupId]);
                    }

                    updatedCount = targetTickets.length;
                    break;

                case 'escalate':
                    await client.query(`
                        UPDATE support_tickets 
                        SET escalation_level = escalation_level + 1, 
                            escalated_at = NOW(),
                            escalation_reason = 'Escalación masiva manual',
                            updated_at = NOW()
                        WHERE id = ANY($1)
                    `, [targetTickets]);

                    // Registrar escalaciones
                    for (const ticketId of targetTickets) {
                        await client.query(`
                            INSERT INTO support_escalations (
                                ticket_id, escalation_level, escalation_reason, 
                                escalation_type, is_automatic
                            ) VALUES ($1, 1, 'Escalación masiva manual', 'manual', false)
                        `, [ticketId]);
                    }

                    updatedCount = targetTickets.length;
                    break;

                default:
                    throw new Error('Acción no válida');
            }

            await client.query('COMMIT');

            res.json({
                success: true,
                action,
                tickets_updated: updatedCount,
                message: `${updatedCount} tickets procesados exitosamente`
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('Error en acción masiva:', error);
        res.status(500).json({ error: error.message || 'Error interno del servidor' });
    }
});

// ==================== ENDPOINTS DE BASE DE CONOCIMIENTO ====================

// Obtener artículos de la base de conocimiento
router.get('/knowledge-base', async (req, res) => {
    try {
        const {
            category_id,
            search,
            status = 'published',
            is_public,
            limit = 20,
            offset = 0
        } = req.query;

        let query = `
            SELECT 
                skb.*,
                sc.name as category_name,
                u.nickname as author_nickname,
                ur.nickname as reviewer_nickname
            FROM support_knowledge_base skb
            LEFT JOIN support_categories sc ON skb.category_id = sc.id
            LEFT JOIN users u ON skb.created_by = u.id
            LEFT JOIN users ur ON skb.reviewed_by = ur.id
            WHERE skb.status = $1
        `;

        const params = [status];
        let paramIndex = 2;

        if (category_id) {
            query += ` AND skb.category_id = $${paramIndex}`;
            params.push(category_id);
            paramIndex++;
        }

        if (is_public !== undefined) {
            query += ` AND skb.is_public = $${paramIndex}`;
            params.push(is_public === 'true');
            paramIndex++;
        }

        if (search) {
            query += ` AND (
                skb.title ILIKE $${paramIndex} OR 
                skb.content ILIKE $${paramIndex} OR
                skb.summary ILIKE $${paramIndex} OR
                $${paramIndex} = ANY(skb.tags)
            )`;
            params.push(`%${search}%`);
            paramIndex++;
        }

        query += ` ORDER BY skb.views_count DESC, skb.helpful_votes DESC
                   LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);

        res.json({
            articles: result.rows
        });

    } catch (error) {
        console.error('Error obteniendo base de conocimiento:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Buscar sugerencias automáticas de soluciones
router.post('/knowledge-base/suggestions', authenticateToken, async (req, res) => {
    try {
        const { description, category_id } = req.body;

        if (!description) {
            return res.status(400).json({ error: 'Descripción es requerida' });
        }

        // Búsqueda de texto completo en base de conocimiento
        let query = `
            SELECT 
                skb.*,
                sc.name as category_name,
                ts_rank(to_tsvector('spanish', skb.title || ' ' || skb.content), 
                        to_tsquery('spanish', $1)) as relevance_score
            FROM support_knowledge_base skb
            LEFT JOIN support_categories sc ON skb.category_id = sc.id
            WHERE skb.status = 'published'
              AND to_tsvector('spanish', skb.title || ' ' || skb.content) @@ to_tsquery('spanish', $1)
        `;

        const params = [description.replace(/[^a-zA-Z0-9\s]/g, '').split(' ').join(' | ')];
        let paramIndex = 2;

        if (category_id) {
            query += ` AND skb.category_id = $${paramIndex}`;
            params.push(category_id);
            paramIndex++;
        }

        query += ` ORDER BY relevance_score DESC, skb.helpful_votes DESC LIMIT 5`;

        const result = await pool.query(query, params);

        res.json({
            suggestions: result.rows
        });

    } catch (error) {
        console.error('Error obteniendo sugerencias:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==================== ENDPOINTS DE PLANTILLAS ====================

// Obtener plantillas de respuesta
router.get('/templates', authenticateToken, async (req, res) => {
    try {
        const { category_id, search } = req.query;

        let query = `
            SELECT 
                st.*,
                sc.name as category_name,
                u.nickname as created_by_nickname
            FROM support_templates st
            LEFT JOIN support_categories sc ON st.category_id = sc.id
            LEFT JOIN users u ON st.created_by = u.id
            WHERE st.is_active = true
        `;

        const params = [];
        let paramIndex = 1;

        if (category_id) {
            query += ` AND st.category_id = $${paramIndex}`;
            params.push(category_id);
            paramIndex++;
        }

        if (search) {
            query += ` AND (st.name ILIKE $${paramIndex} OR st.content ILIKE $${paramIndex})`;
            params.push(`%${search}%`);
            paramIndex++;
        }

        query += ` ORDER BY st.usage_count DESC, st.name ASC`;

        const result = await pool.query(query, params);

        res.json({
            templates: result.rows
        });

    } catch (error) {
        console.error('Error obteniendo plantillas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==================== ENDPOINTS DE ESCALACIÓN AUTOMÁTICA ====================

// Ejecutar proceso de escalación automática (para cron jobs)
router.post('/escalation/process', authenticateToken, async (req, res) => {
    try {
        // Verificar permisos de admin
        if (!req.user.role || !['admin', 'super_admin'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        const result = await pool.query('SELECT process_automatic_escalations()');
        const escalatedCount = result.rows[0].process_automatic_escalations;

        res.json({
            success: true,
            escalated_tickets: escalatedCount,
            message: `${escalatedCount} tickets escalados automáticamente`
        });

    } catch (error) {
        console.error('Error procesando escalaciones automáticas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==================== ENDPOINTS DE CATEGORÍAS ====================

// Obtener categorías de soporte
router.get('/categories', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                sc.*,
                COUNT(st.id) as ticket_count
            FROM support_categories sc
            LEFT JOIN support_tickets st ON sc.id = st.category_id
            WHERE sc.is_active = true
            GROUP BY sc.id
            ORDER BY sc.sort_order, sc.name
        `);

        res.json({
            categories: result.rows
        });

    } catch (error) {
        console.error('Error obteniendo categorías:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

module.exports = router;