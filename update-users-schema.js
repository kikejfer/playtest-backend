const { Pool } = require('pg');

// Script para actualizar esquema de usuarios con campo luminarias
class UsersSchemaUpdater {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
    }

    async updateUsersSchema() {
        try {
            console.log('🔄 Actualizando esquema de usuarios...');

            // Agregar campo luminarias si no existe
            await this.pool.query(`
                ALTER TABLE users 
                ADD COLUMN IF NOT EXISTS luminarias INTEGER DEFAULT 0
            `);

            // Agregar índice para optimización
            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_users_luminarias ON users(luminarias)
            `);

            // Verificar estructura actual
            const columns = await this.pool.query(`
                SELECT column_name, data_type, column_default, is_nullable
                FROM information_schema.columns 
                WHERE table_name = 'users' 
                ORDER BY ordinal_position
            `);

            console.log('📊 Estructura actual de la tabla users:');
            columns.rows.forEach(col => {
                console.log(`   - ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}) ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`);
            });

            // Verificar usuarios sin luminarias y asignar valor inicial
            const usersWithoutLuminarias = await this.pool.query(`
                SELECT COUNT(*) as count FROM users WHERE luminarias IS NULL
            `);

            if (parseInt(usersWithoutLuminarias.rows[0].count) > 0) {
                await this.pool.query(`
                    UPDATE users SET luminarias = 100 WHERE luminarias IS NULL
                `);
                console.log(`✅ ${usersWithoutLuminarias.rows[0].count} usuarios actualizados con 100 Luminarias iniciales`);
            }

            console.log('✅ Esquema de usuarios actualizado exitosamente');

        } catch (error) {
            console.error('❌ Error actualizando esquema de usuarios:', error);
            throw error;
        }
    }

    async verifyUsersSchema() {
        try {
            // Verificar que el campo luminarias existe
            const luminariasField = await this.pool.query(`
                SELECT column_name FROM information_schema.columns 
                WHERE table_name = 'users' AND column_name = 'luminarias'
            `);

            if (luminariasField.rows.length === 0) {
                throw new Error('Campo luminarias no existe en tabla users');
            }

            // Verificar estadísticas de luminarias
            const stats = await this.pool.query(`
                SELECT 
                    COUNT(*) as total_users,
                    MIN(luminarias) as min_luminarias,
                    MAX(luminarias) as max_luminarias,
                    AVG(luminarias) as avg_luminarias,
                    SUM(luminarias) as total_luminarias
                FROM users
                WHERE luminarias IS NOT NULL
            `);

            console.log('📈 Estadísticas de Luminarias:');
            const s = stats.rows[0];
            console.log(`   - Usuarios totales: ${s.total_users}`);
            console.log(`   - Luminarias mínimas: ${s.min_luminarias}`);
            console.log(`   - Luminarias máximas: ${s.max_luminarias}`);
            console.log(`   - Promedio: ${parseFloat(s.avg_luminarias).toFixed(2)}`);
            console.log(`   - Total en circulación: ${s.total_luminarias}`);

            return {
                status: 'ok',
                luminarias_field_exists: true,
                stats: s
            };

        } catch (error) {
            console.error('Error verificando esquema:', error);
            return {
                status: 'error',
                error: error.message
            };
        }
    }

    async close() {
        await this.pool.end();
    }
}

// Auto-ejecutar si se ejecuta directamente
if (require.main === module) {
    const updater = new UsersSchemaUpdater();
    
    async function run() {
        try {
            await updater.updateUsersSchema();
            const verification = await updater.verifyUsersSchema();
            console.log('🔍 Verificación:', verification);
        } catch (error) {
            console.error('💥 Error:', error);
        } finally {
            await updater.close();
        }
    }
    
    run();
}

module.exports = UsersSchemaUpdater;