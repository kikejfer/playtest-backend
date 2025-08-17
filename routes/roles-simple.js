const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { authenticateToken } = require('../middleware/auth');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Panel de Administrador Principal - Versión Simplificada que FUNCIONA
router.get('/admin-principal-panel', authenticateToken, async (req, res) => {
    try {
        console.log('Simple admin panel request from user:', req.user.id);
        
        // Verificar permisos básicos
        if (!req.user || !req.user.id) {
            return res.status(403).json({ error: 'Token de usuario inválido' });
        }

        // Obtener todos los usuarios con consulta simple
        const allUsers = await pool.query(`
            SELECT DISTINCT u.id, u.nickname, COALESCE(u.email, 'Sin email') as email
            FROM users u 
            ORDER BY u.id
        `);

        // Obtener usuarios con bloques con consulta simple
        const usersWithBlocks = await pool.query(`
            SELECT DISTINCT u.id, u.nickname, COALESCE(u.email, 'Sin email') as email, COUNT(b.id) as blocks_count
            FROM users u 
            INNER JOIN blocks b ON u.id = b.creator_id
            GROUP BY u.id, u.nickname, u.email
            ORDER BY COUNT(b.id) DESC
        `);

        console.log('Simple queries executed successfully');
        console.log('All users count:', allUsers.rows.length);
        console.log('Users with blocks count:', usersWithBlocks.rows.length);

        // Construir respuesta usando lógica simple
        const blockCreatorIds = new Set(usersWithBlocks.rows.map(u => u.id));
        
        // AdminPrincipal como administrador
        const adminSecundarios = allUsers.rows
            .filter(user => user.nickname === 'AdminPrincipal')
            .map(user => ({
                id: user.id,
                nickname: user.nickname,
                email: user.email,
                first_name: '',
                last_name: '',
                assigned_creators_count: 0,
                total_blocks_assigned: 0,
                total_questions_assigned: 0,
                luminarias: 0,
                role_name: 'administrador_principal'
            }));

        // Usuarios con bloques como creadores
        const profesoresCreadores = usersWithBlocks.rows
            .filter(user => user.nickname !== 'AdminPrincipal')
            .map(user => ({
                id: user.id,
                nickname: user.nickname,
                email: user.email,
                first_name: '',
                last_name: '',
                assigned_admin_id: 0,
                assigned_admin_nickname: 'Sin asignar',
                blocks_created: parseInt(user.blocks_count) || 0,
                total_questions: 0,
                total_users_blocks: 0,
                luminarias_actuales: 0,
                luminarias_ganadas: 0,
                luminarias_gastadas: 0,
                luminarias_abonadas: 0,
                luminarias_compradas: 0,
                role_name: 'creador_contenido'
            }));

        // Usuarios sin bloques como usuarios normales
        const usuarios = allUsers.rows
            .filter(user => user.nickname !== 'AdminPrincipal' && !blockCreatorIds.has(user.id))
            .map(user => ({
                id: user.id,
                nickname: user.nickname,
                email: user.email,
                first_name: '',
                last_name: '',
                assigned_admin_id: 0,
                assigned_admin_nickname: 'Sin asignar',
                blocks_loaded: 0,
                luminarias_actuales: 0,
                luminarias_ganadas: 0,
                luminarias_gastadas: 0,
                luminarias_abonadas: 0,
                luminarias_compradas: 0,
                role_name: 'usuario'
            }));

        console.log('Simple panel data constructed:', {
            admins: adminSecundarios.length,
            creadores: profesoresCreadores.length,
            usuarios: usuarios.length
        });

        res.json({
            adminSecundarios: adminSecundarios,
            profesoresCreadores: profesoresCreadores,
            usuarios: usuarios,
            availableAdmins: allUsers.rows,
            simple_version: true
        });

    } catch (error) {
        console.error('Error in simple admin panel:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor',
            details: error.message
        });
    }
});

// Endpoint de borrado simplificado
router.delete('/delete-user/:userId', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.params;
        console.log(`Simple delete request for user ${userId}`);
        
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
        
        // 3. Borrar preguntas creadas por el usuario
        const deletedQuestions = await pool.query('DELETE FROM questions WHERE creator_id = $1', [userId]);
        if (deletedQuestions.rowCount > 0) {
            deletedData.push(`${deletedQuestions.rowCount} preguntas creadas`);
        }
        
        // 4. Borrar bloques creados por el usuario
        const deletedBlocks = await pool.query('DELETE FROM blocks WHERE creator_id = $1', [userId]);
        if (deletedBlocks.rowCount > 0) {
            deletedData.push(`${deletedBlocks.rowCount} bloques creados`);
        }
        
        // 5. Borrar roles de usuario
        const deletedRoles = await pool.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
        if (deletedRoles.rowCount > 0) {
            deletedData.push(`${deletedRoles.rowCount} roles asignados`);
        }
        
        // 6. Borrar perfil de usuario
        const deletedProfile = await pool.query('DELETE FROM user_profiles WHERE user_id = $1', [userId]);
        if (deletedProfile.rowCount > 0) {
            deletedData.push(`Perfil de usuario`);
        }
        
        // 7. Finalmente borrar el usuario
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

module.exports = router;