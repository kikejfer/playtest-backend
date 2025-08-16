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
            
            if (existingUser.rows.length > 0) {
                console.log('✅ AdminPrincipal ya existe (ID:', existingUser.rows[0].id, ')');
                return existingUser.rows[0];
            }
            
            console.log('🔧 AdminPrincipal no existe. Creando automáticamente...');
            
            // Crear AdminPrincipal
            const passwordHash = await bcrypt.hash('kikejfer', 10);
            const result = await pool.query(
                'INSERT INTO users (nickname, email, password_hash) VALUES ($1, $2, $3) RETURNING id, nickname',
                ['AdminPrincipal', 'admin@playtest.com', passwordHash]
            );
            
            const newUser = result.rows[0];
            console.log('✅ AdminPrincipal creado con ID:', newUser.id);
            
            // Crear perfil si no existe
            try {
                await pool.query(
                    'INSERT INTO user_profiles (user_id) VALUES ($1)',
                    [newUser.id]
                );
                console.log('✅ Perfil creado para AdminPrincipal');
            } catch (profileError) {
                if (profileError.code !== '23505') { // No es error de duplicate key
                    console.warn('⚠️ Error creando perfil (no crítico):', profileError.message);
                }
            }
            
            return newUser;
            
        } catch (error) {
            console.error('❌ Error en auto-setup de AdminPrincipal:', error.message);
            // No fallar el inicio del servidor por esto
            return null;
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
            
            return {
                adminPrincipalExists: adminCheck.rows.length > 0,
                setupCompleted: this.setupCompleted
            };
        } catch (error) {
            return {
                adminPrincipalExists: false,
                setupCompleted: false,
                error: error.message
            };
        }
    }
}

// Instancia singleton
const autoSetup = new AutoSetup();

module.exports = autoSetup;