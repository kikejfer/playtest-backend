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
            INNER JOIN user_roles ur ON u.id = ur.user_id
            INNER JOIN blocks b ON ur.id = b.user_role_id
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
        console.log('🔥🔥🔥 DIAGNOSTIC VERSION 2025-08-20 - CHECKING ROLES 🔥🔥🔥');
        console.log('ULTRA SIMPLE admin panel request from user:', req.user.id);
        
        // Solo consultas básicas y seguras
        const allUsers = await pool.query('SELECT id, nickname, COALESCE(email, \'Sin email\') as email FROM users ORDER BY id');
        
        // Obtener usuarios básicos sin contar bloques aquí (se calculará por rol específico después)
        const allUsersWithStats = await pool.query(`
            SELECT DISTINCT 
                u.id, 
                u.nickname, 
                COALESCE(u.email, 'Sin email') as email,
                COALESCE(u.first_name, '') as first_name
            FROM users u 
            ORDER BY u.id
        `);
        
        // Las estadísticas por rol se calcularán más adelante para cada usuario según su rol específico
        
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
        
        // Contar usuarios asignados a cada administrador
        let adminUserCounts = {};
        let adminBlockCounts = {};
        let adminQuestionCounts = {};
        let adminJugadoresCounts = {};
        
        try {
            // Contar usuarios asignados por administrador
            const userCounts = await pool.query(`
                SELECT admin_id, COUNT(*) as user_count
                FROM admin_assignments
                GROUP BY admin_id
            `);
            
            userCounts.rows.forEach(row => {
                adminUserCounts[row.admin_id] = parseInt(row.user_count) || 0;
            });
            
            // Contar bloques de usuarios asignados por administrador
            const blockCounts = await pool.query(`
                SELECT aa.admin_id, COUNT(DISTINCT b.id) as block_count, COALESCE(SUM(ba.total_questions), 0) as question_count
                FROM admin_assignments aa
                JOIN user_roles ur ON aa.assigned_user_id = ur.user_id
                JOIN blocks b ON ur.id = b.user_role_id
                LEFT JOIN block_answers ba ON b.id = ba.block_id
                GROUP BY aa.admin_id
            `);
            
            blockCounts.rows.forEach(row => {
                adminBlockCounts[row.admin_id] = parseInt(row.block_count) || 0;
                adminQuestionCounts[row.admin_id] = parseInt(row.question_count) || 0;
            });
            
            // Contar jugadores asignados por administrador
            const jugadoresCounts = await pool.query(`
                SELECT aa.admin_id, COUNT(DISTINCT ur.user_id) as jugadores_count
                FROM admin_assignments aa
                JOIN user_roles ur ON aa.assigned_user_id = ur.user_id
                JOIN roles r ON ur.role_id = r.id
                WHERE r.name = 'jugador'
                GROUP BY aa.admin_id
            `);
            
            jugadoresCounts.rows.forEach(row => {
                adminJugadoresCounts[row.admin_id] = parseInt(row.jugadores_count) || 0;
            });
        } catch (e) {
            console.log('Error calculating admin stats, using defaults:', e.message);
        }

        // AdminPrincipal y administradores secundarios  
        const adminSecundarios = adminUsers.rows.map(user => {
            // Buscar first_name del usuario
            const userData = allUsersWithStats.rows.find(u => u.id === user.id);
            return {
                id: user.id,
                nickname: user.nickname,
                email: user.email,
                first_name: userData?.first_name || '', 
                last_name: '',
                assigned_creators_count: adminUserCounts[user.id] || 0, 
                total_blocks_assigned: adminBlockCounts[user.id] || 0, 
                total_questions_assigned: adminQuestionCounts[user.id] || 0,
                jugadores: adminJugadoresCounts[user.id] || 0,
                luminarias: 0,
                role_name: user.role_name
            };
        });
        
        // Si AdminPrincipal no tiene rol asignado, añadirlo manualmente
        const adminPrincipalExists = adminSecundarios.some(admin => admin.nickname === 'AdminPrincipal');
        if (!adminPrincipalExists) {
            const adminPrincipal = allUsers.rows.find(user => user.nickname === 'AdminPrincipal');
            if (adminPrincipal) {
                const adminPrincipalData = allUsersWithStats.rows.find(u => u.id === adminPrincipal.id);
                adminSecundarios.push({
                    id: adminPrincipal.id,
                    nickname: adminPrincipal.nickname,
                    email: adminPrincipal.email,
                    first_name: adminPrincipalData?.first_name || '', 
                    last_name: '',
                    assigned_creators_count: adminUserCounts[adminPrincipal.id] || 0, 
                    total_blocks_assigned: adminBlockCounts[adminPrincipal.id] || 0, 
                    total_questions_assigned: adminQuestionCounts[adminPrincipal.id] || 0,
                    jugadores: adminJugadoresCounts[adminPrincipal.id] || 0,
                    luminarias: 0,
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
                SELECT aa.assigned_user_id, aa.admin_id, u.nickname as admin_nickname, aa.assigned_at
                FROM admin_assignments aa
                JOIN users u ON aa.admin_id = u.id
            `);
            
            assignments.rows.forEach(assignment => {
                adminAssignments[assignment.assigned_user_id] = {
                    admin_id: assignment.admin_id,
                    admin_nickname: assignment.admin_nickname,
                    assigned_at: assignment.assigned_at
                };
            });
        } catch (e) {
            console.log('Admin assignments table does not exist yet, using defaults');
        }

        // Verificar qué roles existen en la base de datos
        console.log('🏷️ CHECKING ROLES TABLE...');
        try {
            const allRoles = await pool.query('SELECT id, name FROM roles ORDER BY id');
            console.log('🏷️ Available roles in database:', allRoles.rows.map(r => `${r.id}:${r.name}`).join(', '));
            
            // Verificar específicamente rol ID 5
            const rol5 = allRoles.rows.find(r => r.id === 5);
            console.log('🎯 Role ID 5 name:', rol5 ? rol5.name : 'NOT FOUND');
        } catch (e) {
            console.warn('❌ Could not fetch roles table:', e.message);
        }

        // Obtener TODOS los usuarios que tienen roles relevantes
        const usersWithRolesQuery = await pool.query(`
            SELECT DISTINCT u.id, u.nickname, COALESCE(u.email, 'Sin email') as email, COALESCE(u.first_name, '') as first_name
            FROM users u
            INNER JOIN user_roles ur ON u.id = ur.user_id
            INNER JOIN roles r ON ur.role_id = r.id
            WHERE r.name IN ('profesor', 'creador', 'administrador_principal', 'administrador_secundario', 'jugador', 'soporte_tecnico') 
            OR r.id = 5
            ORDER BY u.id
        `);
        
        console.log(`🔍 Found ${usersWithRolesQuery.rows.length} users with relevant roles`);
        
        // Simplificar: solo obtener usuarios y sus roles, sin calcular estadísticas aquí
        const usersWithRoles = usersWithRolesQuery.rows;
        
        // IDs de usuarios que han creado bloques (para excluir de usuarios normales)
        const rolesCreatorIds = new Set(usersWithRoles.map(user => user.id));
        
        // Log de roles encontrados
        console.log('👥 Users with roles found:', usersWithRoles.length);

        // Las estadísticas se calcularán en el módulo genérico, no aquí
        
        // Crear listas separadas por rol (usuarios pueden aparecer en múltiples listas)
        const profesores = [];
        const creadores = [];
        const jugadores = [];
        const soporteTecnico = [];
        
        // Procesar TODOS los usuarios con roles según TODOS sus roles
        for (const user of usersWithRoles) {
            const isAdmin = adminIds.has(user.id);
            
            // Los no asignados corresponden al Administrador Principal
            const assignment = adminAssignments[user.id] || { 
                admin_id: null, 
                admin_nickname: 'Administrador Principal', 
                assigned_at: null 
            };
            const baseUserData = {
                id: user.id, 
                nickname: user.nickname, 
                email: user.email,
                first_name: user.first_name || '', 
                last_name: '', 
                assigned_admin_id: assignment.admin_id, 
                assigned_admin_nickname: assignment.admin_nickname,
                asignacion: assignment.assigned_at ? new Date(assignment.assigned_at).toLocaleDateString() : 'Administrador Principal',
                luminarias_actuales: 0, 
                luminarias_ganadas: 0, 
                luminarias_gastadas: 0, 
                luminarias_abonadas: 0, 
                luminarias_compradas: 0
            };
            
            // Obtener todos los roles del usuario
            try {
                const userRolesResult = await pool.query(`
                    SELECT r.name as role_name
                    FROM user_roles ur
                    JOIN roles r ON ur.role_id = r.id
                    WHERE ur.user_id = $1
                `, [user.id]);
                
                const userRoles = userRolesResult.rows.map(row => row.role_name);
                console.log(`👤 User ${user.nickname} (ID: ${user.id}) has roles:`, userRoles, isAdmin ? '(ADMIN)' : '');
                
                // Agregar a las listas correspondientes según roles (sin cálculos de estadísticas)
                if (userRoles.includes('profesor')) {
                    profesores.push({ 
                        ...baseUserData, 
                        role_name: 'profesor'
                    });
                }
                
                if (userRoles.includes('creador')) {
                    creadores.push({ 
                        ...baseUserData, 
                        role_name: 'creador'
                    });
                }
                
                if (userRoles.includes('jugador') || userRoles.some(role => role.includes('jugador'))) {
                    console.log(`🎮 Adding ${user.nickname} to jugadores list (isAdmin: ${isAdmin})`);
                    // Calcular bloques cargados para jugadores desde user_loaded_blocks
                    try {
                        const bloquesQuery = await pool.query(`
                            SELECT COUNT(DISTINCT ulb.block_id) as bloques_cargados
                            FROM user_loaded_blocks ulb
                            WHERE ulb.user_id = $1
                        `, [user.id]);
                        
                        const bloquesCargados = parseInt(bloquesQuery.rows[0].bloques_cargados) || 0;
                        
                        jugadores.push({ 
                            ...baseUserData, 
                            role_name: 'jugador',
                            bloques: bloquesCargados
                        });
                    } catch (e) {
                        jugadores.push({ 
                            ...baseUserData, 
                            role_name: 'jugador',
                            bloques: 0
                        });
                    }
                }
                
                if (userRoles.includes('soporte_tecnico')) {
                    console.log(`🔧 Adding ${user.nickname} to soporte técnico list (isAdmin: ${isAdmin})`);
                    soporteTecnico.push({ 
                        ...baseUserData, 
                        role_name: 'soporte_tecnico'
                    });
                }
                
            } catch (e) {
                console.warn(`Error getting roles for user ${user.id}:`, e.message);
            }
        }
        
        // Combinar para compatibilidad con código existente
        const profesoresCreadores = [...profesores, ...creadores];

        // Usuarios sin bloques (excluyendo administradores y creadores)
        const usuarios = allUsers.rows
            .filter(user => !adminIds.has(user.id) && !rolesCreatorIds.has(user.id))
            .map(user => {
                // Los no asignados corresponden al Administrador Principal
                const adminPrincipal = adminSecundarios.find(admin => admin.role_name === 'administrador_principal');
                const assignment = adminAssignments[user.id] || { 
                    admin_id: adminPrincipal?.id || 0, 
                    admin_nickname: adminPrincipal?.nickname || 'AdminPrincipal', 
                    assigned_at: null 
                };
                const userData = allUsersWithStats.rows.find(u => u.id === user.id);
                return {
                    id: user.id, 
                    nickname: user.nickname, 
                    email: user.email,
                    first_name: userData?.first_name || '', 
                    last_name: '', 
                    assigned_admin_id: assignment.admin_id, 
                    assigned_admin_nickname: assignment.admin_nickname,
                    asignacion: assignment.assigned_at ? new Date(assignment.assigned_at).toLocaleDateString() : 'Administrador Principal',
                    blocks_loaded: 0,
                    luminarias_actuales: 0, 
                    luminarias_ganadas: 0, 
                    luminarias_gastadas: 0, 
                    luminarias_abonadas: 0, 
                    luminarias_compradas: 0,
                    role_name: 'usuario'
                };
            });

        // Logs de las listas separadas
        console.log('🔍 PROFESORES LIST:');
        profesores.forEach(user => {
            console.log(`  - ${user.nickname} (ID: ${user.id})`);
        });
        
        console.log('🔍 CREADORES LIST:');
        creadores.forEach(user => {
            console.log(`  - ${user.nickname} (ID: ${user.id})`);
        });
        
        console.log('🔍 JUGADORES LIST:');
        jugadores.forEach(user => {
            console.log(`  - ${user.nickname} (ID: ${user.id})`);
        });
        
        console.log(`📊 Role counts: profesores=${profesores.length}, creadores=${creadores.length}, jugadores=${jugadores.length}`);
        
        console.log(`📊 Panel data summary:`);
        console.log(`  - ${adminSecundarios.length} administradores`);
        console.log(`  - ${profesores.length} profesores`);
        console.log(`  - ${creadores.length} creadores`);
        console.log(`  - ${jugadores.length} jugadores`);
        console.log(`  - ${usuarios.length} usuarios sin roles específicos`);
        console.log('🔧 Admin users found:', adminUsers.rows.map(u => `${u.nickname} (${u.role_name})`));
        console.log('👑 AdminPrincipal in allUsers:', allUsers.rows.find(u => u.nickname === 'AdminPrincipal') ? 'YES' : 'NO');

        // Calcular conteos únicos por rol desde la base de datos
        const roleCountsQuery = await pool.query(`
            SELECT 
                r.name as role_name,
                COUNT(DISTINCT ur.user_id) as unique_count
            FROM roles r
            LEFT JOIN user_roles ur ON r.id = ur.role_id
            GROUP BY r.name
            ORDER BY r.name
        `);
        
        let admins = 0, profesores_count = 0, creadores_count = 0, jugadores_count = 0, usuarios_count = 0;
        
        roleCountsQuery.rows.forEach(row => {
            switch (row.role_name) {
                case 'administrador_principal':
                case 'administrador_secundario':
                    admins += parseInt(row.unique_count);
                    break;
                case 'profesor':
                    profesores_count += parseInt(row.unique_count);
                    break;
                case 'creador':
                    creadores_count += parseInt(row.unique_count);
                    break;
                case 'jugador':
                    jugadores_count += parseInt(row.unique_count);
                    break;
                case 'usuario':
                    usuarios_count += parseInt(row.unique_count);
                    break;
            }
        });

        // Obtener el total real de usuarios en la tabla users
        const totalUsersQuery = await pool.query('SELECT COUNT(*) as total FROM users');
        const usuarios_count_real = parseInt(totalUsersQuery.rows[0].total) || 0;

        // Calcular bloques totales y preguntas totales para PAP
        const bloquesTotalesQuery = await pool.query('SELECT COUNT(*) as total FROM blocks');
        const bloques_totales = parseInt(bloquesTotalesQuery.rows[0].total) || 0;

        const preguntasTotalesQuery = await pool.query(`
            SELECT COALESCE(SUM(ba.total_questions), 0) as total 
            FROM block_answers ba
        `);
        const preguntas_totales = parseInt(preguntasTotalesQuery.rows[0].total) || 0;

        console.log(`📊 CORRECTED Role counts from DB: admins=${admins}, profesores=${profesores_count}, creadores=${creadores_count}, jugadores=${jugadores_count}, usuarios=${usuarios_count_real} (total users in table), bloques=${bloques_totales}, preguntas=${preguntas_totales}`);

        // Separar jugadores en dos paneles: AdminPrincipal vs resto de administradores
        const adminPrincipal = adminSecundarios.find(admin => admin.role_name === 'administrador_principal');
        const adminPrincipalId = adminPrincipal?.id || 0;
        
        const jugadoresAdminPrincipal = jugadores.filter(jugador => 
            jugador.assigned_admin_id === null || 
            jugador.assigned_admin_id === 0 || 
            jugador.assigned_admin_id === adminPrincipalId ||
            jugador.assigned_admin_nickname === 'AdminPrincipal'
        );
        const jugadoresOtrosAdmins = jugadores.filter(jugador => 
            jugador.assigned_admin_id !== null && 
            jugador.assigned_admin_id !== 0 && 
            jugador.assigned_admin_id !== adminPrincipalId &&
            jugador.assigned_admin_nickname !== 'AdminPrincipal'
        );
        
        console.log('🎯 BACKEND DEBUG - Jugadores separados:');
        console.log(`  - jugadoresAdminPrincipal: ${jugadoresAdminPrincipal.length} items`);
        jugadoresAdminPrincipal.forEach(j => console.log(`    * ${j.nickname} (assigned_admin_id: ${j.assigned_admin_id})`));
        console.log(`  - jugadoresOtrosAdmins: ${jugadoresOtrosAdmins.length} items`);
        jugadoresOtrosAdmins.forEach(j => console.log(`    * ${j.nickname} (assigned_admin_id: ${j.assigned_admin_id})`));

        res.json({
            adminSecundarios: adminSecundarios,
            profesoresCreadores: profesoresCreadores,
            profesores: profesores,
            creadores: creadores,
            jugadores: jugadores, // Mantener para compatibilidad
            jugadoresAdminPrincipal: jugadoresAdminPrincipal,
            jugadoresOtrosAdmins: jugadoresOtrosAdmins,
            soporteTecnico: soporteTecnico,
            usuarios: usuarios,
            availableAdmins: adminUsers.rows,
            ultra_simple_version: true,
            // Estadísticas corregidas para el frontend
            statistics: {
                admins: admins,
                soporte: soporteTecnico.length,
                profesores: profesores_count,
                creadores: creadores_count,
                jugadores: jugadores_count,
                usuarios: usuarios_count_real,
                bloques: bloques_totales,
                preguntas: preguntas_totales
            }
        });

    } catch (error) {
        console.error('Error in ultra simple admin panel:', error);
        res.status(500).json({ error: 'Error interno del servidor', details: error.message });
    }
});

// Endpoint para obtener estadísticas de un usuario específico por rol
router.get('/usuarios/:userId/estadisticas', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.params;
        const { rol } = req.query; // 'profesor' | 'creador'
        
        console.log(`📊 Calculating stats for user ${userId} with role ${rol}`);
        
        if (!rol || !['profesor', 'creador'].includes(rol)) {
            return res.status(400).json({ error: 'Rol válido requerido (profesor/creador)' });
        }
        
        // Determinar role_id basado en el parámetro rol
        let targetRoleId;
        if (rol === 'profesor') {
            targetRoleId = 3; // profesor
        } else if (rol === 'creador') {
            targetRoleId = 4; // creador
        } else {
            return res.status(400).json({ error: 'Rol inválido. Use profesor o creador.' });
        }
        
        // 1. Contar bloques creados con rol específico
        const blocksQuery = await pool.query(`
            SELECT COUNT(DISTINCT b.id) as blocks_count
            FROM blocks b
            JOIN user_roles ur ON b.user_role_id = ur.id
            WHERE ur.user_id = $1 AND ur.role_id = $2
        `, [userId, targetRoleId]);
        
        const blocksCount = parseInt(blocksQuery.rows[0].blocks_count) || 0;
        
        if (blocksCount === 0) {
            return res.json({
                blocks_created: 0,
                total_questions: 0,
                total_topics: 0,
                total_users: 0
            });
        }
        
        // 2. Contar preguntas usando block_answers.total_questions
        const questionsQuery = await pool.query(`
            SELECT COALESCE(SUM(ba.total_questions), 0) as total_questions
            FROM blocks b
            JOIN user_roles ur ON b.user_role_id = ur.id
            LEFT JOIN block_answers ba ON b.id = ba.block_id
            WHERE ur.user_id = $1 AND ur.role_id = $2
        `, [userId, targetRoleId]);
        
        const totalQuestions = parseInt(questionsQuery.rows[0].total_questions) || 0;
        
        // 3. Contar temas únicos de topic_answers
        const topicsQuery = await pool.query(`
            SELECT COUNT(DISTINCT ta.topic) as total_topics
            FROM blocks b
            JOIN user_roles ur ON b.user_role_id = ur.id
            LEFT JOIN topic_answers ta ON b.id = ta.block_id
            WHERE ur.user_id = $1 AND ur.role_id = $2 
            AND ta.topic IS NOT NULL AND ta.topic != ''
        `, [userId, targetRoleId]);
        
        const totalTopics = parseInt(topicsQuery.rows[0].total_topics) || 0;
        
        // 4. Contar usuarios que han cargado bloques de este rol
        const usersQuery = await pool.query(`
            SELECT COUNT(DISTINCT ulb.user_id) as total_users
            FROM blocks b
            JOIN user_roles ur ON b.user_role_id = ur.id
            LEFT JOIN user_loaded_blocks ulb ON b.id = ulb.block_id
            WHERE ur.user_id = $1 AND ur.role_id = $2
        `, [userId, targetRoleId]);
        
        const totalUsers = parseInt(usersQuery.rows[0].total_users) || 0;
        
        const result = {
            blocks_created: blocksCount,
            total_questions: totalQuestions,
            total_topics: totalTopics,
            total_users: totalUsers
        };
        
        console.log(`📊 Stats for user ${userId} (${rol}):`, result);
        
        res.json(result);
        
    } catch (error) {
        console.error('Error calculating user statistics:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor', 
            details: error.message,
            blocks_created: 0,
            total_questions: 0,
            total_topics: 0,
            total_users: 0
        });
    }
});

// Endpoint para obtener administrados filtrados por admin_assignments
router.get('/administrados/:rol', authenticateToken, async (req, res) => {
    try {
        const { rol } = req.params; // 'profesores' | 'creadores'
        const currentUserId = req.user.id;
        
        console.log(`🔍 Obteniendo ${rol} administrados para usuario ${currentUserId}`);
        
        // Verificar rol del usuario actual usando IDs
        const userRoleQuery = await pool.query(`
            SELECT ur.role_id, r.name as role_name
            FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = $1
        `, [currentUserId]);
        
        const userRoleIds = userRoleQuery.rows.map(row => row.role_id);
        const isAdminPrincipal = userRoleIds.includes(1); // administrador_principal
        const isAdminSecundario = userRoleIds.includes(2); // administrador_secundario
        
        if (!isAdminPrincipal && !isAdminSecundario) {
            return res.status(403).json({ error: 'Usuario no autorizado para ver administrados' });
        }
        
        let administradosQuery;
        let params;
        
        // Determinar role_id basado en el parámetro
        let targetRoleId;
        if (rol === 'profesores') {
            targetRoleId = 3; // profesor
        } else if (rol === 'creadores') {
            targetRoleId = 4; // creador
        } else {
            return res.status(400).json({ error: 'Rol inválido. Use profesores o creadores.' });
        }

        if (isAdminPrincipal) {
            // PAP: todos los assigned_user_id especificando su admin_id
            administradosQuery = `
                SELECT DISTINCT 
                    u.id,
                    u.nickname,
                    u.email,
                    u.first_name,
                    u.last_name,
                    aa.assigned_user_id,
                    aa.admin_id,
                    u_admin.nickname as assigned_admin_nickname
                FROM users u
                JOIN user_roles ur ON u.id = ur.user_id
                LEFT JOIN admin_assignments aa ON u.id = aa.assigned_user_id
                LEFT JOIN users u_admin ON aa.admin_id = u_admin.id
                WHERE ur.role_id = $1
                ORDER BY u.nickname
            `;
            params = [targetRoleId];
        } else {
            // PAS: los assigned_user_id asignados al admin_id del usuario actual
            administradosQuery = `
                SELECT DISTINCT 
                    u.id,
                    u.nickname,
                    u.email,
                    u.first_name,
                    u.last_name,
                    aa.assigned_user_id,
                    aa.admin_id,
                    u_admin.nickname as assigned_admin_nickname
                FROM users u
                JOIN user_roles ur ON u.id = ur.user_id
                JOIN admin_assignments aa ON u.id = aa.assigned_user_id
                LEFT JOIN users u_admin ON aa.admin_id = u_admin.id
                WHERE ur.role_id = $1 AND aa.admin_id = $2
                ORDER BY u.nickname
            `;
            params = [targetRoleId, currentUserId];
        }
        
        const result = await pool.query(administradosQuery, params);
        
        console.log(`🔍 ROLE DEBUG - Solicitado: ${rol} (targetRoleId: ${targetRoleId})`);
        console.log(`🔍 ROLE DEBUG - Usuarios encontrados: ${result.rows.length}`);
        result.rows.forEach(user => {
            console.log(`   - Usuario ${user.nickname} (ID: ${user.id})`);
        });
        
        // Obtener administradores disponibles (solo para PAP)
        let availableAdmins = [];
        if (isAdminPrincipal) {
            const adminsQuery = await pool.query(`
                SELECT DISTINCT u.id, u.nickname, r.name as role_name
                FROM users u
                JOIN user_roles ur ON u.id = ur.user_id
                JOIN roles r ON ur.role_id = r.id
                WHERE ur.role_id IN (1, 2)
                ORDER BY u.nickname
            `);
            availableAdmins = adminsQuery.rows;
        }
        
        res.json({
            administrados: result.rows,
            availableAdmins: availableAdmins,
            total: result.rows.length,
            panel_type: isAdminPrincipal ? 'PAP' : 'PAS'
        });
        
    } catch (error) {
        console.error('Error obteniendo administrados:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor', 
            details: error.message 
        });
    }
});

// Endpoint para obtener características de un administrado
router.get('/administrados/:userId/caracteristicas', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.params;
        const { rol } = req.query; // 'profesor' | 'creador'
        
        console.log(`📊 Calculando características de administrado ${userId} con rol ${rol}`);
        
        // Determinar role_id basado en el parámetro rol  
        let targetRoleId;
        if (rol === 'profesor') {
            targetRoleId = 3; // profesor
        } else if (rol === 'creador') {
            targetRoleId = 4; // creador
        } else {
            return res.status(400).json({ error: 'Rol inválido. Use profesor o creador.' });
        }
        
        console.log(`🔍 CARACTERISTICAS DEBUG - Usuario: ${userId}, Rol: ${rol}, targetRoleId: ${targetRoleId} (ORIGINAL MAPPING)`);
        
        // DIAGNÓSTICO: Verificar qué roles tiene realmente este usuario en la BD
        const userRolesVerification = await pool.query(`
            SELECT ur.role_id, r.name as role_name
            FROM user_roles ur 
            JOIN roles r ON ur.role_id = r.id 
            WHERE ur.user_id = $1
            ORDER BY ur.role_id
        `, [userId]);
        
        console.log(`🔍 DIAGNÓSTICO USER ROLES - Usuario ${userId} tiene roles:`, 
            userRolesVerification.rows.map(row => `${row.role_id}:${row.role_name}`).join(', '));
        
        // DIAGNÓSTICO: Verificar tabla roles completa
        const allRolesVerification = await pool.query(`
            SELECT id, name FROM roles WHERE id IN (3, 4) ORDER BY id
        `);
        
        console.log(`🔍 DIAGNÓSTICO ROLES TABLE - IDs 3 y 4:`, 
            allRolesVerification.rows.map(row => `${row.id}:${row.name}`).join(', '));
        
        // Información básica del usuario
        const userQuery = await pool.query(`
            SELECT id, nickname, email, first_name, last_name
            FROM users
            WHERE id = $1
        `, [userId]);
        
        if (userQuery.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        const user = userQuery.rows[0];
        
        // Bloques creados por el assigned_user_id (tabla blocks filtrado por user_role_id + rol)
        const blocksQuery = await pool.query(`
            SELECT COUNT(DISTINCT b.id) as total_blocks
            FROM blocks b
            JOIN user_roles ur ON b.user_role_id = ur.id
            WHERE ur.user_id = $1 AND ur.role_id = $2
        `, [userId, targetRoleId]);
        
        const totalBlocks = parseInt(blocksQuery.rows[0].total_blocks) || 0;
        console.log(`📊 Usuario ${userId} rol ${targetRoleId}: ${totalBlocks} bloques encontrados`);
        
        // Temas totales (suma de temas por bloque, igual que Nivel 2)
        const topicsQuery = await pool.query(`
            SELECT COALESCE(SUM(block_topics.topic_count), 0) as total_topics
            FROM (
                SELECT b.id, COUNT(DISTINCT ta.topic) as topic_count
                FROM blocks b
                JOIN user_roles ur ON b.user_role_id = ur.id
                LEFT JOIN topic_answers ta ON b.id = ta.block_id 
                AND ta.topic IS NOT NULL AND ta.topic != ''
                WHERE ur.user_id = $1 AND ur.role_id = $2
                GROUP BY b.id
            ) block_topics
        `, [userId, targetRoleId]);
        
        const totalTopics = parseInt(topicsQuery.rows[0].total_topics) || 0;
        console.log(`📊 Usuario ${userId} rol ${targetRoleId}: ${totalTopics} temas encontrados`);
        
        // Preguntas totales (total_questions de tabla block_answers)
        const questionsQuery = await pool.query(`
            SELECT COALESCE(SUM(ba.total_questions), 0) as total_questions
            FROM blocks b
            JOIN user_roles ur ON b.user_role_id = ur.id
            LEFT JOIN block_answers ba ON b.id = ba.block_id
            WHERE ur.user_id = $1 AND ur.role_id = $2
        `, [userId, targetRoleId]);
        
        const totalQuestions = parseInt(questionsQuery.rows[0].total_questions) || 0;
        console.log(`📊 Usuario ${userId} rol ${targetRoleId}: ${totalQuestions} preguntas encontradas`);
        
        // Alumnos/Estudiantes (número de registros de user_loaded_blocks)
        const usersQuery = await pool.query(`
            SELECT COUNT(DISTINCT ulb.user_id) as total_users
            FROM blocks b
            JOIN user_roles ur ON b.user_role_id = ur.id
            LEFT JOIN user_loaded_blocks ulb ON b.id = ulb.block_id
            WHERE ur.user_id = $1 AND ur.role_id = $2
        `, [userId, targetRoleId]);
        
        const totalUsers = parseInt(usersQuery.rows[0].total_users) || 0;
        
        // Administrador asignado
        const adminQuery = await pool.query(`
            SELECT aa.admin_id, u_admin.nickname as assigned_admin_nickname
            FROM admin_assignments aa
            LEFT JOIN users u_admin ON aa.admin_id = u_admin.id
            WHERE aa.assigned_user_id = $1
        `, [userId]);
        
        const adminAssignment = adminQuery.rows[0] || {};
        
        const result = {
            nickname: user.nickname,
            email: user.email,
            full_name: [user.first_name, user.last_name].filter(Boolean).join(' '),
            total_blocks: totalBlocks,
            total_topics: totalTopics,
            total_questions: totalQuestions,
            total_users: totalUsers,
            assigned_admin_id: adminAssignment.admin_id || null,
            assigned_admin_nickname: adminAssignment.assigned_admin_nickname || 'Sin asignar'
        };
        
        console.log(`📊 Características calculadas para ${user.nickname}:`, result);
        
        res.json(result);
        
    } catch (error) {
        console.error('Error calculando características:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor', 
            details: error.message,
            total_blocks: 0,
            total_topics: 0,
            total_questions: 0,
            total_users: 0
        });
    }
});

// Panel secundario (sin sección de administradores)
router.get('/admin-secundario-panel', authenticateToken, async (req, res) => {
    try {
        console.log('🔥 ADMIN SECUNDARIO PANEL - sin sección administradores');
        
        // Reutilizar toda la lógica del panel principal pero sin adminSecundarios
        // Obtener usuarios básicos
        const allUsers = await pool.query('SELECT id, nickname, COALESCE(email, \'Sin email\') as email FROM users ORDER BY id');
        
        const allUsersWithStats = await pool.query(`
            SELECT DISTINCT 
                u.id, 
                u.nickname, 
                COALESCE(u.email, 'Sin email') as email,
                COALESCE(u.first_name, '') as first_name
            FROM users u 
            ORDER BY u.id
        `);
        
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
        
        // Obtener usuarios que tienen roles relevantes (excluyendo administradores)
        const usersWithRolesQuery = await pool.query(`
            SELECT DISTINCT u.id, u.nickname, COALESCE(u.email, 'Sin email') as email, COALESCE(u.first_name, '') as first_name
            FROM users u
            INNER JOIN user_roles ur ON u.id = ur.user_id
            INNER JOIN roles r ON ur.role_id = r.id
            WHERE r.name IN ('profesor', 'creador', 'jugador') 
            ORDER BY u.id
        `);
        
        const usersWithRoles = usersWithRolesQuery.rows;
        
        // Los cálculos de estadísticas se hacen ahora en el módulo genérico
        
        // Obtener asignaciones (simplificado para PAS)
        let adminAssignments = {};
        try {
            const assignments = await pool.query(`
                SELECT aa.assigned_user_id, aa.admin_id, u.nickname as admin_nickname, aa.assigned_at
                FROM admin_assignments aa
                JOIN users u ON aa.admin_id = u.id
            `);
            
            assignments.rows.forEach(assignment => {
                adminAssignments[assignment.assigned_user_id] = {
                    admin_id: assignment.admin_id,
                    admin_nickname: assignment.admin_nickname,
                    assigned_at: assignment.assigned_at
                };
            });
        } catch (e) {
            console.log('Admin assignments table does not exist yet, using defaults');
        }
        
        // Crear listas (sin administradores)
        const profesores = [];
        const creadores = [];
        const jugadores = [];
        
        for (const user of usersWithRoles) {
            const assignment = adminAssignments[user.id] || { 
                admin_id: 0, 
                admin_nickname: 'AdminPrincipal', 
                assigned_at: null 
            };
            const baseUserData = {
                id: user.id, 
                nickname: user.nickname, 
                email: user.email,
                first_name: user.first_name || '', 
                last_name: '', 
                assigned_admin_id: assignment.admin_id, 
                assigned_admin_nickname: assignment.admin_nickname,
                asignacion: assignment.assigned_at ? new Date(assignment.assigned_at).toLocaleDateString() : 'Administrador Principal',
                luminarias_actuales: 0, luminarias_ganadas: 0, luminarias_gastadas: 0, luminarias_abonadas: 0, luminarias_compradas: 0
            };
            
            try {
                const userRolesResult = await pool.query(`
                    SELECT r.name as role_name
                    FROM user_roles ur
                    JOIN roles r ON ur.role_id = r.id
                    WHERE ur.user_id = $1
                `, [user.id]);
                
                const userRoles = userRolesResult.rows.map(row => row.role_name);
                
                if (userRoles.includes('profesor')) {
                    profesores.push({ 
                        ...baseUserData, 
                        role_name: 'profesor'
                    });
                }
                
                if (userRoles.includes('creador')) {
                    creadores.push({ 
                        ...baseUserData, 
                        role_name: 'creador'
                    });
                }
                
                if (userRoles.includes('jugador')) {
                    jugadores.push({ ...baseUserData, role_name: 'jugador' });
                }
                
            } catch (e) {
                console.warn(`Error getting roles for user ${user.id}:`, e.message);
            }
        }
        
        const profesoresCreadores = [...profesores, ...creadores];
        
        // Usuarios normales (excluyendo usuarios con roles específicos)
        const rolesUserIds = new Set(usersWithRoles.map(user => user.id));
        const usuarios = allUsers.rows
            .filter(user => !rolesUserIds.has(user.id))
            .map(user => {
                const assignment = adminAssignments[user.id] || { 
                    admin_id: 0, 
                    admin_nickname: 'AdminPrincipal', 
                    assigned_at: null 
                };
                const userData = allUsersWithStats.rows.find(u => u.id === user.id);
                return {
                    id: user.id, 
                    nickname: user.nickname, 
                    email: user.email,
                    first_name: userData?.first_name || '', 
                    last_name: '', 
                    assigned_admin_id: assignment.admin_id, 
                    assigned_admin_nickname: assignment.admin_nickname,
                    asignacion: assignment.assigned_at ? new Date(assignment.assigned_at).toLocaleDateString() : 'Administrador Principal',
                    blocks_loaded: 0,
                    luminarias_actuales: 0, luminarias_ganadas: 0, luminarias_gastadas: 0, luminarias_abonadas: 0, luminarias_compradas: 0,
                    role_name: 'usuario'
                };
            });

        // Obtener el ID del administrador actual desde el token
        const currentAdminId = req.user.id;
        console.log('📋 Admin secundario ID:', currentAdminId);

        // Calcular estadísticas específicas para este administrador
        const profesoresAssignedQuery = await pool.query(`
            SELECT COUNT(DISTINCT u.id) as count
            FROM users u
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN roles r ON ur.role_id = r.id
            LEFT JOIN admin_assignments aa ON u.id = aa.assigned_user_id
            WHERE r.name = 'profesor' AND aa.admin_id = $1
        `, [currentAdminId]);

        const creadoresAssignedQuery = await pool.query(`
            SELECT COUNT(DISTINCT u.id) as count
            FROM users u
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN roles r ON ur.role_id = r.id
            LEFT JOIN admin_assignments aa ON u.id = aa.assigned_user_id
            WHERE r.name = 'creador' AND aa.admin_id = $1
        `, [currentAdminId]);

        const jugadoresAssignedQuery = await pool.query(`
            SELECT COUNT(DISTINCT u.id) as count
            FROM users u
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN roles r ON ur.role_id = r.id
            LEFT JOIN admin_assignments aa ON u.id = aa.assigned_user_id
            WHERE r.name = 'jugador' AND aa.admin_id = $1
        `, [currentAdminId]);

        // Obtener jugadores asignados con datos detallados
        const jugadoresAsignadosQuery = await pool.query(`
            SELECT 
                u.id as user_id,
                u.nickname,
                u.first_name,
                u.email,
                ur.id as user_role_id,
                COUNT(DISTINCT ulb.block_id) as blocks_loaded,
                COALESCE(u_admin.nickname, 'Administrador Principal') as assigned_admin_nickname,
                aa.admin_id as assigned_admin_id
            FROM users u
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN roles r ON ur.role_id = r.id
            LEFT JOIN admin_assignments aa ON u.id = aa.assigned_user_id
            LEFT JOIN users u_admin ON aa.admin_id = u_admin.id
            LEFT JOIN user_loaded_blocks ulb ON u.id = ulb.user_id
            WHERE r.name = 'jugador' AND aa.admin_id = $1
            GROUP BY u.id, u.nickname, u.first_name, u.email, ur.id, u_admin.nickname, aa.admin_id
            ORDER BY u.nickname
        `, [currentAdminId]);
        
        const profesores_count = parseInt(profesoresAssignedQuery.rows[0]?.count) || 0;
        const creadores_count = parseInt(creadoresAssignedQuery.rows[0]?.count) || 0;
        const jugadores_count = parseInt(jugadoresAssignedQuery.rows[0]?.count) || 0;
        const usuarios_count = 0; // No se usa en PAS

        // Calcular bloques y preguntas específicos del administrador
        const bloquesAdminQuery = await pool.query(`
            SELECT COUNT(DISTINCT b.id) as count
            FROM blocks b
            JOIN user_roles ur ON b.user_role_id = ur.id
            JOIN users u ON ur.user_id = u.id
            LEFT JOIN admin_assignments aa ON u.id = aa.assigned_user_id
            WHERE aa.admin_id = $1
        `, [currentAdminId]);

        const preguntasAdminQuery = await pool.query(`
            SELECT COALESCE(SUM(ba.total_questions), 0) as count
            FROM block_answers ba
            JOIN blocks b ON ba.block_id = b.id
            JOIN user_roles ur ON b.user_role_id = ur.id
            JOIN users u ON ur.user_id = u.id
            LEFT JOIN admin_assignments aa ON u.id = aa.assigned_user_id
            WHERE aa.admin_id = $1
        `, [currentAdminId]);

        const bloques_count = parseInt(bloquesAdminQuery.rows[0]?.count) || 0;
        const preguntas_count = parseInt(preguntasAdminQuery.rows[0]?.count) || 0;

        // Obtener profesores asignados con estadísticas detalladas
        const profesoresAsignadosQuery = await pool.query(`
            SELECT 
                u.id as user_id,
                u.nickname,
                u.first_name,
                u.email,
                ur.id as user_role_id,
                COUNT(DISTINCT b.id) as bloques_creados,
                COUNT(DISTINCT ulb.user_id) as estudiantes,
                COALESCE(SUM(ba.total_questions), 0) as total_preguntas,
                COALESCE(u_admin.nickname, 'Administrador Principal') as assigned_admin_nickname
            FROM users u
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN roles r ON ur.role_id = r.id
            LEFT JOIN admin_assignments aa ON u.id = aa.assigned_user_id
            LEFT JOIN users u_admin ON aa.admin_id = u_admin.id
            LEFT JOIN blocks b ON ur.id = b.user_role_id 
            LEFT JOIN user_roles ur_block ON b.user_role_id = ur_block.id
            LEFT JOIN roles r_block ON ur_block.role_id = r_block.id AND r_block.name = 'profesor'
            LEFT JOIN block_answers ba ON b.id = ba.block_id AND r_block.id IS NOT NULL
            LEFT JOIN topic_answers ta ON b.id = ta.block_id AND r_block.id IS NOT NULL
            LEFT JOIN user_loaded_blocks ulb ON b.id = ulb.block_id AND r_block.id IS NOT NULL
            WHERE r.name = 'profesor' AND aa.admin_id = $1
            GROUP BY u.id, u.nickname, u.first_name, u.email, ur.id, u_admin.nickname
            ORDER BY u.nickname
        `, [currentAdminId]);

        // Obtener creadores asignados con estadísticas detalladas
        const creadoresAsignadosQuery = await pool.query(`
            SELECT 
                u.id as user_id,
                u.nickname,
                u.first_name,
                u.email,
                ur.id as user_role_id,
                COUNT(DISTINCT b.id) as bloques_creados,
                COALESCE(SUM(ba.total_questions), 0) as total_preguntas,
                COUNT(DISTINCT ta.id) as total_temas,
                COUNT(DISTINCT ulb.user_id) as total_usuarios,
                COALESCE(u_admin.nickname, 'Administrador Principal') as assigned_admin_nickname
            FROM users u
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN roles r ON ur.role_id = r.id
            LEFT JOIN admin_assignments aa ON u.id = aa.assigned_user_id
            LEFT JOIN users u_admin ON aa.admin_id = u_admin.id
            LEFT JOIN blocks b ON ur.id = b.user_role_id 
            LEFT JOIN user_roles ur_block ON b.user_role_id = ur_block.id
            LEFT JOIN roles r_block ON ur_block.role_id = r_block.id AND r_block.name = 'creador'
            LEFT JOIN block_answers ba ON b.id = ba.block_id AND r_block.id IS NOT NULL
            LEFT JOIN topic_answers ta ON b.id = ta.block_id AND r_block.id IS NOT NULL
            LEFT JOIN user_loaded_blocks ulb ON b.id = ulb.block_id AND r_block.id IS NOT NULL
            WHERE r.name = 'creador' AND aa.admin_id = $1
            GROUP BY u.id, u.nickname, u.first_name, u.email, ur.id, u_admin.nickname
            ORDER BY u.nickname
        `, [currentAdminId]);

        console.log('📊 PAS Data Summary for Admin', currentAdminId, ':', {
            profesores: profesoresAsignadosQuery.rows.length,
            creadores: creadoresAsignadosQuery.rows.length,
            jugadores: jugadoresAsignadosQuery.rows.length
        });

        res.json({
            // Datos específicos para PAS con estadísticas detalladas
            profesores: profesoresAsignadosQuery.rows,
            creadores: creadoresAsignadosQuery.rows,
            jugadores: jugadoresAsignadosQuery.rows,
            usuarios: [], // PAS no maneja usuarios genéricos
            availableAdmins: adminUsers.rows,
            admin_secundario_version: true,
            statistics: {
                profesores: profesores_count,
                creadores: creadores_count,
                jugadores: jugadores_count,
                usuarios: usuarios_count,
                bloques: bloques_count,
                preguntas: preguntas_count
            }
        });

    } catch (error) {
        console.error('Error in admin secundario panel:', error);
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
            const deletedQuestions = await pool.query('DELETE FROM questions WHERE user_id = $1', [userId]);
            if (deletedQuestions.rowCount > 0) {
                deletedData.push(`${deletedQuestions.rowCount} preguntas creadas`);
            }
        } catch (e) { /* Tabla no existe */ }
        
        // 4. Borrar bloques creados por el usuario
        try {
            const deletedBlocks = await pool.query('DELETE FROM blocks WHERE user_id = $1', [userId]);
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

// Remover rol específico de usuario
router.post('/remove-role', authenticateToken, async (req, res) => {
    try {
        const { userId, roleToRemove } = req.body;
        console.log(`🔧 REQUEST: remove-role - userId: ${userId}, roleToRemove: ${roleToRemove}`);
        
        if (!userId || !roleToRemove) {
            console.log(`❌ VALIDATION: Missing userId or roleToRemove`);
            return res.status(400).json({ error: 'userId y roleToRemove son requeridos' });
        }
        
        // Verificar que el usuario existe
        const userCheck = await pool.query('SELECT id, nickname, email FROM users WHERE id = $1', [userId]);
        
        if (userCheck.rows.length === 0) {
            console.log(`❌ USER NOT FOUND: ${userId}`);
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        const user = userCheck.rows[0];
        console.log(`🔍 USER FOUND: ${user.nickname} (${user.id})`);
        
        // Buscar el rol que se quiere remover
        const roleResult = await pool.query('SELECT id FROM roles WHERE name = $1', [roleToRemove]);
        
        if (roleResult.rows.length === 0) {
            console.log(`❌ ROLE NOT FOUND: ${roleToRemove}`);
            return res.status(404).json({ error: `Rol '${roleToRemove}' no encontrado` });
        }
        
        const roleId = roleResult.rows[0].id;
        
        // Verificar que el usuario tiene ese rol
        const userRoleCheck = await pool.query(`
            SELECT id FROM user_roles 
            WHERE user_id = $1 AND role_id = $2
        `, [user.id, roleId]);
        
        if (userRoleCheck.rows.length === 0) {
            console.log(`❌ USER ROLE NOT FOUND: User ${user.id} doesn't have role ${roleToRemove}`);
            return res.status(404).json({ 
                error: `El usuario ${user.nickname} no tiene el rol '${roleToRemove}'` 
            });
        }
        
        // Remover el rol del usuario
        await pool.query(`
            DELETE FROM user_roles 
            WHERE user_id = $1 AND role_id = $2
        `, [user.id, roleId]);
        
        console.log(`✅ SUCCESS: Removed role '${roleToRemove}' from user ${user.id} (${user.nickname})`);
        
        res.json({
            success: true,
            message: `Rol '${roleToRemove}' removido del usuario ${user.nickname}`,
            user: {
                id: user.id,
                nickname: user.nickname,
                email: user.email,
                removedRole: roleToRemove
            }
        });
        
    } catch (error) {
        console.error('Error removing role:', error);
        res.status(500).json({ 
            error: 'Error removiendo rol',
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

// Endpoint para obtener bloques de un administrado
router.get('/administrados/:userId/bloques', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.params;
        const { rol } = req.query; // 'profesor' | 'creador'
        
        console.log(`📚 Obteniendo bloques de administrado ${userId} con rol ${rol}`);
        
        // Determinar role_id basado en el parámetro rol
        let targetRoleId;
        if (rol === 'profesor') {
            targetRoleId = 3; // profesor
        } else if (rol === 'creador') {
            targetRoleId = 4; // creador
        } else {
            return res.status(400).json({ error: 'Rol inválido. Use profesor o creador.' });
        }
        
        console.log(`🔍 BLOQUES DEBUG - Usuario: ${userId}, Rol: ${rol}, targetRoleId: ${targetRoleId}`);
        
        // Bloques filtrados de tabla blocks creados por el usuario con el rol correspondiente
        const blocksQuery = await pool.query(`
            SELECT DISTINCT
                b.id,
                b.name,
                b.created_at,
                (SELECT COUNT(DISTINCT ta.topic) 
                 FROM topic_answers ta 
                 WHERE ta.block_id = b.id 
                 AND ta.topic IS NOT NULL AND ta.topic != '') as total_topics,
                (SELECT COALESCE(ba.total_questions, 0) 
                 FROM block_answers ba 
                 WHERE ba.block_id = b.id) as total_questions,
                (SELECT COUNT(DISTINCT ulb.user_id) 
                 FROM user_loaded_blocks ulb 
                 WHERE ulb.block_id = b.id) as total_users
            FROM blocks b
            JOIN user_roles ur ON b.user_role_id = ur.id
            WHERE ur.user_id = $1 AND ur.role_id = $2
            ORDER BY b.created_at DESC
        `, [userId, targetRoleId]);
        
        const bloques = blocksQuery.rows;
        
        console.log(`📚 Encontrados ${bloques.length} bloques para ${rol} ${userId}`);
        
        res.json({
            bloques: bloques,
            total: bloques.length,
            user_id: userId,
            rol: rol
        });
        
    } catch (error) {
        console.error('Error obteniendo bloques de administrado:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor', 
            details: error.message,
            bloques: []
        });
    }
});

// Endpoint para obtener preguntas de un tema específico
router.get('/bloques/:blockId/temas/:topic/preguntas', authenticateToken, async (req, res) => {
    try {
        const { blockId, topic } = req.params;
        
        console.log(`❓ Obteniendo preguntas del tema "${topic}" del bloque ${blockId} desde tabla questions`);
        
        // DEBUG: Verificar parámetros
        console.log(`🔍 PREGUNTAS DEBUG - blockId: ${blockId} (type: ${typeof blockId}), topic: "${topic}" (type: ${typeof topic})`);
        
        // Las preguntas son los registros text_questions que se obtienen filtrando questions con block_id y topic
        const preguntasQuery = await pool.query(`
            SELECT 
                q.id,
                q.text_question as question,
                q.block_id,
                q.topic
            FROM questions q
            WHERE q.block_id = $1 AND q.topic = $2
            ORDER BY q.id
        `, [blockId, topic]);
        
        // DEBUG: Log del resultado de la query
        console.log(`🔍 PREGUNTAS QUERY RESULT - rows: ${preguntasQuery.rows.length}, rowCount: ${preguntasQuery.rowCount}`);
        if (preguntasQuery.rows.length > 0) {
            console.log(`🔍 PREGUNTAS SAMPLE:`, preguntasQuery.rows[0]);
        } else {
            // Verificar si existen preguntas para este bloque en general
            const allBlockQuestions = await pool.query(`
                SELECT COUNT(*) as total, array_agg(DISTINCT topic) as topics  
                FROM questions 
                WHERE block_id = $1
            `, [blockId]);
            console.log(`🔍 PREGUNTAS BLOCK VERIFICATION - Total questions in block ${blockId}:`, allBlockQuestions.rows[0]);
        }
        
        const preguntas = preguntasQuery.rows;
        
        console.log(`❓ Encontradas ${preguntas.length} preguntas reales para tema "${topic}" en bloque ${blockId}`);
        
        res.json({
            success: true,
            questions: preguntas,
            preguntas: preguntas, // Alias para compatibilidad
            total: preguntas.length,
            block_id: parseInt(blockId),
            topic: topic
        });
        
    } catch (error) {
        console.error('Error obteniendo preguntas del tema desde tabla questions:', error);
        res.status(500).json({ 
            success: false,
            error: 'Error obteniendo preguntas del tema', 
            details: error.message,
            questions: [],
            preguntas: []
        });
    }
});

// Endpoints para el editor de bloques (bloques-creados-component.js)

// Obtener datos completos de un bloque
router.get('/blocks/:blockId/complete-data', authenticateToken, async (req, res) => {
    try {
        const { blockId } = req.params;
        
        console.log(`📦 Obteniendo datos completos del bloque ${blockId}`);
        
        // Obtener información básica del bloque
        const blockQuery = await pool.query(`
            SELECT 
                b.id,
                b.name,
                b.description,
                b.created_at,
                b.updated_at,
                b.user_role_id,
                u.nickname as creator_nickname,
                r.name as creator_role
            FROM blocks b
            LEFT JOIN user_roles ur ON b.user_role_id = ur.id
            LEFT JOIN users u ON ur.user_id = u.id
            LEFT JOIN roles r ON ur.role_id = r.id
            WHERE b.id = $1
        `, [blockId]);
        
        if (blockQuery.rows.length === 0) {
            return res.status(404).json({ error: 'Bloque no encontrado' });
        }
        
        const block = blockQuery.rows[0];
        
        // Contar temas únicos
        const topicsQuery = await pool.query(`
            SELECT COUNT(DISTINCT topic) as total_topics
            FROM topic_answers
            WHERE block_id = $1 AND topic IS NOT NULL AND topic != ''
        `, [blockId]);
        
        // Contar preguntas totales
        const questionsQuery = await pool.query(`
            SELECT COUNT(*) as total_questions
            FROM questions
            WHERE block_id = $1
        `, [blockId]);
        
        // Contar usuarios que han cargado el bloque
        const usersQuery = await pool.query(`
            SELECT COUNT(DISTINCT user_id) as total_users
            FROM user_loaded_blocks
            WHERE block_id = $1
        `, [blockId]);
        
        const completeData = {
            ...block,
            statistics: {
                total_topics: parseInt(topicsQuery.rows[0].total_topics) || 0,
                total_questions: parseInt(questionsQuery.rows[0].total_questions) || 0,
                total_users: parseInt(usersQuery.rows[0].total_users) || 0
            }
        };
        
        console.log(`📦 Datos completos del bloque ${blockId}:`, completeData.statistics);
        
        res.json(completeData);
        
    } catch (error) {
        console.error('Error obteniendo datos completos del bloque:', error);
        res.status(500).json({ 
            error: 'Error obteniendo datos del bloque', 
            details: error.message 
        });
    }
});

// Obtener todas las preguntas de un bloque
router.get('/blocks/:blockId/questions', authenticateToken, async (req, res) => {
    try {
        const { blockId } = req.params;
        const { limit } = req.query;
        
        console.log(`❓ Obteniendo preguntas del bloque ${blockId}${limit ? ` (limit: ${limit})` : ''}`);
        
        // Query base para obtener preguntas
        let questionsQuery = `
            SELECT 
                q.id,
                q.text_question as question,
                q.block_id,
                q.topic,
                q.created_at
            FROM questions q
            WHERE q.block_id = $1
            ORDER BY q.topic, q.id
        `;
        
        const params = [blockId];
        
        // Añadir LIMIT si se especifica
        if (limit && !isNaN(limit)) {
            questionsQuery += ` LIMIT $2`;
            params.push(parseInt(limit));
        }
        
        const result = await pool.query(questionsQuery, params);
        const questions = result.rows;
        
        console.log(`❓ Encontradas ${questions.length} preguntas para bloque ${blockId}`);
        
        res.json(questions);
        
    } catch (error) {
        console.error('Error obteniendo preguntas del bloque:', error);
        res.status(500).json({ 
            error: 'Error obteniendo preguntas del bloque', 
            details: error.message 
        });
    }
});

// Obtener bloques de un profesor/creador
router.get('/profesores/:profesorId/bloques', authenticateToken, async (req, res) => {
    try {
        const { profesorId } = req.params;
        console.log(`👨‍🏫 PROFESOR ENDPOINT - Request to get blocks for profesor ${profesorId}`);
        
        // Verificar que el profesor existe
        const profesorCheck = await pool.query('SELECT id, nickname FROM users WHERE id = $1', [profesorId]);
        if (profesorCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Profesor no encontrado' });
        }
        
        // Obtener bloques del profesor creados específicamente con rol de profesor
        const bloques = await pool.query(`
            SELECT 
                b.id, 
                b.name,
                b.description,
                b.observaciones,
                b.is_public,
                b.created_at,
                b.image_url,
                COALESCE(COUNT(DISTINCT ta.id), 0) as total_preguntas,
                COALESCE(COUNT(DISTINCT ta.topic), 0) as num_temas
            FROM blocks b 
            JOIN user_roles ur ON b.user_role_id = ur.id
            JOIN roles r ON ur.role_id = r.id
            LEFT JOIN topic_answers ta ON b.id = ta.block_id
            WHERE ur.user_id = $1 AND r.name = 'profesor'
            GROUP BY b.id, b.name, b.description, b.observaciones, b.is_public, b.created_at, b.image_url
            ORDER BY b.created_at DESC
        `, [profesorId]);
        
        // Agregar estadísticas de usuarios para cada bloque
        const bloquesConStats = await Promise.all(bloques.rows.map(async (bloque) => {
            try {
                // Contar usuarios que han cargado este bloque usando user_loaded_blocks
                const usuariosBloque = await pool.query(`
                    SELECT COUNT(DISTINCT ulb.user_id) as usuarios_bloque
                    FROM user_loaded_blocks ulb 
                    WHERE ulb.block_id = $1
                `, [bloque.id]);
                
                const usuariosCount = parseInt(usuariosBloque.rows[0].usuarios_bloque) || 0;
                return {
                    ...bloque,
                    num_temas: parseInt(bloque.num_temas) || 0,
                    total_preguntas: parseInt(bloque.total_preguntas) || 0,
                    usuarios_bloque: usuariosCount,
                    total_usuarios: usuariosCount,
                    total_users: usuariosCount,
                    usuarios: usuariosCount,
                    users: usuariosCount
                };
            } catch (e) {
                return {
                    ...bloque,
                    num_temas: parseInt(bloque.num_temas) || 0,
                    total_preguntas: parseInt(bloque.total_preguntas) || 0,
                    usuarios_bloque: 0,
                    total_usuarios: 0,
                    total_users: 0,
                    usuarios: 0,
                    users: 0
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

// Obtener bloques de un creador
router.get('/creadores/:creadorId/bloques', authenticateToken, async (req, res) => {
    try {
        const { creadorId } = req.params;
        console.log(`🎨 CREADOR ENDPOINT - Request to get blocks for creador ${creadorId}`);
        
        // Verificar que el creador existe
        const creadorCheck = await pool.query('SELECT id, nickname FROM users WHERE id = $1', [creadorId]);
        if (creadorCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Creador no encontrado' });
        }
        
        // Obtener bloques del creador creados específicamente con rol de creador
        const bloques = await pool.query(`
            SELECT 
                b.id, 
                b.name,
                b.description,
                b.observaciones,
                b.is_public,
                b.created_at,
                b.image_url,
                b.user_role_id,
                r.name as created_with_role,
                COALESCE(COUNT(DISTINCT ta.id), 0) as total_preguntas,
                COALESCE(COUNT(DISTINCT ta.topic), 0) as num_temas
            FROM blocks b 
            JOIN user_roles ur ON b.user_role_id = ur.id
            JOIN roles r ON ur.role_id = r.id
            LEFT JOIN topic_answers ta ON b.id = ta.block_id
            WHERE ur.user_id = $1 AND r.name = 'creador'
            GROUP BY b.id, b.name, b.description, b.observaciones, b.is_public, b.created_at, b.image_url, b.user_role_id, r.name
            ORDER BY b.created_at DESC
        `, [creadorId]);
        
        console.log(`Found ${bloques.rows.length} blocks for creador ${creadorId}`);
        
        // Agregar estadísticas de usuarios para cada bloque
        const bloquesConStats = await Promise.all(bloques.rows.map(async (bloque) => {
            try {
                // Contar usuarios que han cargado este bloque usando user_loaded_blocks
                const usuariosBloque = await pool.query(`
                    SELECT COUNT(DISTINCT ulb.user_id) as usuarios_bloque
                    FROM user_loaded_blocks ulb 
                    WHERE ulb.block_id = $1
                `, [bloque.id]);
                
                const usuariosCount = parseInt(usuariosBloque.rows[0].usuarios_bloque) || 0;
                return {
                    ...bloque,
                    num_temas: parseInt(bloque.num_temas) || 0,
                    total_preguntas: parseInt(bloque.total_preguntas) || 0,
                    usuarios_bloque: usuariosCount,
                    total_usuarios: usuariosCount,
                    total_users: usuariosCount,
                    usuarios: usuariosCount,
                    users: usuariosCount
                };
            } catch (e) {
                return {
                    ...bloque,
                    num_temas: parseInt(bloque.num_temas) || 0,
                    total_preguntas: parseInt(bloque.total_preguntas) || 0,
                    usuarios_bloque: 0,
                    total_usuarios: 0,
                    total_users: 0,
                    usuarios: 0,
                    users: 0
                };
            }
        }));
        
        res.json({
            success: true,
            creadorInfo: {
                id: creadorCheck.rows[0].id,
                nickname: creadorCheck.rows[0].nickname
            },
            bloques: bloquesConStats
        });
        
    } catch (error) {
        console.error('Error getting creador blocks:', error);
        res.status(500).json({ 
            error: 'Error obteniendo bloques del creador',
            details: error.message 
        });
    }
});

// Endpoint alternativo para obtener bloques por parámetro de consulta
router.get('/bloques', authenticateToken, async (req, res) => {
    try {
        const { user_id } = req.query;
        
        if (!user_id) {
            return res.status(400).json({ error: 'user_id parameter is required' });
        }
        
        console.log(`Request to get blocks for user via query param ${user_id}`);
        
        // Verificar que el usuario existe
        const creadorCheck = await pool.query('SELECT id, nickname FROM users WHERE id = $1', [user_id]);
        if (creadorCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Creador no encontrado' });
        }
        
        // Obtener bloques del creador
        const bloques = await pool.query(`
            SELECT 
                b.id, 
                b.name,
                b.description,
                b.observaciones,
                b.is_public,
                b.created_at,
                b.image_url,
                b.user_role_id,
                r.name as created_with_role,
                COALESCE(ba.total_questions, 0) as total_preguntas,
                COALESCE(ba.total_topics, 0) as num_temas
            FROM blocks b 
            JOIN user_roles ur ON b.user_role_id = ur.id
            LEFT JOIN roles r ON ur.role_id = r.id
            LEFT JOIN block_answers ba ON b.id = ba.block_id
            WHERE ur.user_id = $1
            ORDER BY b.created_at DESC
        `, [user_id]);
        
        console.log(`Found ${bloques.rows.length} blocks for user ${user_id} via query param`);
        
        // Agregar estadísticas de usuarios para cada bloque
        const bloquesConStats = await Promise.all(bloques.rows.map(async (bloque) => {
            try {
                // Contar usuarios que han cargado este bloque usando user_loaded_blocks
                const usuariosBloque = await pool.query(`
                    SELECT COUNT(DISTINCT ulb.user_id) as usuarios_bloque
                    FROM user_loaded_blocks ulb 
                    WHERE ulb.block_id = $1
                `, [bloque.id]);
                
                const usuariosCount = parseInt(usuariosBloque.rows[0].usuarios_bloque) || 0;
                return {
                    ...bloque,
                    num_temas: parseInt(bloque.num_temas) || 0,
                    total_preguntas: parseInt(bloque.total_preguntas) || 0,
                    usuarios_bloque: usuariosCount,
                    total_usuarios: usuariosCount,
                    total_users: usuariosCount,
                    usuarios: usuariosCount,
                    users: usuariosCount
                };
            } catch (e) {
                return {
                    ...bloque,
                    num_temas: parseInt(bloque.num_temas) || 0,
                    total_preguntas: parseInt(bloque.total_preguntas) || 0,
                    usuarios_bloque: 0,
                    total_usuarios: 0,
                    total_users: 0,
                    usuarios: 0,
                    users: 0
                };
            }
        }));
        
        res.json({
            success: true,
            creadorInfo: {
                id: creadorCheck.rows[0].id,
                nickname: creadorCheck.rows[0].nickname
            },
            bloques: bloquesConStats
        });
        
    } catch (error) {
        console.error('Error getting creador blocks via query param:', error);
        res.status(500).json({ 
            error: 'Error obteniendo bloques del creador',
            details: error.message 
        });
    }
});

// Obtener temas de un bloque
router.get('/bloques/:blockId/temas', authenticateToken, async (req, res) => {
    try {
        const { blockId } = req.params;
        console.log(`📝 Obteniendo temas del bloque ${blockId} desde topic_answers`);
        
        // Temas son los registros topic que se obtienen filtrando topic_answers con block_id
        const temasResult = await pool.query(`
            SELECT DISTINCT
                ta.topic,
                ta.total_questions
            FROM topic_answers ta
            WHERE ta.block_id = $1
            AND ta.topic IS NOT NULL 
            AND ta.topic != ''
            ORDER BY ta.topic
        `, [blockId]);
        
        console.log(`📝 Encontrados ${temasResult.rows.length} temas para bloque ${blockId}`);
        
        res.json({
            success: true,
            topics: temasResult.rows,
            temas: temasResult.rows, // Alias para compatibilidad
            total: temasResult.rows.length,
            block_id: parseInt(blockId)
        });
        
    } catch (error) {
        console.error('Error obteniendo temas del bloque:', error);
        res.status(500).json({ 
            error: 'Error obteniendo temas del bloque',
            details: error.message,
            topics: [],
            temas: [] 
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
            topic: decodeURIComponent(topicName)
        });
        
    } catch (error) {
        console.error('Error getting topic questions:', error);
        res.status(500).json({ 
            error: 'Error obteniendo preguntas del tema',
            details: error.message 
        });
    }
});

// Endpoint para actualizar asignaciones de administrador en admin_assignments
router.put('/admin-assignments/update', authenticateToken, async (req, res) => {
    try {
        const { assigned_user_id, admin_id } = req.body;
        
        console.log(`🔄 Updating admin assignment: user ${assigned_user_id} -> admin ${admin_id}`);
        
        if (!assigned_user_id) {
            return res.status(400).json({ 
                success: false, 
                message: 'assigned_user_id es requerido' 
            });
        }
        
        // Verificar si la tabla admin_assignments existe y crear si es necesario
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS admin_assignments (
                    id SERIAL PRIMARY KEY,
                    admin_id INTEGER REFERENCES users(id),
                    assigned_user_id INTEGER REFERENCES users(id),
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(assigned_user_id)
                )
            `);
        } catch (tableError) {
            console.warn('⚠️ Could not create admin_assignments table:', tableError.message);
        }

        // Verificar si ya existe una asignación para este usuario
        const existingQuery = await pool.query(
            'SELECT id FROM admin_assignments WHERE assigned_user_id = $1',
            [assigned_user_id]
        );
        
        if (existingQuery.rows.length > 0) {
            // Actualizar asignación existente
            if (admin_id === null || admin_id === undefined) {
                // Remover asignación
                await pool.query(
                    'DELETE FROM admin_assignments WHERE assigned_user_id = $1',
                    [assigned_user_id]
                );
                console.log(`✅ Asignación removida para usuario ${assigned_user_id}`);
            } else {
                // Actualizar con nuevo admin
                await pool.query(
                    'UPDATE admin_assignments SET admin_id = $1, updated_at = NOW() WHERE assigned_user_id = $2',
                    [admin_id, assigned_user_id]
                );
                console.log(`✅ Asignación actualizada: usuario ${assigned_user_id} -> admin ${admin_id}`);
            }
        } else if (admin_id !== null && admin_id !== undefined) {
            // Crear nueva asignación
            await pool.query(
                'INSERT INTO admin_assignments (admin_id, assigned_user_id, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())',
                [admin_id, assigned_user_id]
            );
            console.log(`✅ Nueva asignación creada: usuario ${assigned_user_id} -> admin ${admin_id}`);
        }
        
        res.json({ 
            success: true, 
            message: 'Asignación actualizada exitosamente',
            assigned_user_id,
            admin_id 
        });
        
    } catch (error) {
        console.error('❌ Error updating admin assignment:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor',
            details: error.message 
        });
    }
});

module.exports = router;