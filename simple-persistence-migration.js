const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function simplePersistenceMigration() {
    const client = await pool.connect();
    
    try {
        console.log('🔄 Ejecutando migración de persistencia simplificada...');
        
        await client.query('BEGIN');
        
        // 1. Feature flags
        console.log('1. 🚩 Creando tabla feature_flags...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS feature_flags (
                id SERIAL PRIMARY KEY,
                flag_name VARCHAR(100) NOT NULL UNIQUE,
                description TEXT,
                is_enabled BOOLEAN DEFAULT false,
                config JSONB DEFAULT '{}',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 2. Preferencias de usuario
        console.log('2. ⚙️ Creando tabla user_preferences...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_preferences (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                ui_preferences JSONB DEFAULT '{}',
                game_preferences JSONB DEFAULT '{}',
                notification_preferences JSONB DEFAULT '{}',
                privacy_preferences JSONB DEFAULT '{}',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 3. Estados de juego persistentes
        console.log('3. 🎮 Creando tabla persistent_game_states...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS persistent_game_states (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                game_type VARCHAR(50) NOT NULL,
                current_state JSONB NOT NULL,
                auto_saved BOOLEAN DEFAULT false,
                last_checkpoint TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days'),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 4. Configuración del sistema
        console.log('4. 🔧 Creando tabla system_configuration...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS system_configuration (
                id SERIAL PRIMARY KEY,
                config_key VARCHAR(100) NOT NULL UNIQUE,
                config_value JSONB NOT NULL,
                description TEXT,
                category VARCHAR(50) DEFAULT 'general',
                is_public BOOLEAN DEFAULT false,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 5. Historial de búsquedas
        console.log('5. 🔍 Creando tabla user_search_history...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_search_history (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                search_query TEXT NOT NULL,
                search_context VARCHAR(50) DEFAULT 'all',
                search_filters JSONB DEFAULT '{}',
                results_count INTEGER DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                last_searched_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 6. Sesiones persistentes
        console.log('6. 📱 Creando tabla user_sessions_persistent...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_sessions_persistent (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(128) NOT NULL UNIQUE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                session_data JSONB DEFAULT '{}',
                last_activity TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days'),
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 7. Analytics y métricas
        console.log('7. 📊 Creando tabla analytics_events...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS analytics_events (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                event_type VARCHAR(100) NOT NULL,
                event_category VARCHAR(50),
                event_data JSONB DEFAULT '{}',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Insertar configuraciones por defecto
        console.log('8. 🔧 Insertando configuraciones por defecto...');
        
        const defaultConfigs = [
            {
                key: 'maintenance_mode',
                value: { enabled: false },
                description: 'Modo de mantenimiento del sistema',
                category: 'system'
            },
            {
                key: 'luminarias_rates',
                value: { base_earn_rate: 10, conversion_rate: 0.004 },
                description: 'Tasas de Luminarias',
                category: 'economy'
            },
            {
                key: 'game_limits',
                value: { max_daily_games: 50, session_timeout: 3600 },
                description: 'Límites de juegos',
                category: 'gaming'
            }
        ];
        
        for (const config of defaultConfigs) {
            await client.query(`
                INSERT INTO system_configuration (config_key, config_value, description, category)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (config_key) DO NOTHING
            `, [config.key, JSON.stringify(config.value), config.description, config.category]);
        }
        
        const defaultFlags = [
            { name: 'new_level_system', description: 'Nuevo sistema de niveles', enabled: true },
            { name: 'advanced_challenges', description: 'Challenges avanzados', enabled: true },
            { name: 'luminarias_marketplace', description: 'Marketplace de Luminarias', enabled: true },
            { name: 'real_time_features', description: 'Funciones en tiempo real', enabled: true }
        ];
        
        for (const flag of defaultFlags) {
            await client.query(`
                INSERT INTO feature_flags (flag_name, description, is_enabled)
                VALUES ($1, $2, $3)
                ON CONFLICT (flag_name) DO NOTHING
            `, [flag.name, flag.description, flag.enabled]);
        }
        
        // Crear índices básicos
        console.log('9. 📈 Creando índices...');
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);
            CREATE INDEX IF NOT EXISTS idx_game_states_user_id ON persistent_game_states(user_id, game_type);
            CREATE INDEX IF NOT EXISTS idx_search_history_user_id ON user_search_history(user_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions_persistent(user_id, is_active);
            CREATE INDEX IF NOT EXISTS idx_analytics_user_id ON analytics_events(user_id, created_at);
        `);
        
        await client.query('COMMIT');
        
        console.log('✅ Migración de persistencia completada exitosamente!');
        console.log('\n📝 Tablas creadas:');
        console.log('   ✓ feature_flags - Feature flags del sistema');
        console.log('   ✓ user_preferences - Preferencias de usuario');
        console.log('   ✓ persistent_game_states - Estados de juego');
        console.log('   ✓ system_configuration - Configuración del sistema');
        console.log('   ✓ user_search_history - Historial de búsquedas');
        console.log('   ✓ user_sessions_persistent - Sesiones persistentes');
        console.log('   ✓ analytics_events - Eventos de analytics');
        
        console.log('\n⚠️ IMPORTANTE: Frontend debe usar APIs en lugar de localStorage');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error en migración:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

if (require.main === module) {
    simplePersistenceMigration()
        .then(() => {
            console.log('🎉 Migración completada!');
            process.exit(0);
        })
        .catch(error => {
            console.error('💥 Error:', error);
            process.exit(1);
        });
}

module.exports = { simplePersistenceMigration };