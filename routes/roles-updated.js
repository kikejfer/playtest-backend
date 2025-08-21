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
            INNER JOIN blocks b ON u.id = b.user_id
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
                SELECT aa.admin_id, COUNT(DISTINCT b.id) as block_count, COALESCE(SUM(q_count.question_count), 0) as question_count
                FROM admin_assignments aa
                JOIN blocks b ON aa.assigned_user_id = b.user_id
                LEFT JOIN (
                    SELECT block_id, COUNT(*) as question_count 
                    FROM questions 
                    GROUP BY block_id
                ) q_count ON b.id = q_count.block_id
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
            WHERE r.name IN ('profesor', 'creador', 'administrador_principal', 'administrador_secundario', 'jugador') 
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

        // Funciones para calcular estadísticas por rol específico
        async function calculateStatsForRole(userId, roleName) {
            try {
                // 1. Contar bloques creados con rol específico
                const blocksQuery = await pool.query(`
                    SELECT COUNT(DISTINCT b.id) as blocks_count
                    FROM blocks b
                    JOIN user_roles ur ON b.user_role_id = ur.id
                    JOIN roles r ON ur.role_id = r.id
                    WHERE b.user_id = $1 AND r.name = $2
                `, [userId, roleName]);
                
                const blocksCount = parseInt(blocksQuery.rows[0].blocks_count) || 0;
                
                if (blocksCount === 0) {
                    return {
                        blocks_created: 0,
                        total_questions: 0,
                        total_topics: 0,
                        total_users: 0
                    };
                }
                
                // 2. Contar preguntas usando block_answers.total_questions
                const questionsQuery = await pool.query(`
                    SELECT COALESCE(SUM(ba.total_questions), 0) as total_questions
                    FROM blocks b
                    JOIN user_roles ur ON b.user_role_id = ur.id
                    JOIN roles r ON ur.role_id = r.id
                    LEFT JOIN block_answers ba ON b.id = ba.block_id
                    WHERE b.user_id = $1 AND r.name = $2
                `, [userId, roleName]);
                
                const totalQuestions = parseInt(questionsQuery.rows[0].total_questions) || 0;
                
                // 3. Contar temas únicos
                const topicsQuery = await pool.query(`
                    SELECT COUNT(DISTINCT ta.topic) as total_topics
                    FROM blocks b
                    JOIN user_roles ur ON b.user_role_id = ur.id
                    JOIN roles r ON ur.role_id = r.id
                    LEFT JOIN topic_answers ta ON b.id = ta.block_id
                    WHERE b.user_id = $1 AND r.name = $2
                `, [userId, roleName]);
                
                const totalTopics = parseInt(topicsQuery.rows[0].total_topics) || 0;
                
                // 4. Contar usuarios que han cargado bloques de este rol
                const usersQuery = await pool.query(`
                    SELECT COUNT(DISTINCT ulb.user_id) as total_users
                    FROM blocks b
                    JOIN user_roles ur ON b.user_role_id = ur.id
                    JOIN roles r ON ur.role_id = r.id
                    LEFT JOIN user_loaded_blocks ulb ON b.id = ulb.block_id
                    WHERE b.user_id = $1 AND r.name = $2
                `, [userId, roleName]);
                
                const totalUsers = parseInt(usersQuery.rows[0].total_users) || 0;
                
                return {
                    blocks_created: blocksCount,
                    total_questions: totalQuestions,
                    total_topics: totalTopics,
                    total_users: totalUsers
                };
                
            } catch (e) {
                console.warn(`Error calculating stats for user ${userId} role ${roleName}:`, e.message);
                return {
                    blocks_created: 0,
                    total_questions: 0,
                    total_topics: 0,
                    total_users: 0
                };
            }
        }
        
        // Crear listas separadas por rol (usuarios pueden aparecer en múltiples listas)
        const profesores = [];
        const creadores = [];
        const jugadores = [];
        
        // Procesar TODOS los usuarios con roles según TODOS sus roles
        for (const user of usersWithRoles) {
            if (adminIds.has(user.id)) continue; // Excluir administradores
            
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
                console.log(`👤 User ${user.nickname} (ID: ${user.id}) has roles:`, userRoles);
                
                // Agregar a las listas correspondientes según roles con estadísticas correctas
                if (userRoles.includes('profesor')) {
                    const profesorStats = await calculateStatsForRole(user.id, 'profesor');
                    profesores.push({ 
                        ...baseUserData, 
                        role_name: 'profesor',
                        blocks_created: profesorStats.blocks_created,
                        total_questions: profesorStats.total_questions,
                        total_topics: profesorStats.total_topics,
                        estudiantes: profesorStats.total_users
                    });
                }
                
                if (userRoles.includes('creador')) {
                    const creadorStats = await calculateStatsForRole(user.id, 'creador');
                    creadores.push({ 
                        ...baseUserData, 
                        role_name: 'creador',
                        blocks_created: creadorStats.blocks_created,
                        total_questions: creadorStats.total_questions,
                        total_topics: creadorStats.total_topics,
                        usuarios: creadorStats.total_users
                    });
                }
                
                if (userRoles.includes('jugador') || userRoles.some(role => role.includes('jugador'))) {
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

        // Separar jugadores en dos paneles: AdminPrincipal (sin asignar) vs resto de administradores (asignados)
        const jugadoresAdminPrincipal = jugadores.filter(jugador => 
            jugador.assigned_admin_id === null || jugador.assigned_admin_id === 0
        );
        const jugadoresOtrosAdmins = jugadores.filter(jugador => 
            jugador.assigned_admin_id !== null && jugador.assigned_admin_id !== 0
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
            usuarios: usuarios,
            availableAdmins: allUsers.rows,
            ultra_simple_version: true,
            // Estadísticas corregidas para el frontend
            statistics: {
                admins: admins,
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
        
        // Reutilizar función de cálculos de estadísticas
        async function calculateStatsForRole(userId, roleName) {
            try {
                const blocksQuery = await pool.query(`
                    SELECT COUNT(DISTINCT b.id) as blocks_count
                    FROM blocks b
                    JOIN user_roles ur ON b.user_role_id = ur.id
                    JOIN roles r ON ur.role_id = r.id
                    WHERE b.user_id = $1 AND r.name = $2
                `, [userId, roleName]);
                
                const blocksCount = parseInt(blocksQuery.rows[0].blocks_count) || 0;
                
                if (blocksCount === 0) {
                    return { blocks_created: 0, total_questions: 0, total_topics: 0, total_users: 0 };
                }
                
                const questionsQuery = await pool.query(`
                    SELECT COALESCE(SUM(ba.total_questions), 0) as total_questions
                    FROM blocks b
                    JOIN user_roles ur ON b.user_role_id = ur.id
                    JOIN roles r ON ur.role_id = r.id
                    LEFT JOIN block_answers ba ON b.id = ba.block_id
                    WHERE b.user_id = $1 AND r.name = $2
                `, [userId, roleName]);
                
                const totalQuestions = parseInt(questionsQuery.rows[0].total_questions) || 0;
                
                const topicsQuery = await pool.query(`
                    SELECT COUNT(DISTINCT ta.topic) as total_topics
                    FROM blocks b
                    JOIN user_roles ur ON b.user_role_id = ur.id
                    JOIN roles r ON ur.role_id = r.id
                    LEFT JOIN topic_answers ta ON b.id = ta.block_id
                    WHERE b.user_id = $1 AND r.name = $2
                `, [userId, roleName]);
                
                const totalTopics = parseInt(topicsQuery.rows[0].total_topics) || 0;
                
                const usersQuery = await pool.query(`
                    SELECT COUNT(DISTINCT ulb.user_id) as total_users
                    FROM blocks b
                    JOIN user_roles ur ON b.user_role_id = ur.id
                    JOIN roles r ON ur.role_id = r.id
                    LEFT JOIN user_loaded_blocks ulb ON b.id = ulb.block_id
                    WHERE b.user_id = $1 AND r.name = $2
                `, [userId, roleName]);
                
                const totalUsers = parseInt(usersQuery.rows[0].total_users) || 0;
                
                return {
                    blocks_created: blocksCount,
                    total_questions: totalQuestions,
                    total_topics: totalTopics,
                    total_users: totalUsers
                };
                
            } catch (e) {
                return { blocks_created: 0, total_questions: 0, total_topics: 0, total_users: 0 };
            }
        }
        
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
                    const profesorStats = await calculateStatsForRole(user.id, 'profesor');
                    profesores.push({ 
                        ...baseUserData, 
                        role_name: 'profesor',
                        blocks_created: profesorStats.blocks_created,
                        total_questions: profesorStats.total_questions,
                        total_topics: profesorStats.total_topics,
                        estudiantes: profesorStats.total_users
                    });
                }
                
                if (userRoles.includes('creador')) {
                    const creadorStats = await calculateStatsForRole(user.id, 'creador');
                    creadores.push({ 
                        ...baseUserData, 
                        role_name: 'creador',
                        blocks_created: creadorStats.blocks_created,
                        total_questions: creadorStats.total_questions,
                        total_topics: creadorStats.total_topics,
                        usuarios: creadorStats.total_users
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
            LEFT JOIN block_answers ba ON b.id = ba.block_id
            LEFT JOIN user_loaded_blocks ulb ON b.id = ulb.block_id
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
            LEFT JOIN block_answers ba ON b.id = ba.block_id
            LEFT JOIN topic_answers ta ON b.id = ta.block_id
            LEFT JOIN user_loaded_blocks ulb ON b.id = ulb.block_id
            WHERE r.name = 'creador' AND aa.admin_id = $1
            GROUP BY u.id, u.nickname, u.first_name, u.email, ur.id, u_admin.nickname
            ORDER BY u.nickname
        `, [currentAdminId]);

        res.json({
            // Datos específicos para PAS con estadísticas detalladas
            profesores: profesoresAsignadosQuery.rows,
            creadores: creadoresAsignadosQuery.rows,
            jugadores,
            usuarios,
            availableAdmins: allUsers.rows,
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
            WHERE b.user_id = $1 AND r.name = 'profesor'
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
            WHERE b.user_id = $1 AND r.name = 'creador'
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
            LEFT JOIN roles r ON b.user_role_id = r.id
            LEFT JOIN block_answers ba ON b.id = ba.block_id
            WHERE b.user_id = $1
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
        console.log(`Request to get topics for block ${blockId}`);
        
        // Obtener temas usando la tabla optimizada topic_answers
        const temasResult = await pool.query(`
            SELECT 
                ta.topic,
                ta.question_count as num_preguntas
            FROM topic_answers ta
            WHERE ta.block_id = $1
            ORDER BY ta.topic
        `, [blockId]);
        
        res.json({
            success: true,
            temas: temasResult.rows,
            block_id: parseInt(blockId)
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

module.exports = router;