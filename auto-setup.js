const pool = require('./database/connection');
const bcrypt = require('bcrypt');

/**
 * Configuración automática que se ejecuta al iniciar el servidor
 * Solo se ejecuta si es necesario (no reinicia cada vez)
 */

class AutoSetup {
    constructor() {
        this.setupCompleted = false;
    }

    async ensureAdminPrincipalExists() {
        try {
            // Verificar si AdminPrincipal ya existe
            const existingUser = await pool.query(
                'SELECT id, nickname FROM users WHERE nickname = $1',
                ['AdminPrincipal']
            );
            
            let userId;
            if (existingUser.rows.length > 0) {
                console.log('✅ AdminPrincipal ya existe (ID:', existingUser.rows[0].id, ')');
                userId = existingUser.rows[0].id;
            } else {
                console.log('🔧 AdminPrincipal no existe. Creando automáticamente...');
                
                // Crear AdminPrincipal
                const passwordHash = await bcrypt.hash('kikejfer', 10);
                const result = await pool.query(
                    'INSERT INTO users (nickname, email, password_hash) VALUES ($1, $2, $3) RETURNING id, nickname',
                    ['AdminPrincipal', 'admin@playtest.com', passwordHash]
                );
                
                userId = result.rows[0].id;
                console.log('✅ AdminPrincipal creado con ID:', userId);
            }
            
            // Crear perfil si no existe
            try {
                const profileCheck = await pool.query(
                    'SELECT id FROM user_profiles WHERE user_id = $1',
                    [userId]
                );
                
                if (profileCheck.rows.length === 0) {
                    await pool.query(
                        'INSERT INTO user_profiles (user_id) VALUES ($1)',
                        [userId]
                    );
                    console.log('✅ Perfil creado para AdminPrincipal');
                } else {
                    console.log('✅ Perfil ya existe para AdminPrincipal');
                }
            } catch (profileError) {
                console.warn('⚠️ Error con perfil (no crítico):', profileError.message);
            }
            
            // Asegurar que tiene el rol de administrador_principal
            await this.ensureAdminPrincipalRole(userId);
            
            return { id: userId, nickname: 'AdminPrincipal' };
            
        } catch (error) {
            console.error('❌ Error en auto-setup de AdminPrincipal:', error.message);
            // No fallar el inicio del servidor por esto
            return null;
        }
    }

    async ensureAdminPrincipalRole(userId) {
        try {
            // Verificar si existe el rol administrador_principal
            let adminRoleResult = await pool.query(
                'SELECT id FROM roles WHERE name = $1',
                ['administrador_principal']
            );
            
            let adminRoleId;
            if (adminRoleResult.rows.length === 0) {
                console.log('🔧 Creando rol administrador_principal...');
                // Crear el rol si no existe
                const newRoleResult = await pool.query(
                    'INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING id',
                    ['administrador_principal', 'Administrador Principal del Sistema']
                );
                adminRoleId = newRoleResult.rows[0].id;
                console.log('✅ Rol administrador_principal creado');
            } else {
                adminRoleId = adminRoleResult.rows[0].id;
            }
            
            // Verificar si AdminPrincipal ya tiene el rol asignado
            const existingRoleAssignment = await pool.query(
                'SELECT id FROM user_roles WHERE user_id = $1 AND role_id = $2',
                [userId, adminRoleId]
            );
            
            if (existingRoleAssignment.rows.length === 0) {
                console.log('🔧 Asignando rol administrador_principal a AdminPrincipal...');
                await pool.query(
                    'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
                    [userId, adminRoleId]
                );
                console.log('✅ Rol administrador_principal asignado a AdminPrincipal');
            } else {
                console.log('✅ AdminPrincipal ya tiene el rol administrador_principal');
            }
            
        } catch (error) {
            console.warn('⚠️ Error configurando rol de AdminPrincipal:', error.message);
        }
    }

    async ensureBlockImageColumnExists() {
        try {
            // Verificar si la columna image_url existe en blocks
            const columnCheck = await pool.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'blocks' AND column_name = 'image_url'
            `);
            
            if (columnCheck.rows.length === 0) {
                console.log('🔧 Agregando columna image_url a tabla blocks...');
                await pool.query('ALTER TABLE blocks ADD COLUMN IF NOT EXISTS image_url TEXT');
                console.log('✅ Columna image_url agregada');
            }
            
        } catch (error) {
            console.warn('⚠️ Error agregando columna image_url (no crítico):', error.message);
        }
    }

    async runAutoSetup() {
        if (this.setupCompleted) {
            return; // Ya se ejecutó en esta sesión
        }

        try {
            console.log('🚀 Ejecutando configuración automática...');
            
            // Verificar que la base de datos esté disponible
            await pool.query('SELECT 1');
            
            // Ejecutar configuraciones necesarias
            await this.ensureAdminPrincipalExists();
            await this.ensureBlockImageColumnExists();
            
            this.setupCompleted = true;
            console.log('✅ Configuración automática completada');
            
        } catch (error) {
            console.error('❌ Error en configuración automática:', error.message);
            // No fallar el inicio del servidor
        }
    }

    // Método para verificar el estado sin ejecutar setup
    async checkStatus() {
        try {
            const adminCheck = await pool.query(
                'SELECT id FROM users WHERE nickname = $1',
                ['AdminPrincipal']
            );
            
            let hasAdminRole = false;
            if (adminCheck.rows.length > 0) {
                const roleCheck = await pool.query(`
                    SELECT ur.id FROM user_roles ur
                    JOIN roles r ON ur.role_id = r.id
                    WHERE ur.user_id = $1 AND r.name = 'administrador_principal'
                `, [adminCheck.rows[0].id]);
                
                hasAdminRole = roleCheck.rows.length > 0;
            }
            
            return {
                adminPrincipalExists: adminCheck.rows.length > 0,
                hasAdminRole: hasAdminRole,
                setupCompleted: this.setupCompleted
            };
        } catch (error) {
            return {
                adminPrincipalExists: false,
                hasAdminRole: false,
                setupCompleted: false,
                error: error.message
            };
        }
    }
}

// Instancia singleton
const autoSetup = new AutoSetup();

module.exports = autoSetup;