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
        
        // Consulta simple y segura para usuarios con bloques
        const usersWithBlocks = await pool.query(`
            SELECT DISTINCT 
                u.id, 
                u.nickname, 
                COALESCE(u.email, 'Sin email') as email, 
                COUNT(DISTINCT b.id) as block_count
            FROM users u 
            INNER JOIN blocks b ON u.id = b.creator_id
            GROUP BY u.id, u.nickname, u.email
        `);
        
        // Intentar obtener estadísticas adicionales de forma segura
        const blockStatsPromises = usersWithBlocks.rows.map(async (user) => {
            try {
                // Contar preguntas si la tabla existe
                const questionStats = await pool.query(`
                    SELECT COUNT(q.id) as total_questions
                    FROM blocks b
                    LEFT JOIN questions q ON b.id = q.block_id
                    WHERE b.creator_id = $1
                `, [user.id]);
                
                user.total_questions = parseInt(questionStats.rows[0].total_questions) || 0;
            } catch (e) {
                user.total_questions = 0;
            }
            
            try {
                // Contar usuarios de bloques si la tabla existe
                const userBlockStats = await pool.query(`
                    SELECT COUNT(DISTINCT ub.user_id) as total_users
                    FROM blocks b
                    LEFT JOIN user_blocks ub ON b.id = ub.block_id
                    WHERE b.creator_id = $1
                `, [user.id]);
                
                user.total_users_blocks = parseInt(userBlockStats.rows[0].total_users) || 0;
                console.log(`User ${user.nickname}: questions=${user.total_questions}, users=${user.total_users_blocks}`);
            } catch (e) {
                user.total_users_blocks = 0;
            }
            
            return user;
        });
        
        // Esperar a que se resuelvan todas las consultas
        try {
            await Promise.all(blockStatsPromises);
        } catch (e) {
            console.warn('Some block statistics queries failed, using defaults:', e.message);
        }
        
        const blockCreatorIds = new Set(usersWithBlocks.rows.map(u => u.id));
        
        // Obtener usuarios con roles administrativos
        const adminUsers = await pool.query(`
            SELECT DISTINCT 
                u.id, 
                u.nickname, 
                COALESCE(u.email, 'Sin email') as email,
                r.name as role_name
            FROM users u
            INNER JOIN user_roles ur ON u.id = ur.user_id
            INNER JOIN roles r ON ur.role_id = r.id
            WHERE r.name IN ('administrador_principal', 'administrador_secundario')
            ORDER BY u.id
        `);
        
        // AdminPrincipal y administradores secundarios
        const adminSecundarios = adminUsers.rows.map(user => ({
            id: user.id,
            nickname: user.nickname,
            email: user.email,
            first_name: '', last_name: '',
            assigned_creators_count: 0, total_blocks_assigned: 0, total_questions_assigned: 0, luminarias: 0,
            role_name: user.role_name
        }));
        
        // Si AdminPrincipal no tiene rol asignado, añadirlo manualmente
        const adminPrincipalExists = adminSecundarios.some(admin => admin.nickname === 'AdminPrincipal');
        if (!adminPrincipalExists) {
            const adminPrincipal = allUsers.rows.find(user => user.nickname === 'AdminPrincipal');
            if (adminPrincipal) {
                adminSecundarios.push({
                    id: adminPrincipal.id,
                    nickname: adminPrincipal.nickname,
                    email: adminPrincipal.email,
                    first_name: '', last_name: '',
                    assigned_creators_count: 0, total_blocks_assigned: 0, total_questions_assigned: 0, luminarias: 0,
                    role_name: 'administrador_principal'
                });
            }
        }

        // IDs de usuarios con roles administrativos
        const adminIds = new Set(adminSecundarios.map(admin => admin.id));
        
        // Obtener asignaciones de administradores
        let adminAssignments = {};
        try {
            const assignments = await pool.query(`
                SELECT aa.assigned_user_id, aa.admin_id, u.nickname as admin_nickname
                FROM admin_assignments aa
                JOIN users u ON aa.admin_id = u.id
            `);
            
            assignments.rows.forEach(assignment => {
                adminAssignments[assignment.assigned_user_id] = {
                    admin_id: assignment.admin_id,
                    admin_nickname: assignment.admin_nickname
                };
            });
        } catch (e) {
            console.log('Admin assignments table does not exist yet, using defaults');
        }

        // Usuarios con bloques como creadores (excluyendo administradores)
        const profesoresCreadores = usersWithBlocks.rows
            .filter(user => !adminIds.has(user.id))
            .map(user => {
                const assignment = adminAssignments[user.id] || { admin_id: 0, admin_nickname: 'Sin asignar' };
                return {
                    id: user.id, nickname: user.nickname, email: user.email,
                    first_name: '', last_name: '', 
                    assigned_admin_id: assignment.admin_id, 
                    assigned_admin_nickname: assignment.admin_nickname,
                    blocks_created: parseInt(user.block_count) || 0, 
                    total_questions: parseInt(user.total_questions) || 0, 
                    total_users_blocks: parseInt(user.total_users_blocks) || 0,
                    luminarias_actuales: 0, luminarias_ganadas: 0, luminarias_gastadas: 0, luminarias_abonadas: 0, luminarias_compradas: 0,
                    role_name: 'creador_contenido'
                };
            });

        // Usuarios sin bloques (excluyendo administradores y creadores)
        const usuarios = allUsers.rows
            .filter(user => !adminIds.has(user.id) && !blockCreatorIds.has(user.id))
            .map(user => {
                const assignment = adminAssignments[user.id] || { admin_id: 0, admin_nickname: 'Sin asignar' };
                return {
                    id: user.id, nickname: user.nickname, email: user.email,
                    first_name: '', last_name: '', 
                    assigned_admin_id: assignment.admin_id, 
                    assigned_admin_nickname: assignment.admin_nickname, 
                    blocks_loaded: 0,
                    luminarias_actuales: 0, luminarias_ganadas: 0, luminarias_gastadas: 0, luminarias_abonadas: 0, luminarias_compradas: 0,
                    role_name: 'usuario'
                };
            });

        console.log(`Panel data: ${adminSecundarios.length} admins, ${profesoresCreadores.length} creadores, ${usuarios.length} usuarios`);
        console.log('Admin users found:', adminUsers.rows.map(u => `${u.nickname} (${u.role_name})`));
        console.log('AdminPrincipal in allUsers:', allUsers.rows.find(u => u.nickname === 'AdminPrincipal') ? 'YES' : 'NO');

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
        
        // Borrar en orden para evitar errores de clave foránea - solo tablas que existen
        const deletedData = [];
        
        // 1. Borrar de game_players primero (si existe)
        try {
            const deletedGamePlayers = await pool.query('DELETE FROM game_players WHERE user_id = $1', [userId]);
            if (deletedGamePlayers.rowCount > 0) {
                deletedData.push(`${deletedGamePlayers.rowCount} participaciones en juegos`);
            }
        } catch (e) { /* Tabla no existe */ }
        
        // 2. Borrar juegos creados por el usuario (usando created_by)
        try {
            const deletedGames = await pool.query('DELETE FROM games WHERE created_by = $1', [userId]);
            if (deletedGames.rowCount > 0) {
                deletedData.push(`${deletedGames.rowCount} juegos creados`);
            }
        } catch (e) { /* Tabla no existe */ }
        
        // 3. Borrar preguntas creadas por el usuario
        try {
            const deletedQuestions = await pool.query('DELETE FROM questions WHERE creator_id = $1', [userId]);
            if (deletedQuestions.rowCount > 0) {
                deletedData.push(`${deletedQuestions.rowCount} preguntas creadas`);
            }
        } catch (e) { /* Tabla no existe */ }
        
        // 4. Borrar bloques creados por el usuario
        try {
            const deletedBlocks = await pool.query('DELETE FROM blocks WHERE creator_id = $1', [userId]);
            if (deletedBlocks.rowCount > 0) {
                deletedData.push(`${deletedBlocks.rowCount} bloques creados`);
            }
        } catch (e) { /* Tabla no existe */ }
        
        // 5. Borrar roles de usuario
        try {
            const deletedRoles = await pool.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
            if (deletedRoles.rowCount > 0) {
                deletedData.push(`${deletedRoles.rowCount} roles asignados`);
            }
        } catch (e) { /* Tabla no existe */ }
        
        // 6. Borrar perfil de usuario
        try {
            const deletedProfile = await pool.query('DELETE FROM user_profiles WHERE user_id = $1', [userId]);
            if (deletedProfile.rowCount > 0) {
                deletedData.push(`Perfil de usuario`);
            }
        } catch (e) { /* Tabla no existe */ }
        
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

// Asignar administrador secundario
router.post('/add-admin-secundario', authenticateToken, async (req, res) => {
    try {
        const { userId, nickname } = req.body;
        console.log(`🔧 REQUEST: add-admin-secundario - userId: ${userId}, nickname: ${nickname}`);
        console.log(`🔧 REQUEST body full:`, req.body);
        
        if (!userId && !nickname) {
            console.log(`❌ VALIDATION: Neither userId nor nickname provided`);
            return res.status(400).json({ error: 'userId o nickname es requerido' });
        }
        
        // Verificar que el usuario existe (por ID o nickname)
        let userCheck;
        if (userId) {
            console.log(`🔍 SEARCHING: by userId = ${userId}`);
            userCheck = await pool.query('SELECT id, nickname, email FROM users WHERE id = $1', [userId]);
        } else {
            console.log(`🔍 SEARCHING: by nickname = ${nickname}`);
            userCheck = await pool.query('SELECT id, nickname, email FROM users WHERE nickname = $1', [nickname]);
        }
        
        console.log(`🔍 USER SEARCH result: found ${userCheck.rows.length} users`);
        
        if (userCheck.rows.length === 0) {
            console.log(`❌ USER NOT FOUND: ${userId || nickname}`);
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        const user = userCheck.rows[0];
        console.log(`✅ USER FOUND: ${user.nickname} (ID: ${user.id})`);
        
        // Verificar si ya es admin secundario (opcional - podemos permitir múltiples roles)
        const existingRole = await pool.query(`
            SELECT ur.id FROM user_roles ur
            INNER JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = $1 AND r.name = 'administrador_secundario'
        `, [user.id]);
        
        if (existingRole.rows.length > 0) {
            return res.status(409).json({ 
                error: 'El usuario ya es administrador secundario',
                user: {
                    id: user.id,
                    nickname: user.nickname,
                    email: user.email,
                    current_role: 'administrador_secundario'
                }
            });
        }
        
        // Buscar o crear el rol de administrador_secundario
        let roleResult = await pool.query('SELECT id FROM roles WHERE name = $1', ['administrador_secundario']);
        let roleId;
        
        if (roleResult.rows.length === 0) {
            // Crear el rol si no existe
            const newRole = await pool.query(`
                INSERT INTO roles (name, description) 
                VALUES ($1, $2) 
                RETURNING id
            `, ['administrador_secundario', 'Administrador Secundario']);
            roleId = newRole.rows[0].id;
            console.log(`Created new role administrador_secundario with id ${roleId}`);
        } else {
            roleId = roleResult.rows[0].id;
        }
        
        // Asignar el rol al usuario
        await pool.query(`
            INSERT INTO user_roles (user_id, role_id) 
            VALUES ($1, $2)
        `, [user.id, roleId]);
        
        console.log(`✅ SUCCESS: User ${user.id} (${user.nickname}) assigned as admin secundario`);
        
        res.json({
            success: true,
            message: `${user.nickname} asignado como Administrador Secundario`,
            user: {
                id: user.id,
                nickname: user.nickname,
                email: user.email,
                role: 'administrador_secundario'
            }
        });
        
    } catch (error) {
        console.error('Error adding admin secundario:', error);
        res.status(500).json({ 
            error: 'Error asignando administrador secundario',
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

// Reasignar usuario a administrador
router.post('/reassign-user', authenticateToken, async (req, res) => {
    try {
        const { userId, newAdminId } = req.body;
        console.log(`Request to reassign user ${userId} to admin ${newAdminId}`);
        
        if (!userId || !newAdminId) {
            return res.status(400).json({ error: 'userId y newAdminId son requeridos' });
        }
        
        // Verificar que ambos usuarios existen
        const userCheck = await pool.query('SELECT id, nickname FROM users WHERE id = $1', [userId]);
        const adminCheck = await pool.query('SELECT id, nickname FROM users WHERE id = $1', [newAdminId]);
        
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        if (adminCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Administrador no encontrado' });
        }
        
        // Implementar lógica real de asignación
        console.log(`🔧 BACKEND: Assigning user ${userId} to admin ${newAdminId}`);
        
        // Crear tabla admin_assignments si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS admin_assignments (
                id SERIAL PRIMARY KEY,
                admin_id INTEGER REFERENCES users(id),
                assigned_user_id INTEGER REFERENCES users(id),
                assigned_by INTEGER REFERENCES users(id),
                assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(assigned_user_id)
            )
        `);
        
        // Insertar o actualizar la asignación
        await pool.query(`
            INSERT INTO admin_assignments (admin_id, assigned_user_id, assigned_by)
            VALUES ($1, $2, $3)
            ON CONFLICT (assigned_user_id)
            DO UPDATE SET 
                admin_id = $1,
                assigned_by = $3,
                assigned_at = CURRENT_TIMESTAMP
        `, [newAdminId, userId, req.user.id]);
        
        console.log(`✅ BACKEND: User ${userId} successfully assigned to admin ${newAdminId}`);
        
        res.json({
            success: true,
            message: 'Usuario reasignado exitosamente',
            user: userCheck.rows[0],
            admin: adminCheck.rows[0]
        });
        
    } catch (error) {
        console.error('Error reassigning user:', error);
        res.status(500).json({ 
            error: 'Error reasignando usuario',
            details: error.message 
        });
    }
});

// Obtener bloques de un profesor/creador
router.get('/profesores/:profesorId/bloques', authenticateToken, async (req, res) => {
    try {
        const { profesorId } = req.params;
        console.log(`Request to get blocks for profesor ${profesorId}`);
        
        // Verificar que el profesor existe
        const profesorCheck = await pool.query('SELECT id, nickname FROM users WHERE id = $1', [profesorId]);
        if (profesorCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Profesor no encontrado' });
        }
        
        // Obtener bloques del profesor
        const bloques = await pool.query(`
            SELECT 
                b.id, 
                b.name, 
                b.created_at,
                (SELECT COUNT(*) FROM questions q WHERE q.block_id = b.id) as total_preguntas
            FROM blocks b 
            WHERE b.creator_id = $1
            ORDER BY b.created_at DESC
        `, [profesorId]);
        
        // Para cada bloque, intentar obtener estadísticas adicionales
        const bloquesConStats = await Promise.all(bloques.rows.map(async (bloque) => {
            try {
                // Contar usuarios del bloque
                const usuariosBloque = await pool.query(`
                    SELECT COUNT(DISTINCT ub.user_id) as usuarios_bloque
                    FROM user_blocks ub 
                    WHERE ub.block_id = $1
                `, [bloque.id]);
                
                return {
                    ...bloque,
                    num_temas: 1, // Placeholder, podría calcularse si hay tabla de temas
                    total_preguntas: parseInt(bloque.total_preguntas) || 0,
                    usuarios_bloque: parseInt(usuariosBloque.rows[0].usuarios_bloque) || 0
                };
            } catch (e) {
                return {
                    ...bloque,
                    num_temas: 1,
                    total_preguntas: parseInt(bloque.total_preguntas) || 0,
                    usuarios_bloque: 0
                };
            }
        }));
        
        res.json({
            success: true,
            bloques: bloquesConStats,
            profesor: profesorCheck.rows[0]
        });
        
    } catch (error) {
        console.error('Error getting profesor blocks:', error);
        res.status(500).json({ 
            error: 'Error obteniendo bloques del profesor',
            details: error.message 
        });
    }
});

// Obtener temas de un bloque
router.get('/bloques/:blockId/temas', authenticateToken, async (req, res) => {
    try {
        const { blockId } = req.params;
        console.log(`Request to get topics for block ${blockId}`);
        
        // Para simplificar, devolver datos de ejemplo ya que la estructura de temas puede variar
        // En una implementación real, esto consultaría la tabla de temas
        res.json({
            success: true,
            temas: [
                {
                    topic: 'Tema General',
                    num_preguntas: 5
                }
            ],
            block_id: blockId
        });
        
    } catch (error) {
        console.error('Error getting block topics:', error);
        res.status(500).json({ 
            error: 'Error obteniendo temas del bloque',
            details: error.message 
        });
    }
});

// Obtener preguntas de un tema
router.get('/temas/:topicName/preguntas', authenticateToken, async (req, res) => {
    try {
        const { topicName } = req.params;
        console.log(`Request to get questions for topic ${topicName}`);
        
        // Para simplificar, devolver datos de ejemplo
        // En una implementación real, esto consultaría las preguntas por tema
        res.json({
            success: true,
            preguntas: [
                {
                    text_question: 'Pregunta de ejemplo',
                    difficulty: 3,
                    explanation: 'Esta es una explicación de ejemplo',
                    answers: [
                        { text: 'Respuesta correcta', is_correct: true },
                        { text: 'Respuesta incorrecta 1', is_correct: false },
                        { text: 'Respuesta incorrecta 2', is_correct: false }
                    ]
                }
            ],
            topic_name: decodeURIComponent(topicName)
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