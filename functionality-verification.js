const { Pool } = require('pg');
const RoutesCompatibilityLayer = require('./routes-compatibility-layer');

// Sistema de verificación completa de funcionalidades
class FunctionalityVerification {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
        this.compatibilityLayer = new RoutesCompatibilityLayer();
        this.verificationResults = {
            passed: [],
            failed: [],
            warnings: [],
            critical_issues: []
        };
    }

    async runCompleteVerification() {
        try {
            console.log('🔍 Iniciando verificación completa de funcionalidades...');
            console.log('='.repeat(70));

            // 1. Verificar integridad de base de datos
            console.log('\n1. 🗄️  Verificando integridad de base de datos...');
            await this.verifyDatabaseIntegrity();

            // 2. Verificar sistema de autenticación
            console.log('\n2. 🔐 Verificando sistema de autenticación...');
            await this.verifyAuthenticationSystem();

            // 3. Verificar sistema de roles unificado
            console.log('\n3. 👥 Verificando sistema de roles...');
            await this.verifyRoleSystem();

            // 4. Verificar sistema de Luminarias
            console.log('\n4. 💰 Verificando sistema de Luminarias...');
            await this.verifyLuminariasSystem();

            // 5. Verificar sistema de niveles
            console.log('\n5. 🏆 Verificando sistema de niveles...');
            await this.verifyLevelsSystem();

            // 6. Verificar sistema de challenges
            console.log('\n6. 🎯 Verificando sistema de challenges...');
            await this.verifyChallengesSystem();

            // 7. Verificar sistema de comunicación/soporte
            console.log('\n7. 💬 Verificando sistema de comunicación...');
            await this.verifyCommunicationSystem();

            // 8. Verificar APIs y endpoints
            console.log('\n8. 🌐 Verificando APIs y endpoints...');
            await this.verifyAPIsEndpoints();

            // 9. Verificar integraciones entre sistemas
            console.log('\n9. 🔗 Verificando integraciones...');
            await this.verifySystemIntegrations();

            // 10. Verificar servicios técnicos
            console.log('\n10. ⚙️ Verificando servicios técnicos...');
            await this.verifyTechnicalServices();

            // Generar reporte final
            this.generateFinalReport();

        } catch (error) {
            console.error('\n💥 Error durante la verificación:', error);
            this.verificationResults.critical_issues.push({
                component: 'Verification System',
                error: error.message,
                impact: 'critical'
            });
        }
    }

    async verifyDatabaseIntegrity() {
        try {
            // Verificar tablas principales
            const requiredTables = [
                'users', 'blocks', 'questions', 'games', 'user_answers',
                'unified_roles', 'unified_user_roles', 'unified_user_luminarias',
                'unified_luminarias_transactions', 'unified_tickets',
                'level_definitions', 'user_levels', 'challenges'
            ];

            for (const table of requiredTables) {
                const exists = await this.pool.query(`
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.tables 
                        WHERE table_name = $1
                    )
                `, [table]);

                if (exists.rows[0].exists) {
                    const count = await this.pool.query(`SELECT COUNT(*) FROM ${table}`);
                    console.log(`   ✓ Tabla ${table}: ${count.rows[0].count} registros`);
                    this.verificationResults.passed.push(`Tabla ${table} existe y accesible`);
                } else {
                    console.log(`   ❌ Tabla ${table}: NO EXISTE`);
                    this.verificationResults.failed.push(`Tabla requerida ${table} no existe`);
                }
            }

            // Verificar foreign keys críticas
            await this.verifyForeignKeys();

            // Verificar índices importantes
            await this.verifyIndexes();

        } catch (error) {
            console.error('   ❌ Error verificando integridad de BD:', error);
            this.verificationResults.failed.push(`Error de integridad de BD: ${error.message}`);
        }
    }

    async verifyForeignKeys() {
        const criticalFKs = [
            { table: 'blocks', column: 'creator_id', references: 'users' },
            { table: 'questions', column: 'block_id', references: 'blocks' },
            { table: 'user_answers', column: 'user_id', references: 'users' },
            { table: 'games', column: 'created_by', references: 'users' },
            { table: 'unified_user_roles', column: 'user_id', references: 'users' },
            { table: 'unified_user_luminarias', column: 'user_id', references: 'users' }
        ];

        for (const fk of criticalFKs) {
            const exists = await this.pool.query(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints tc
                    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
                    WHERE tc.table_name = $1 
                    AND ccu.column_name = $2
                    AND tc.constraint_type = 'FOREIGN KEY'
                )
            `, [fk.table, fk.column]);

            if (exists.rows[0].exists) {
                this.verificationResults.passed.push(`FK ${fk.table}.${fk.column} existe`);
            } else {
                this.verificationResults.warnings.push(`FK faltante: ${fk.table}.${fk.column} -> ${fk.references}`);
            }
        }
    }

    async verifyIndexes() {
        const importantIndexes = [
            'idx_users_loaded_blocks_gin',
            'idx_unified_luminarias_transactions_user_id',
            'idx_user_levels_user_type'
        ];

        for (const indexName of importantIndexes) {
            const exists = await this.pool.query(`
                SELECT EXISTS (
                    SELECT 1 FROM pg_indexes 
                    WHERE indexname = $1
                )
            `, [indexName]);

            if (exists.rows[0].exists) {
                this.verificationResults.passed.push(`Índice ${indexName} existe`);
            } else {
                this.verificationResults.warnings.push(`Índice recomendado faltante: ${indexName}`);
            }
        }
    }

    async verifyAuthenticationSystem() {
        try {
            // Verificar que middleware de auth existe
            const fs = require('fs').promises;
            const authMiddlewarePath = './middleware/auth.js';
            
            try {
                await fs.access(authMiddlewarePath);
                this.verificationResults.passed.push('Middleware de autenticación existe');
            } catch {
                this.verificationResults.failed.push('Middleware de autenticación no encontrado');
            }

            // Verificar variables de entorno críticas
            const requiredEnvVars = ['JWT_SECRET', 'DATABASE_URL'];
            for (const envVar of requiredEnvVars) {
                if (process.env[envVar]) {
                    this.verificationResults.passed.push(`Variable ${envVar} configurada`);
                } else {
                    this.verificationResults.failed.push(`Variable crítica ${envVar} faltante`);
                }
            }

            // Test básico de conectividad
            const testQuery = await this.pool.query('SELECT NOW()');
            if (testQuery.rows.length > 0) {
                this.verificationResults.passed.push('Conexión a base de datos funcional');
            }

        } catch (error) {
            console.error('   ❌ Error verificando autenticación:', error);
            this.verificationResults.failed.push(`Error de autenticación: ${error.message}`);
        }
    }

    async verifyRoleSystem() {
        try {
            // Verificar roles unificados
            const rolesResult = await this.pool.query('SELECT COUNT(*) FROM unified_roles');
            const rolesCount = parseInt(rolesResult.rows[0].count);

            if (rolesCount >= 5) {
                console.log(`   ✓ Sistema de roles unificado: ${rolesCount} roles`);
                this.verificationResults.passed.push(`Sistema de roles tiene ${rolesCount} roles`);
            } else {
                console.log(`   ⚠️  Pocos roles definidos: ${rolesCount}`);
                this.verificationResults.warnings.push(`Solo ${rolesCount} roles definidos, se esperan al menos 5`);
            }

            // Verificar permisos
            const rolesWithPermissions = await this.pool.query(`
                SELECT COUNT(*) FROM unified_roles 
                WHERE permissions IS NOT NULL AND jsonb_array_length(permissions) > 0
            `);

            if (parseInt(rolesWithPermissions.rows[0].count) > 0) {
                this.verificationResults.passed.push('Roles tienen permisos asignados');
            } else {
                this.verificationResults.warnings.push('Roles sin permisos definidos');
            }

            // Verificar vista de compatibilidad
            const compatibilityView = await this.pool.query('SELECT COUNT(*) FROM roles');
            this.verificationResults.passed.push('Vista de compatibilidad "roles" funcional');

        } catch (error) {
            console.error('   ❌ Error verificando roles:', error);
            this.verificationResults.failed.push(`Error en sistema de roles: ${error.message}`);
        }
    }

    async verifyLuminariasSystem() {
        try {
            // Verificar tabla unificada de Luminarias
            const luminariasUsers = await this.pool.query('SELECT COUNT(*) FROM unified_user_luminarias');
            const usersCount = await this.pool.query('SELECT COUNT(*) FROM users');

            const luminariasCount = parseInt(luminariasUsers.rows[0].count);
            const totalUsers = parseInt(usersCount.rows[0].count);

            if (luminariasCount === totalUsers) {
                console.log(`   ✓ Todos los usuarios tienen registro de Luminarias (${luminariasCount})`);
                this.verificationResults.passed.push('Sistema de Luminarias completo');
            } else {
                console.log(`   ⚠️  Solo ${luminariasCount}/${totalUsers} usuarios tienen Luminarias`);
                this.verificationResults.warnings.push(`${totalUsers - luminariasCount} usuarios sin registro de Luminarias`);
            }

            // Verificar función de transacciones
            try {
                const funcExists = await this.pool.query(`
                    SELECT EXISTS (
                        SELECT 1 FROM pg_proc 
                        WHERE proname = 'process_unified_luminarias_transaction'
                    )
                `);

                if (funcExists.rows[0].exists) {
                    this.verificationResults.passed.push('Función de transacciones de Luminarias existe');
                } else {
                    this.verificationResults.failed.push('Función de transacciones de Luminarias faltante');
                }
            } catch (error) {
                this.verificationResults.warnings.push('Error verificando función de Luminarias');
            }

            // Test de transacción básica (sin commit)
            const client = await this.pool.connect();
            try {
                await client.query('BEGIN');
                
                // Intentar una transacción de prueba
                await client.query(`
                    SELECT process_unified_luminarias_transaction(
                        1, 'earn', 10, 'Test transaction', 'testing', null, null, null, '{}', null, null
                    )
                `);
                
                await client.query('ROLLBACK');
                this.verificationResults.passed.push('Función de transacciones de Luminarias funcional');
                
            } catch (error) {
                await client.query('ROLLBACK');
                this.verificationResults.warnings.push('Función de Luminarias puede tener problemas');
            } finally {
                client.release();
            }

        } catch (error) {
            console.error('   ❌ Error verificando Luminarias:', error);
            this.verificationResults.failed.push(`Error en sistema de Luminarias: ${error.message}`);
        }
    }

    async verifyLevelsSystem() {
        try {
            // Verificar definiciones de niveles
            const levelDefs = await this.pool.query('SELECT COUNT(*) FROM level_definitions');
            const levelDefsCount = parseInt(levelDefs.rows[0].count);

            if (levelDefsCount >= 15) { // 5 niveles x 3 tipos
                this.verificationResults.passed.push(`Definiciones de niveles completas: ${levelDefsCount}`);
            } else {
                this.verificationResults.warnings.push(`Definiciones de niveles incompletas: ${levelDefsCount}/15 esperadas`);
            }

            // Verificar badges
            const badges = await this.pool.query('SELECT COUNT(*) FROM badge_definitions');
            const badgesCount = parseInt(badges.rows[0].count);

            if (badgesCount > 0) {
                this.verificationResults.passed.push(`Sistema de badges: ${badgesCount} badges definidos`);
            } else {
                this.verificationResults.warnings.push('Sistema de badges sin definiciones');
            }

            // Verificar calculadora de niveles
            const fs = require('fs').promises;
            try {
                await fs.access('./levels-calculator.js');
                this.verificationResults.passed.push('Calculadora de niveles existe');
            } catch {
                this.verificationResults.failed.push('Calculadora de niveles no encontrada');
            }

        } catch (error) {
            console.error('   ❌ Error verificando niveles:', error);
            this.verificationResults.failed.push(`Error en sistema de niveles: ${error.message}`);
        }
    }

    async verifyChallengesSystem() {
        try {
            // Verificar tabla de challenges
            const challenges = await this.pool.query('SELECT COUNT(*) FROM challenges');
            console.log(`   ℹ️  Challenges en sistema: ${challenges.rows[0].count}`);

            // Verificar participantes
            const participants = await this.pool.query('SELECT COUNT(*) FROM challenge_participants');
            console.log(`   ℹ️  Participaciones registradas: ${participants.rows[0].count}`);

            // Verificar integración con niveles
            const fs = require('fs').promises;
            try {
                await fs.access('./levels-challenges-integration.js');
                this.verificationResults.passed.push('Integración challenges-niveles existe');
            } catch {
                this.verificationResults.warnings.push('Integración challenges-niveles no encontrada');
            }

            this.verificationResults.passed.push('Sistema de challenges operativo');

        } catch (error) {
            console.error('   ❌ Error verificando challenges:', error);
            this.verificationResults.failed.push(`Error en sistema de challenges: ${error.message}`);
        }
    }

    async verifyCommunicationSystem() {
        try {
            // Verificar tickets unificados
            const tickets = await this.pool.query('SELECT COUNT(*) FROM unified_tickets');
            console.log(`   ℹ️  Tickets en sistema: ${tickets.rows[0].count}`);

            // Verificar mensajes
            const messages = await this.pool.query('SELECT COUNT(*) FROM unified_ticket_messages');
            console.log(`   ℹ️  Mensajes registrados: ${messages.rows[0].count}`);

            // Verificar función de generación de números
            const funcExists = await this.pool.query(`
                SELECT EXISTS (
                    SELECT 1 FROM pg_proc 
                    WHERE proname = 'generate_ticket_number'
                )
            `);

            if (funcExists.rows[0].exists) {
                this.verificationResults.passed.push('Sistema de comunicación funcional');
            } else {
                this.verificationResults.warnings.push('Función de tickets puede faltar');
            }

        } catch (error) {
            console.error('   ❌ Error verificando comunicación:', error);
            this.verificationResults.failed.push(`Error en sistema de comunicación: ${error.message}`);
        }
    }

    async verifyAPIsEndpoints() {
        try {
            // Verificar archivos de rutas críticos
            const fs = require('fs').promises;
            const criticalRoutes = [
                './routes/auth.js',
                './routes/users.js',
                './routes/blocks.js',
                './routes/games.js',
                './routes/levels.js',
                './routes/luminarias.js'
            ];

            for (const route of criticalRoutes) {
                try {
                    await fs.access(route);
                    this.verificationResults.passed.push(`Ruta ${route} existe`);
                } catch {
                    this.verificationResults.failed.push(`Ruta crítica ${route} faltante`);
                }
            }

            // Verificar capa de compatibilidad
            try {
                await fs.access('./routes-compatibility-layer.js');
                this.verificationResults.passed.push('Capa de compatibilidad de rutas existe');
            } catch {
                this.verificationResults.failed.push('Capa de compatibilidad faltante');
            }

        } catch (error) {
            console.error('   ❌ Error verificando APIs:', error);
            this.verificationResults.failed.push(`Error verificando APIs: ${error.message}`);
        }
    }

    async verifySystemIntegrations() {
        try {
            // Verificar WebSocket
            if (global.realTimeEvents) {
                this.verificationResults.passed.push('Sistema WebSocket inicializado');
            } else {
                this.verificationResults.warnings.push('Sistema WebSocket no inicializado');
            }

            // Verificar compatibilidad
            if (global.compatibilityLayer) {
                this.verificationResults.passed.push('Capa de compatibilidad activa');
            } else {
                this.verificationResults.failed.push('Capa de compatibilidad no activa');
            }

            // Verificar migration status
            const migrationStatus = await this.compatibilityLayer.checkMigrationStatus();
            if (migrationStatus.migration_complete) {
                this.verificationResults.passed.push('Migración de tablas unificadas completa');
            } else {
                this.verificationResults.critical_issues.push({
                    component: 'Migration System',
                    error: 'Migración no completada',
                    impact: 'critical',
                    missing_tables: migrationStatus.missing_tables
                });
            }

        } catch (error) {
            console.error('   ❌ Error verificando integraciones:', error);
            this.verificationResults.failed.push(`Error en integraciones: ${error.message}`);
        }
    }

    async verifyTechnicalServices() {
        try {
            const fs = require('fs').promises;
            
            // Verificar servicios técnicos avanzados
            try {
                await fs.access('./technical-services-advanced.js');
                this.verificationResults.passed.push('Servicios técnicos avanzados disponibles');
            } catch {
                this.verificationResults.warnings.push('Servicios técnicos avanzados no encontrados');
            }

            // Verificar búsqueda avanzada
            try {
                await fs.access('./advanced-search.js');
                this.verificationResults.passed.push('Sistema de búsqueda avanzada disponible');
            } catch {
                this.verificationResults.warnings.push('Sistema de búsqueda avanzada no encontrado');
            }

            // Verificar modales admin
            try {
                await fs.access('./admin-details-modal.js');
                this.verificationResults.passed.push('Sistema de modales admin disponible');
            } catch {
                this.verificationResults.warnings.push('Sistema de modales admin no encontrado');
            }

        } catch (error) {
            console.error('   ❌ Error verificando servicios técnicos:', error);
            this.verificationResults.warnings.push(`Error verificando servicios técnicos: ${error.message}`);
        }
    }

    generateFinalReport() {
        console.log('\n' + '='.repeat(70));
        console.log('📊 REPORTE FINAL DE VERIFICACIÓN');
        console.log('='.repeat(70));

        const totalTests = this.verificationResults.passed.length + 
                          this.verificationResults.failed.length + 
                          this.verificationResults.warnings.length;

        console.log(`\n🎯 Resumen General:`);
        console.log(`   Total de verificaciones: ${totalTests}`);
        console.log(`   ✅ Pasaron: ${this.verificationResults.passed.length}`);
        console.log(`   ❌ Fallaron: ${this.verificationResults.failed.length}`);
        console.log(`   ⚠️  Advertencias: ${this.verificationResults.warnings.length}`);
        console.log(`   🚨 Issues críticos: ${this.verificationResults.critical_issues.length}`);

        // Mostrar issues críticos
        if (this.verificationResults.critical_issues.length > 0) {
            console.log('\n🚨 ISSUES CRÍTICOS QUE REQUIEREN ATENCIÓN INMEDIATA:');
            this.verificationResults.critical_issues.forEach((issue, index) => {
                console.log(`   ${index + 1}. ${issue.component}: ${issue.error}`);
                if (issue.missing_tables) {
                    console.log(`      Tablas faltantes: ${issue.missing_tables.join(', ')}`);
                }
            });
        }

        // Mostrar fallos
        if (this.verificationResults.failed.length > 0) {
            console.log('\n❌ FUNCIONALIDADES CON FALLOS:');
            this.verificationResults.failed.forEach((fail, index) => {
                console.log(`   ${index + 1}. ${fail}`);
            });
        }

        // Mostrar advertencias
        if (this.verificationResults.warnings.length > 0) {
            console.log('\n⚠️  ADVERTENCIAS (Recomendado corregir):');
            this.verificationResults.warnings.slice(0, 5).forEach((warning, index) => {
                console.log(`   ${index + 1}. ${warning}`);
            });
            if (this.verificationResults.warnings.length > 5) {
                console.log(`   ... y ${this.verificationResults.warnings.length - 5} advertencias más`);
            }
        }

        // Estado general del sistema
        const criticalCount = this.verificationResults.critical_issues.length;
        const failCount = this.verificationResults.failed.length;
        const passCount = this.verificationResults.passed.length;

        let systemStatus;
        if (criticalCount > 0) {
            systemStatus = '🚨 CRÍTICO - Requiere atención inmediata';
        } else if (failCount > 5) {
            systemStatus = '❌ INESTABLE - Múltiples fallos detectados';
        } else if (failCount > 0) {
            systemStatus = '⚠️  PARCIAL - Algunos componentes fallan';
        } else if (this.verificationResults.warnings.length > 10) {
            systemStatus = '👀 ESTABLE - Con advertencias menores';
        } else {
            systemStatus = '✅ ESTABLE - Sistema operativo';
        }

        console.log(`\n🏥 ESTADO GENERAL DEL SISTEMA: ${systemStatus}`);
        console.log(`\n📈 Tasa de éxito: ${((passCount / totalTests) * 100).toFixed(1)}%`);

        // Recomendaciones
        console.log('\n💡 RECOMENDACIONES:');
        if (criticalCount > 0) {
            console.log('   1. URGENTE: Ejecutar migración crítica (node critical-fixes-migration.js)');
            console.log('   2. Verificar configuración de base de datos');
            console.log('   3. Re-ejecutar esta verificación después de correcciones');
        } else if (failCount > 0) {
            console.log('   1. Revisar y corregir funcionalidades fallidas');
            console.log('   2. Verificar configuración de archivos faltantes');
            console.log('   3. Comprobar variables de entorno');
        } else {
            console.log('   1. Sistema listo para producción');
            console.log('   2. Considerar corregir advertencias menores');
            console.log('   3. Implementar monitoreo continuo');
        }

        console.log('\n' + '='.repeat(70));
    }

    async close() {
        await this.pool.end();
        await this.compatibilityLayer.close();
    }
}

// Auto-ejecutar si se ejecuta directamente
if (require.main === module) {
    const verification = new FunctionalityVerification();
    
    async function run() {
        try {
            await verification.runCompleteVerification();
        } catch (error) {
            console.error('\n💥 Error en verificación:', error);
            process.exit(1);
        } finally {
            await verification.close();
            process.exit(0);
        }
    }
    
    run();
}

module.exports = FunctionalityVerification;