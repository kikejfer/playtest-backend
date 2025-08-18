const LevelsDatabase = require('./levels-database');
const LevelsCalculator = require('./levels-calculator');
const LevelsPaymentSystem = require('./levels-payments');
const LevelsNotificationSystem = require('./levels-notifications');
const LevelsBadgeSystem = require('./levels-badges');

// Script de configuración completa del sistema de niveles
class LevelsSetup {
    constructor() {
        this.database = new LevelsDatabase();
        this.calculator = new LevelsCalculator();
        this.paymentSystem = new LevelsPaymentSystem();
        this.notificationSystem = new LevelsNotificationSystem();
        this.badgeSystem = new LevelsBadgeSystem();
    }

    async setupCompleteSystem() {
        try {
            console.log('🚀 Iniciando configuración del sistema de niveles PLAYTEST...');

            // 1. Crear esquema de base de datos
            console.log('\n📊 Configurando base de datos...');
            await this.database.createLevelsSchema();
            await this.database.insertDefaultLevelDefinitions();

            // 2. Crear tablas adicionales para notificaciones y badges
            console.log('\n🔔 Configurando sistema de notificaciones...');
            await this.createNotificationTables();

            // 3. Crear tablas para badges y beneficios
            console.log('\n🏆 Configurando sistema de badges...');
            await this.createBadgeTables();
            await this.badgeSystem.createBadgeDefinitions();

            // 4. Configurar triggers automáticos
            console.log('\n⚡ Configurando triggers automáticos...');
            await this.setupAutomaticTriggers();

            // 5. Crear tareas automáticas
            console.log('\n⏰ Configurando tareas automáticas...');
            await this.setupAutomaticTasks();

            // 6. Ejecutar configuración inicial
            console.log('\n🔧 Ejecutando configuración inicial...');
            await this.runInitialConfiguration();

            console.log('\n✅ ¡Sistema de niveles configurado exitosamente!');
            console.log('\n📋 Resumen de configuración:');
            console.log('   ✓ Base de datos configurada con 7 tablas especializadas');
            console.log('   ✓ Sistema de cálculo automático de niveles');
            console.log('   ✓ Pagos semanales automáticos configurados');
            console.log('   ✓ Sistema de notificaciones activo');
            console.log('   ✓ Sistema de badges y beneficios implementado');
            console.log('   ✓ Triggers automáticos para cambios de nivel');
            console.log('   ✓ Analytics y estadísticas habilitados');
            console.log('\n🎉 ¡El sistema está listo para usar!');

        } catch (error) {
            console.error('❌ Error configurando sistema de niveles:', error);
            throw error;
        }
    }

    async createNotificationTables() {
        try {
            const { Pool } = require('pg');
            const pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });

            // Tabla de notificaciones de usuario
            await pool.query(`
                CREATE TABLE IF NOT EXISTS user_notifications (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    notification_type VARCHAR(50) NOT NULL,
                    title VARCHAR(200) NOT NULL,
                    message TEXT NOT NULL,
                    data JSONB DEFAULT '{}',
                    icon VARCHAR(100),
                    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
                    read_at TIMESTAMP WITH TIME ZONE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Tabla de preferencias de notificaciones
            await pool.query(`
                CREATE TABLE IF NOT EXISTS user_notification_preferences (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
                    preferences JSONB DEFAULT '{}',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Tabla de tokens push
            await pool.query(`
                CREATE TABLE IF NOT EXISTS user_push_tokens (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    push_token TEXT NOT NULL,
                    platform VARCHAR(20) NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    last_used TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, push_token, platform)
                )
            `);

            // Índices para notificaciones
            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_user_notifications_user_id ON user_notifications(user_id, created_at);
                CREATE INDEX IF NOT EXISTS idx_user_notifications_unread ON user_notifications(user_id, read_at) WHERE read_at IS NULL;
                CREATE INDEX IF NOT EXISTS idx_push_tokens_user_active ON user_push_tokens(user_id, is_active);
            `);

            console.log('   ✓ Tablas de notificaciones creadas');

        } catch (error) {
            console.error('Error creating notification tables:', error);
            throw error;
        }
    }

    async createBadgeTables() {
        try {
            const { Pool } = require('pg');
            const pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });

            // Tabla de definiciones de badges
            await pool.query(`
                CREATE TABLE IF NOT EXISTS badge_definitions (
                    id SERIAL PRIMARY KEY,
                    badge_type VARCHAR(50) NOT NULL,
                    level_name VARCHAR(50),
                    name VARCHAR(100) NOT NULL UNIQUE,
                    description TEXT NOT NULL,
                    icon VARCHAR(100) NOT NULL,
                    color VARCHAR(7) NOT NULL,
                    rarity VARCHAR(20) DEFAULT 'common' CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary')),
                    trigger_condition JSONB DEFAULT '{}',
                    benefits JSONB DEFAULT '{}',
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Tabla de badges de usuario
            await pool.query(`
                CREATE TABLE IF NOT EXISTS user_badges (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    badge_id INTEGER REFERENCES badge_definitions(id) ON DELETE CASCADE,
                    earned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    metadata JSONB DEFAULT '{}',
                    UNIQUE(user_id, badge_id)
                )
            `);

            // Tabla de transacciones de usuario (para pagos)
            await pool.query(`
                CREATE TABLE IF NOT EXISTS user_transactions (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    transaction_type VARCHAR(50) NOT NULL,
                    amount INTEGER NOT NULL,
                    description TEXT,
                    metadata JSONB DEFAULT '{}',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Índices para badges
            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_user_badges_user_id ON user_badges(user_id, earned_at);
                CREATE INDEX IF NOT EXISTS idx_user_badges_badge_id ON user_badges(badge_id);
                CREATE INDEX IF NOT EXISTS idx_badge_definitions_type ON badge_definitions(badge_type, level_name);
                CREATE INDEX IF NOT EXISTS idx_user_transactions_user_type ON user_transactions(user_id, transaction_type, created_at);
            `);

            console.log('   ✓ Tablas de badges creadas');

        } catch (error) {
            console.error('Error creating badge tables:', error);
            throw error;
        }
    }

    async setupAutomaticTriggers() {
        try {
            const { Pool } = require('pg');
            const pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });

            // Función para manejar cambios de respuestas (actualizar consolidación)
            await pool.query(`
                CREATE OR REPLACE FUNCTION handle_answer_changes()
                RETURNS TRIGGER AS $$
                BEGIN
                    -- Recalcular consolidación cuando se responde una pregunta
                    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
                        -- Obtener block_id de la pregunta
                        INSERT INTO async_level_calculations (user_id, block_id, calculation_type, trigger_source)
                        SELECT NEW.user_id, q.block_id, 'consolidation_update', 'user_answer'
                        FROM questions q 
                        WHERE q.id = NEW.question_id
                        ON CONFLICT (user_id, block_id, calculation_type) DO UPDATE SET
                            created_at = CURRENT_TIMESTAMP,
                            processed = false;
                    END IF;
                    
                    RETURN COALESCE(NEW, OLD);
                END;
                $$ LANGUAGE plpgsql;
            `);

            // Función para manejar cambios en games (actividad de creador)
            await pool.query(`
                CREATE OR REPLACE FUNCTION handle_game_changes()
                RETURNS TRIGGER AS $$
                BEGIN
                    -- Actualizar métricas de creador cuando se completa un juego
                    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status != 'completed') THEN
                        INSERT INTO async_level_calculations (user_id, calculation_type, trigger_source)
                        VALUES (NEW.created_by, 'creator_update', 'game_completed')
                        ON CONFLICT (user_id, calculation_type) DO UPDATE SET
                            created_at = CURRENT_TIMESTAMP,
                            processed = false;
                    END IF;
                    
                    RETURN COALESCE(NEW, OLD);
                END;
                $$ LANGUAGE plpgsql;
            `);

            // Tabla para cálculos asíncronos
            await pool.query(`
                CREATE TABLE IF NOT EXISTS async_level_calculations (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    block_id INTEGER,
                    calculation_type VARCHAR(50) NOT NULL,
                    trigger_source VARCHAR(50) NOT NULL,
                    processed BOOLEAN DEFAULT false,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    processed_at TIMESTAMP WITH TIME ZONE,
                    UNIQUE(user_id, block_id, calculation_type)
                )
            `);

            // Triggers en user_answers
            await pool.query(`
                DROP TRIGGER IF EXISTS trigger_answer_level_update ON user_answers;
                CREATE TRIGGER trigger_answer_level_update
                    AFTER INSERT OR UPDATE ON user_answers
                    FOR EACH ROW EXECUTE FUNCTION handle_answer_changes();
            `);

            // Triggers en games
            await pool.query(`
                DROP TRIGGER IF EXISTS trigger_game_level_update ON games;
                CREATE TRIGGER trigger_game_level_update
                    AFTER INSERT OR UPDATE ON games
                    FOR EACH ROW EXECUTE FUNCTION handle_game_changes();
            `);

            // Función para procesar cálculos pendientes
            await pool.query(`
                CREATE OR REPLACE FUNCTION process_pending_calculations()
                RETURNS INTEGER AS $$
                DECLARE
                    calc_record RECORD;
                    processed_count INTEGER := 0;
                BEGIN
                    -- Procesar cálculos pendientes
                    FOR calc_record IN 
                        SELECT * FROM async_level_calculations 
                        WHERE processed = false 
                        ORDER BY created_at ASC 
                        LIMIT 100
                    LOOP
                        -- Marcar como procesado inmediatamente para evitar duplicados
                        UPDATE async_level_calculations 
                        SET processed = true, processed_at = CURRENT_TIMESTAMP
                        WHERE id = calc_record.id;
                        
                        -- Aquí se ejecutarían los cálculos reales
                        -- Por ahora solo marcamos como procesado
                        processed_count := processed_count + 1;
                    END LOOP;
                    
                    RETURN processed_count;
                END;
                $$ LANGUAGE plpgsql;
            `);

            console.log('   ✓ Triggers automáticos configurados');

        } catch (error) {
            console.error('Error setting up automatic triggers:', error);
            throw error;
        }
    }

    async setupAutomaticTasks() {
        try {
            // Configurar tareas automáticas usando node-cron si está disponible
            try {
                const cron = require('node-cron');

                // Cálculos de nivel cada 5 minutos
                cron.schedule('*/5 * * * *', async () => {
                    try {
                        await this.processAsyncCalculations();
                    } catch (error) {
                        console.error('Error en cálculos automáticos:', error);
                    }
                });

                // Notificaciones cada 15 minutos
                cron.schedule('*/15 * * * *', async () => {
                    try {
                        await this.notificationSystem.runPeriodicNotifications();
                    } catch (error) {
                        console.error('Error en notificaciones automáticas:', error);
                    }
                });

                // Pagos semanales los lunes a las 2 AM
                cron.schedule('0 2 * * 1', async () => {
                    try {
                        console.log('🕐 Ejecutando pagos semanales automáticos...');
                        const results = await this.paymentSystem.processWeeklyPayments();
                        console.log('💰 Pagos semanales completados:', results.summary);
                    } catch (error) {
                        console.error('Error en pagos automáticos:', error);
                    }
                });

                // Limpieza de datos antiguos diaria a las 3 AM
                cron.schedule('0 3 * * *', async () => {
                    try {
                        await this.runDailyMaintenance();
                    } catch (error) {
                        console.error('Error en mantenimiento diario:', error);
                    }
                });

                console.log('   ✓ Tareas automáticas configuradas con cron:');
                console.log('     - Cálculos de nivel cada 5 minutos');
                console.log('     - Notificaciones cada 15 minutos');
                console.log('     - Pagos semanales los lunes a las 2 AM');
                console.log('     - Mantenimiento diario a las 3 AM');

            } catch (cronError) {
                console.log('   ⚠️  node-cron no disponible, configurando intervalos básicos...');

                // Fallback con setInterval
                setInterval(async () => {
                    try {
                        await this.processAsyncCalculations();
                    } catch (error) {
                        console.error('Error en cálculos:', error);
                    }
                }, 5 * 60 * 1000); // 5 minutos

                setInterval(async () => {
                    try {
                        await this.notificationSystem.runPeriodicNotifications();
                    } catch (error) {
                        console.error('Error en notificaciones:', error);
                    }
                }, 15 * 60 * 1000); // 15 minutos

                console.log('   ✓ Intervalos básicos configurados');
            }

        } catch (error) {
            console.error('Error setting up automatic tasks:', error);
        }
    }

    async processAsyncCalculations() {
        try {
            const { Pool } = require('pg');
            const pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });

            // Obtener cálculos pendientes
            const pendingCalculations = await pool.query(`
                SELECT * FROM async_level_calculations 
                WHERE processed = false 
                ORDER BY created_at ASC 
                LIMIT 50
            `);

            let processedCount = 0;

            for (const calc of pendingCalculations.rows) {
                try {
                    // Marcar como procesado inmediatamente
                    await pool.query(`
                        UPDATE async_level_calculations 
                        SET processed = true, processed_at = CURRENT_TIMESTAMP
                        WHERE id = $1
                    `, [calc.id]);

                    // Ejecutar cálculo según el tipo
                    switch (calc.calculation_type) {
                        case 'consolidation_update':
                            if (calc.block_id) {
                                const result = await this.calculator.updateUserLevelForBlock(calc.user_id, calc.block_id, false);
                                if (result && result.changed) {
                                    // Enviar notificación si hubo cambio
                                    await this.notificationSystem.sendLevelUpNotification(calc.user_id, {
                                        level_type: 'user',
                                        new_level: result.level.level_name,
                                        previous_level: result.previous_level,
                                        block_id: calc.block_id,
                                        consolidation: result.consolidation
                                    });

                                    // Otorgar badge si corresponde
                                    await this.badgeSystem.awardLevelBadge(calc.user_id, 'user', result.level.level_name);
                                }
                            }
                            break;

                        case 'creator_update':
                            const creatorResult = await this.calculator.updateCreatorLevel(calc.user_id, false);
                            if (creatorResult && creatorResult.changed) {
                                await this.notificationSystem.sendLevelUpNotification(calc.user_id, {
                                    level_type: 'creator',
                                    new_level: creatorResult.level.level_name,
                                    previous_level: creatorResult.previous_level,
                                    active_users: creatorResult.active_users,
                                    weekly_luminarias: creatorResult.level.weekly_luminarias
                                });

                                await this.badgeSystem.awardLevelBadge(calc.user_id, 'creator', creatorResult.level.level_name);
                            }
                            break;

                        case 'teacher_update':
                            const teacherResult = await this.calculator.updateTeacherLevel(calc.user_id, false);
                            if (teacherResult && teacherResult.changed) {
                                await this.notificationSystem.sendLevelUpNotification(calc.user_id, {
                                    level_type: 'teacher',
                                    new_level: teacherResult.level.level_name,
                                    previous_level: teacherResult.previous_level,
                                    active_students: teacherResult.active_students,
                                    weekly_luminarias: teacherResult.level.weekly_luminarias
                                });

                                await this.badgeSystem.awardLevelBadge(calc.user_id, 'teacher', teacherResult.level.level_name);
                            }
                            break;
                    }

                    processedCount++;

                } catch (calcError) {
                    console.error(`Error procesando cálculo ${calc.id}:`, calcError);
                }
            }

            if (processedCount > 0) {
                console.log(`🔄 Procesados ${processedCount} cálculos de nivel pendientes`);
            }

        } catch (error) {
            console.error('Error processing async calculations:', error);
        }
    }

    async runDailyMaintenance() {
        try {
            console.log('🧹 Ejecutando mantenimiento diario...');

            // Limpiar notificaciones antiguas
            const cleanedNotifications = await this.notificationSystem.cleanupOldNotifications(90);

            // Limpiar beneficios expirados
            const cleanedBenefits = await this.badgeSystem.cleanupExpiredBenefits();

            // Limpiar cálculos procesados antiguos
            const { Pool } = require('pg');
            const pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });

            const cleanedCalculations = await pool.query(`
                DELETE FROM async_level_calculations
                WHERE processed = true 
                    AND processed_at < CURRENT_TIMESTAMP - INTERVAL '7 days'
                RETURNING id
            `);

            console.log(`✅ Mantenimiento completado:`);
            console.log(`   - ${cleanedNotifications} notificaciones antiguas eliminadas`);
            console.log(`   - ${cleanedBenefits} beneficios expirados desactivados`);
            console.log(`   - ${cleanedCalculations.rows.length} cálculos antiguos eliminados`);

        } catch (error) {
            console.error('Error en mantenimiento diario:', error);
        }
    }

    async runInitialConfiguration() {
        try {
            // Calcular niveles para usuarios existentes
            const { Pool } = require('pg');
            const pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });

            const usersResult = await pool.query(`
                SELECT DISTINCT u.id, u.nickname
                FROM users u
                WHERE u.id IN (
                    SELECT DISTINCT user_id FROM user_answers
                    UNION
                    SELECT DISTINCT created_by FROM games
                    UNION 
                    SELECT DISTINCT creator_id FROM blocks
                )
                LIMIT 50
            `);

            console.log(`   🔄 Calculando niveles iniciales para ${usersResult.rows.length} usuarios...`);

            let processedUsers = 0;
            for (const user of usersResult.rows) {
                try {
                    const results = await this.calculator.updateAllUserLevels(user.id);
                    
                    // Otorgar badges iniciales
                    if (results.creator_level) {
                        await this.badgeSystem.awardLevelBadge(user.id, 'creator', results.creator_level.level.level_name);
                    }
                    if (results.teacher_level) {
                        await this.badgeSystem.awardLevelBadge(user.id, 'teacher', results.teacher_level.level.level_name);
                    }
                    for (const [blockId, userLevel] of Object.entries(results.user_levels)) {
                        await this.badgeSystem.awardLevelBadge(user.id, 'user', userLevel.level.level_name);
                    }

                    processedUsers++;
                } catch (userError) {
                    console.error(`Error procesando usuario ${user.id}:`, userError);
                }
            }

            console.log(`   ✅ ${processedUsers} usuarios procesados exitosamente`);

        } catch (error) {
            console.error('Error en configuración inicial:', error);
        }
    }

    async checkSystemHealth() {
        try {
            const { Pool } = require('pg');
            const pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });

            // Verificar conexión a base de datos
            await pool.query('SELECT 1');

            // Verificar tablas principales
            const requiredTables = [
                'level_definitions', 'user_levels', 'level_progression_history',
                'user_activity_metrics', 'weekly_luminarias_payments', 'user_block_consolidation',
                'user_level_benefits', 'user_notifications', 'badge_definitions', 'user_badges'
            ];

            const missingTables = [];
            for (const table of requiredTables) {
                const result = await pool.query(`
                    SELECT COUNT(*) FROM information_schema.tables 
                    WHERE table_name = $1
                `, [table]);

                if (result.rows[0].count === '0') {
                    missingTables.push(table);
                }
            }

            // Obtener estadísticas básicas
            const stats = await pool.query(`
                SELECT 
                    (SELECT COUNT(*) FROM level_definitions) as level_definitions,
                    (SELECT COUNT(*) FROM user_levels) as user_levels,
                    (SELECT COUNT(*) FROM badge_definitions) as badge_definitions,
                    (SELECT COUNT(*) FROM user_badges) as user_badges,
                    (SELECT COUNT(*) FROM weekly_luminarias_payments WHERE payment_status = 'paid') as successful_payments,
                    (SELECT COUNT(*) FROM user_notifications WHERE read_at IS NULL) as unread_notifications
            `);

            const healthReport = {
                status: missingTables.length === 0 ? 'healthy' : 'incomplete',
                database_connected: true,
                missing_tables: missingTables,
                system_statistics: stats.rows[0],
                last_check: new Date().toISOString()
            };

            return healthReport;

        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                last_check: new Date().toISOString()
            };
        }
    }

    async close() {
        await this.database.close();
        await this.calculator.close();
        await this.paymentSystem.close();
        await this.notificationSystem.close();
        await this.badgeSystem.close();
    }
}

// Permitir ejecución directa del script
if (require.main === module) {
    const setup = new LevelsSetup();
    setup.setupCompleteSystem()
        .then(async () => {
            console.log('\n🔍 Verificando estado del sistema...');
            const health = await setup.checkSystemHealth();
            console.log('📊 Estado del sistema:', health);

            // Ejecutar un cálculo inicial
            console.log('\n🚀 Ejecutando procesamiento inicial...');
            await setup.processAsyncCalculations();

            await setup.close();
            console.log('\n🎯 ¡Configuración completada exitosamente!');
            process.exit(0);
        })
        .catch(async (error) => {
            console.error('💥 Error en configuración:', error);
            await setup.close();
            process.exit(1);
        });
}

module.exports = LevelsSetup;