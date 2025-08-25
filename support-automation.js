const cron = require('node-cron');
const pool = require('./database/connection');

// ==================== SISTEMA DE ESCALADO AUTOMÁTICO ====================

class SupportAutomation {
    constructor() {
        this.isRunning = false;
        this.jobs = new Map();
    }

    // Inicializar todos los trabajos automáticos
    async start() {
        if (this.isRunning) {
            console.log('⚠️ Sistema de automatización ya está ejecutándose');
            return;
        }

        console.log('🚀 Iniciando sistema de automatización de soporte...');

        try {
            // Escalación automática cada 30 minutos
            this.jobs.set('escalation', cron.schedule('*/30 * * * *', () => {
                this.processAutomaticEscalations();
            }, { scheduled: false }));

            // Análisis de agrupación inteligente cada hora
            this.jobs.set('grouping', cron.schedule('0 * * * *', () => {
                this.processIntelligentGrouping();
            }, { scheduled: false }));

            // Categorización automática cada 15 minutos
            this.jobs.set('categorization', cron.schedule('*/15 * * * *', () => {
                this.processAutomaticCategorization();
            }, { scheduled: false }));

            // Cierre automático de tickets resueltos cada día a las 2:00 AM
            this.jobs.set('autoclose', cron.schedule('0 2 * * *', () => {
                this.autoCloseResolvedTickets();
            }, { scheduled: false }));

            // Generación de analytics diarios a las 1:00 AM
            this.jobs.set('analytics', cron.schedule('0 1 * * *', () => {
                this.generateDailyAnalytics();
            }, { scheduled: false }));

            // Notificaciones de SLA en riesgo cada 10 minutos
            this.jobs.set('sla_alerts', cron.schedule('*/10 * * * *', () => {
                this.checkSLAAlerts();
            }, { scheduled: false }));

            // Generar FAQ automático semanalmente (domingos a las 3:00 AM)
            this.jobs.set('auto_faq', cron.schedule('0 3 * * 0', () => {
                this.generateAutoFAQ();
            }, { scheduled: false }));

            // Iniciar todos los trabajos
            this.jobs.forEach((job, name) => {
                job.start();
                console.log(`✅ Trabajo ${name} iniciado`);
            });

            this.isRunning = true;
            console.log('🎯 Sistema de automatización iniciado correctamente');

        } catch (error) {
            console.error('❌ Error iniciando sistema de automatización:', error);
            throw error;
        }
    }

    // Detener todos los trabajos
    stop() {
        if (!this.isRunning) return;

        console.log('🛑 Deteniendo sistema de automatización...');
        
        this.jobs.forEach((job, name) => {
            job.stop();
            console.log(`⏹️ Trabajo ${name} detenido`);
        });

        this.isRunning = false;
        console.log('✅ Sistema de automatización detenido');
    }

    // Procesar escalaciones automáticas
    async processAutomaticEscalations() {
        try {
            console.log('⚡ Procesando escalaciones automáticas...');
            
            // TEMPORARY: Function disabled until migration runs
            // const result = await pool.query('SELECT process_automatic_escalations()');
            // const escalatedCount = result.rows[0].process_automatic_escalations;
            const escalatedCount = 0;
            
            if (escalatedCount > 0) {
                console.log(`📈 ${escalatedCount} tickets escalados automáticamente`);
                
                // Enviar notificaciones a administradores
                await this.notifyAdminsOfEscalations(escalatedCount);
            }

        } catch (error) {
            console.error('❌ Error en escalaciones automáticas:', error);
        }
    }

    // Procesar agrupación inteligente
    async processIntelligentGrouping() {
        try {
            console.log('👥 Procesando agrupación inteligente...');
            
            // Buscar tickets sin agrupar de las últimas 2 horas
            const ungrouppedTickets = await pool.query(`
                SELECT id, subject, description, category_id, similarity_hash
                FROM support_tickets 
                WHERE group_id IS NULL 
                  AND created_at >= NOW() - INTERVAL '2 hours'
                  AND status NOT IN ('closed')
                ORDER BY created_at DESC
            `);

            let groupedCount = 0;

            for (const ticket of ungrouppedTickets.rows) {
                // Intentar agrupar con tickets similares
                const grouped = await pool.query('SELECT auto_assign_ticket_to_group($1)', [ticket.id]);
                
                if (!grouped.rows[0].auto_assign_ticket_to_group) {
                    // Si no se pudo agrupar, buscar otros tickets similares para crear grupo
                    const similarTickets = await pool.query(`
                        SELECT id FROM support_tickets 
                        WHERE similarity_hash = $1 
                          AND category_id = $2 
                          AND id != $3
                          AND group_id IS NULL
                          AND created_at >= NOW() - INTERVAL '24 hours'
                    `, [ticket.similarity_hash, ticket.category_id, ticket.id]);

                    if (similarTickets.rows.length >= 1) {
                        // Crear nuevo grupo
                        await pool.query('SELECT create_auto_group_for_ticket($1)', [ticket.id]);
                        groupedCount++;
                    }
                } else {
                    groupedCount++;
                }
            }

            if (groupedCount > 0) {
                console.log(`🎯 ${groupedCount} tickets agrupados automáticamente`);
            }

        } catch (error) {
            console.error('❌ Error en agrupación inteligente:', error);
        }
    }

    // Categorización automática usando ML básico
    async processAutomaticCategorization() {
        try {
            console.log('🏷️ Procesando categorización automática...');
            
            // Obtener tickets sin categorizar de la última hora
            const uncategorizedTickets = await pool.query(`
                SELECT id, subject, description, user_id
                FROM support_tickets 
                WHERE category_id IS NULL 
                  AND created_at >= NOW() - INTERVAL '1 hour'
                ORDER BY created_at DESC
                LIMIT 50
            `);

            let categorizedCount = 0;

            for (const ticket of uncategorizedTickets.rows) {
                const category = await this.predictCategory(ticket);
                
                if (category) {
                    await pool.query(`
                        UPDATE support_tickets 
                        SET category_id = $1, 
                            ml_classification = $2,
                            ml_confidence = $3,
                            updated_at = NOW()
                        WHERE id = $4
                    `, [
                        category.id, 
                        JSON.stringify(category), 
                        category.confidence, 
                        ticket.id
                    ]);
                    
                    categorizedCount++;
                }
            }

            if (categorizedCount > 0) {
                console.log(`🎯 ${categorizedCount} tickets categorizados automáticamente`);
            }

        } catch (error) {
            console.error('❌ Error en categorización automática:', error);
        }
    }

    // Predicción básica de categoría usando palabras clave
    async predictCategory(ticket) {
        try {
            const text = (ticket.subject + ' ' + ticket.description).toLowerCase();
            
            // Diccionario básico de palabras clave por categoría
            const categoryKeywords = {
                1: ['error', 'bug', 'fallo', 'excepción', 'crash', 'no funciona', 'roto'], // Bugs del Sistema
                2: ['como', 'cómo', 'ayuda', 'tutorial', 'funciona', 'usar', 'manual'], // Funcionalidad
                3: ['lento', 'velocidad', 'carga', 'rendimiento', 'timeout', 'demora'], // Rendimiento
                4: ['login', 'contraseña', 'acceso', 'cuenta', 'registro', 'perfil', 'autenticación'], // Cuenta
                5: ['pago', 'luminarias', 'compra', 'facturación', 'dinero', 'transacción'], // Pagos
                6: ['quiz', 'bloque', 'contenido', 'pregunta', 'material', 'curso'], // Contenido
                7: ['móvil', 'tablet', 'celular', 'responsive', 'pantalla'], // Móvil
                8: ['api', 'integración', 'conexión', 'sincronización'], // Integración
                9: ['solicito', 'quiero', 'necesito', 'mejora', 'funcionalidad nueva'], // Solicitudes
            };

            let bestMatch = null;
            let maxScore = 0;

            for (const [categoryId, keywords] of Object.entries(categoryKeywords)) {
                let score = 0;
                
                keywords.forEach(keyword => {
                    const occurrences = (text.match(new RegExp(keyword, 'g')) || []).length;
                    score += occurrences;
                });

                if (score > maxScore && score > 0) {
                    maxScore = score;
                    bestMatch = {
                        id: parseInt(categoryId),
                        confidence: Math.min(score / 10, 1.0), // Normalizar confianza
                        keywords_matched: keywords.filter(k => text.includes(k))
                    };
                }
            }

            // Solo categorizar si hay confianza mínima
            return bestMatch && bestMatch.confidence >= 0.3 ? bestMatch : null;

        } catch (error) {
            console.error('Error prediciendo categoría:', error);
            return null;
        }
    }

    // Cerrar automáticamente tickets resueltos
    async autoCloseResolvedTickets() {
        try {
            console.log('🔒 Cerrando automáticamente tickets resueltos...');
            
            // TEMPORARY: Table disabled until migration runs
            // const configResult = await pool.query(`
            //     SELECT config_value FROM support_system_config 
            //     WHERE config_key = 'auto_close_resolved_days'
            // `);
            
            const daysToClose = 7; // Default value
            
            const result = await pool.query(`
                UPDATE support_tickets 
                SET status = 'closed', 
                    closed_at = NOW(),
                    updated_at = NOW()
                WHERE status = 'resolved' 
                  AND resolved_at <= NOW() - INTERVAL '${daysToClose} days'
                  AND closed_at IS NULL
                RETURNING id, ticket_number
            `);

            if (result.rows.length > 0) {
                console.log(`🔐 ${result.rows.length} tickets cerrados automáticamente`);
                
                // Agregar comentarios automáticos
                for (const ticket of result.rows) {
                    await pool.query(`
                        INSERT INTO support_comments (
                            ticket_id, user_id, user_type, content, is_automated
                        ) VALUES ($1, 1, 'system', $2, true)
                    `, [
                        ticket.id,
                        `Ticket cerrado automáticamente después de ${daysToClose} días como resuelto.`
                    ]);
                }
            }

        } catch (error) {
            console.error('❌ Error en auto-cierre de tickets:', error);
        }
    }

    // Generar analytics diarios
    async generateDailyAnalytics() {
        try {
            console.log('📊 Generando analytics diarios...');
            
            const today = new Date().toISOString().split('T')[0];
            
            // Verificar si ya existen analytics para hoy
            const existingAnalytics = await pool.query(`
                SELECT id FROM support_analytics WHERE metric_date = $1
            `, [today]);

            if (existingAnalytics.rows.length > 0) {
                console.log('📈 Analytics de hoy ya existen, actualizando...');
            }

            // Calcular métricas del día
            const metricsResult = await pool.query(`
                SELECT 
                    COUNT(CASE WHEN DATE(created_at) = $1 THEN 1 END) as tickets_created,
                    COUNT(CASE WHEN DATE(resolved_at) = $1 THEN 1 END) as tickets_resolved,
                    COUNT(CASE WHEN DATE(escalated_at) = $1 THEN 1 END) as tickets_escalated,
                    AVG(CASE WHEN DATE(first_response_at) = $1 AND first_response_at IS NOT NULL 
                        THEN EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60 
                        ELSE NULL END) as avg_first_response_time,
                    AVG(CASE WHEN DATE(resolved_at) = $1 AND resolved_at IS NOT NULL 
                        THEN EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60 
                        ELSE NULL END) as avg_resolution_time,
                    AVG(CASE WHEN DATE(resolved_at) = $1 AND satisfaction_rating IS NOT NULL 
                        THEN satisfaction_rating 
                        ELSE NULL END) as avg_satisfaction_rating,
                    COUNT(CASE WHEN DATE(resolved_at) = $1 AND satisfaction_rating IS NOT NULL 
                        THEN 1 END) as total_ratings
                FROM support_tickets
            `, [today]);

            const metrics = metricsResult.rows[0];

            // Estadísticas por categoría
            const categoryStatsResult = await pool.query(`
                SELECT 
                    sc.id as category_id,
                    sc.name as category_name,
                    COUNT(CASE WHEN DATE(st.created_at) = $1 THEN 1 END) as created,
                    COUNT(CASE WHEN DATE(st.resolved_at) = $1 THEN 1 END) as resolved,
                    AVG(CASE WHEN DATE(st.resolved_at) = $1 AND st.resolved_at IS NOT NULL 
                        THEN EXTRACT(EPOCH FROM (st.resolved_at - st.created_at)) / 60 
                        ELSE NULL END) as avg_time
                FROM support_categories sc
                LEFT JOIN support_tickets st ON sc.id = st.category_id
                GROUP BY sc.id, sc.name
            `, [today]);

            const categoryStats = {};
            categoryStatsResult.rows.forEach(row => {
                categoryStats[row.category_id] = {
                    name: row.category_name,
                    created: parseInt(row.created),
                    resolved: parseInt(row.resolved),
                    avg_time: parseFloat(row.avg_time) || null
                };
            });

            // Insertar o actualizar analytics
            await pool.query(`
                INSERT INTO support_analytics (
                    metric_date, tickets_created, tickets_resolved, tickets_escalated,
                    avg_first_response_time, avg_resolution_time, avg_satisfaction_rating,
                    total_ratings, category_stats
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (metric_date) DO UPDATE SET
                    tickets_created = EXCLUDED.tickets_created,
                    tickets_resolved = EXCLUDED.tickets_resolved,
                    tickets_escalated = EXCLUDED.tickets_escalated,
                    avg_first_response_time = EXCLUDED.avg_first_response_time,
                    avg_resolution_time = EXCLUDED.avg_resolution_time,
                    avg_satisfaction_rating = EXCLUDED.avg_satisfaction_rating,
                    total_ratings = EXCLUDED.total_ratings,
                    category_stats = EXCLUDED.category_stats
            `, [
                today,
                metrics.tickets_created || 0,
                metrics.tickets_resolved || 0,
                metrics.tickets_escalated || 0,
                metrics.avg_first_response_time || null,
                metrics.avg_resolution_time || null,
                metrics.avg_satisfaction_rating || null,
                metrics.total_ratings || 0,
                JSON.stringify(categoryStats)
            ]);

            console.log(`📈 Analytics diarios generados: ${metrics.tickets_created} creados, ${metrics.tickets_resolved} resueltos`);

        } catch (error) {
            console.error('❌ Error generando analytics diarios:', error);
        }
    }

    // Verificar alertas de SLA
    async checkSLAAlerts() {
        try {
            // TEMPORARY: Table disabled until migration runs
            // const slaConfigResult = await pool.query(`
            //     SELECT config_key, config_value FROM support_system_config 
            //     WHERE config_key IN ('sla_first_response_hours', 'sla_resolution_hours')
            // `);

            const slaConfig = {
                sla_first_response_hours: 4,
                sla_resolution_hours: 24
            };
            
            // slaConfigResult.rows.forEach(row => {
            //     slaConfig[row.config_key] = parseInt(row.config_value);
            // });

            const firstResponseHours = slaConfig.sla_first_response_hours || 4;
            const resolutionHours = slaConfig.sla_resolution_hours || 24;

            // Verificar tickets en riesgo de SLA de primera respuesta
            const firstResponseAtRisk = await pool.query(`
                SELECT id, ticket_number, subject, user_nickname, created_at
                FROM support_tickets 
                WHERE first_response_at IS NULL
                  AND created_at <= NOW() - INTERVAL '${firstResponseHours * 0.8} hours'
                  AND status IN ('open', 'in_progress')
                ORDER BY created_at ASC
                LIMIT 20
            `);

            // Verificar tickets en riesgo de SLA de resolución
            const resolutionAtRisk = await pool.query(`
                SELECT id, ticket_number, subject, user_nickname, created_at, priority
                FROM support_tickets 
                WHERE resolved_at IS NULL
                  AND created_at <= NOW() - INTERVAL '${resolutionHours * 0.8} hours'
                  AND status IN ('open', 'in_progress', 'waiting_user')
                ORDER BY priority DESC, created_at ASC
                LIMIT 20
            `);

            // Enviar notificaciones si hay tickets en riesgo
            if (firstResponseAtRisk.rows.length > 0 || resolutionAtRisk.rows.length > 0) {
                await this.sendSLAAlerts(firstResponseAtRisk.rows, resolutionAtRisk.rows);
            }

        } catch (error) {
            console.error('❌ Error verificando alertas de SLA:', error);
        }
    }

    // Generar FAQ automático
    async generateAutoFAQ() {
        try {
            console.log('❓ Generando FAQ automático...');
            
            // Buscar patrones de preguntas frecuentes en tickets resueltos
            const frequentIssues = await pool.query(`
                SELECT 
                    similarity_hash,
                    subject,
                    description,
                    category_id,
                    COUNT(*) as occurrence_count,
                    array_agg(id) as ticket_ids,
                    MIN(created_at) as first_occurrence,
                    MAX(created_at) as last_occurrence
                FROM support_tickets
                WHERE status IN ('resolved', 'closed')
                  AND similarity_hash IS NOT NULL
                  AND created_at >= NOW() - INTERVAL '30 days'
                GROUP BY similarity_hash, subject, description, category_id
                HAVING COUNT(*) >= 3
                ORDER BY COUNT(*) DESC
                LIMIT 20
            `);

            let faqGenerated = 0;

            for (const issue of frequentIssues.rows) {
                // Buscar soluciones comunes en los comentarios
                const solutionsResult = await pool.query(`
                    SELECT content, COUNT(*) as usage_count
                    FROM support_comments 
                    WHERE ticket_id = ANY($1)
                      AND user_type IN ('agent', 'admin')
                      AND is_solution = true
                    GROUP BY content
                    ORDER BY COUNT(*) DESC
                    LIMIT 1
                `, [issue.ticket_ids]);

                if (solutionsResult.rows.length > 0) {
                    const solution = solutionsResult.rows[0];
                    
                    // Verificar si ya existe este FAQ
                    const existingFAQ = await pool.query(`
                        SELECT id FROM support_faq 
                        WHERE $1 = ANY(generated_from_tickets)
                    `, [issue.ticket_ids[0]]);

                    if (existingFAQ.rows.length === 0) {
                        // Crear nuevo FAQ
                        await pool.query(`
                            INSERT INTO support_faq (
                                question, answer, generated_from_tickets, 
                                occurrence_count, category_id, is_published
                            ) VALUES ($1, $2, $3, $4, $5, false)
                        `, [
                            issue.subject,
                            solution.content,
                            issue.ticket_ids,
                            issue.occurrence_count,
                            issue.category_id
                        ]);

                        faqGenerated++;
                    }
                }
            }

            if (faqGenerated > 0) {
                console.log(`❓ ${faqGenerated} FAQs automáticos generados`);
            }

        } catch (error) {
            console.error('❌ Error generando FAQ automático:', error);
        }
    }

    // Enviar notificaciones a administradores sobre escalaciones
    async notifyAdminsOfEscalations(escalatedCount) {
        try {
            const admins = await pool.query(`
                SELECT id, nickname, email FROM users 
                WHERE role IN ('admin', 'super_admin')
                  AND is_active = true
            `);

            for (const admin of admins.rows) {
                await pool.query(`
                    INSERT INTO support_notifications (
                        user_id, notification_type, title, message, priority
                    ) VALUES ($1, $2, $3, $4, $5)
                `, [
                    admin.id,
                    'escalation_alert',
                    'Tickets Escalados Automáticamente',
                    `${escalatedCount} tickets han sido escalados automáticamente y requieren atención.`,
                    'high'
                ]);
            }

        } catch (error) {
            console.error('Error enviando notificaciones de escalación:', error);
        }
    }

    // Enviar alertas de SLA
    async sendSLAAlerts(firstResponseAtRisk, resolutionAtRisk) {
        try {
            const agents = await pool.query(`
                SELECT id, nickname, email FROM users 
                WHERE role IN ('agent', 'admin', 'super_admin')
                  AND is_active = true
            `);

            for (const agent of agents.rows) {
                if (firstResponseAtRisk.length > 0) {
                    await pool.query(`
                        INSERT INTO support_notifications (
                            user_id, notification_type, title, message, priority
                        ) VALUES ($1, $2, $3, $4, $5)
                    `, [
                        agent.id,
                        'sla_first_response_risk',
                        'SLA de Primera Respuesta en Riesgo',
                        `${firstResponseAtRisk.length} tickets están cerca del límite de SLA para primera respuesta.`,
                        'warning'
                    ]);
                }

                if (resolutionAtRisk.length > 0) {
                    await pool.query(`
                        INSERT INTO support_notifications (
                            user_id, notification_type, title, message, priority
                        ) VALUES ($1, $2, $3, $4, $5)
                    `, [
                        agent.id,
                        'sla_resolution_risk',
                        'SLA de Resolución en Riesgo',
                        `${resolutionAtRisk.length} tickets están cerca del límite de SLA para resolución.`,
                        'warning'
                    ]);
                }
            }

        } catch (error) {
            console.error('Error enviando alertas de SLA:', error);
        }
    }

    // Obtener estado del sistema
    getStatus() {
        return {
            isRunning: this.isRunning,
            activeJobs: Array.from(this.jobs.keys()),
            jobCount: this.jobs.size
        };
    }
}

// Instancia singleton
const supportAutomation = new SupportAutomation();

module.exports = supportAutomation;