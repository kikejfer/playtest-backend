const { Pool } = require('pg');
require('dotenv').config();

// Sistema de migración para asegurar que todos los datos permanentes estén en PostgreSQL
class DataPersistenceMigration {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
    }

    async migrateToPersistentStorage() {
        try {
            console.log('🔄 Iniciando migración de persistencia de datos...');
            console.log('='.repeat(60));

            const client = await this.pool.connect();
            
            try {
                await client.query('BEGIN');

                // 1. Migrar sistema de feature flags a PostgreSQL
                console.log('\n1. 🚩 Migrando feature flags a PostgreSQL...');
                await this.migrateFeatureFlags(client);

                // 2. Crear tablas para preferencias de usuario persistentes
                console.log('\n2. ⚙️ Creando sistema de preferencias persistentes...');
                await this.createUserPreferencesSystem(client);

                // 3. Migrar estados de juego a persistencia
                console.log('\n3. 🎮 Migrando estados de juego...');
                await this.migrateGameStates(client);

                // 4. Crear sistema de configuración del sistema
                console.log('\n4. 🔧 Creando configuración del sistema...');
                await this.createSystemConfiguration(client);

                // 5. Migrar historial de búsquedas a PostgreSQL
                console.log('\n5. 🔍 Asegurando persistencia de búsquedas...');
                await this.ensureSearchPersistence(client);

                // 6. Crear sistema de sesiones persistentes
                console.log('\n6. 📱 Creando sesiones persistentes...');
                await this.createPersistentSessions(client);

                // 7. Migrar datos de analytics y métricas
                console.log('\n7. 📊 Asegurando persistencia de analytics...');
                await this.ensureAnalyticsPersistence(client);

                await client.query('COMMIT');
                console.log('\n✅ Migración de persistencia completada exitosamente!');

                // Verificar integridad de la migración
                await this.verifyDataPersistence();

            } catch (error) {
                await client.query('ROLLBACK');
                console.error('\n❌ Error durante la migración:', error);
                throw error;
            } finally {
                client.release();
            }

        } catch (error) {
            console.error('\n💥 Error crítico en migración de persistencia:', error);
            throw error;
        }
    }

    async migrateFeatureFlags(client) {
        try {
            // Crear tabla para feature flags persistentes
            await client.query(`
                CREATE TABLE IF NOT EXISTS feature_flags (
                    id SERIAL PRIMARY KEY,
                    flag_name VARCHAR(100) NOT NULL UNIQUE,
                    description TEXT,
                    is_enabled BOOLEAN DEFAULT false,
                    config JSONB DEFAULT '{}',
                    target_percentage DECIMAL(5,2) DEFAULT 0.00,
                    target_users JSONB DEFAULT '[]',
                    start_date TIMESTAMP WITH TIME ZONE,
                    end_date TIMESTAMP WITH TIME ZONE,
                    created_by INTEGER REFERENCES users(id),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Insertar feature flags por defecto del sistema
            const defaultFlags = [
                {
                    flag_name: 'new_level_system',
                    description: 'Nuevo sistema de niveles con 3 tipos',
                    is_enabled: true,
                    config: { migration_complete: true }
                },
                {
                    flag_name: 'advanced_challenges',
                    description: 'Sistema avanzado de challenges con A/B testing',
                    is_enabled: true,
                    config: { ab_testing: true, analytics: true }
                },
                {
                    flag_name: 'luminarias_marketplace',
                    description: 'Marketplace interno de Luminarias',
                    is_enabled: true,
                    config: { conversion_enabled: true, withdrawal_enabled: true }
                },
                {
                    flag_name: 'real_time_features',
                    description: 'Funcionalidades en tiempo real con WebSocket',
                    is_enabled: true,
                    config: { websocket_enabled: true, live_updates: true }
                },
                {
                    flag_name: 'advanced_search',
                    description: 'Sistema de búsqueda avanzada con ML',
                    is_enabled: true,
                    config: { suggestions: true, recent_history: true }
                }
            ];

            for (const flag of defaultFlags) {
                await client.query(`
                    INSERT INTO feature_flags (flag_name, description, is_enabled, config)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (flag_name) DO UPDATE SET
                        description = EXCLUDED.description,
                        is_enabled = EXCLUDED.is_enabled,
                        config = EXCLUDED.config,
                        updated_at = CURRENT_TIMESTAMP
                `, [flag.flag_name, flag.description, flag.is_enabled, JSON.stringify(flag.config)]);
            }

            // Crear función para verificar feature flags
            await client.query(`
                CREATE OR REPLACE FUNCTION is_feature_enabled(flag_name TEXT, user_id INTEGER DEFAULT NULL)
                RETURNS BOOLEAN AS $$
                DECLARE
                    flag_record RECORD;
                    user_in_target BOOLEAN := false;
                BEGIN
                    SELECT * INTO flag_record FROM feature_flags WHERE feature_flags.flag_name = $1;
                    
                    IF NOT FOUND THEN
                        RETURN false;
                    END IF;
                    
                    IF NOT flag_record.is_enabled THEN
                        RETURN false;
                    END IF;
                    
                    -- Si hay usuarios específicos en target_users
                    IF jsonb_array_length(flag_record.target_users) > 0 AND user_id IS NOT NULL THEN
                        SELECT EXISTS(
                            SELECT 1 FROM jsonb_array_elements_text(flag_record.target_users) 
                            WHERE value::integer = user_id
                        ) INTO user_in_target;
                        
                        IF user_in_target THEN
                            RETURN true;
                        END IF;
                    END IF;
                    
                    -- Verificar porcentaje de activación
                    IF flag_record.target_percentage > 0 AND user_id IS NOT NULL THEN
                        IF (user_id % 100) < flag_record.target_percentage THEN
                            RETURN true;
                        END IF;
                    END IF;
                    
                    -- Si no hay restricciones específicas y está habilitado
                    IF flag_record.target_percentage = 0 AND jsonb_array_length(flag_record.target_users) = 0 THEN
                        RETURN true;
                    END IF;
                    
                    RETURN false;
                END;
                $$ LANGUAGE plpgsql;
            `);

            console.log('   ✓ Feature flags migrados a PostgreSQL');

        } catch (error) {
            console.error('   ❌ Error migrando feature flags:', error);
            throw error;
        }
    }

    async createUserPreferencesSystem(client) {
        try {
            // Crear tabla de preferencias de usuario
            await client.query(`
                CREATE TABLE IF NOT EXISTS user_preferences (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
                    ui_preferences JSONB DEFAULT '{}',
                    game_preferences JSONB DEFAULT '{}',
                    notification_preferences JSONB DEFAULT '{}',
                    privacy_preferences JSONB DEFAULT '{}',
                    language VARCHAR(10) DEFAULT 'es',
                    timezone VARCHAR(50) DEFAULT 'Europe/Madrid',
                    theme VARCHAR(20) DEFAULT 'light',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Crear preferencias por defecto para usuarios existentes
            await client.query(`
                INSERT INTO user_preferences (user_id, ui_preferences, game_preferences, notification_preferences, privacy_preferences)
                SELECT 
                    id,
                    '{"sidebar_collapsed": false, "grid_view": true, "auto_save": true}'::jsonb,
                    '{"sound_enabled": true, "animations": true, "difficulty_preference": "medium"}'::jsonb,
                    '{"email_notifications": true, "push_notifications": true, "level_up_alerts": true}'::jsonb,
                    '{"profile_public": false, "show_progress": true, "show_achievements": true}'::jsonb
                FROM users
                WHERE id NOT IN (SELECT user_id FROM user_preferences)
            `);

            // Función para obtener preferencias de usuario
            await client.query(`
                CREATE OR REPLACE FUNCTION get_user_preferences(p_user_id INTEGER)
                RETURNS TABLE(
                    ui_prefs JSONB,
                    game_prefs JSONB,
                    notification_prefs JSONB,
                    privacy_prefs JSONB,
                    language VARCHAR(10),
                    timezone VARCHAR(50),
                    theme VARCHAR(20)
                ) AS $$
                BEGIN
                    RETURN QUERY
                    SELECT 
                        up.ui_preferences,
                        up.game_preferences,
                        up.notification_preferences,
                        up.privacy_preferences,
                        up.language,
                        up.timezone,
                        up.theme
                    FROM user_preferences up
                    WHERE up.user_id = p_user_id;
                END;
                $$ LANGUAGE plpgsql;
            `);

            console.log('   ✓ Sistema de preferencias de usuario creado');

        } catch (error) {
            console.error('   ❌ Error creando preferencias de usuario:', error);
            throw error;
        }
    }

    async migrateGameStates(client) {
        try {
            // Crear tabla para estados de juego persistentes
            await client.query(`
                CREATE TABLE IF NOT EXISTS persistent_game_states (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
                    session_id VARCHAR(100),
                    game_type VARCHAR(50) NOT NULL,
                    current_state JSONB NOT NULL,
                    progress JSONB DEFAULT '{}',
                    auto_saved BOOLEAN DEFAULT false,
                    last_checkpoint TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days'),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, game_id, session_id)
                )
            `);

            // Crear tabla para configuraciones de juego persistentes
            await client.query(`
                CREATE TABLE IF NOT EXISTS persistent_game_configs (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    game_type VARCHAR(50) NOT NULL,
                    config_name VARCHAR(100) NOT NULL,
                    config_data JSONB NOT NULL,
                    is_default BOOLEAN DEFAULT false,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, game_type, config_name)
                )
            `);

            // Función para guardar estado de juego
            await client.query(`
                CREATE OR REPLACE FUNCTION save_game_state(
                    p_user_id INTEGER,
                    p_game_id INTEGER,
                    p_session_id VARCHAR(100),
                    p_game_type VARCHAR(50),
                    p_current_state JSONB,
                    p_progress JSONB DEFAULT '{}'
                ) RETURNS INTEGER AS $$
                DECLARE
                    state_id INTEGER;
                BEGIN
                    INSERT INTO persistent_game_states (
                        user_id, game_id, session_id, game_type, current_state, progress, auto_saved
                    ) VALUES (
                        p_user_id, p_game_id, p_session_id, p_game_type, p_current_state, p_progress, true
                    )
                    ON CONFLICT (user_id, game_id, session_id) DO UPDATE SET
                        current_state = EXCLUDED.current_state,
                        progress = EXCLUDED.progress,
                        auto_saved = true,
                        last_checkpoint = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP
                    RETURNING id INTO state_id;
                    
                    RETURN state_id;
                END;
                $$ LANGUAGE plpgsql;
            `);

            // Crear índices para rendimiento
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_game_states_user_type ON persistent_game_states(user_id, game_type);
                CREATE INDEX IF NOT EXISTS idx_game_states_expires ON persistent_game_states(expires_at);
            `);

            console.log('   ✓ Estados de juego migrados a persistencia');

        } catch (error) {
            console.error('   ❌ Error migrando estados de juego:', error);
            throw error;
        }
    }

    async createSystemConfiguration(client) {
        try {
            // Crear tabla de configuración del sistema
            await client.query(`
                CREATE TABLE IF NOT EXISTS system_configuration (
                    id SERIAL PRIMARY KEY,
                    config_key VARCHAR(100) NOT NULL UNIQUE,
                    config_value JSONB NOT NULL,
                    description TEXT,
                    category VARCHAR(50) DEFAULT 'general',
                    is_public BOOLEAN DEFAULT false,
                    requires_restart BOOLEAN DEFAULT false,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_by INTEGER REFERENCES users(id)
                )
            `);

            // Insertar configuraciones por defecto del sistema
            const systemConfigs = [
                {
                    config_key: 'maintenance_mode',
                    config_value: { enabled: false, message: '', scheduled_end: null },
                    description: 'Modo de mantenimiento del sistema',
                    category: 'system'
                },
                {
                    config_key: 'registration_enabled',
                    config_value: { enabled: true, requires_invitation: false },
                    description: 'Configuración de registro de usuarios',
                    category: 'auth',
                    is_public: true
                },
                {
                    config_key: 'luminarias_rates',
                    config_value: { 
                        base_earn_rate: 10, 
                        conversion_rate: 0.004, 
                        withdrawal_fee: 0.05,
                        min_withdrawal: 25000
                    },
                    description: 'Tasas y configuración de Luminarias',
                    category: 'economy'
                },
                {
                    config_key: 'game_limits',
                    config_value: {
                        max_daily_games: 50,
                        max_concurrent_games: 5,
                        session_timeout: 3600
                    },
                    description: 'Límites de juegos por usuario',
                    category: 'gaming'
                },
                {
                    config_key: 'level_calculation_schedule',
                    config_value: {
                        auto_calculation: true,
                        interval_minutes: 5,
                        weekly_payments_day: 'monday'
                    },
                    description: 'Configuración de cálculo de niveles',
                    category: 'levels'
                }
            ];

            for (const config of systemConfigs) {
                await client.query(`
                    INSERT INTO system_configuration (config_key, config_value, description, category, is_public)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (config_key) DO UPDATE SET
                        config_value = EXCLUDED.config_value,
                        description = EXCLUDED.description,
                        category = EXCLUDED.category,
                        is_public = EXCLUDED.is_public,
                        updated_at = CURRENT_TIMESTAMP
                `, [config.config_key, JSON.stringify(config.config_value), config.description, config.category, config.is_public]);
            }

            // Función para obtener configuración
            await client.query(`
                CREATE OR REPLACE FUNCTION get_system_config(config_key TEXT)
                RETURNS JSONB AS $$
                DECLARE
                    config_value JSONB;
                BEGIN
                    SELECT sc.config_value INTO config_value
                    FROM system_configuration sc
                    WHERE sc.config_key = $1;
                    
                    RETURN COALESCE(config_value, '{}'::jsonb);
                END;
                $$ LANGUAGE plpgsql;
            `);

            console.log('   ✓ Configuración del sistema creada');

        } catch (error) {
            console.error('   ❌ Error creando configuración del sistema:', error);
            throw error;
        }
    }

    async ensureSearchPersistence(client) {
        try {
            // Verificar que la tabla de historial de búsquedas existe y está optimizada
            const searchHistoryExists = await client.query(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables 
                    WHERE table_name = 'user_search_history'
                )
            `);

            if (!searchHistoryExists.rows[0].exists) {
                await client.query(`
                    CREATE TABLE user_search_history (
                        id SERIAL PRIMARY KEY,
                        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        search_query TEXT NOT NULL,
                        search_context VARCHAR(50) DEFAULT 'all',
                        search_filters JSONB DEFAULT '{}',
                        results_count INTEGER DEFAULT 0,
                        execution_time_ms INTEGER DEFAULT 0,
                        search_count INTEGER DEFAULT 1,
                        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                        last_searched_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(user_id, search_query, search_context)
                    )
                `);
            }

            // Crear tabla de sugerencias de búsqueda persistentes
            await client.query(`
                CREATE TABLE IF NOT EXISTS search_suggestions (
                    id SERIAL PRIMARY KEY,
                    suggestion_text TEXT NOT NULL,
                    suggestion_type VARCHAR(50) NOT NULL,
                    category VARCHAR(50),
                    usage_count INTEGER DEFAULT 1,
                    success_rate DECIMAL(5,2) DEFAULT 0.0,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    last_used_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(suggestion_text, suggestion_type, category)
                )
            `);

            // Crear índices para búsquedas eficientes
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_search_history_user_query ON user_search_history(user_id, search_query);
                CREATE INDEX IF NOT EXISTS idx_search_history_context ON user_search_history(search_context, created_at);
                CREATE INDEX IF NOT EXISTS idx_search_suggestions_text ON search_suggestions USING gin(to_tsvector('spanish', suggestion_text));
            `);

            console.log('   ✓ Persistencia de búsquedas asegurada');

        } catch (error) {
            console.error('   ❌ Error asegurando persistencia de búsquedas:', error);
            throw error;
        }
    }

    async createPersistentSessions(client) {
        try {
            // Crear tabla de sesiones persistentes
            await client.query(`
                CREATE TABLE IF NOT EXISTS user_sessions (
                    id SERIAL PRIMARY KEY,
                    session_id VARCHAR(128) NOT NULL UNIQUE,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    user_agent TEXT,
                    ip_address INET,
                    session_data JSONB DEFAULT '{}',
                    last_activity TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days'),
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);


            // Crear tabla de actividad de usuario persistente
            await client.query(`
                CREATE TABLE IF NOT EXISTS user_activity_log (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    session_id VARCHAR(128) REFERENCES user_sessions(session_id),
                    activity_type VARCHAR(50) NOT NULL,
                    activity_data JSONB DEFAULT '{}',
                    page_url TEXT,
                    user_agent TEXT,
                    ip_address INET,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Función para limpiar sesiones expiradas
            await client.query(`
                CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
                RETURNS INTEGER AS $$
                DECLARE
                    deleted_count INTEGER;
                BEGIN
                    DELETE FROM user_sessions 
                    WHERE expires_at < CURRENT_TIMESTAMP OR is_active = false;
                    
                    GET DIAGNOSTICS deleted_count = ROW_COUNT;
                    RETURN deleted_count;
                END;
                $$ LANGUAGE plpgsql;
            `);

            // Crear índices para rendimiento
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id, is_active);
                CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);
                CREATE INDEX IF NOT EXISTS idx_user_activity_user_date ON user_activity_log(user_id, created_at);
            `);

            console.log('   ✓ Sesiones persistentes creadas');

        } catch (error) {
            console.error('   ❌ Error creando sesiones persistentes:', error);
            throw error;
        }
    }

    async ensureAnalyticsPersistence(client) {
        try {
            // Crear tabla de métricas del sistema persistentes
            await client.query(`
                CREATE TABLE IF NOT EXISTS system_metrics (
                    id SERIAL PRIMARY KEY,
                    metric_name VARCHAR(100) NOT NULL,
                    metric_value DECIMAL(10,2) NOT NULL,
                    metric_unit VARCHAR(20),
                    metric_metadata JSONB DEFAULT '{}',
                    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Crear tabla de eventos de analytics
            await client.query(`
                CREATE TABLE IF NOT EXISTS analytics_events (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    session_id VARCHAR(128),
                    event_type VARCHAR(100) NOT NULL,
                    event_category VARCHAR(50),
                    event_data JSONB DEFAULT '{}',
                    page_url TEXT,
                    referrer TEXT,
                    user_agent TEXT,
                    ip_address INET,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Crear tabla de reportes de analytics agregados
            await client.query(`
                CREATE TABLE IF NOT EXISTS analytics_reports (
                    id SERIAL PRIMARY KEY,
                    report_type VARCHAR(50) NOT NULL,
                    report_period VARCHAR(20) NOT NULL, -- daily, weekly, monthly
                    period_start TIMESTAMP WITH TIME ZONE NOT NULL,
                    period_end TIMESTAMP WITH TIME ZONE NOT NULL,
                    report_data JSONB NOT NULL,
                    generated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(report_type, report_period, period_start)
                )
            `);

            // Función para registrar métricas del sistema
            await client.query(`
                CREATE OR REPLACE FUNCTION record_system_metric(
                    p_metric_name VARCHAR(100),
                    p_metric_value DECIMAL(10,2),
                    p_metric_unit VARCHAR(20) DEFAULT NULL,
                    p_metadata JSONB DEFAULT '{}'
                ) RETURNS VOID AS $$
                BEGIN
                    INSERT INTO system_metrics (metric_name, metric_value, metric_unit, metric_metadata)
                    VALUES (p_metric_name, p_metric_value, p_metric_unit, p_metadata);
                END;
                $$ LANGUAGE plpgsql;
            `);

            // Crear índices para analytics
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_analytics_events_type_date ON analytics_events(event_type, created_at);
                CREATE INDEX IF NOT EXISTS idx_analytics_events_user_date ON analytics_events(user_id, created_at);
                CREATE INDEX IF NOT EXISTS idx_system_metrics_name_date ON system_metrics(metric_name, recorded_at);
            `);

            console.log('   ✓ Persistencia de analytics asegurada');

        } catch (error) {
            console.error('   ❌ Error asegurando persistencia de analytics:', error);
            throw error;
        }
    }

    async verifyDataPersistence() {
        try {
            console.log('\n🔍 Verificando persistencia de datos...');

            const persistenceChecks = [
                { table: 'feature_flags', description: 'Feature flags del sistema' },
                { table: 'user_preferences', description: 'Preferencias de usuario' },
                { table: 'persistent_game_states', description: 'Estados de juego' },
                { table: 'system_configuration', description: 'Configuración del sistema' },
                { table: 'user_search_history', description: 'Historial de búsquedas' },
                { table: 'user_sessions', description: 'Sesiones de usuario' },
                { table: 'analytics_events', description: 'Eventos de analytics' }
            ];

            for (const check of persistenceChecks) {
                const result = await this.pool.query(`SELECT COUNT(*) FROM ${check.table}`);
                console.log(`   ✓ ${check.description}: ${result.rows[0].count} registros`);
            }

            // Verificar funciones críticas
            const functions = [
                'is_feature_enabled',
                'get_user_preferences', 
                'save_game_state',
                'get_system_config'
            ];

            for (const func of functions) {
                const exists = await this.pool.query(`
                    SELECT EXISTS (
                        SELECT 1 FROM pg_proc 
                        WHERE proname = $1
                    )
                `, [func]);

                if (exists.rows[0].exists) {
                    console.log(`   ✓ Función ${func} disponible`);
                } else {
                    console.log(`   ❌ Función ${func} faltante`);
                }
            }

            console.log('\n✅ Verificación de persistencia completada');

        } catch (error) {
            console.error('\n❌ Error verificando persistencia:', error);
            throw error;
        }
    }

    async close() {
        await this.pool.end();
    }
}

// Auto-ejecutar si se ejecuta directamente
if (require.main === module) {
    const migration = new DataPersistenceMigration();
    
    async function run() {
        try {
            await migration.migrateToPersistentStorage();
            console.log('\n🎉 ¡Migración de persistencia completada exitosamente!');
            console.log('\n📝 Resumen de cambios:');
            console.log('   ✓ Feature flags migrados de localStorage a PostgreSQL');
            console.log('   ✓ Preferencias de usuario ahora persisten en DB');
            console.log('   ✓ Estados de juego con auto-guardado en PostgreSQL');
            console.log('   ✓ Configuración del sistema centralizada en DB');
            console.log('   ✓ Sesiones persistentes para mejor UX');
            console.log('   ✓ Analytics y métricas completamente persistentes');
            console.log('\n⚠️  IMPORTANTE: Actualizar frontend para usar APIs en lugar de localStorage');
            
        } catch (error) {
            console.error('\n💥 Error en migración de persistencia:', error);
            process.exit(1);
        } finally {
            await migration.close();
            process.exit(0);
        }
    }
    
    run();
}

module.exports = DataPersistenceMigration;