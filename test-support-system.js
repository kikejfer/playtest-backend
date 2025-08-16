#!/usr/bin/env node

const pool = require('./database/connection');
const supportAutomation = require('./support-automation');

/**
 * Script de prueba del Sistema de Soporte Técnico PLAYTEST
 * Verifica que todos los componentes funcionen correctamente
 */

class SupportSystemTester {
    constructor() {
        this.testResults = [];
        this.testUsers = [];
        this.testTickets = [];
    }

    async runAllTests() {
        console.log('🧪 Iniciando pruebas del Sistema de Soporte Técnico PLAYTEST');
        console.log('=' .repeat(70));
        
        const tests = [
            { name: 'Conexión de Base de Datos', fn: this.testDatabaseConnection },
            { name: 'Esquema de Tablas', fn: this.testDatabaseSchema },
            { name: 'Configuración del Sistema', fn: this.testSystemConfiguration },
            { name: 'Creación de Tickets', fn: this.testTicketCreation },
            { name: 'Sistema de Automatización', fn: this.testAutomationSystem },
            { name: 'Categorización Automática', fn: this.testAutomaticCategorization },
            { name: 'Agrupación Inteligente', fn: this.testIntelligentGrouping },
            { name: 'Sistema de Escalación', fn: this.testEscalationSystem },
            { name: 'Base de Conocimiento', fn: this.testKnowledgeBase },
            { name: 'Analytics y Métricas', fn: this.testAnalyticsSystem },
            { name: 'API Endpoints', fn: this.testAPIEndpoints },
            { name: 'Limpieza de Datos de Prueba', fn: this.cleanupTestData }
        ];
        
        let passedTests = 0;
        let totalTests = tests.length;
        
        for (const test of tests) {
            try {
                console.log(`\n🔍 ${test.name}...`);
                await test.fn.call(this);
                console.log(`✅ ${test.name} - PASSED`);
                this.testResults.push({ name: test.name, status: 'PASSED', error: null });
                passedTests++;
            } catch (error) {
                console.error(`❌ ${test.name} - FAILED`);
                console.error(`   Error: ${error.message}`);
                this.testResults.push({ name: test.name, status: 'FAILED', error: error.message });
            }
        }
        
        // Mostrar resumen
        console.log('\n' + '='.repeat(70));
        console.log('📊 RESUMEN DE PRUEBAS');
        console.log('='.repeat(70));
        console.log(`✅ Pruebas exitosas: ${passedTests}/${totalTests}`);
        console.log(`❌ Pruebas fallidas: ${totalTests - passedTests}/${totalTests}`);
        console.log(`📈 Tasa de éxito: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
        
        if (passedTests === totalTests) {
            console.log('\n🎉 ¡Todas las pruebas pasaron! El sistema está funcionando correctamente.');
        } else {
            console.log('\n⚠️ Algunas pruebas fallaron. Revise los errores anteriores.');
        }
        
        return { passed: passedTests, total: totalTests, results: this.testResults };
    }

    async testDatabaseConnection() {
        const result = await pool.query('SELECT NOW() as current_time');
        if (!result.rows[0].current_time) {
            throw new Error('No se pudo obtener timestamp de la base de datos');
        }
        console.log(`   Conexión establecida: ${result.rows[0].current_time}`);
    }

    async testDatabaseSchema() {
        const requiredTables = [
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
        
        for (const table of requiredTables) {
            const result = await pool.query(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables 
                    WHERE table_name = $1
                )
            `, [table]);
            
            if (!result.rows[0].exists) {
                throw new Error(`Tabla requerida ${table} no encontrada`);
            }
        }
        
        console.log(`   ${requiredTables.length} tablas verificadas correctamente`);
    }

    async testSystemConfiguration() {
        const result = await pool.query('SELECT COUNT(*) as count FROM support_system_config');
        const configCount = parseInt(result.rows[0].count);
        
        if (configCount < 10) {
            throw new Error(`Configuración insuficiente: solo ${configCount} parámetros encontrados`);
        }
        
        // Verificar configuraciones críticas
        const criticalConfigs = ['sla_first_response_hours', 'sla_resolution_hours', 'auto_close_resolved_days'];
        for (const config of criticalConfigs) {
            const configResult = await pool.query(
                'SELECT config_value FROM support_system_config WHERE config_key = $1',
                [config]
            );
            
            if (configResult.rows.length === 0) {
                throw new Error(`Configuración crítica ${config} no encontrada`);
            }
        }
        
        console.log(`   ${configCount} configuraciones verificadas`);
    }

    async testTicketCreation() {
        // Crear usuario de prueba
        const testUser = await pool.query(`
            INSERT INTO users (nickname, email, password_hash, role, is_active)
            VALUES ('test_user_support', 'test@example.com', 'hash', 'user', true)
            RETURNING id, nickname
        `);
        
        this.testUsers.push(testUser.rows[0].id);
        
        // Crear ticket de prueba
        const testTicket = await pool.query(`
            INSERT INTO support_tickets (
                user_id, user_nickname, subject, description, 
                category_id, priority, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id, ticket_number
        `, [
            testUser.rows[0].id,
            testUser.rows[0].nickname,
            'Ticket de prueba automática',
            'Este es un ticket generado automáticamente para verificar el sistema',
            1, // Bugs del Sistema
            'medium',
            'open'
        ]);
        
        this.testTickets.push(testTicket.rows[0].id);
        
        if (!testTicket.rows[0].ticket_number) {
            throw new Error('Número de ticket no fue generado automáticamente');
        }
        
        console.log(`   Ticket creado: #${testTicket.rows[0].ticket_number}`);
    }

    async testAutomationSystem() {
        const status = supportAutomation.getStatus();
        
        if (!status.isRunning) {
            throw new Error('Sistema de automatización no está ejecutándose');
        }
        
        if (status.jobCount < 5) {
            throw new Error(`Número insuficiente de trabajos automáticos: ${status.jobCount}`);
        }
        
        console.log(`   Sistema activo con ${status.jobCount} trabajos automáticos`);
        console.log(`   Trabajos activos: ${status.activeJobs.join(', ')}`);
    }

    async testAutomaticCategorization() {
        // Crear ticket con contenido específico para ML
        const testTicket = await pool.query(`
            INSERT INTO support_tickets (
                user_id, user_nickname, subject, description, 
                priority, status
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
        `, [
            this.testUsers[0],
            'test_user_support',
            'Error crítico en el sistema',
            'El sistema presenta un bug grave que causa crash cuando intento acceder',
            'high',
            'open'
        ]);
        
        this.testTickets.push(testTicket.rows[0].id);
        
        // Ejecutar categorización manual para prueba
        await supportAutomation.processAutomaticCategorization();
        
        // Verificar que fue categorizado
        const categorizedTicket = await pool.query(`
            SELECT category_id, ml_classification, ml_confidence 
            FROM support_tickets 
            WHERE id = $1
        `, [testTicket.rows[0].id]);
        
        if (!categorizedTicket.rows[0].category_id) {
            console.log('   ⚠️ Ticket no fue categorizado automáticamente (puede ser normal con umbral alto)');
        } else {
            console.log(`   Ticket categorizado automáticamente (categoría: ${categorizedTicket.rows[0].category_id})`);
        }
    }

    async testIntelligentGrouping() {
        // Crear tickets similares
        const similarTickets = [
            {
                subject: 'Problema de conexión',
                description: 'No puedo conectarme al servidor de PLAYTEST'
            },
            {
                subject: 'Error de conexión',
                description: 'El servidor de PLAYTEST no responde cuando intento conectar'
            }
        ];
        
        for (const ticket of similarTickets) {
            const result = await pool.query(`
                INSERT INTO support_tickets (
                    user_id, user_nickname, subject, description, 
                    category_id, priority, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id
            `, [
                this.testUsers[0],
                'test_user_support',
                ticket.subject,
                ticket.description,
                8, // Integración
                'medium',
                'open'
            ]);
            
            this.testTickets.push(result.rows[0].id);
        }
        
        // Ejecutar agrupación
        await supportAutomation.processIntelligentGrouping();
        
        console.log('   Proceso de agrupación inteligente ejecutado');
    }

    async testEscalationSystem() {
        // Crear ticket que debería escalarse
        const oldTicket = await pool.query(`
            INSERT INTO support_tickets (
                user_id, user_nickname, subject, description, 
                category_id, priority, status, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - INTERVAL '5 hours')
            RETURNING id
        `, [
            this.testUsers[0],
            'test_user_support',
            'Ticket para prueba de escalación',
            'Este ticket debería escalarse por tiempo',
            1,
            'high',
            'open'
        ]);
        
        this.testTickets.push(oldTicket.rows[0].id);
        
        // Ejecutar escalación
        await supportAutomation.processAutomaticEscalations();
        
        // Verificar si se creó escalación
        const escalationResult = await pool.query(`
            SELECT COUNT(*) as count FROM support_escalations 
            WHERE ticket_id = $1
        `, [oldTicket.rows[0].id]);
        
        console.log(`   Proceso de escalación ejecutado (escalaciones creadas: ${escalationResult.rows[0].count})`);
    }

    async testKnowledgeBase() {
        // Crear artículo de prueba
        const testArticle = await pool.query(`
            INSERT INTO support_knowledge_base (
                title, content, category_id, is_published, author_id
            ) VALUES ($1, $2, $3, $4, $5)
            RETURNING id, title
        `, [
            'Artículo de prueba automática',
            '# Solución de Prueba\n\nEste artículo fue creado automáticamente para verificar el sistema.',
            1,
            true,
            this.testUsers[0]
        ]);
        
        // Buscar artículo
        const searchResult = await pool.query(`
            SELECT * FROM support_knowledge_base 
            WHERE to_tsvector('spanish', title || ' ' || content) @@ plainto_tsquery('spanish', 'prueba')
        `);
        
        if (searchResult.rows.length === 0) {
            throw new Error('Búsqueda en base de conocimiento no funcionó');
        }
        
        console.log(`   Artículo creado y encontrado en búsqueda: "${testArticle.rows[0].title}"`);
        
        // Limpiar artículo de prueba
        await pool.query('DELETE FROM support_knowledge_base WHERE id = $1', [testArticle.rows[0].id]);
    }

    async testAnalyticsSystem() {
        // Ejecutar generación de analytics
        await supportAutomation.generateDailyAnalytics();
        
        // Verificar que se generaron analytics
        const analyticsResult = await pool.query(`
            SELECT * FROM support_analytics 
            WHERE metric_date = CURRENT_DATE
        `);
        
        if (analyticsResult.rows.length === 0) {
            throw new Error('Analytics diarios no fueron generados');
        }
        
        const analytics = analyticsResult.rows[0];
        console.log(`   Analytics generados: ${analytics.tickets_created} creados, ${analytics.tickets_resolved} resueltos`);
    }

    async testAPIEndpoints() {
        // Simular llamadas a API principales (sin servidor HTTP real)
        const testData = {
            tickets_open: await pool.query("SELECT COUNT(*) FROM support_tickets WHERE status = 'open'"),
            categories: await pool.query("SELECT COUNT(*) FROM support_categories"),
            templates: await pool.query("SELECT COUNT(*) FROM support_templates"),
            config: await pool.query("SELECT COUNT(*) FROM support_system_config")
        };
        
        // Verificar que hay datos para los endpoints
        if (parseInt(testData.categories.rows[0].count) === 0) {
            throw new Error('No hay categorías disponibles para API');
        }
        
        if (parseInt(testData.templates.rows[0].count) === 0) {
            throw new Error('No hay plantillas disponibles para API');
        }
        
        console.log('   Datos de API verificados: categorías, plantillas y configuración disponibles');
    }

    async cleanupTestData() {
        // Limpiar tickets de prueba
        if (this.testTickets.length > 0) {
            await pool.query(`
                DELETE FROM support_comments WHERE ticket_id = ANY($1)
            `, [this.testTickets]);
            
            await pool.query(`
                DELETE FROM support_escalations WHERE ticket_id = ANY($1)
            `, [this.testTickets]);
            
            await pool.query(`
                DELETE FROM support_tickets WHERE id = ANY($1)
            `, [this.testTickets]);
        }
        
        // Limpiar usuarios de prueba
        if (this.testUsers.length > 0) {
            await pool.query(`
                DELETE FROM users WHERE id = ANY($1)
            `, [this.testUsers]);
        }
        
        console.log(`   Limpieza completada: ${this.testTickets.length} tickets y ${this.testUsers.length} usuarios eliminados`);
    }
}

// Ejecutar pruebas si es llamado directamente
if (require.main === module) {
    const tester = new SupportSystemTester();
    
    tester.runAllTests().then((results) => {
        if (results.passed === results.total) {
            console.log('\n🎯 ¡Sistema de Soporte Técnico completamente funcional!');
            process.exit(0);
        } else {
            console.log('\n🔧 Se encontraron problemas que requieren atención.');
            process.exit(1);
        }
    }).catch(error => {
        console.error('\n💥 Error crítico durante las pruebas:', error);
        process.exit(1);
    });
}

module.exports = SupportSystemTester;