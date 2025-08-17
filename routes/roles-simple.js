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

        // Obtener usuarios con bloques y total de preguntas
        const usersWithBlocks = await pool.query(`
            SELECT 
                u.id, 
                u.nickname, 
                COALESCE(u.email, 'Sin email') as email, 
                COUNT(DISTINCT b.id) as blocks_count,
                COALESCE(SUM(b.total_questions), 0) as total_questions
            FROM users u 
            INNER JOIN blocks b ON u.id = b.creator_id
            GROUP BY u.id, u.nickname, u.email
            ORDER BY COUNT(DISTINCT b.id) DESC
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
                total_questions: parseInt(user.total_questions) || 0,
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

// Buscar usuarios por nickname
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
        res.status(500).json({ 
            error: 'Error buscando usuarios',
            details: error.message 
        });
    }
});

// Asignar administrador secundario
router.post('/add-admin-secundario', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: 'ID de usuario requerido' });
        }
        
        // Verificar que el usuario existe
        const userCheck = await pool.query('SELECT id, nickname FROM users WHERE id = $1', [userId]);
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        const user = userCheck.rows[0];
        
        // Verificar que no es AdminPrincipal
        if (user.nickname === 'AdminPrincipal') {
            return res.status(400).json({ error: 'AdminPrincipal no puede ser asignado como administrador secundario' });
        }
        
        // Buscar el rol de administrador_secundario
        const roleCheck = await pool.query('SELECT id FROM roles WHERE name = $1', ['administrador_secundario']);
        if (roleCheck.rows.length === 0) {
            return res.status(500).json({ error: 'Rol administrador_secundario no existe' });
        }
        
        const roleId = roleCheck.rows[0].id;
        
        // Verificar si ya tiene el rol
        const existingRole = await pool.query(
            'SELECT id FROM user_roles WHERE user_id = $1 AND role_id = $2', 
            [userId, roleId]
        );
        
        if (existingRole.rows.length > 0) {
            return res.status(400).json({ error: 'El usuario ya es administrador secundario' });
        }
        
        // Asignar el rol
        await pool.query(
            'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', 
            [userId, roleId]
        );
        
        res.json({
            success: true,
            message: `${user.nickname} asignado como administrador secundario exitosamente`,
            user: user
        });
        
    } catch (error) {
        console.error('Error adding admin secundario:', error);
        res.status(500).json({ 
            error: 'Error asignando administrador secundario',
            details: error.message 
        });
    }
});

// Obtener bloques de un usuario
router.get('/user-blocks/:userId', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.params;
        
        const blocks = await pool.query(`
            SELECT 
                id,
                title,
                description,
                topic,
                COALESCE(total_questions, 0) as total_questions,
                COALESCE(total_users, 0) as total_users,
                is_public,
                created_at
            FROM blocks 
            WHERE creator_id = $1 
            ORDER BY created_at DESC
        `, [userId]);
        
        res.json({
            blocks: blocks.rows,
            count: blocks.rows.length
        });
        
    } catch (error) {
        console.error('Error getting user blocks:', error);
        res.status(500).json({ 
            error: 'Error obteniendo bloques del usuario',
            details: error.message 
        });
    }
});

// Obtener temas de un bloque
router.get('/block-topics/:blockId', authenticateToken, async (req, res) => {
    try {
        const { blockId } = req.params;
        
        const topics = await pool.query(`
            SELECT DISTINCT topic
            FROM questions 
            WHERE block_id = $1 AND topic IS NOT NULL
            ORDER BY topic
        `, [blockId]);
        
        res.json({
            topics: topics.rows.map(row => row.topic),
            count: topics.rows.length
        });
        
    } catch (error) {
        console.error('Error getting block topics:', error);
        res.status(500).json({ 
            error: 'Error obteniendo temas del bloque',
            details: error.message 
        });
    }
});

// Obtener preguntas de un tema específico
router.get('/topic-questions/:blockId/:topic', authenticateToken, async (req, res) => {
    try {
        const { blockId, topic } = req.params;
        
        const questions = await pool.query(`
            SELECT 
                id,
                question_text,
                question_type,
                difficulty_level,
                created_at
            FROM questions 
            WHERE block_id = $1 AND topic = $2
            ORDER BY created_at DESC
        `, [blockId, topic]);
        
        res.json({
            questions: questions.rows,
            count: questions.rows.length,
            topic: topic
        });
        
    } catch (error) {
        console.error('Error getting topic questions:', error);
        res.status(500).json({ 
            error: 'Error obteniendo preguntas del tema',
            details: error.message 
        });
    }
});

module.exports = router;