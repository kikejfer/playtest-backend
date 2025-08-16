#!/usr/bin/env node

const pool = require('./database/connection');
const fs = require('fs');
const path = require('path');

/**
 * Script de configuración inicial del Sistema de Soporte Técnico PLAYTEST
 * Inicializa el esquema de base de datos y configuraciones necesarias
 */

class SupportSystemSetup {
    constructor() {
        this.setupSteps = [
            { name: 'Verificar conexión de base de datos', fn: this.checkDatabaseConnection },
            { name: 'Aplicar esquema de soporte', fn: this.applySupportSchema },
            { name: 'Verificar instalación del esquema', fn: this.verifySchemaInstallation },
            { name: 'Configurar parámetros del sistema', fn: this.configureSystemParameters },
            { name: 'Cargar datos iniciales', fn: this.loadInitialData },
            { name: 'Crear índices de rendimiento', fn: this.createPerformanceIndexes },
            { name: 'Configurar funciones automáticas', fn: this.setupAutomaticFunctions },
            { name: 'Verificar integridad del sistema', fn: this.verifySystemIntegrity }
        ];
    }

    async run() {
        console.log('🚀 Iniciando configuración del Sistema de Soporte Técnico PLAYTEST');
        console.log('=' .repeat(70));
        
        let success = true;
        
        for (const step of this.setupSteps) {
            try {
                console.log(`\n📋 ${step.name}...`);
                await step.fn.call(this);
                console.log(`✅ ${step.name} completado`);
            } catch (error) {
                console.error(`❌ Error en: ${step.name}`);
                console.error(`   ${error.message}`);
                success = false;
                break;
            }
        }
        
        if (success) {
            console.log('\n🎉 Sistema de Soporte Técnico configurado exitosamente');
            console.log('=' .repeat(70));
            console.log('📊 El sistema está listo para usar con las siguientes características:');
            console.log('   • Dashboard en tiempo real con métricas y alertas');
            console.log('   • Agrupación inteligente automática de tickets');
            console.log('   • Sistema de escalado automático configurable');
            console.log('   • Categorización ML automática de tickets');
            console.log('   • Base de conocimiento integrada');
            console.log('   • Analytics y reportes automatizados');
            console.log('   • Gestión masiva de tickets');
            console.log('   • Monitoreo de SLA en tiempo real');
            console.log('\n🌐 URLs del sistema:');
            console.log('   • Dashboard: /support-dashboard.html');
            console.log('   • Gestión de Tickets: /support-tickets.html');
            console.log('   • Base de Conocimiento: /support-knowledge.html');
            console.log('   • Analytics: /support-analytics.html');
        } else {
            console.log('\n💥 La configuración falló. Revise los errores anteriores.');
            process.exit(1);
        }
    }

    async checkDatabaseConnection() {
        const result = await pool.query('SELECT version()');
        console.log(`   Base de datos conectada: PostgreSQL`);
    }

    async applySupportSchema() {
        const schemaPath = path.join(__dirname, 'database-schema-support.sql');
        
        if (!fs.existsSync(schemaPath)) {
            throw new Error(`Archivo de esquema no encontrado: ${schemaPath}`);
        }
        
        const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
        
        // Ejecutar el esquema en una transacción
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(schemaSql);
            await client.query('COMMIT');
            console.log('   Esquema de soporte aplicado correctamente');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async verifySchemaInstallation() {
        const tables = [
            'support_categories',
            'support_tickets',
            'support_ticket_groups',
            'support_comments',
            'support_templates',
            'support_knowledge_base',
            'support_faq',
            'support_escalations',
            'support_escalation_rules',
            'support_analytics',
            'support_notifications',
            'support_system_config'
        ];
        
        for (const table of tables) {
            const result = await pool.query(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables 
                    WHERE table_name = $1
                )
            `, [table]);
            
            if (!result.rows[0].exists) {
                throw new Error(`Tabla ${table} no fue creada correctamente`);
            }
        }
        
        console.log(`   ${tables.length} tablas verificadas correctamente`);
    }

    async configureSystemParameters() {
        const defaultConfig = [
            // SLA Configuration
            { key: 'sla_first_response_hours', value: '4', description: 'Horas límite para primera respuesta' },
            { key: 'sla_resolution_hours', value: '24', description: 'Horas límite para resolución' },
            { key: 'sla_critical_resolution_hours', value: '8', description: 'Horas límite para tickets críticos' },
            
            // Auto-close Configuration
            { key: 'auto_close_resolved_days', value: '7', description: 'Días para auto-cierre de tickets resueltos' },
            { key: 'auto_close_waiting_days', value: '14', description: 'Días para auto-cierre esperando usuario' },
            
            // Automation Configuration
            { key: 'max_auto_escalations_per_hour', value: '50', description: 'Máximo escalaciones automáticas por hora' },
            { key: 'similarity_threshold', value: '0.8', description: 'Umbral de similitud para agrupación' },
            { key: 'ml_confidence_threshold', value: '0.7', description: 'Umbral de confianza ML' },
            
            // Notification Configuration
            { key: 'notification_batch_size', value: '100', description: 'Tamaño de lote para notificaciones' },
            { key: 'enable_email_notifications', value: 'true', description: 'Habilitar notificaciones por email' },
            { key: 'enable_push_notifications', value: 'true', description: 'Habilitar notificaciones push' },
            
            // Analytics Configuration
            { key: 'analytics_retention_days', value: '365', description: 'Días de retención de analytics' },
            { key: 'generate_weekly_reports', value: 'true', description: 'Generar reportes semanales' },
            { key: 'generate_monthly_reports', value: 'true', description: 'Generar reportes mensuales' }
        ];
        
        for (const config of defaultConfig) {
            await pool.query(`
                INSERT INTO support_system_config (config_key, config_value, description)
                VALUES ($1, $2, $3)
                ON CONFLICT (config_key) DO NOTHING
            `, [config.key, config.value, config.description]);
        }
        
        console.log(`   ${defaultConfig.length} parámetros de configuración establecidos`);
    }

    async loadInitialData() {
        // Cargar plantillas de respuesta iniciales
        const templates = [
            {
                name: 'Bienvenida',
                subject: 'Confirmación de recepción de ticket',
                content: 'Estimado/a {{user_nickname}},\n\nHemos recibido su solicitud de soporte (Ticket #{{ticket_number}}) y nuestro equipo la revisará en breve.\n\nTiempo estimado de primera respuesta: 4 horas.\n\nSaludos,\nEquipo de Soporte PLAYTEST',
                category_id: null,
                is_active: true
            },
            {
                name: 'Solicitud de información adicional',
                subject: 'Necesitamos más información - Ticket #{{ticket_number}}',
                content: 'Estimado/a {{user_nickname}},\n\nPara poder ayudarle mejor con su consulta, necesitamos información adicional:\n\n- [ESPECIFIQUE QUÉ INFORMACIÓN NECESITA]\n\nPor favor responda a este ticket con los detalles solicitados.\n\nSaludos,\nEquipo de Soporte PLAYTEST',
                category_id: null,
                is_active: true
            },
            {
                name: 'Ticket resuelto',
                subject: 'Ticket resuelto - #{{ticket_number}}',
                content: 'Estimado/a {{user_nickname}},\n\nNos complace informarle que su ticket #{{ticket_number}} ha sido resuelto.\n\nSi considera que el problema persiste o tiene alguna pregunta adicional, no dude en reabrir este ticket o crear uno nuevo.\n\n¿Qué le pareció nuestro servicio? Califique su experiencia.\n\nSaludos,\nEquipo de Soporte PLAYTEST',
                category_id: null,
                is_active: true
            }
        ];
        
        for (const template of templates) {
            await pool.query(`
                INSERT INTO support_templates (name, subject, content, category_id, is_active)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (name) DO NOTHING
            `, [template.name, template.subject, template.content, template.category_id, template.is_active]);
        }
        
        // Cargar reglas de escalación iniciales
        const escalationRules = [
            {
                name: 'Escalación por tiempo - Primera respuesta',
                condition_type: 'time_based',
                condition_value: JSON.stringify({ 
                    field: 'first_response_at', 
                    operator: 'is_null', 
                    hours: 4 
                }),
                action_type: 'escalate_to_admin',
                action_value: JSON.stringify({ notification: true }),
                priority: 'medium',
                is_active: true
            },
            {
                name: 'Escalación crítica inmediata',
                condition_type: 'priority_based',
                condition_value: JSON.stringify({ 
                    priority: 'critical',
                    immediate: true 
                }),
                action_type: 'escalate_to_admin',
                action_value: JSON.stringify({ 
                    notification: true,
                    sms: true,
                    priority: 'high'
                }),
                priority: 'critical',
                is_active: true
            }
        ];
        
        for (const rule of escalationRules) {
            await pool.query(`
                INSERT INTO support_escalation_rules (
                    name, condition_type, condition_value, action_type, 
                    action_value, priority, is_active
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (name) DO NOTHING
            `, [
                rule.name, rule.condition_type, rule.condition_value,
                rule.action_type, rule.action_value, rule.priority, rule.is_active
            ]);
        }
        
        console.log(`   ${templates.length} plantillas y ${escalationRules.length} reglas de escalación cargadas`);
    }

    async createPerformanceIndexes() {
        const indexes = [
            // Índices para consultas frecuentes
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_support_tickets_status_created 
             ON support_tickets(status, created_at DESC)`,
            
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_support_tickets_category_priority 
             ON support_tickets(category_id, priority, created_at DESC)`,
            
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_support_tickets_similarity_hash 
             ON support_tickets(similarity_hash) WHERE similarity_hash IS NOT NULL`,
            
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_support_tickets_user_status 
             ON support_tickets(user_id, status, created_at DESC)`,
            
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_support_comments_ticket_created 
             ON support_comments(ticket_id, created_at ASC)`,
            
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_support_analytics_date 
             ON support_analytics(metric_date DESC)`,
            
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_support_notifications_user_status 
             ON support_notifications(user_id, is_read, created_at DESC)`,
            
            // Índices de texto completo para búsqueda
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_support_tickets_fts 
             ON support_tickets USING gin(to_tsvector('spanish', subject || ' ' || description))`,
            
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_support_knowledge_base_fts 
             ON support_knowledge_base USING gin(to_tsvector('spanish', title || ' ' || content))`
        ];
        
        for (const indexSql of indexes) {
            try {
                await pool.query(indexSql);
            } catch (error) {
                // Si el índice ya existe, continuar
                if (!error.message.includes('already exists')) {
                    throw error;
                }
            }
        }
        
        console.log(`   ${indexes.length} índices de rendimiento verificados`);
    }

    async setupAutomaticFunctions() {
        // Verificar que las funciones automáticas existan
        const functions = [
            'generate_ticket_number',
            'calculate_ticket_similarity_hash',
            'auto_assign_ticket_to_group',
            'process_automatic_escalations'
        ];
        
        for (const functionName of functions) {
            const result = await pool.query(`
                SELECT EXISTS (
                    SELECT 1 FROM pg_proc 
                    WHERE proname = $1
                )
            `, [functionName]);
            
            if (!result.rows[0].exists) {
                throw new Error(`Función ${functionName} no encontrada`);
            }
        }
        
        console.log(`   ${functions.length} funciones automáticas verificadas`);
    }

    async verifySystemIntegrity() {
        // Verificar categorías
        const categoriesResult = await pool.query('SELECT COUNT(*) FROM support_categories');
        const categoriesCount = parseInt(categoriesResult.rows[0].count);
        
        // Verificar configuración
        const configResult = await pool.query('SELECT COUNT(*) FROM support_system_config');
        const configCount = parseInt(configResult.rows[0].count);
        
        // Verificar plantillas
        const templatesResult = await pool.query('SELECT COUNT(*) FROM support_templates');
        const templatesCount = parseInt(templatesResult.rows[0].count);
        
        // Verificar reglas de escalación
        const rulesResult = await pool.query('SELECT COUNT(*) FROM support_escalation_rules');
        const rulesCount = parseInt(rulesResult.rows[0].count);
        
        console.log(`   Sistema verificado: ${categoriesCount} categorías, ${configCount} configuraciones`);
        console.log(`   ${templatesCount} plantillas, ${rulesCount} reglas de escalación`);
        
        if (categoriesCount === 0) {
            throw new Error('No se encontraron categorías de soporte');
        }
        
        if (configCount < 10) {
            throw new Error('Configuración del sistema incompleta');
        }
    }
}

// Ejecutar configuración si es llamado directamente
if (require.main === module) {
    const setup = new SupportSystemSetup();
    setup.run().then(() => {
        process.exit(0);
    }).catch(error => {
        console.error('💥 Error en la configuración:', error);
        process.exit(1);
    });
}

module.exports = SupportSystemSetup;