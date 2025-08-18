const LevelsDatabase = require('./levels-database');
const LevelsBadgeSystem = require('./levels-badges');
const UsersSchemaUpdater = require('./update-users-schema');
const { Pool } = require('pg');

// Script de migración completa del sistema de niveles
class CompleteLevelsMigration {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
        
        this.levelsDatabase = new LevelsDatabase();
        this.badgeSystem = new LevelsBadgeSystem();
        this.usersUpdater = new UsersSchemaUpdater();
    }

    async runCompleteMigration() {
        try {
            console.log('🚀 Iniciando migración completa del sistema de niveles PLAYTEST');
            console.log('=====================================================');

            // 1. Verificar conexión a base de datos
            console.log('\n📡 Verificando conexión a base de datos...');
            await this.verifyDatabaseConnection();

            // 2. Actualizar esquema de usuarios
            console.log('\n👥 Actualizando esquema de usuarios...');
            await this.usersUpdater.updateUsersSchema();

            // 3. Crear esquema completo de niveles
            console.log('\n📊 Creando esquema de niveles...');
            await this.levelsDatabase.createLevelsSchema();
            await this.levelsDatabase.insertDefaultLevelDefinitions();

            // 4. Crear tablas adicionales
            console.log('\n🔧 Creando tablas adicionales...');
            await this.createAdditionalTables();

            // 5. Crear sistema de badges
            console.log('\n🏆 Configurando sistema de badges...');
            await this.badgeSystem.createBadgeDefinitions();

            // 6. Configurar triggers y funciones
            console.log('\n⚡ Configurando triggers automáticos...');
            await this.setupAdvancedTriggers();

            // 7. Migrar datos existentes
            console.log('\n📤 Migrando datos existentes...');
            await this.migrateExistingData();

            // 8. Ejecutar cálculos iniciales
            console.log('\n🔄 Ejecutando cálculos iniciales...');
            await this.runInitialCalculations();

            // 9. Verificar integridad
            console.log('\n✅ Verificando integridad del sistema...');
            const verification = await this.verifySystemIntegrity();

            console.log('\n🎉 ¡Migración completada exitosamente!');
            console.log('=====================================================');
            console.log('📋 Resumen de migración:');
            console.log(`   ✓ ${verification.tables_created} tablas creadas`);
            console.log(`   ✓ ${verification.users_migrated} usuarios migrados`);
            console.log(`   ✓ ${verification.levels_calculated} niveles calculados`);
            console.log(`   ✓ ${verification.badges_created} badges creados`);
            console.log(`   ✓ ${verification.triggers_created} triggers configurados`);
            
            return verification;

        } catch (error) {
            console.error('❌ Error en migración:', error);
            await this.rollbackMigration();
            throw error;
        }
    }

    async verifyDatabaseConnection() {
        try {
            const result = await this.pool.query('SELECT NOW() as current_time, version() as db_version');
            console.log(`   ✓ Conectado a PostgreSQL`);
            console.log(`   ✓ Hora actual: ${result.rows[0].current_time}`);
            console.log(`   ✓ Versión: ${result.rows[0].db_version.split(' ')[0]} ${result.rows[0].db_version.split(' ')[1]}`);
        } catch (error) {
            throw new Error(`Error conectando a base de datos: ${error.message}`);
        }
    }

    async createAdditionalTables() {
        try {
            // Tabla de notificaciones
            await this.pool.query(`
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
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS user_notification_preferences (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
                    preferences JSONB DEFAULT '{}',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Tabla de tokens push
            await this.pool.query(`
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

            // Tabla de transacciones de usuario
            await this.pool.query(`
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

            // Tabla de cálculos asíncronos
            await this.pool.query(`
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

            // Crear índices optimizados
            await this.createOptimizedIndexes();

            console.log('   ✓ Tablas adicionales creadas');

        } catch (error) {
            throw new Error(`Error creando tablas adicionales: ${error.message}`);
        }
    }

    async createOptimizedIndexes() {
        const indexes = [
            // Índices para notificaciones
            'CREATE INDEX IF NOT EXISTS idx_user_notifications_user_id ON user_notifications(user_id, created_at)',
            'CREATE INDEX IF NOT EXISTS idx_user_notifications_unread ON user_notifications(user_id, read_at) WHERE read_at IS NULL',
            'CREATE INDEX IF NOT EXISTS idx_push_tokens_user_active ON user_push_tokens(user_id, is_active)',
            
            // Índices para badges
            'CREATE INDEX IF NOT EXISTS idx_user_badges_user_id ON user_badges(user_id, earned_at)',
            'CREATE INDEX IF NOT EXISTS idx_user_badges_badge_id ON user_badges(badge_id)',
            'CREATE INDEX IF NOT EXISTS idx_badge_definitions_type ON badge_definitions(badge_type, level_name)',
            
            // Índices para transacciones
            'CREATE INDEX IF NOT EXISTS idx_user_transactions_user_type ON user_transactions(user_id, transaction_type, created_at)',
            'CREATE INDEX IF NOT EXISTS idx_user_transactions_amount ON user_transactions(amount, created_at)',
            
            // Índices para cálculos asíncronos
            'CREATE INDEX IF NOT EXISTS idx_async_calculations_processed ON async_level_calculations(processed, created_at)',
            'CREATE INDEX IF NOT EXISTS idx_async_calculations_user_type ON async_level_calculations(user_id, calculation_type)',
            
            // Índices para optimización de niveles
            'CREATE INDEX IF NOT EXISTS idx_user_levels_user_type ON user_levels(user_id, level_type)',
            'CREATE INDEX IF NOT EXISTS idx_user_levels_block ON user_levels(user_id, block_id)',
            'CREATE INDEX IF NOT EXISTS idx_activity_metrics_user_date ON user_activity_metrics(user_id, metric_date)',
            'CREATE INDEX IF NOT EXISTS idx_activity_metrics_block_date ON user_activity_metrics(block_id, metric_date)',
            'CREATE INDEX IF NOT EXISTS idx_consolidation_user_block ON user_block_consolidation(user_id, block_id)',
            'CREATE INDEX IF NOT EXISTS idx_progression_history_user ON level_progression_history(user_id, promoted_at)',
            'CREATE INDEX IF NOT EXISTS idx_weekly_payments_user_week ON weekly_luminarias_payments(user_id, week_start_date)',
            'CREATE INDEX IF NOT EXISTS idx_level_benefits_user_active ON user_level_benefits(user_id, is_active)',
            
            // Índices para rendimiento de consultas
            'CREATE INDEX IF NOT EXISTS idx_users_luminarias ON users(luminarias) WHERE luminarias IS NOT NULL',
            'CREATE INDEX IF NOT EXISTS idx_level_definitions_type_order ON level_definitions(level_type, level_order)',
            'CREATE INDEX IF NOT EXISTS idx_weekly_payments_status ON weekly_luminarias_payments(payment_status, week_start_date)'
        ];

        for (const indexQuery of indexes) {
            try {
                await this.pool.query(indexQuery);
            } catch (error) {
                console.warn(`   ⚠️  Error creando índice: ${error.message}`);
            }
        }
    }

    async setupAdvancedTriggers() {
        try {
            // Función para manejar cambios de respuestas
            await this.pool.query(`
                CREATE OR REPLACE FUNCTION handle_answer_changes()
                RETURNS TRIGGER AS $$
                BEGIN
                    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
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

            // Función para manejar cambios en games
            await this.pool.query(`
                CREATE OR REPLACE FUNCTION handle_game_changes()
                RETURNS TRIGGER AS $$
                BEGIN
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

            // Función para actualizar timestamp de notificaciones
            await this.pool.query(`
                CREATE OR REPLACE FUNCTION update_notification_preferences_timestamp()
                RETURNS TRIGGER AS $$
                BEGIN
                    NEW.updated_at = CURRENT_TIMESTAMP;
                    RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;
            `);

            // Crear triggers
            const triggers = [
                'DROP TRIGGER IF EXISTS trigger_answer_level_update ON user_answers',
                'CREATE TRIGGER trigger_answer_level_update AFTER INSERT OR UPDATE ON user_answers FOR EACH ROW EXECUTE FUNCTION handle_answer_changes()',
                
                'DROP TRIGGER IF EXISTS trigger_game_level_update ON games',
                'CREATE TRIGGER trigger_game_level_update AFTER INSERT OR UPDATE ON games FOR EACH ROW EXECUTE FUNCTION handle_game_changes()',
                
                'DROP TRIGGER IF EXISTS trigger_update_notification_preferences ON user_notification_preferences',
                'CREATE TRIGGER trigger_update_notification_preferences BEFORE UPDATE ON user_notification_preferences FOR EACH ROW EXECUTE FUNCTION update_notification_preferences_timestamp()'
            ];

            for (const triggerQuery of triggers) {
                await this.pool.query(triggerQuery);
            }

            console.log('   ✓ Triggers automáticos configurados');

        } catch (error) {
            throw new Error(`Error configurando triggers: ${error.message}`);
        }
    }

    async migrateExistingData() {
        try {
            // Verificar usuarios existentes
            const usersResult = await this.pool.query(`
                SELECT COUNT(*) as total FROM users
            `);
            const totalUsers = parseInt(usersResult.rows[0].total);

            if (totalUsers === 0) {
                console.log('   ⚠️  No hay usuarios existentes para migrar');
                return;
            }

            // Asignar Luminarias iniciales a usuarios sin balance
            const usersUpdated = await this.pool.query(`
                UPDATE users 
                SET luminarias = 100 
                WHERE luminarias IS NULL OR luminarias = 0
                RETURNING id
            `);

            console.log(`   ✓ ${usersUpdated.rows.length} usuarios actualizados con Luminarias iniciales`);

            // Crear preferencias de notificación por defecto
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
                SELECT id, $1::jsonb
                FROM users
                WHERE id NOT IN (SELECT user_id FROM user_notification_preferences)
            `, [JSON.stringify(defaultPreferences)]);

            console.log('   ✓ Preferencias de notificación por defecto creadas');

        } catch (error) {
            throw new Error(`Error migrando datos existentes: ${error.message}`);
        }
    }

    async runInitialCalculations() {
        try {
            const LevelsCalculator = require('./levels-calculator');
            const calculator = new LevelsCalculator();

            // Obtener usuarios con actividad para calcular niveles iniciales
            const activeUsersResult = await this.pool.query(`
                SELECT DISTINCT u.id, u.nickname
                FROM users u
                WHERE u.id IN (
                    SELECT DISTINCT user_id FROM user_answers
                    UNION
                    SELECT DISTINCT created_by FROM games
                    UNION 
                    SELECT DISTINCT creator_id FROM blocks
                )
                LIMIT 100
            `);

            let processedUsers = 0;
            let levelsCalculated = 0;

            for (const user of activeUsersResult.rows) {
                try {
                    const results = await calculator.updateAllUserLevels(user.id);
                    
                    // Contar niveles calculados
                    if (results.creator_level) levelsCalculated++;
                    if (results.teacher_level) levelsCalculated++;
                    levelsCalculated += Object.keys(results.user_levels || {}).length;

                    // Otorgar badges iniciales
                    if (results.creator_level) {
                        await this.badgeSystem.awardLevelBadge(user.id, 'creator', results.creator_level.level.level_name);
                    }
                    if (results.teacher_level) {
                        await this.badgeSystem.awardLevelBadge(user.id, 'teacher', results.teacher_level.level.level_name);
                    }
                    for (const [blockId, userLevel] of Object.entries(results.user_levels || {})) {
                        await this.badgeSystem.awardLevelBadge(user.id, 'user', userLevel.level.level_name);
                    }

                    processedUsers++;
                } catch (userError) {
                    console.warn(`   ⚠️  Error procesando usuario ${user.id}: ${userError.message}`);
                }
            }

            await calculator.close();
            console.log(`   ✓ ${processedUsers} usuarios procesados, ${levelsCalculated} niveles calculados`);

            return { processedUsers, levelsCalculated };

        } catch (error) {
            throw new Error(`Error en cálculos iniciales: ${error.message}`);
        }
    }

    async verifySystemIntegrity() {
        try {
            const verification = {
                tables_created: 0,
                users_migrated: 0,
                levels_calculated: 0,
                badges_created: 0,
                triggers_created: 0,
                indexes_created: 0,
                errors: []
            };

            // Verificar tablas principales
            const requiredTables = [
                'level_definitions', 'user_levels', 'level_progression_history',
                'user_activity_metrics', 'weekly_luminarias_payments', 'user_block_consolidation',
                'user_level_benefits', 'user_notifications', 'user_notification_preferences',
                'badge_definitions', 'user_badges', 'user_transactions', 'async_level_calculations'
            ];

            for (const table of requiredTables) {
                const result = await this.pool.query(`
                    SELECT COUNT(*) FROM information_schema.tables 
                    WHERE table_name = $1
                `, [table]);

                if (result.rows[0].count === '1') {
                    verification.tables_created++;
                } else {
                    verification.errors.push(`Tabla ${table} no existe`);
                }
            }

            // Verificar datos migrados
            const userCount = await this.pool.query('SELECT COUNT(*) FROM users WHERE luminarias IS NOT NULL');
            verification.users_migrated = parseInt(userCount.rows[0].count);

            const levelCount = await this.pool.query('SELECT COUNT(*) FROM user_levels');
            verification.levels_calculated = parseInt(levelCount.rows[0].count);

            const badgeDefCount = await this.pool.query('SELECT COUNT(*) FROM badge_definitions');
            verification.badges_created = parseInt(badgeDefCount.rows[0].count);

            // Verificar triggers
            const triggerCount = await this.pool.query(`
                SELECT COUNT(*) FROM information_schema.triggers 
                WHERE trigger_name LIKE '%level%' OR trigger_name LIKE '%notification%'
            `);
            verification.triggers_created = parseInt(triggerCount.rows[0].count);

            // Verificar índices
            const indexCount = await this.pool.query(`
                SELECT COUNT(*) FROM pg_indexes 
                WHERE indexname LIKE 'idx_%level%' OR indexname LIKE 'idx_%notification%' OR indexname LIKE 'idx_%badge%'
            `);
            verification.indexes_created = parseInt(indexCount.rows[0].count);

            // Verificar integridad referencial
            await this.verifyReferentialIntegrity(verification);

            return verification;

        } catch (error) {
            throw new Error(`Error verificando integridad: ${error.message}`);
        }
    }

    async verifyReferentialIntegrity(verification) {
        try {
            // Verificar referencias de user_levels
            const orphanLevels = await this.pool.query(`
                SELECT COUNT(*) FROM user_levels ul
                LEFT JOIN users u ON ul.user_id = u.id
                WHERE u.id IS NULL
            `);

            if (parseInt(orphanLevels.rows[0].count) > 0) {
                verification.errors.push(`${orphanLevels.rows[0].count} niveles huérfanos encontrados`);
            }

            // Verificar referencias de badges
            const orphanBadges = await this.pool.query(`
                SELECT COUNT(*) FROM user_badges ub
                LEFT JOIN users u ON ub.user_id = u.id
                WHERE u.id IS NULL
            `);

            if (parseInt(orphanBadges.rows[0].count) > 0) {
                verification.errors.push(`${orphanBadges.rows[0].count} badges huérfanos encontrados`);
            }

            // Verificar definiciones de niveles completas
            const levelDefinitionsCount = await this.pool.query(`
                SELECT level_type, COUNT(*) as count
                FROM level_definitions
                GROUP BY level_type
            `);

            const expectedCounts = { creator: 5, teacher: 5, user: 5 };
            for (const row of levelDefinitionsCount.rows) {
                if (parseInt(row.count) !== expectedCounts[row.level_type]) {
                    verification.errors.push(`Definiciones de nivel ${row.level_type}: esperadas ${expectedCounts[row.level_type]}, encontradas ${row.count}`);
                }
            }

        } catch (error) {
            verification.errors.push(`Error verificando integridad referencial: ${error.message}`);
        }
    }

    async rollbackMigration() {
        try {
            console.log('\n🔄 Iniciando rollback de migración...');

            // Lista de tablas a eliminar (en orden inverso de dependencias)
            const tablesToDrop = [
                'async_level_calculations',
                'user_transactions', 
                'user_push_tokens',
                'user_notification_preferences',
                'user_notifications',
                'user_badges',
                'badge_definitions',
                'user_level_benefits',
                'weekly_luminarias_payments',
                'level_progression_history',
                'user_block_consolidation',
                'user_activity_metrics',
                'user_levels',
                'level_definitions'
            ];

            for (const table of tablesToDrop) {
                try {
                    await this.pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
                    console.log(`   ✓ Tabla ${table} eliminada`);
                } catch (error) {
                    console.warn(`   ⚠️  Error eliminando tabla ${table}: ${error.message}`);
                }
            }

            // Eliminar triggers
            const triggersToRemove = [
                'trigger_answer_level_update',
                'trigger_game_level_update', 
                'trigger_update_notification_preferences'
            ];

            for (const trigger of triggersToRemove) {
                try {
                    await this.pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON user_answers CASCADE`);
                    await this.pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON games CASCADE`);
                    await this.pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON user_notification_preferences CASCADE`);
                } catch (error) {
                    // Ignorar errores de triggers que no existen
                }
            }

            // Eliminar funciones
            const functionsToRemove = [
                'handle_answer_changes',
                'handle_game_changes',
                'update_notification_preferences_timestamp',
                'calculate_user_consolidation',
                'count_active_users_for_creator',
                'count_active_students_for_teacher',
                'update_user_levels',
                'update_user_level_by_consolidation',
                'update_creator_teacher_levels'
            ];

            for (const func of functionsToRemove) {
                try {
                    await this.pool.query(`DROP FUNCTION IF EXISTS ${func}() CASCADE`);
                } catch (error) {
                    // Ignorar errores de funciones que no existen
                }
            }

            console.log('   ✓ Rollback completado');

        } catch (error) {
            console.error('❌ Error en rollback:', error);
        }
    }

    async close() {
        await this.pool.end();
        await this.levelsDatabase.close();
        await this.badgeSystem.close();
        await this.usersUpdater.close();
    }
}

// Auto-ejecutar si se ejecuta directamente
if (require.main === module) {
    const migration = new CompleteLevelsMigration();
    
    async function run() {
        try {
            const result = await migration.runCompleteMigration();
            
            if (result.errors && result.errors.length > 0) {
                console.log('\n⚠️  Advertencias encontradas:');
                result.errors.forEach(error => console.log(`   - ${error}`));
            }
            
            console.log('\n🎯 ¡Migración exitosa! El sistema de niveles está listo para usar.');
            
        } catch (error) {
            console.error('\n💥 Error en migración:', error);
            process.exit(1);
        } finally {
            await migration.close();
            process.exit(0);
        }
    }
    
    run();
}

module.exports = CompleteLevelsMigration;