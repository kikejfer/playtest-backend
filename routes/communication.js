const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { pool } = require('../database/connection');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Configuración de multer para adjuntos
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/tickets');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, `ticket-${uniqueSuffix}${extension}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 5 // Máximo 5 archivos por upload
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|zip|rar/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido'));
    }
  }
});

// Obtener categorías filtradas según tipo de origen
router.get('/categories/:originType', authenticateToken, async (req, res) => {
  try {
    const { originType } = req.params;
    
    if (!['global', 'block'].includes(originType)) {
      return res.status(400).json({ error: 'Tipo de origen inválido' });
    }

    const result = await pool.query(`
      SELECT id, name, priority, description
      FROM ticket_categories
      WHERE origin_type = $1
      ORDER BY name
    `, [originType]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo categorías:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Crear nuevo ticket
router.post('/tickets', authenticateToken, upload.array('attachments'), async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const {
      originType,
      blockId,
      categoryId,
      title,
      description,
      priority = 'media'
    } = req.body;

    // Validaciones
    if (!originType || !categoryId || !title || !description) {
      return res.status(400).json({ 
        error: 'Campos requeridos: originType, categoryId, title, description' 
      });
    }

    if (originType === 'block' && !blockId) {
      return res.status(400).json({ 
        error: 'blockId es requerido para tickets de bloque' 
      });
    }

    // Verificar que la categoría corresponde al tipo de origen
    const categoryResult = await client.query(`
      SELECT id, priority FROM ticket_categories 
      WHERE id = $1 AND origin_type = $2
    `, [categoryId, originType]);

    if (categoryResult.rows.length === 0) {
      return res.status(400).json({ 
        error: 'Categoría no válida para el tipo de origen especificado' 
      });
    }

    // Usar la prioridad de la categoría si no se especifica otra
    const finalPriority = priority || categoryResult.rows[0].priority;

    // Crear el ticket
    const ticketResult = await client.query(`
      INSERT INTO tickets (
        origin_type, block_id, category_id, created_by, 
        title, description, priority
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, ticket_number
    `, [
      originType, 
      originType === 'block' ? parseInt(blockId) : null, 
      categoryId, 
      req.user.id, 
      title, 
      description, 
      finalPriority
    ]);

    const ticket = ticketResult.rows[0];

    // Procesar adjuntos si los hay
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await client.query(`
          INSERT INTO ticket_attachments (
            ticket_id, filename, original_name, file_type, 
            file_size, file_path, uploaded_by, is_image
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          ticket.id,
          file.filename,
          file.originalname,
          file.mimetype,
          file.size,
          file.path,
          req.user.id,
          file.mimetype.startsWith('image/')
        ]);
      }
    }

    // Crear mensaje inicial con la descripción
    await client.query(`
      INSERT INTO ticket_messages (ticket_id, sender_id, message_text)
      VALUES ($1, $2, $3)
    `, [ticket.id, req.user.id, description]);

    // Añadir participantes (creador y asignado)
    await client.query(`
      INSERT INTO ticket_participants (ticket_id, user_id, role)
      VALUES ($1, $2, 'creator')
    `, [ticket.id, req.user.id]);

    // Obtener información del ticket asignado
    const ticketInfo = await client.query(`
      SELECT assigned_to FROM tickets WHERE id = $1
    `, [ticket.id]);

    if (ticketInfo.rows[0].assigned_to && ticketInfo.rows[0].assigned_to !== req.user.id) {
      await client.query(`
        INSERT INTO ticket_participants (ticket_id, user_id, role)
        VALUES ($1, $2, 'assigned')
      `, [ticket.id, ticketInfo.rows[0].assigned_to]);

      // Crear notificación para el asignado
      await client.query(`
        INSERT INTO notifications (user_id, ticket_id, type, title, message, action_url)
        VALUES ($1, $2, 'new_ticket', $3, $4, $5)
      `, [
        ticketInfo.rows[0].assigned_to,
        ticket.id,
        `Nuevo ticket: ${title}`,
        `Se te ha asignado un nuevo ticket de soporte.`,
        `/ticket/${ticket.id}`
      ]);
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Ticket creado exitosamente',
      ticket: {
        id: ticket.id,
        ticketNumber: ticket.ticket_number
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creando ticket:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    client.release();
  }
});

// Obtener tickets del usuario (según su rol)
router.get('/tickets', authenticateToken, async (req, res) => {
  try {
    const { status, priority, page = 1, limit = 20, search } = req.query;
    
    const offset = (page - 1) * limit;
    
    // Construir query base con filtros
    let whereClause = `
      WHERE (tp.user_id = $1 OR t.created_by = $1)
    `;
    const params = [req.user.id, limit, offset];
    let paramCount = 1;

    if (status) {
      paramCount++;
      whereClause += ` AND t.status = $${paramCount}`;
      params.splice(-2, 0, status);
    }

    if (priority) {
      paramCount++;
      whereClause += ` AND t.priority = $${paramCount}`;
      params.splice(-2, 0, priority);
    }

    if (search) {
      paramCount++;
      whereClause += ` AND (t.title ILIKE $${paramCount} OR t.ticket_number ILIKE $${paramCount})`;
      params.splice(-2, 0, `%${search}%`);
    }

    const query = `
      SELECT DISTINCT
        tci.id,
        tci.ticket_number,
        tci.origin_type,
        tci.title,
        tci.status,
        tci.priority,
        tci.created_at,
        tci.updated_at,
        tci.last_activity,
        tci.creator_nickname,
        tci.assigned_nickname,
        tci.category_name,
        tci.block_name,
        tci.message_count,
        tci.attachment_count,
        tci.last_message,
        tci.last_message_at,
        tci.last_message_by
      FROM ticket_complete_info tci
      LEFT JOIN ticket_participants tp ON tci.id = tp.ticket_id
      ${whereClause}
      ORDER BY tci.last_activity DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;

    const result = await pool.query(query, params);

    // Obtener total para paginación
    const countQuery = `
      SELECT COUNT(DISTINCT tci.id) as total
      FROM ticket_complete_info tci
      LEFT JOIN ticket_participants tp ON tci.id = tp.ticket_id
      ${whereClause.replace(/LIMIT.*$/, '')}
    `;
    
    const countResult = await pool.query(countQuery, params.slice(0, -2));
    const total = parseInt(countResult.rows[0].total);

    res.json({
      tickets: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Error obteniendo tickets:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener detalles completos de un ticket
router.get('/tickets/:ticketId', authenticateToken, async (req, res) => {
  try {
    const ticketId = parseInt(req.params.ticketId);

    // Verificar acceso al ticket
    const accessCheck = await pool.query(`
      SELECT 1 FROM ticket_participants tp
      WHERE tp.ticket_id = $1 AND tp.user_id = $2
      UNION
      SELECT 1 FROM tickets t WHERE t.id = $1 AND t.created_by = $2
    `, [ticketId, req.user.id]);

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({ error: 'No tienes acceso a este ticket' });
    }

    // Obtener información del ticket
    const ticketResult = await pool.query(`
      SELECT * FROM ticket_complete_info WHERE id = $1
    `, [ticketId]);

    if (ticketResult.rows.length === 0) {
      return res.status(404).json({ error: 'Ticket no encontrado' });
    }

    // Obtener mensajes del ticket
    const messagesResult = await pool.query(`
      SELECT 
        tm.id,
        tm.message_text,
        tm.message_html,
        tm.is_internal,
        tm.is_system,
        tm.created_at,
        tm.edited_at,
        u.nickname as sender_nickname,
        u.id as sender_id
      FROM ticket_messages tm
      JOIN users u ON tm.sender_id = u.id
      WHERE tm.ticket_id = $1
      ORDER BY tm.created_at ASC
    `, [ticketId]);

    // Obtener adjuntos del ticket
    const attachmentsResult = await pool.query(`
      SELECT 
        ta.id,
        ta.filename,
        ta.original_name,
        ta.file_type,
        ta.file_size,
        ta.is_image,
        ta.upload_date,
        u.nickname as uploaded_by_nickname
      FROM ticket_attachments ta
      JOIN users u ON ta.uploaded_by = u.id
      WHERE ta.ticket_id = $1
      ORDER BY ta.upload_date ASC
    `, [ticketId]);

    // Marcar mensajes como leídos
    await pool.query(`
      UPDATE ticket_messages
      SET read_by = COALESCE(read_by, '{}'::jsonb) || jsonb_build_object($2::text, NOW()::text)
      WHERE ticket_id = $1 
      AND sender_id != $2
      AND NOT (read_by ? $2::text)
    `, [ticketId, req.user.id.toString()]);

    res.json({
      ticket: ticketResult.rows[0],
      messages: messagesResult.rows,
      attachments: attachmentsResult.rows
    });

  } catch (error) {
    console.error('Error obteniendo detalles del ticket:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Enviar mensaje en un ticket
router.post('/tickets/:ticketId/messages', authenticateToken, upload.array('attachments'), async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const ticketId = parseInt(req.params.ticketId);
    const { message, isInternal = false } = req.body;

    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
    }

    // Verificar acceso al ticket
    const accessCheck = await client.query(`
      SELECT 1 FROM ticket_participants tp
      WHERE tp.ticket_id = $1 AND tp.user_id = $2
      UNION
      SELECT 1 FROM tickets t WHERE t.id = $1 AND t.created_by = $2
    `, [ticketId, req.user.id]);

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({ error: 'No tienes acceso a este ticket' });
    }

    // Crear el mensaje
    const messageResult = await client.query(`
      INSERT INTO ticket_messages (ticket_id, sender_id, message_text, is_internal)
      VALUES ($1, $2, $3, $4)
      RETURNING id, created_at
    `, [ticketId, req.user.id, message, isInternal]);

    const newMessage = messageResult.rows[0];

    // Procesar adjuntos si los hay
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await client.query(`
          INSERT INTO ticket_attachments (
            ticket_id, message_id, filename, original_name, file_type, 
            file_size, file_path, uploaded_by, is_image
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          ticketId,
          newMessage.id,
          file.filename,
          file.originalname,
          file.mimetype,
          file.size,
          file.path,
          req.user.id,
          file.mimetype.startsWith('image/')
        ]);
      }
    }

    // Actualizar estado del ticket si está resuelto
    await client.query(`
      UPDATE tickets 
      SET status = CASE 
        WHEN status = 'resuelto' THEN 'en_progreso'
        WHEN status = 'cerrado' THEN 'en_progreso'
        ELSE status
      END
      WHERE id = $1
    `, [ticketId]);

    // Crear notificaciones para otros participantes
    const participantsResult = await client.query(`
      SELECT DISTINCT user_id
      FROM ticket_participants tp
      WHERE tp.ticket_id = $1 
      AND tp.user_id != $2
      AND tp.notifications_enabled = true
    `, [ticketId, req.user.id]);

    const ticketInfo = await client.query(`
      SELECT ticket_number, title FROM tickets WHERE id = $1
    `, [ticketId]);

    for (const participant of participantsResult.rows) {
      await client.query(`
        INSERT INTO notifications (user_id, ticket_id, type, title, message, action_url)
        VALUES ($1, $2, 'new_message', $3, $4, $5)
      `, [
        participant.user_id,
        ticketId,
        `Nuevo mensaje en ${ticketInfo.rows[0].ticket_number}`,
        `${ticketInfo.rows[0].title}`,
        `/ticket/${ticketId}`
      ]);
    }

    await client.query('COMMIT');

    // Obtener información completa del mensaje para respuesta
    const messageInfo = await pool.query(`
      SELECT 
        tm.id,
        tm.message_text,
        tm.is_internal,
        tm.created_at,
        u.nickname as sender_nickname
      FROM ticket_messages tm
      JOIN users u ON tm.sender_id = u.id
      WHERE tm.id = $1
    `, [newMessage.id]);

    res.status(201).json({
      message: 'Mensaje enviado exitosamente',
      messageInfo: messageInfo.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error enviando mensaje:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    client.release();
  }
});

// Actualizar estado de ticket
router.patch('/tickets/:ticketId/status', authenticateToken, async (req, res) => {
  try {
    const ticketId = parseInt(req.params.ticketId);
    const { status } = req.body;

    const validStatuses = ['abierto', 'en_progreso', 'esperando_respuesta', 'resuelto', 'cerrado'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    // Verificar acceso (solo asignado o administradores)
    const accessCheck = await pool.query(`
      SELECT t.assigned_to, t.escalated_to
      FROM tickets t
      WHERE t.id = $1 
      AND (t.assigned_to = $2 OR t.escalated_to = $2 OR EXISTS (
        SELECT 1 FROM user_roles ur 
        JOIN roles r ON ur.role_id = r.id 
        WHERE ur.user_id = $2 
        AND r.name IN ('administrador_principal', 'administrador_secundario')
      ))
    `, [ticketId, req.user.id]);

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({ error: 'No tienes permisos para cambiar el estado de este ticket' });
    }

    // Actualizar estado
    const updateFields = ['status = $1', 'updated_at = NOW()'];
    const params = [status, ticketId];

    if (status === 'resuelto') {
      updateFields.push('resolved_at = NOW()');
    } else if (status === 'cerrado') {
      updateFields.push('closed_at = NOW()');
    }

    await pool.query(`
      UPDATE tickets 
      SET ${updateFields.join(', ')}
      WHERE id = $2
    `, params);

    // Crear mensaje del sistema
    await pool.query(`
      INSERT INTO ticket_messages (ticket_id, sender_id, message_text, is_system)
      VALUES ($1, $2, $3, true)
    `, [ticketId, req.user.id, `Estado del ticket cambiado a: ${status}`]);

    res.json({ message: 'Estado actualizado exitosamente' });

  } catch (error) {
    console.error('Error actualizando estado:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener notificaciones del usuario
router.get('/notifications', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE user_id = $1';
    if (unreadOnly === 'true') {
      whereClause += ' AND is_read = false';
    }

    const result = await pool.query(`
      SELECT 
        n.id,
        n.type,
        n.title,
        n.message,
        n.action_url,
        n.is_read,
        n.created_at,
        t.ticket_number
      FROM notifications n
      LEFT JOIN tickets t ON n.ticket_id = t.id
      ${whereClause}
      ORDER BY n.created_at DESC
      LIMIT $2 OFFSET $3
    `, [req.user.id, limit, offset]);

    // Contar no leídas
    const unreadResult = await pool.query(
      'SELECT COUNT(*) as unread FROM notifications WHERE user_id = $1 AND is_read = false',
      [req.user.id]
    );

    res.json({
      notifications: result.rows,
      unreadCount: parseInt(unreadResult.rows[0].unread)
    });

  } catch (error) {
    console.error('Error obteniendo notificaciones:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Marcar notificación como leída
router.patch('/notifications/:notificationId/read', authenticateToken, async (req, res) => {
  try {
    const notificationId = parseInt(req.params.notificationId);

    await pool.query(`
      UPDATE notifications 
      SET is_read = true, read_at = NOW()
      WHERE id = $1 AND user_id = $2
    `, [notificationId, req.user.id]);

    res.json({ message: 'Notificación marcada como leída' });

  } catch (error) {
    console.error('Error marcando notificación:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Marcar todas las notificaciones como leídas
router.patch('/notifications/read-all', authenticateToken, async (req, res) => {
  try {
    await pool.query(`
      UPDATE notifications 
      SET is_read = true, read_at = NOW()
      WHERE user_id = $1 AND is_read = false
    `, [req.user.id]);

    res.json({ message: 'Todas las notificaciones marcadas como leídas' });

  } catch (error) {
    console.error('Error marcando notificaciones:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Endpoint para ejecutar escalado manual (para testing o cron jobs)
router.post('/escalate-tickets', authenticateToken, async (req, res) => {
  try {
    // Verificar que sea administrador
    const adminCheck = await pool.query(`
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = $1 AND r.name IN ('administrador_principal', 'administrador_secundario')
    `, [req.user.id]);

    if (adminCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Solo los administradores pueden ejecutar escalado' });
    }

    const result = await pool.query('SELECT escalate_tickets() as escalated_count');
    const escalatedCount = result.rows[0].escalated_count;

    res.json({
      message: `Se escalaron ${escalatedCount} tickets`,
      escalatedCount
    });

  } catch (error) {
    console.error('Error en escalado manual:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Gestión del scheduler de escalado
router.get('/escalation/status', authenticateToken, async (req, res) => {
  try {
    // Solo administradores pueden ver el estado
    const adminCheck = await pool.query(`
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = $1 AND r.name IN ('administrador_principal', 'administrador_secundario')
    `, [req.user.id]);

    if (adminCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Solo los administradores pueden ver el estado del escalado' });
    }

    // El escalationScheduler está disponible globalmente en el servidor
    const status = global.escalationScheduler ? global.escalationScheduler.getStatus() : { isRunning: false };
    
    res.json(status);
  } catch (error) {
    console.error('Error obteniendo estado del escalado:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.post('/escalation/manual', authenticateToken, async (req, res) => {
  try {
    // Solo administradores pueden ejecutar escalado manual
    const adminCheck = await pool.query(`
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = $1 AND r.name IN ('administrador_principal', 'administrador_secundario')
    `, [req.user.id]);

    if (adminCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Solo los administradores pueden ejecutar escalado manual' });
    }

    if (global.escalationScheduler) {
      const count = await global.escalationScheduler.runNow();
      res.json({
        message: `Escalado manual completado - ${count} tickets escalados`,
        escalatedCount: count
      });
    } else {
      res.status(503).json({ error: 'Scheduler de escalado no disponible' });
    }
  } catch (error) {
    console.error('Error en escalado manual:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Servir archivos adjuntos (con control de acceso)
router.get('/attachments/:filename', authenticateToken, async (req, res) => {
  try {
    const { filename } = req.params;

    // Verificar que el usuario tenga acceso al archivo
    const accessCheck = await pool.query(`
      SELECT ta.file_path, ta.original_name, ta.file_type
      FROM ticket_attachments ta
      JOIN tickets t ON ta.ticket_id = t.id
      LEFT JOIN ticket_participants tp ON t.id = tp.ticket_id
      WHERE ta.filename = $1 
      AND (tp.user_id = $2 OR t.created_by = $2)
    `, [filename, req.user.id]);

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({ error: 'No tienes acceso a este archivo' });
    }

    const file = accessCheck.rows[0];
    
    res.setHeader('Content-Type', file.file_type);
    res.setHeader('Content-Disposition', `inline; filename="${file.original_name}"`);
    res.sendFile(path.resolve(file.file_path));

  } catch (error) {
    console.error('Error sirviendo archivo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;