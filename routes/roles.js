const express = require('express');
const pool = require('../database/connection');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Middleware para verificar rol de administrador
const requireAdminRole = async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT r.name, r.hierarchy_level
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = $1 AND r.name IN ('administrador_principal', 'administrador_secundario')
    `, [req.user.id]);

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Acceso denegado: Se requiere rol de administrador' });
    }

    req.adminRole = result.rows[0];
    next();
  } catch (error) {
    console.error('Error verificando rol de administrador:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// Obtener roles del usuario actual
router.get('/my-roles', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.name, r.description, r.hierarchy_level, ur.assigned_at, ur.auto_assigned
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = $1
      ORDER BY r.hierarchy_level
    `, [req.user.id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo roles del usuario:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Asignar rol de administrador secundario (solo AdminPrincipal)
router.post('/assign-admin-secundario', authenticateToken, requireAdminRole, async (req, res) => {
  try {
    // Solo el administrador principal puede asignar admin secundarios
    if (req.adminRole.name !== 'administrador_principal') {
      return res.status(403).json({ error: 'Solo el Administrador Principal puede asignar Administradores Secundarios' });
    }

    const { nickname } = req.body;
    if (!nickname) {
      return res.status(400).json({ error: 'Se requiere el nickname del usuario' });
    }

    // Verificar que el usuario existe
    const userResult = await pool.query('SELECT id FROM users WHERE nickname = $1', [nickname]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const userId = userResult.rows[0].id;

    // Verificar que no sea el mismo AdminPrincipal
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'No puedes asignarte el rol a ti mismo' });
    }

    // Verificar que no tenga ya el rol
    const existingRole = await pool.query(`
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = $1 AND r.name = 'administrador_secundario'
    `, [userId]);

    if (existingRole.rows.length > 0) {
      return res.status(400).json({ error: 'El usuario ya tiene el rol de Administrador Secundario' });
    }

    // Asignar el rol
    const roleResult = await pool.query('SELECT id FROM roles WHERE name = $1', ['administrador_secundario']);
    await pool.query(
      'INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $3)',
      [userId, roleResult.rows[0].id, req.user.id]
    );

    // Inicializar luminarias si no existen
    await pool.query(`
      INSERT INTO user_luminarias (user_id)
      VALUES ($1)
      ON CONFLICT (user_id) DO NOTHING
    `, [userId]);

    // Ejecutar redistribución automática
    await redistributeUsersToAdmins();

    res.json({ message: 'Administrador Secundario asignado exitosamente' });

  } catch (error) {
    console.error('Error asignando administrador secundario:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Reasignar usuario a otro administrador secundario
router.post('/reassign-user', authenticateToken, requireAdminRole, async (req, res) => {
  try {
    const { userId, newAdminId } = req.body;

    if (!userId || !newAdminId) {
      return res.status(400).json({ error: 'Se requieren userId y newAdminId' });
    }

    // Solo AdminPrincipal puede hacer reasignaciones
    if (req.adminRole.name !== 'administrador_principal') {
      return res.status(403).json({ error: 'Solo el Administrador Principal puede reasignar usuarios' });
    }

    // Verificar que el nuevo admin es realmente un admin secundario
    const adminCheck = await pool.query(`
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = $1 AND r.name = 'administrador_secundario'
    `, [newAdminId]);

    if (adminCheck.rows.length === 0) {
      return res.status(400).json({ error: 'El usuario especificado no es un Administrador Secundario' });
    }

    // Actualizar o insertar asignación
    await pool.query(`
      INSERT INTO admin_assignments (admin_id, assigned_user_id, assigned_by)
      VALUES ($1, $2, $3)
      ON CONFLICT (assigned_user_id)
      DO UPDATE SET admin_id = $1, assigned_by = $3, assigned_at = CURRENT_TIMESTAMP
    `, [newAdminId, userId, req.user.id]);

    res.json({ message: 'Usuario reasignado exitosamente' });

  } catch (error) {
    console.error('Error reasignando usuario:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener panel del administrador principal
router.get('/admin-principal-panel', authenticateToken, requireAdminRole, async (req, res) => {
  try {
    if (req.adminRole.name !== 'administrador_principal') {
      return res.status(403).json({ error: 'Solo el Administrador Principal puede acceder a este panel' });
    }

    // Sección 1: Administradores Secundarios
    const adminsSecundarios = await pool.query(`
      SELECT 
        u.id, u.nickname, u.email,
        COUNT(DISTINCT aa.assigned_user_id) as profesores_asignados,
        COUNT(DISTINCT b.id) as bloques_totales,
        COUNT(DISTINCT q.id) as preguntas_totales,
        COALESCE(ul.actuales, 0) as luminarias
      FROM users u
      JOIN user_roles ur ON u.id = ur.user_id
      JOIN roles r ON ur.role_id = r.id
      LEFT JOIN admin_assignments aa ON u.id = aa.admin_id
      LEFT JOIN blocks b ON aa.assigned_user_id = b.creator_id AND b.is_public = true
      LEFT JOIN questions q ON b.id = q.block_id
      LEFT JOIN user_luminarias ul ON u.id = ul.user_id
      WHERE r.name = 'administrador_secundario'
      GROUP BY u.id, u.nickname, u.email, ul.actuales
      ORDER BY luminarias DESC
    `);

    // Sección 2: Profesores/Creadores
    const profesoresCreadores = await pool.query(`
      SELECT 
        u.id, u.nickname, u.email,
        COALESCE(aa_admin.nickname, 'Sin asignar') as admin_asignado,
        aa.admin_id,
        COUNT(DISTINCT b.id) as bloques_creados,
        COUNT(DISTINCT q.id) as preguntas_totales,
        COUNT(DISTINCT up_users.user_id) as usuarios_bloques_publicos,
        COALESCE(ul.actuales, 0) as luminarias_actuales,
        COALESCE(ul.ganadas, 0) as luminarias_ganadas,
        COALESCE(ul.gastadas, 0) as luminarias_gastadas,
        COALESCE(ul.abonadas, 0) as luminarias_abonadas,
        COALESCE(ul.compradas, 0) as luminarias_compradas
      FROM users u
      JOIN user_roles ur ON u.id = ur.user_id
      JOIN roles r ON ur.role_id = r.id
      LEFT JOIN admin_assignments aa ON u.id = aa.assigned_user_id
      LEFT JOIN users aa_admin ON aa.admin_id = aa_admin.id
      LEFT JOIN blocks b ON u.id = b.creator_id AND b.is_public = true
      LEFT JOIN questions q ON b.id = q.block_id
      LEFT JOIN user_profiles up_users ON up_users.loaded_blocks::jsonb ? b.id::text
      LEFT JOIN user_luminarias ul ON u.id = ul.user_id
      WHERE r.name = 'profesor_creador'
      GROUP BY u.id, u.nickname, u.email, aa_admin.nickname, aa.admin_id, ul.actuales, ul.ganadas, ul.gastadas, ul.abonadas, ul.compradas
      ORDER BY luminarias_actuales DESC
    `);

    // Sección 3: Usuarios (Jugadores)
    const usuarios = await pool.query(`
      SELECT 
        u.id, u.nickname, u.email,
        COALESCE(array_length(up.loaded_blocks::int[], 1), 0) as bloques_cargados,
        COALESCE(aa_admin.nickname, 'Sin asignar') as admin_asignado,
        aa.admin_id,
        COALESCE(ul.actuales, 0) as luminarias_actuales,
        COALESCE(ul.ganadas, 0) as luminarias_ganadas,
        COALESCE(ul.gastadas, 0) as luminarias_gastadas,
        COALESCE(ul.abonadas, 0) as luminarias_abonadas,
        COALESCE(ul.compradas, 0) as luminarias_compradas
      FROM users u
      JOIN user_roles ur ON u.id = ur.user_id
      JOIN roles r ON ur.role_id = r.id
      LEFT JOIN user_profiles up ON u.id = up.user_id
      LEFT JOIN admin_assignments aa ON u.id = aa.assigned_user_id
      LEFT JOIN users aa_admin ON aa.admin_id = aa_admin.id
      LEFT JOIN user_luminarias ul ON u.id = ul.user_id
      WHERE r.name = 'usuario'
      GROUP BY u.id, u.nickname, u.email, up.loaded_blocks, aa_admin.nickname, aa.admin_id, ul.actuales, ul.ganadas, ul.gastadas, ul.abonadas, ul.compradas
      ORDER BY luminarias_actuales DESC
    `);

    res.json({
      administradoresSecundarios: adminsSecundarios.rows,
      profesoresCreadores: profesoresCreadores.rows,
      usuarios: usuarios.rows
    });

  } catch (error) {
    console.error('Error obteniendo panel de administrador principal:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener panel del administrador secundario
router.get('/admin-secundario-panel', authenticateToken, requireAdminRole, async (req, res) => {
  try {
    if (req.adminRole.name !== 'administrador_secundario') {
      return res.status(403).json({ error: 'Solo los Administradores Secundarios pueden acceder a este panel' });
    }

    // Sección 1: Profesores/Creadores asignados (SIN luminarias)
    const profesoresAsignados = await pool.query(`
      SELECT 
        u.id, u.nickname, u.email,
        COUNT(DISTINCT b.id) as bloques_creados,
        COUNT(DISTINCT q.id) as preguntas_totales,
        COUNT(DISTINCT up_users.user_id) as usuarios_bloques_publicos
      FROM users u
      JOIN admin_assignments aa ON u.id = aa.assigned_user_id
      JOIN user_roles ur ON u.id = ur.user_id
      JOIN roles r ON ur.role_id = r.id
      LEFT JOIN blocks b ON u.id = b.creator_id AND b.is_public = true
      LEFT JOIN questions q ON b.id = q.block_id
      LEFT JOIN user_profiles up_users ON up_users.loaded_blocks::jsonb ? b.id::text
      WHERE aa.admin_id = $1 AND r.name = 'profesor_creador'
      GROUP BY u.id, u.nickname, u.email
      ORDER BY u.nickname
    `, [req.user.id]);

    // Sección 2: Usuarios asignados (SIN luminarias, SIN reasignación)
    const usuariosAsignados = await pool.query(`
      SELECT 
        u.id, u.nickname, u.email,
        COALESCE(array_length(up.loaded_blocks::int[], 1), 0) as bloques_cargados
      FROM users u
      JOIN admin_assignments aa ON u.id = aa.assigned_user_id
      JOIN user_roles ur ON u.id = ur.user_id
      JOIN roles r ON ur.role_id = r.id
      LEFT JOIN user_profiles up ON u.id = up.user_id
      WHERE aa.admin_id = $1 AND r.name = 'usuario'
      GROUP BY u.id, u.nickname, u.email, up.loaded_blocks
      ORDER BY u.nickname
    `, [req.user.id]);

    res.json({
      profesoresAsignados: profesoresAsignados.rows,
      usuariosAsignados: usuariosAsignados.rows
    });

  } catch (error) {
    console.error('Error obteniendo panel de administrador secundario:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener detalles expandibles de bloques para un profesor
router.get('/profesor-blocks/:profesorId', authenticateToken, requireAdminRole, async (req, res) => {
  try {
    const profesorId = parseInt(req.params.profesorId);
    
    // Verificar acceso según el tipo de administrador
    let hasAccess = false;
    if (req.adminRole.name === 'administrador_principal') {
      hasAccess = true;
    } else if (req.adminRole.name === 'administrador_secundario') {
      // Verificar que el profesor esté asignado a este admin
      const assignmentCheck = await pool.query(
        'SELECT 1 FROM admin_assignments WHERE admin_id = $1 AND assigned_user_id = $2',
        [req.user.id, profesorId]
      );
      hasAccess = assignmentCheck.rows.length > 0;
    }

    if (!hasAccess) {
      return res.status(403).json({ error: 'No tienes acceso a la información de este profesor' });
    }

    const bloques = await pool.query(`
      SELECT 
        b.id, b.name, b.description, b.created_at,
        COUNT(DISTINCT q.topic) as num_temas,
        COUNT(DISTINCT q.id) as total_preguntas,
        COUNT(DISTINCT up.user_id) as usuarios_bloque
      FROM blocks b
      LEFT JOIN questions q ON b.id = q.block_id
      LEFT JOIN user_profiles up ON up.loaded_blocks::jsonb ? b.id::text
      WHERE b.creator_id = $1 AND b.is_public = true
      GROUP BY b.id, b.name, b.description, b.created_at
      ORDER BY b.created_at DESC
    `, [profesorId]);

    res.json(bloques.rows);

  } catch (error) {
    console.error('Error obteniendo bloques del profesor:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener temas de un bloque específico
router.get('/block-topics/:blockId', authenticateToken, requireAdminRole, async (req, res) => {
  try {
    const blockId = parseInt(req.params.blockId);

    const temas = await pool.query(`
      SELECT 
        topic,
        COUNT(*) as num_preguntas
      FROM questions
      WHERE block_id = $1
      GROUP BY topic
      ORDER BY topic
    `, [blockId]);

    res.json(temas.rows);

  } catch (error) {
    console.error('Error obteniendo temas del bloque:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener preguntas de un tema específico
router.get('/topic-questions/:blockId/:topic', authenticateToken, requireAdminRole, async (req, res) => {
  try {
    const blockId = parseInt(req.params.blockId);
    const topic = req.params.topic;

    const preguntas = await pool.query(`
      SELECT 
        q.id, q.text_question, q.difficulty, q.explanation, q.created_at,
        array_agg(
          json_build_object(
            'id', a.id,
            'text', a.answer_text,
            'is_correct', a.is_correct
          ) ORDER BY a.id
        ) as answers
      FROM questions q
      LEFT JOIN answers a ON q.id = a.question_id
      WHERE q.block_id = $1 AND q.topic = $2
      GROUP BY q.id, q.text_question, q.difficulty, q.explanation, q.created_at
      ORDER BY q.created_at
    `, [blockId, topic]);

    res.json(preguntas.rows);

  } catch (error) {
    console.error('Error obteniendo preguntas del tema:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Función auxiliar para redistribuir usuarios entre administradores secundarios
async function redistributeUsersToAdmins() {
  try {
    // Obtener todos los administradores secundarios
    const adminsResult = await pool.query(`
      SELECT u.id
      FROM users u
      JOIN user_roles ur ON u.id = ur.user_id
      JOIN roles r ON ur.role_id = r.id
      WHERE r.name = 'administrador_secundario'
    `);

    if (adminsResult.rows.length === 0) return;

    const adminIds = adminsResult.rows.map(row => row.id);

    // Obtener todos los usuarios que necesitan ser asignados (profesores y usuarios sin asignar)
    const usersToAssignResult = await pool.query(`
      SELECT DISTINCT u.id
      FROM users u
      JOIN user_roles ur ON u.id = ur.user_id
      JOIN roles r ON ur.role_id = r.id
      WHERE r.name IN ('profesor_creador', 'usuario')
        AND u.id NOT IN (
          SELECT assigned_user_id 
          FROM admin_assignments 
          WHERE assigned_user_id IS NOT NULL
        )
        AND u.id NOT IN (
          SELECT u2.id FROM users u2
          JOIN user_roles ur2 ON u2.id = ur2.user_id
          JOIN roles r2 ON ur2.role_id = r2.id
          WHERE r2.name = 'administrador_principal'
        )
    `);

    const usersToAssign = usersToAssignResult.rows.map(row => row.id);

    // Distribuir usuarios de forma equitativa
    for (let i = 0; i < usersToAssign.length; i++) {
      const adminIndex = i % adminIds.length;
      const adminId = adminIds[adminIndex];
      const userId = usersToAssign[i];

      await pool.query(`
        INSERT INTO admin_assignments (admin_id, assigned_user_id, assigned_by)
        SELECT $1, $2, (
          SELECT u.id FROM users u
          JOIN user_roles ur ON u.id = ur.user_id
          JOIN roles r ON ur.role_id = r.id
          WHERE r.name = 'administrador_principal'
          LIMIT 1
        )
        ON CONFLICT (assigned_user_id) DO NOTHING
      `, [adminId, userId]);
    }

    console.log(`✅ Redistribuidos ${usersToAssign.length} usuarios entre ${adminIds.length} administradores secundarios`);

  } catch (error) {
    console.error('Error en redistribución automática:', error);
  }
}

module.exports = router;