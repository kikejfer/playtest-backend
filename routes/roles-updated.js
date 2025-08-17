const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { authenticateToken } = require('../middleware/auth');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Debug endpoint que sabemos que funciona
router.get('/debug-users', authenticateToken, async (req, res) => {
    try {
        // Usuarios básicos
        const allUsers = await pool.query('SELECT id, nickname, email FROM users ORDER BY id LIMIT 10');
        
        // Usuarios con roles
        const usersWithRoles = await pool.query(`
            SELECT u.id, u.nickname, u.email, r.name as role_name
            FROM users u
            LEFT JOIN user_roles ur ON u.id = ur.user_id
            LEFT JOIN roles r ON ur.role_id = r.id
            ORDER BY u.id LIMIT 10
        `);
        
        // Usuarios con bloques
        const usersWithBlocks = await pool.query(`
            SELECT DISTINCT u.id, u.nickname, u.email, COUNT(b.id) as block_count
            FROM users u
            INNER JOIN blocks b ON u.id = b.creator_id
            GROUP BY u.id, u.nickname, u.email
            ORDER BY u.id LIMIT 10
        `);
        
        // Contar perfiles
        const profilesCount = await pool.query('SELECT COUNT(*) as count FROM user_profiles');
        
        res.json({
            all_users: allUsers.rows,
            users_with_roles: usersWithRoles.rows,
            users_with_blocks: usersWithBlocks.rows,
            profiles_count: profilesCount.rows[0].count,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Debug users error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Panel principal ULTRA SIMPLE que funciona
router.get('/admin-principal-panel', authenticateToken, async (req, res) => {
    try {
        console.log('ULTRA SIMPLE admin panel request from user:', req.user.id);
        
        // Solo consultas básicas y seguras
        const allUsers = await pool.query('SELECT id, nickname, COALESCE(email, \'Sin email\') as email FROM users ORDER BY id');
        
        const usersWithBlocks = await pool.query(`
            SELECT DISTINCT u.id, u.nickname, COALESCE(u.email, 'Sin email') as email, COUNT(b.id) as block_count
            FROM users u 
            INNER JOIN blocks b ON u.id = b.creator_id
            GROUP BY u.id, u.nickname, u.email
        `);
        
        const blockCreatorIds = new Set(usersWithBlocks.rows.map(u => u.id));
        
        // AdminPrincipal como administrador
        const adminSecundarios = allUsers.rows
            .filter(user => user.nickname === 'AdminPrincipal')
            .map(user => ({
                id: user.id,
                nickname: user.nickname,
                email: user.email,
                first_name: '', last_name: '',
                assigned_creators_count: 0, total_blocks_assigned: 0, total_questions_assigned: 0, luminarias: 0,
                role_name: 'administrador_principal'
            }));

        // Usuarios con bloques como creadores
        const profesoresCreadores = usersWithBlocks.rows
            .filter(user => user.nickname !== 'AdminPrincipal')
            .map(user => ({
                id: user.id, nickname: user.nickname, email: user.email,
                first_name: '', last_name: '', assigned_admin_id: 0, assigned_admin_nickname: 'Sin asignar',
                blocks_created: parseInt(user.block_count) || 1, total_questions: 0, total_users_blocks: 0,
                luminarias_actuales: 0, luminarias_ganadas: 0, luminarias_gastadas: 0, luminarias_abonadas: 0, luminarias_compradas: 0,
                role_name: 'creador_contenido'
            }));

        // Usuarios sin bloques
        const usuarios = allUsers.rows
            .filter(user => user.nickname !== 'AdminPrincipal' && !blockCreatorIds.has(user.id))
            .map(user => ({
                id: user.id, nickname: user.nickname, email: user.email,
                first_name: '', last_name: '', assigned_admin_id: 0, assigned_admin_nickname: 'Sin asignar', blocks_loaded: 0,
                luminarias_actuales: 0, luminarias_ganadas: 0, luminarias_gastadas: 0, luminarias_abonadas: 0, luminarias_compradas: 0,
                role_name: 'usuario'
            }));

        console.log(`Panel data: ${adminSecundarios.length} admins, ${profesoresCreadores.length} creadores, ${usuarios.length} usuarios`);

        res.json({
            adminSecundarios: adminSecundarios,
            profesoresCreadores: profesoresCreadores,
            usuarios: usuarios,
            availableAdmins: allUsers.rows,
            ultra_simple_version: true
        });

    } catch (error) {
        console.error('Error in ultra simple admin panel:', error);
        res.status(500).json({ error: 'Error interno del servidor', details: error.message });
    }
});

// Endpoint de borrado simplificado
router.delete('/delete-user/:userId', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.params;
        console.log(`Delete request for user ${userId}`);
        
        // Verificar que el usuario existe
        const userCheck = await pool.query('SELECT id, nickname FROM users WHERE id = $1', [userId]);
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        const user = userCheck.rows[0];
        
        // Proteger AdminPrincipal
        if (user.nickname === 'AdminPrincipal') {
            return res.status(403).json({ error: 'No se puede borrar AdminPrincipal' });
        }
        
        // Borrar en orden para evitar errores de clave foránea
        const deletedData = [];
        
        // 1. Borrar respuestas de usuario
        const deletedAnswers = await pool.query('DELETE FROM user_answers WHERE user_id = $1', [userId]);
        if (deletedAnswers.rowCount > 0) {
            deletedData.push(`${deletedAnswers.rowCount} respuestas de usuario`);
        }
        
        // 2. Borrar progreso de juegos
        const deletedProgress = await pool.query('DELETE FROM user_game_progress WHERE user_id = $1', [userId]);
        if (deletedProgress.rowCount > 0) {
            deletedData.push(`${deletedProgress.rowCount} registros de progreso`);
        }
        
        // 3. Borrar juegos
        const deletedGames = await pool.query('DELETE FROM games WHERE user_id = $1', [userId]);
        if (deletedGames.rowCount > 0) {
            deletedData.push(`${deletedGames.rowCount} juegos`);
        }
        
        // 4. Borrar preguntas creadas por el usuario
        const deletedQuestions = await pool.query('DELETE FROM questions WHERE creator_id = $1', [userId]);
        if (deletedQuestions.rowCount > 0) {
            deletedData.push(`${deletedQuestions.rowCount} preguntas creadas`);
        }
        
        // 5. Borrar bloques creados por el usuario
        const deletedBlocks = await pool.query('DELETE FROM blocks WHERE creator_id = $1', [userId]);
        if (deletedBlocks.rowCount > 0) {
            deletedData.push(`${deletedBlocks.rowCount} bloques creados`);
        }
        
        // 6. Borrar roles de usuario
        const deletedRoles = await pool.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
        if (deletedRoles.rowCount > 0) {
            deletedData.push(`${deletedRoles.rowCount} roles asignados`);
        }
        
        // 7. Borrar perfil de usuario
        const deletedProfile = await pool.query('DELETE FROM user_profiles WHERE user_id = $1', [userId]);
        if (deletedProfile.rowCount > 0) {
            deletedData.push(`Perfil de usuario`);
        }
        
        // 8. Finalmente borrar el usuario
        const deletedUser = await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        deletedData.push(`Cuenta de usuario: ${user.nickname}`);
        
        console.log(`User ${userId} (${user.nickname}) deleted successfully`);
        
        res.json({
            success: true,
            message: `Usuario ${user.nickname} borrado exitosamente`,
            deleted_data: deletedData,
            total_deleted: deletedData.length
        });
        
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ 
            error: 'Error borrando usuario',
            details: error.message 
        });
    }
});

// Buscar usuarios
router.get('/search-users', authenticateToken, async (req, res) => {
    try {
        const { q } = req.query;
        
        if (!q || q.trim().length === 0) {
            return res.json({ users: [] });
        }
        
        const searchTerm = `%${q.trim()}%`;
        const users = await pool.query(`
            SELECT id, nickname, COALESCE(email, 'Sin email') as email
            FROM users 
            WHERE nickname ILIKE $1 
            ORDER BY nickname 
            LIMIT 10
        `, [searchTerm]);
        
        res.json({
            users: users.rows,
            count: users.rows.length
        });
        
    } catch (error) {
        console.error('Error searching users:', error);
        res.status(500).json({ error: 'Error buscando usuarios', details: error.message });
    }
});

module.exports = router;