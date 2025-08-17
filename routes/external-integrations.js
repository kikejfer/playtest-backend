const express = require('express');
const router = express.Router();
const pool = require('../database/connection');
const { authenticateToken } = require('../middleware/auth');

// ==========================================
// INTEGRACIÓN CON SISTEMAS EDUCATIVOS EXTERNOS
// Sistema de conectores para LMS, SIS y otras plataformas
// ==========================================

// Middleware para verificar permisos de administrador
const requireAdminRole = async (req, res, next) => {
    try {
        const adminCheck = await pool.query(`
            SELECT ur.id FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = $1 AND r.name IN ('administrador_principal', 'administrador_secundario')
        `, [req.user.id]);
        
        if (adminCheck.rows.length === 0) {
            return res.status(403).json({ 
                error: 'Acceso denegado: se requiere rol de administrador'
            });
        }
        
        next();
    } catch (error) {
        console.error('Error verificando rol de administrador:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};

// ==========================================
// CONFIGURACIÓN DE INTEGRACIONES
// ==========================================

// Obtener configuraciones de integración
router.get('/configurations', authenticateToken, requireAdminRole, async (req, res) => {
    try {
        const configs = await pool.query(`
            SELECT 
                ic.*,
                CASE 
                    WHEN ic.credentials IS NOT NULL THEN true 
                    ELSE false 
                END as has_credentials
            FROM integration_configurations ic
            ORDER BY ic.integration_type, ic.created_at DESC
        `);

        // No enviar credenciales sensibles
        const safeConfigs = configs.rows.map(config => ({
            ...config,
            credentials: undefined
        }));

        res.json({ integrations: safeConfigs });

    } catch (error) {
        console.error('Error obteniendo configuraciones:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear nueva configuración de integración
router.post('/configurations', authenticateToken, requireAdminRole, async (req, res) => {
    try {
        const {
            integration_type,
            integration_name,
            provider_name,
            base_url,
            api_version,
            credentials,
            field_mappings,
            sync_settings,
            is_active
        } = req.body;

        const result = await pool.query(`
            INSERT INTO integration_configurations (
                integration_type, integration_name, provider_name,
                base_url, api_version, credentials, field_mappings,
                sync_settings, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id, integration_type, integration_name, provider_name, 
                     base_url, api_version, field_mappings, sync_settings, 
                     is_active, created_at
        `, [
            integration_type, integration_name, provider_name,
            base_url, api_version, 
            JSON.stringify(credentials),
            JSON.stringify(field_mappings),
            JSON.stringify(sync_settings),
            is_active
        ]);

        res.status(201).json({
            message: 'Configuración de integración creada exitosamente',
            integration: result.rows[0]
        });

    } catch (error) {
        console.error('Error creando configuración:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Actualizar configuración de integración
router.put('/configurations/:configId', authenticateToken, requireAdminRole, async (req, res) => {
    try {
        const { configId } = req.params;
        const {
            integration_name,
            base_url,
            api_version,
            credentials,
            field_mappings,
            sync_settings,
            is_active
        } = req.body;

        const result = await pool.query(`
            UPDATE integration_configurations 
            SET integration_name = $1, base_url = $2, api_version = $3,
                credentials = $4, field_mappings = $5, sync_settings = $6,
                is_active = $7, updated_at = NOW()
            WHERE id = $8
            RETURNING id, integration_type, integration_name, provider_name, 
                     base_url, api_version, field_mappings, sync_settings, 
                     is_active, updated_at
        `, [
            integration_name, base_url, api_version,
            JSON.stringify(credentials),
            JSON.stringify(field_mappings),
            JSON.stringify(sync_settings),
            is_active, configId
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Configuración no encontrada' });
        }

        res.json({
            message: 'Configuración actualizada exitosamente',
            integration: result.rows[0]
        });

    } catch (error) {
        console.error('Error actualizando configuración:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==========================================
// SINCRONIZACIÓN DE DATOS
// ==========================================

// Sincronizar estudiantes desde sistema externo
router.post('/sync/students', authenticateToken, requireAdminRole, async (req, res) => {
    try {
        const { integration_id, force_sync = false } = req.body;

        // Obtener configuración de integración
        const configResult = await pool.query(`
            SELECT * FROM integration_configurations 
            WHERE id = $1 AND is_active = true
        `, [integration_id]);

        if (configResult.rows.length === 0) {
            return res.status(404).json({ error: 'Configuración de integración no encontrada' });
        }

        const config = configResult.rows[0];

        // Simular sincronización (en implementación real, aquí haría llamadas a APIs externas)
        const syncResult = await simulateStudentSync(config, force_sync);

        // Registrar operación de sincronización
        await pool.query(`
            INSERT INTO sync_operations (
                integration_id, operation_type, status, 
                records_processed, records_created, records_updated,
                sync_details
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
            integration_id, 'student_sync', syncResult.status,
            syncResult.processed, syncResult.created, syncResult.updated,
            JSON.stringify(syncResult.details)
        ]);

        res.json({
            message: 'Sincronización de estudiantes completada',
            result: syncResult
        });

    } catch (error) {
        console.error('Error en sincronización de estudiantes:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Sincronizar calificaciones hacia sistema externo
router.post('/sync/grades', authenticateToken, requireAdminRole, async (req, res) => {
    try {
        const { integration_id, class_ids, date_range } = req.body;

        // Obtener configuración
        const configResult = await pool.query(`
            SELECT * FROM integration_configurations 
            WHERE id = $1 AND is_active = true
        `, [integration_id]);

        if (configResult.rows.length === 0) {
            return res.status(404).json({ error: 'Configuración no encontrada' });
        }

        const config = configResult.rows[0];

        // Obtener calificaciones para sincronizar
        const gradesResult = await pool.query(`
            SELECT 
                ap.student_id,
                u.nickname,
                ap.percentage as grade,
                ap.date_completed,
                tc.class_name,
                ca.assignment_name
            FROM academic_progress ap
            JOIN users u ON ap.student_id = u.id
            JOIN teacher_classes tc ON ap.class_id = tc.id
            JOIN content_assignments ca ON ap.assignment_id = ca.id
            WHERE ap.class_id = ANY($1)
            AND ap.date_completed BETWEEN $2 AND $3
            AND ap.percentage IS NOT NULL
            ORDER BY ap.date_completed DESC
        `, [class_ids, date_range.start, date_range.end]);

        // Simular envío de calificaciones
        const syncResult = await simulateGradeSync(config, gradesResult.rows);

        // Registrar operación
        await pool.query(`
            INSERT INTO sync_operations (
                integration_id, operation_type, status,
                records_processed, records_created, records_updated,
                sync_details
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
            integration_id, 'grade_sync', syncResult.status,
            syncResult.processed, syncResult.created, syncResult.updated,
            JSON.stringify(syncResult.details)
        ]);

        res.json({
            message: 'Sincronización de calificaciones completada',
            result: syncResult
        });

    } catch (error) {
        console.error('Error en sincronización de calificaciones:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==========================================
// MAPEO DE CAMPOS
// ==========================================

// Obtener mapeo de campos sugerido
router.get('/field-mapping/:integrationType', authenticateToken, requireAdminRole, async (req, res) => {
    try {
        const { integrationType } = req.params;

        // Mapeos predefinidos por tipo de integración
        const fieldMappings = {
            'canvas_lms': {
                student_fields: {
                    'user_id': 'external_id',
                    'nickname': 'name',
                    'email': 'email',
                    'first_name': 'first_name',
                    'last_name': 'last_name'
                },
                grade_fields: {
                    'assignment_id': 'assignment_id',
                    'student_id': 'user_id',
                    'score': 'grade',
                    'submitted_at': 'submitted_at'
                }
            },
            'moodle': {
                student_fields: {
                    'user_id': 'id',
                    'nickname': 'username',
                    'email': 'email',
                    'first_name': 'firstname',
                    'last_name': 'lastname'
                },
                grade_fields: {
                    'assignment_id': 'itemid',
                    'student_id': 'userid',
                    'score': 'rawgrade',
                    'submitted_at': 'timemodified'
                }
            },
            'schoology': {
                student_fields: {
                    'user_id': 'uid',
                    'nickname': 'username',
                    'email': 'primary_email',
                    'first_name': 'name_first',
                    'last_name': 'name_last'
                },
                grade_fields: {
                    'assignment_id': 'assignment_id',
                    'student_id': 'uid',
                    'score': 'grade',
                    'submitted_at': 'timestamp'
                }
            }
        };

        const mapping = fieldMappings[integrationType] || {
            student_fields: {},
            grade_fields: {},
            note: 'Mapeo personalizado requerido para este tipo de integración'
        };

        res.json({ field_mapping: mapping });

    } catch (error) {
        console.error('Error obteniendo mapeo de campos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==========================================
// HISTORIAL DE SINCRONIZACIÓN
// ==========================================

// Obtener historial de operaciones de sincronización
router.get('/sync-history', authenticateToken, requireAdminRole, async (req, res) => {
    try {
        const { integration_id, operation_type, limit = 50 } = req.query;

        let query = `
            SELECT 
                so.*,
                ic.integration_name,
                ic.provider_name
            FROM sync_operations so
            JOIN integration_configurations ic ON so.integration_id = ic.id
            WHERE 1=1
        `;

        const params = [];
        let paramIndex = 1;

        if (integration_id) {
            query += ` AND so.integration_id = $${paramIndex}`;
            params.push(integration_id);
            paramIndex++;
        }

        if (operation_type) {
            query += ` AND so.operation_type = $${paramIndex}`;
            params.push(operation_type);
            paramIndex++;
        }

        query += ` ORDER BY so.created_at DESC LIMIT $${paramIndex}`;
        params.push(limit);

        const operations = await pool.query(query, params);

        res.json({ sync_operations: operations.rows });

    } catch (error) {
        console.error('Error obteniendo historial de sincronización:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==========================================
// FUNCIONES DE SIMULACIÓN
// (En implementación real, estas serían llamadas a APIs externas)
// ==========================================

async function simulateStudentSync(config, forceSync) {
    // Simular obtención de datos del sistema externo
    const externalStudents = [
        {
            external_id: 'EXT001',
            username: 'estudiante1',
            email: 'est1@example.com',
            first_name: 'Juan',
            last_name: 'Pérez'
        },
        {
            external_id: 'EXT002',
            username: 'estudiante2',
            email: 'est2@example.com',
            first_name: 'María',
            last_name: 'García'
        }
    ];

    let created = 0;
    let updated = 0;
    const details = [];

    for (const extStudent of externalStudents) {
        try {
            // Verificar si el usuario ya existe
            const existingUser = await pool.query(`
                SELECT id FROM users WHERE external_id = $1
            `, [extStudent.external_id]);

            if (existingUser.rows.length === 0) {
                // Crear nuevo usuario
                await pool.query(`
                    INSERT INTO users (nickname, email, external_id, created_via_integration)
                    VALUES ($1, $2, $3, true)
                `, [extStudent.username, extStudent.email, extStudent.external_id]);

                created++;
                details.push(`Creado: ${extStudent.username}`);
            } else if (forceSync) {
                // Actualizar usuario existente
                await pool.query(`
                    UPDATE users 
                    SET nickname = $1, email = $2, updated_at = NOW()
                    WHERE external_id = $3
                `, [extStudent.username, extStudent.email, extStudent.external_id]);

                updated++;
                details.push(`Actualizado: ${extStudent.username}`);
            }
        } catch (error) {
            details.push(`Error con ${extStudent.username}: ${error.message}`);
        }
    }

    return {
        status: 'completed',
        processed: externalStudents.length,
        created,
        updated,
        details
    };
}

async function simulateGradeSync(config, grades) {
    // Simular envío de calificaciones al sistema externo
    let processed = 0;
    let successful = 0;
    const details = [];

    for (const grade of grades) {
        try {
            // Simular llamada a API externa
            // En implementación real: await externalAPI.updateGrade(grade)
            
            processed++;
            successful++;
            details.push(`Enviado: ${grade.nickname} - ${grade.assignment_name}: ${grade.grade}%`);
        } catch (error) {
            details.push(`Error: ${grade.nickname} - ${error.message}`);
        }
    }

    return {
        status: 'completed',
        processed,
        created: 0,
        updated: successful,
        details
    };
}

module.exports = router;