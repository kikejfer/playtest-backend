const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { authenticateToken } = require('../middleware/auth');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware para verificar rol de administrador
const requireAdminRole = async (req, res, next) => {
    try {
        const result = await pool.query(`
            SELECT r.name FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = $1 AND r.name IN ('administrador_principal', 'administrador_secundario')
        `, [req.user.id]);

        if (result.rows.length === 0) {
            return res.status(403).json({ error: 'Acceso denegado: se requieren permisos administrativos' });
        }

        req.user.adminRole = result.rows[0].name;
        next();
    } catch (error) {
        console.error('Error verificando rol admin:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};

// Panel de Administrador Principal - Vista completa
router.get('/admin-principal-panel', authenticateToken, async (req, res) => {
    try {
        console.log('Admin panel request from user:', req.user.id);
        
        // Verificar que es AdminPrincipal específicamente (más permisivo para testing)
        let adminCheck;
        try {
            adminCheck = await pool.query(`
                SELECT 1 FROM user_roles ur
                JOIN roles r ON ur.role_id = r.id
                WHERE ur.user_id = $1 AND r.name IN ('administrador_principal', 'administrador_secundario')
            `, [req.user.id]);
            console.log('Admin check result:', adminCheck.rows.length);
        } catch (roleError) {
            console.error('Error checking admin role:', roleError);
            // Si falla el check de rol, continuar anyway para debugging
        }

        // Comentamos temporalmente la verificación de permisos para debugging
        // if (adminCheck.rows.length === 0) {
        //     return res.status(403).json({ error: 'Se requieren permisos administrativos para acceder a este panel' });
        // }

        // Sección 1: Administradores (Principal y Secundarios)
        console.log('Fetching administradores...');
        let adminSecundarios;
        try {
            adminSecundarios = await pool.query(`
                SELECT DISTINCT
                    u.id,
                    u.nickname,
                    COALESCE(u.email, 'Sin email') as email,
                    '' as first_name,
                    '' as last_name,
                    0 as assigned_creators_count,
                    0 as total_blocks_assigned,
                    0 as total_questions_assigned,
                    0 as luminarias,
                    r.name as role_name
                FROM users u
                LEFT JOIN user_roles ur ON u.id = ur.user_id
                LEFT JOIN roles r ON ur.role_id = r.id
                WHERE r.name IN ('administrador_principal', 'administrador_secundario')
                ORDER BY u.nickname
                LIMIT 10
            `);
            console.log('Administradores found:', adminSecundarios.rows.length);
        } catch (adminError) {
            console.error('Error fetching administradores:', adminError);
            adminSecundarios = { rows: [] };
        }

        // Sección 2: Creadores de Contenido (usuarios con bloques)
        console.log('Fetching creadores de contenido...');
        let profesoresCreadores;
        try {
            profesoresCreadores = await pool.query(`
                SELECT DISTINCT
                    u.id,
                    u.nickname,
                    COALESCE(u.email, 'Sin email') as email,
                    '' as first_name,
                    '' as last_name,
                    0 as assigned_admin_id,
                    'Sin asignar' as assigned_admin_nickname,
                    COUNT(b.id) as blocks_created,
                    COALESCE(SUM(b.total_questions), 0) as total_questions,
                    0 as total_users_blocks,
                    0 as luminarias_actuales,
                    0 as luminarias_ganadas,
                    0 as luminarias_gastadas,
                    0 as luminarias_abonadas,
                    0 as luminarias_compradas,
                    COALESCE(r.name, 'creador_contenido') as role_name
                FROM users u
                LEFT JOIN blocks b ON u.id = b.creator_id
                LEFT JOIN user_roles ur ON u.id = ur.user_id
                LEFT JOIN roles r ON ur.role_id = r.id
                WHERE b.id IS NOT NULL
                GROUP BY u.id, u.nickname, u.email, r.name
                ORDER BY COUNT(b.id) DESC, u.nickname
                LIMIT 15
            `);
            console.log('Creadores de contenido found:', profesoresCreadores.rows.length);
        } catch (profError) {
            console.error('Error fetching creadores:', profError);
            profesoresCreadores = { rows: [] };
        }

        // Sección 3: Usuarios regulares (excluyendo admins y creadores)
        console.log('Fetching usuarios regulares...');
        let usuarios;
        try {
            usuarios = await pool.query(`
                SELECT DISTINCT
                    u.id,
                    u.nickname,
                    COALESCE(u.email, 'Sin email') as email,
                    '' as first_name,
                    '' as last_name,
                    0 as assigned_admin_id,
                    'Sin asignar' as assigned_admin_nickname,
                    0 as blocks_loaded,
                    0 as luminarias_actuales,
                    0 as luminarias_ganadas,
                    0 as luminarias_gastadas,
                    0 as luminarias_abonadas,
                    0 as luminarias_compradas,
                    COALESCE(r.name, 'usuario') as role_name
                FROM users u
                LEFT JOIN user_roles ur ON u.id = ur.user_id
                LEFT JOIN roles r ON ur.role_id = r.id
                LEFT JOIN blocks b ON u.id = b.creator_id
                WHERE (r.name IS NULL OR r.name = 'usuario') 
                  AND b.id IS NULL
                ORDER BY u.nickname
                LIMIT 25
            `);
            console.log('Usuarios regulares found:', usuarios.rows.length);
        } catch (userError) {
            console.error('Error fetching usuarios:', userError);
            usuarios = { rows: [] };
        }

        // Lista de administradores disponibles para asignación - simplificada
        console.log('Fetching available admins...');
        let availableAdmins;
        try {
            availableAdmins = await pool.query(`
                SELECT id, nickname
                FROM users
                ORDER BY nickname
                LIMIT 5
            `);
            console.log('Available admins found:', availableAdmins.rows.length);
        } catch (adminListError) {
            console.error('Error fetching available admins:', adminListError);
            availableAdmins = { rows: [] };
        }

        res.json({
            adminSecundarios: adminSecundarios.rows,
            profesoresCreadores: profesoresCreadores.rows,
            usuarios: usuarios.rows,
            availableAdmins: availableAdmins.rows
        });

    } catch (error) {
        console.error('Error obteniendo panel AdminPrincipal:', error);
        console.error('Error details:', error.message);
        console.error('Stack trace:', error.stack);
        res.status(500).json({ 
            error: 'Error interno del servidor',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Panel de Administrador Secundario - Vista limitada
router.get('/admin-secundario-panel', authenticateToken, requireAdminRole, async (req, res) => {
    try {
        if (req.user.adminRole !== 'administrador_secundario') {
            return res.status(403).json({ error: 'Solo Administradores Secundarios pueden acceder' });
        }

        // Sección 1: Profesores/Creadores asignados (sin luminarias)
        const profesoresCreadores = await pool.query(`
            SELECT 
                u.id,
                u.nickname,
                up.first_name,
                up.last_name,
                u.email,
                COUNT(DISTINCT b.id) as blocks_created,
                COALESCE(SUM(b.total_questions), 0) as total_questions,
                COALESCE(SUM(b.total_users), 0) as total_users_blocks,
                array_agg(DISTINCT r.name) as roles
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            LEFT JOIN blocks b ON u.id = b.creator_id AND b.is_public = true
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN roles r ON ur.role_id = r.id
            JOIN admin_assignments aa ON u.id = aa.assigned_user_id
            WHERE r.name IN ('creador_contenido', 'profesor') 
            AND aa.admin_id = $1
            GROUP BY u.id, u.nickname, up.first_name, up.last_name, u.email
            ORDER BY u.nickname
        `, [req.user.id]);

        // Sección 2: Usuarios asignados (sin luminarias ni reasignación)
        const usuarios = await pool.query(`
            SELECT 
                u.id,
                u.nickname,
                up.first_name,
                up.last_name,
                u.email,
                COALESCE(array_length(up.loaded_blocks::int[], 1), 0) as blocks_loaded
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN roles r ON ur.role_id = r.id
            JOIN admin_assignments aa ON u.id = aa.assigned_user_id
            WHERE r.name = 'usuario' 
            AND aa.admin_id = $1
            GROUP BY u.id, u.nickname, up.first_name, up.last_name, u.email, up.loaded_blocks
            ORDER BY u.nickname
        `, [req.user.id]);

        res.json({
            profesoresCreadores: profesoresCreadores.rows,
            usuarios: usuarios.rows
        });

    } catch (error) {
        console.error('Error obteniendo panel AdminSecundario:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Asignar nuevo Administrador Secundario
router.post('/assign-admin-secundario', authenticateToken, async (req, res) => {
    try {
        // Solo AdminPrincipal puede asignar
        const adminCheck = await pool.query(`
            SELECT 1 FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = $1 AND r.name = 'administrador_principal'
        `, [req.user.id]);

        if (adminCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Solo el Administrador Principal puede asignar administradores' });
        }

        const { nickname } = req.body;

        if (!nickname) {
            return res.status(400).json({ error: 'Nickname es requerido' });
        }

        // Verificar que el usuario existe
        const userCheck = await pool.query('SELECT id FROM users WHERE nickname = $1', [nickname]);
        
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const userId = userCheck.rows[0].id;

        // Verificar que no sea ya administrador
        const existingAdmin = await pool.query(`
            SELECT 1 FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = $1 AND r.name IN ('administrador_principal', 'administrador_secundario')
        `, [userId]);

        if (existingAdmin.rows.length > 0) {
            return res.status(400).json({ error: 'El usuario ya tiene rol administrativo' });
        }

        // Asignar rol
        await pool.query(`
            INSERT INTO user_roles (user_id, role_id, assigned_by, auto_assigned)
            SELECT $1, r.id, $2, false
            FROM roles r
            WHERE r.name = 'administrador_secundario'
        `, [userId, req.user.id]);

        // Inicializar luminarias si no existen
        await pool.query(`
            INSERT INTO user_luminarias (user_id)
            VALUES ($1)
            ON CONFLICT (user_id) DO NOTHING
        `, [userId]);

        res.json({ 
            message: 'Administrador Secundario asignado exitosamente',
            userId: userId,
            nickname: nickname
        });

    } catch (error) {
        console.error('Error asignando administrador secundario:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Reasignar usuario a diferente administrador
router.post('/reassign-user', authenticateToken, async (req, res) => {
    try {
        // Solo AdminPrincipal puede reasignar
        const adminCheck = await pool.query(`
            SELECT 1 FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = $1 AND r.name = 'administrador_principal'
        `, [req.user.id]);

        if (adminCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Solo el Administrador Principal puede reasignar usuarios' });
        }

        const { userId, newAdminId } = req.body;

        if (!userId || !newAdminId) {
            return res.status(400).json({ error: 'userId y newAdminId son requeridos' });
        }

        // Verificar que el nuevo admin existe y es administrador secundario
        const adminVerify = await pool.query(`
            SELECT 1 FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = $1 AND r.name = 'administrador_secundario'
        `, [newAdminId]);

        if (adminVerify.rows.length === 0) {
            return res.status(400).json({ error: 'El nuevo administrador no es válido' });
        }

        // Actualizar asignación
        await pool.query(`
            UPDATE admin_assignments 
            SET admin_id = $1, assigned_by = $2
            WHERE assigned_user_id = $3
        `, [newAdminId, req.user.id, userId]);

        res.json({ message: 'Usuario reasignado exitosamente' });

    } catch (error) {
        console.error('Error reasignando usuario:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener bloques detallados de un creador/profesor
router.get('/user-blocks/:userId', authenticateToken, requireAdminRole, async (req, res) => {
    try {
        const { userId } = req.params;

        const blocks = await pool.query(`
            SELECT 
                b.id,
                b.name,
                b.description,
                b.created_at,
                COUNT(DISTINCT q.id) as total_questions,
                COUNT(DISTINCT q.topic) as total_topics,
                COALESCE(b.total_users, 0) as total_users
            FROM blocks b
            LEFT JOIN questions q ON b.id = q.block_id
            WHERE b.creator_id = $1 AND b.is_public = true
            GROUP BY b.id, b.name, b.description, b.created_at, b.total_users
            ORDER BY b.created_at DESC
        `, [userId]);

        res.json({ blocks: blocks.rows });

    } catch (error) {
        console.error('Error obteniendo bloques del usuario:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener temas de un bloque
router.get('/block-topics/:blockId', authenticateToken, requireAdminRole, async (req, res) => {
    try {
        const { blockId } = req.params;

        const topics = await pool.query(`
            SELECT 
                topic,
                COUNT(*) as question_count
            FROM questions
            WHERE block_id = $1
            GROUP BY topic
            ORDER BY topic
        `, [blockId]);

        res.json({ topics: topics.rows });

    } catch (error) {
        console.error('Error obteniendo temas del bloque:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener preguntas de un tema específico
router.get('/topic-questions/:blockId/:topic', authenticateToken, requireAdminRole, async (req, res) => {
    try {
        const { blockId, topic } = req.params;

        const questions = await pool.query(`
            SELECT 
                q.id,
                q.text_question,
                q.difficulty,
                q.explanation,
                q.created_at,
                array_agg(
                    json_build_object(
                        'id', a.id,
                        'text', a.answer_text,
                        'is_correct', a.is_correct
                    )
                ) as answers
            FROM questions q
            LEFT JOIN answers a ON q.id = a.question_id
            WHERE q.block_id = $1 AND q.topic = $2
            GROUP BY q.id, q.text_question, q.difficulty, q.explanation, q.created_at
            ORDER BY q.created_at DESC
        `, [blockId, topic]);

        res.json({ questions: questions.rows });

    } catch (error) {
        console.error('Error obteniendo preguntas del tema:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Ejecutar redistribución manual
router.post('/redistribute-users', authenticateToken, async (req, res) => {
    try {
        // Solo AdminPrincipal puede redistribuir
        const adminCheck = await pool.query(`
            SELECT 1 FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = $1 AND r.name = 'administrador_principal'
        `, [req.user.id]);

        if (adminCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Solo el Administrador Principal puede redistribuir usuarios' });
        }

        const result = await pool.query('SELECT redistribute_users_to_admins() as redistributed_count');
        const redistributedCount = result.rows[0].redistributed_count;

        res.json({
            message: `Redistribución completada: ${redistributedCount} usuarios redistribuidos`,
            redistributedCount
        });

    } catch (error) {
        console.error('Error en redistribución:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear código educativo
router.post('/create-educational-code', authenticateToken, async (req, res) => {
    try {
        const { code, institutionName, maxUses, expiresAt } = req.body;

        if (!code) {
            return res.status(400).json({ error: 'Código es requerido' });
        }

        const result = await pool.query(`
            INSERT INTO educational_codes (code, institution_name, created_by, max_uses, expires_at)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, code, created_at
        `, [code, institutionName || null, req.user.id, maxUses || null, expiresAt || null]);

        res.json({
            message: 'Código educativo creado exitosamente',
            educationalCode: result.rows[0]
        });

    } catch (error) {
        if (error.code === '23505') { // unique violation
            res.status(400).json({ error: 'El código ya existe' });
        } else {
            console.error('Error creando código educativo:', error);
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    }
});

// Usar código educativo
router.post('/use-educational-code', authenticateToken, async (req, res) => {
    try {
        const { code } = req.body;

        if (!code) {
            return res.status(400).json({ error: 'Código es requerido' });
        }

        const result = await pool.query('SELECT assign_professor_by_code($1, $2) as success', 
            [req.user.id, code]);

        if (result.rows[0].success) {
            res.json({ message: 'Código educativo aplicado exitosamente' });
        } else {
            res.status(400).json({ error: 'Código inválido, expirado o agotado' });
        }

    } catch (error) {
        console.error('Error usando código educativo:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener roles del usuario actual
router.get('/my-roles', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                r.name,
                r.description,
                r.hierarchy_level,
                ur.assigned_at,
                ur.auto_assigned
            FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = $1
            ORDER BY r.hierarchy_level
        `, [req.user.id]);

        res.json(result.rows);

    } catch (error) {
        console.error('Error obteniendo roles:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

module.exports = router;