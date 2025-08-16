const { Pool } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function createAdminPrincipal() {
    try {
        console.log('🔧 Creando AdminPrincipal en producción...');
        
        // Verificar si ya existe
        const existingUser = await pool.query(
            'SELECT id, nickname FROM users WHERE nickname = $1',
            ['AdminPrincipal']
        );
        
        if (existingUser.rows.length > 0) {
            console.log('ℹ️  AdminPrincipal ya existe. Actualizando contraseña...');
            
            // Actualizar contraseña
            const passwordHash = await bcrypt.hash('kikejfer', 10);
            await pool.query(
                'UPDATE users SET password_hash = $1 WHERE nickname = $2',
                [passwordHash, 'AdminPrincipal']
            );
            console.log('✅ Contraseña de AdminPrincipal actualizada');
            
        } else {
            console.log('🆕 Creando nuevo AdminPrincipal...');
            
            // Crear nuevo usuario
            const passwordHash = await bcrypt.hash('kikejfer', 10);
            const result = await pool.query(
                'INSERT INTO users (nickname, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
                ['AdminPrincipal', 'admin@playtest.com', passwordHash]
            );
            
            const userId = result.rows[0].id;
            console.log('✅ AdminPrincipal creado con ID:', userId);
            
            // Crear perfil
            await pool.query(
                'INSERT INTO user_profiles (user_id) VALUES ($1)',
                [userId]
            );
            console.log('✅ Perfil creado para AdminPrincipal');
        }
        
        // Verificar que funciona
        const testUser = await pool.query(
            'SELECT id, nickname, password_hash FROM users WHERE nickname = $1',
            ['AdminPrincipal']
        );
        
        if (testUser.rows.length > 0) {
            const isValidPassword = await bcrypt.compare('kikejfer', testUser.rows[0].password_hash);
            console.log('🔑 Verificación de contraseña:', isValidPassword ? 'OK' : 'ERROR');
            
            if (isValidPassword) {
                console.log('\n✅ ¡AdminPrincipal está listo para usar!');
                console.log('🌐 URL: https://playtest-frontend.onrender.com/');
                console.log('👤 Usuario: AdminPrincipal');
                console.log('🔑 Contraseña: kikejfer');
            }
        }
        
    } catch (error) {
        console.error('❌ Error creando AdminPrincipal:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
    createAdminPrincipal().catch(error => {
        console.error('💥 Error fatal:', error);
        process.exit(1);
    });
}

module.exports = createAdminPrincipal;