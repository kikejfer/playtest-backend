const express = require('express');
const router = express.Router();
const pool = require('../database/connection');
const { authenticateToken } = require('../middleware/auth');

// ==========================================
// API ENDPOINTS - PANEL DE PROFESORES
// Sistema completo de gestión académica y seguimiento pedagógico
// ==========================================

// Middleware para verificar que el usuario es profesor
const requireTeacherRole = async (req, res, next) => {
    try {
        // Verificar que el usuario tiene rol de profesor
        const teacherCheck = await pool.query(`
            SELECT ur.id FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = $1 AND r.name IN ('profesor', 'administrador_principal', 'administrador_secundario')
        `, [req.user.id]);
        
        if (teacherCheck.rows.length === 0) {
            return res.status(403).json({ 
                error: 'Acceso denegado: se requiere rol de profesor'
            });
        }
        
        req.user.isTeacher = true;
        next();
    } catch (error) {
        console.error('Error verificando rol de profesor:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};

// ==========================================
// PESTAÑA 1 - GESTIÓN DE ALUMNOS Y CLASES
// ==========================================

// Crear nueva clase
router.post('/classes', authenticateToken, requireTeacherRole, async (req, res) => {
    try {
        const teacherId = req.user.id;
        const {
            class_name,
            subject,
            grade_level,
            academic_year,
            semester,
            max_students,
            meeting_schedule,
            class_room,
            curriculum_standards,
            learning_objectives,
            assessment_criteria,
            start_date,
            end_date
        } = req.body;

        // Generar código único para la clase
        const codeResult = await pool.query('SELECT generate_class_code() as code');
        const class_code = codeResult.rows[0].code;

        const result = await pool.query(`
            INSERT INTO teacher_classes (
                teacher_id, class_name, class_code, subject, grade_level,
                academic_year, semester, max_students, meeting_schedule,
                class_room, curriculum_standards, learning_objectives,
                assessment_criteria, start_date, end_date
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            RETURNING *
        `, [
            teacherId, class_name, class_code, subject, grade_level,
            academic_year, semester, max_students,
            JSON.stringify(meeting_schedule), class_room,
            JSON.stringify(curriculum_standards), JSON.stringify(learning_objectives),
            JSON.stringify(assessment_criteria), start_date, end_date
        ]);

        res.status(201).json({
            message: 'Clase creada exitosamente',
            class: result.rows[0]
        });

    } catch (error) {
        console.error('Error creando clase:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener clases del profesor
router.get('/classes', authenticateToken, requireTeacherRole, async (req, res) => {
    try {
        const teacherId = req.user.id;
        const { status = 'active' } = req.query;

        const classes = await pool.query(`
            SELECT 
                tc.*,
                COUNT(ce.student_id) as enrolled_students,
                COALESCE(AVG(
                    CASE WHEN at.status = 'present' THEN 1 
                         WHEN at.status = 'absent' THEN 0 
                         ELSE NULL END
                ), 0) * 100 as avg_attendance_rate
            FROM teacher_classes tc
            LEFT JOIN class_enrollments ce ON tc.id = ce.class_id AND ce.enrollment_status = 'active'
            LEFT JOIN attendance_tracking at ON tc.id = at.class_id 
                AND at.attendance_date >= CURRENT_DATE - INTERVAL '30 days'
            WHERE tc.teacher_id = $1 
            ${status !== 'all' ? 'AND tc.is_active = $2' : ''}
            GROUP BY tc.id
            ORDER BY tc.created_at DESC
        `, status !== 'all' ? [teacherId, status === 'active'] : [teacherId]);

        res.json({ classes: classes.rows });

    } catch (error) {
        console.error('Error obteniendo clases:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Inscribir estudiante en clase (por código)
router.post('/classes/:classCode/enroll', authenticateToken, async (req, res) => {
    try {
        const { classCode } = req.params;
        const studentId = req.user.id;
        const { parent_guardian_info, emergency_contacts } = req.body;

        // Verificar que la clase existe y está activa
        const classResult = await pool.query(`
            SELECT id, max_students, current_students, class_name 
            FROM teacher_classes 
            WHERE class_code = $1 AND is_active = true
        `, [classCode]);

        if (classResult.rows.length === 0) {
            return res.status(404).json({ error: 'Código de clase inválido o clase inactiva' });
        }

        const classInfo = classResult.rows[0];

        // Verificar capacidad
        if (classInfo.current_students >= classInfo.max_students) {
            return res.status(400).json({ error: 'La clase ha alcanzado su capacidad máxima' });
        }

        // Verificar si ya está inscrito
        const existingEnrollment = await pool.query(`
            SELECT id FROM class_enrollments 
            WHERE class_id = $1 AND student_id = $2
        `, [classInfo.id, studentId]);

        if (existingEnrollment.rows.length > 0) {
            return res.status(400).json({ error: 'Ya estás inscrito en esta clase' });
        }

        // Inscribir estudiante
        const enrollmentResult = await pool.query(`
            INSERT INTO class_enrollments (
                class_id, student_id, parent_guardian_info, emergency_contacts
            ) VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [
            classInfo.id, studentId,
            JSON.stringify(parent_guardian_info),
            JSON.stringify(emergency_contacts)
        ]);

        // Actualizar contador de estudiantes
        await pool.query(`
            UPDATE teacher_classes 
            SET current_students = current_students + 1 
            WHERE id = $1
        `, [classInfo.id]);

        res.status(201).json({
            message: `Inscrito exitosamente en ${classInfo.class_name}`,
            enrollment: enrollmentResult.rows[0]
        });

    } catch (error) {
        console.error('Error inscribiendo estudiante:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener estudiantes de una clase
router.get('/classes/:classId/students', authenticateToken, requireTeacherRole, async (req, res) => {
    try {
        const { classId } = req.params;
        const teacherId = req.user.id;

        // Verificar que la clase pertenece al profesor
        const classCheck = await pool.query(`
            SELECT id FROM teacher_classes WHERE id = $1 AND teacher_id = $2
        `, [classId, teacherId]);

        if (classCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Acceso denegado a esta clase' });
        }

        const students = await pool.query(`
            SELECT 
                u.id,
                u.nickname,
                up.first_name,
                up.last_name,
                ce.enrollment_date,
                ce.enrollment_status,
                ce.learning_style,
                ce.attendance_rate,
                ce.engagement_score,
                ce.last_activity,
                sap.dominant_learning_style,
                sap.strengths_mapping,
                sap.weaknesses_mapping,
                
                -- Métricas recientes de rendimiento
                COALESCE(recent_progress.avg_score, 0) as recent_avg_score,
                COALESCE(recent_progress.completion_rate, 0) as recent_completion_rate,
                
                -- Asistencia reciente
                COALESCE(recent_attendance.attendance_rate, 0) as recent_attendance_rate,
                COALESCE(recent_attendance.avg_engagement, 0) as avg_engagement_score
                
            FROM class_enrollments ce
            JOIN users u ON ce.student_id = u.id
            LEFT JOIN user_profiles up ON u.id = up.user_id
            LEFT JOIN student_academic_profiles sap ON u.id = sap.student_id AND sap.class_id = ce.class_id
            
            -- Progreso académico reciente (últimos 30 días)
            LEFT JOIN (
                SELECT 
                    student_id,
                    AVG(percentage) as avg_score,
                    (COUNT(CASE WHEN date_completed IS NOT NULL THEN 1 END)::DECIMAL / 
                     NULLIF(COUNT(*), 0)) * 100 as completion_rate
                FROM academic_progress
                WHERE class_id = $1 AND date_started >= CURRENT_DATE - INTERVAL '30 days'
                GROUP BY student_id
            ) recent_progress ON u.id = recent_progress.student_id
            
            -- Asistencia reciente (últimos 30 días)
            LEFT JOIN (
                SELECT 
                    student_id,
                    (COUNT(CASE WHEN status = 'present' THEN 1 END)::DECIMAL / 
                     NULLIF(COUNT(*), 0)) * 100 as attendance_rate,
                    AVG(engagement_score) as avg_engagement
                FROM attendance_tracking
                WHERE class_id = $1 AND attendance_date >= CURRENT_DATE - INTERVAL '30 days'
                GROUP BY student_id
            ) recent_attendance ON u.id = recent_attendance.student_id
            
            WHERE ce.class_id = $1 AND ce.enrollment_status = 'active'
            ORDER BY u.nickname
        `, [classId]);

        res.json({ students: students.rows });

    } catch (error) {
        console.error('Error obteniendo estudiantes:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear perfil académico detallado para estudiante
router.post('/students/:studentId/profile', authenticateToken, requireTeacherRole, async (req, res) => {
    try {
        const { studentId } = req.params;
        const {
            class_id,
            learning_style_assessment,
            dominant_learning_style,
            learning_preferences,
            strengths_mapping,
            weaknesses_mapping,
            improvement_areas,
            individual_goals,
            accommodations
        } = req.body;

        const result = await pool.query(`
            INSERT INTO student_academic_profiles (
                student_id, class_id, learning_style_assessment,
                dominant_learning_style, learning_preferences,
                strengths_mapping, weaknesses_mapping, improvement_areas,
                individual_goals, accommodations
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (student_id, class_id) 
            DO UPDATE SET
                learning_style_assessment = EXCLUDED.learning_style_assessment,
                dominant_learning_style = EXCLUDED.dominant_learning_style,
                learning_preferences = EXCLUDED.learning_preferences,
                strengths_mapping = EXCLUDED.strengths_mapping,
                weaknesses_mapping = EXCLUDED.weaknesses_mapping,
                improvement_areas = EXCLUDED.improvement_areas,
                individual_goals = EXCLUDED.individual_goals,
                accommodations = EXCLUDED.accommodations,
                last_updated = NOW()
            RETURNING *
        `, [
            studentId, class_id,
            JSON.stringify(learning_style_assessment),
            dominant_learning_style,
            JSON.stringify(learning_preferences),
            JSON.stringify(strengths_mapping),
            JSON.stringify(weaknesses_mapping),
            JSON.stringify(improvement_areas),
            JSON.stringify(individual_goals),
            JSON.stringify(accommodations)
        ]);

        res.json({
            message: 'Perfil académico actualizado exitosamente',
            profile: result.rows[0]
        });

    } catch (error) {
        console.error('Error actualizando perfil académico:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Registrar asistencia
router.post('/classes/:classId/attendance', authenticateToken, requireTeacherRole, async (req, res) => {
    try {
        const { classId } = req.params;
        const { attendance_records } = req.body; // Array de registros de asistencia

        const results = [];

        for (const record of attendance_records) {
            const {
                student_id,
                attendance_date,
                status,
                arrival_time,
                departure_time,
                participation_level,
                engagement_score,
                behavior_notes,
                activities_completed,
                blocks_attempted,
                blocks_completed,
                time_on_task,
                teacher_observations
            } = record;

            const result = await pool.query(`
                INSERT INTO attendance_tracking (
                    class_id, student_id, attendance_date, status,
                    arrival_time, departure_time, participation_level,
                    engagement_score, behavior_notes, activities_completed,
                    blocks_attempted, blocks_completed, time_on_task,
                    teacher_observations
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                ON CONFLICT (class_id, student_id, attendance_date)
                DO UPDATE SET
                    status = EXCLUDED.status,
                    arrival_time = EXCLUDED.arrival_time,
                    departure_time = EXCLUDED.departure_time,
                    participation_level = EXCLUDED.participation_level,
                    engagement_score = EXCLUDED.engagement_score,
                    behavior_notes = EXCLUDED.behavior_notes,
                    activities_completed = EXCLUDED.activities_completed,
                    blocks_attempted = EXCLUDED.blocks_attempted,
                    blocks_completed = EXCLUDED.blocks_completed,
                    time_on_task = EXCLUDED.time_on_task,
                    teacher_observations = EXCLUDED.teacher_observations
                RETURNING *
            `, [
                classId, student_id, attendance_date, status,
                arrival_time, departure_time, participation_level,
                engagement_score, behavior_notes, activities_completed,
                blocks_attempted, blocks_completed, time_on_task,
                teacher_observations
            ]);

            results.push(result.rows[0]);
        }

        res.json({
            message: 'Asistencia registrada exitosamente',
            attendance_records: results
        });

    } catch (error) {
        console.error('Error registrando asistencia:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==========================================
// PESTAÑA 2 - CRONOGRAMAS ACADÉMICOS Y PLANIFICACIÓN
// ==========================================

// Crear cronograma académico
router.post('/schedules', authenticateToken, requireTeacherRole, async (req, res) => {
    try {
        const teacherId = req.user.id;
        const {
            class_id,
            schedule_name,
            schedule_type,
            start_date,
            end_date,
            curriculum_mapping,
            learning_milestones,
            pacing_guide,
            content_distribution,
            difficulty_progression,
            prerequisites_map,
            assessment_schedule,
            exam_dates,
            checkpoint_dates
        } = req.body;

        const result = await pool.query(`
            INSERT INTO academic_schedules (
                class_id, teacher_id, schedule_name, schedule_type,
                start_date, end_date, curriculum_mapping,
                learning_milestones, pacing_guide, content_distribution,
                difficulty_progression, prerequisites_map,
                assessment_schedule, exam_dates, checkpoint_dates
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            RETURNING *
        `, [
            class_id, teacherId, schedule_name, schedule_type,
            start_date, end_date,
            JSON.stringify(curriculum_mapping),
            JSON.stringify(learning_milestones),
            JSON.stringify(pacing_guide),
            JSON.stringify(content_distribution),
            JSON.stringify(difficulty_progression),
            JSON.stringify(prerequisites_map),
            JSON.stringify(assessment_schedule),
            JSON.stringify(exam_dates),
            JSON.stringify(checkpoint_dates)
        ]);

        res.status(201).json({
            message: 'Cronograma académico creado exitosamente',
            schedule: result.rows[0]
        });

    } catch (error) {
        console.error('Error creando cronograma:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener cronogramas de una clase
router.get('/classes/:classId/schedules', authenticateToken, requireTeacherRole, async (req, res) => {
    try {
        const { classId } = req.params;
        const teacherId = req.user.id;

        const schedules = await pool.query(`
            SELECT * FROM academic_schedules
            WHERE class_id = $1 AND teacher_id = $2 AND is_active = true
            ORDER BY start_date DESC
        `, [classId, teacherId]);

        res.json({ schedules: schedules.rows });

    } catch (error) {
        console.error('Error obteniendo cronogramas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear asignación de contenido
router.post('/assignments', authenticateToken, requireTeacherRole, async (req, res) => {
    try {
        const {
            schedule_id,
            class_id,
            assignment_name,
            assignment_type,
            block_ids,
            due_date,
            estimated_duration,
            difficulty_level,
            learning_objectives,
            success_criteria,
            differentiated_versions,
            accommodations,
            enrichment_activities,
            auto_assign,
            adaptive_difficulty
        } = req.body;

        const result = await pool.query(`
            INSERT INTO content_assignments (
                schedule_id, class_id, assignment_name, assignment_type,
                block_ids, due_date, estimated_duration, difficulty_level,
                learning_objectives, success_criteria, differentiated_versions,
                accommodations, enrichment_activities, auto_assign, adaptive_difficulty
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            RETURNING *
        `, [
            schedule_id, class_id, assignment_name, assignment_type,
            block_ids, due_date, estimated_duration, difficulty_level,
            JSON.stringify(learning_objectives),
            JSON.stringify(success_criteria),
            JSON.stringify(differentiated_versions),
            JSON.stringify(accommodations),
            JSON.stringify(enrichment_activities),
            auto_assign, adaptive_difficulty
        ]);

        res.status(201).json({
            message: 'Asignación creada exitosamente',
            assignment: result.rows[0]
        });

    } catch (error) {
        console.error('Error creando asignación:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==========================================
// PESTAÑA 3 - ANALYTICS PEDAGÓGICOS AVANZADOS
// ==========================================

// Obtener analytics pedagógicos de una clase
router.get('/classes/:classId/analytics', authenticateToken, requireTeacherRole, async (req, res) => {
    try {
        const { classId } = req.params;
        const { period = '30' } = req.query;

        // Evolución individual de estudiantes
        const studentProgress = await pool.query(`
            SELECT 
                u.id as student_id,
                u.nickname,
                calculate_student_progress_metrics(u.id, $1) as metrics,
                
                -- Curvas de aprendizaje (progreso en el tiempo)
                array_agg(
                    json_build_object(
                        'date', ap.date_completed,
                        'score', ap.percentage,
                        'time_spent', ap.time_spent
                    ) ORDER BY ap.date_completed
                ) FILTER (WHERE ap.date_completed IS NOT NULL) as learning_curve,
                
                -- Análisis de patrones de error
                json_agg(DISTINCT ap.error_patterns) FILTER (WHERE ap.error_patterns IS NOT NULL) as error_patterns,
                
                -- Retención de conocimientos
                AVG(CASE 
                    WHEN ap.date_completed >= CURRENT_DATE - INTERVAL '7 days' THEN ap.percentage
                    ELSE NULL 
                END) as recent_retention
                
            FROM class_enrollments ce
            JOIN users u ON ce.student_id = u.id
            LEFT JOIN academic_progress ap ON u.id = ap.student_id 
                AND ap.class_id = $1 
                AND ap.date_started >= CURRENT_DATE - INTERVAL $2
            WHERE ce.class_id = $1 AND ce.enrollment_status = 'active'
            GROUP BY u.id, u.nickname
            ORDER BY u.nickname
        `, [classId, `${period} days`]);

        // Análisis comparativo grupal
        const classOverview = await pool.query(`
            SELECT 
                COUNT(DISTINCT ce.student_id) as total_students,
                
                -- Métricas promedio de la clase
                AVG(recent_progress.avg_score) as class_avg_score,
                AVG(recent_attendance.attendance_rate) as class_avg_attendance,
                AVG(recent_attendance.avg_engagement) as class_avg_engagement,
                
                -- Distribución de rendimiento
                COUNT(CASE WHEN recent_progress.avg_score >= 90 THEN 1 END) as excellent_performers,
                COUNT(CASE WHEN recent_progress.avg_score >= 80 AND recent_progress.avg_score < 90 THEN 1 END) as good_performers,
                COUNT(CASE WHEN recent_progress.avg_score >= 70 AND recent_progress.avg_score < 80 THEN 1 END) as average_performers,
                COUNT(CASE WHEN recent_progress.avg_score < 70 THEN 1 END) as struggling_students,
                
                -- Identificación de outliers
                array_agg(
                    CASE WHEN recent_progress.avg_score >= 95 OR recent_progress.avg_score <= 50 THEN
                        json_build_object(
                            'student_id', ce.student_id,
                            'nickname', u.nickname,
                            'score', recent_progress.avg_score,
                            'type', CASE WHEN recent_progress.avg_score >= 95 THEN 'high_performer' ELSE 'at_risk' END
                        )
                    ELSE NULL END
                ) FILTER (WHERE recent_progress.avg_score >= 95 OR recent_progress.avg_score <= 50) as outliers
                
            FROM class_enrollments ce
            JOIN users u ON ce.student_id = u.id
            LEFT JOIN (
                SELECT 
                    student_id,
                    AVG(percentage) as avg_score
                FROM academic_progress
                WHERE class_id = $1 AND date_started >= CURRENT_DATE - INTERVAL $2
                GROUP BY student_id
            ) recent_progress ON ce.student_id = recent_progress.student_id
            LEFT JOIN (
                SELECT 
                    student_id,
                    (COUNT(CASE WHEN status = 'present' THEN 1 END)::DECIMAL / 
                     NULLIF(COUNT(*), 0)) * 100 as attendance_rate,
                    AVG(engagement_score) as avg_engagement
                FROM attendance_tracking
                WHERE class_id = $1 AND attendance_date >= CURRENT_DATE - INTERVAL $2
                GROUP BY student_id
            ) recent_attendance ON ce.student_id = recent_attendance.student_id
            WHERE ce.class_id = $1 AND ce.enrollment_status = 'active'
        `, [classId, `${period} days`]);

        // Predicción de resultados académicos usando IA simple
        const riskAssessment = await pool.query(`
            SELECT 
                u.id as student_id,
                u.nickname,
                CASE 
                    WHEN recent_metrics.avg_score < 60 AND recent_metrics.attendance_rate < 75 THEN 'high_risk'
                    WHEN recent_metrics.avg_score < 70 OR recent_metrics.attendance_rate < 80 THEN 'medium_risk'
                    WHEN recent_metrics.avg_score >= 90 AND recent_metrics.attendance_rate >= 95 THEN 'advanced'
                    ELSE 'on_track'
                END as risk_level,
                
                -- Probabilidad de éxito (algoritmo simple)
                CASE 
                    WHEN recent_metrics.avg_score IS NULL THEN 0.5
                    ELSE GREATEST(0, LEAST(1, 
                        (recent_metrics.avg_score / 100.0) * 0.7 + 
                        (recent_metrics.attendance_rate / 100.0) * 0.2 + 
                        (recent_metrics.engagement_score / 10.0) * 0.1
                    ))
                END as success_probability,
                
                recent_metrics.*
                
            FROM class_enrollments ce
            JOIN users u ON ce.student_id = u.id
            LEFT JOIN (
                SELECT 
                    ap.student_id,
                    AVG(ap.percentage) as avg_score,
                    AVG(at.engagement_score) as engagement_score,
                    (COUNT(CASE WHEN at.status = 'present' THEN 1 END)::DECIMAL / 
                     NULLIF(COUNT(at.status), 0)) * 100 as attendance_rate
                FROM academic_progress ap
                LEFT JOIN attendance_tracking at ON ap.student_id = at.student_id 
                    AND ap.class_id = at.class_id
                WHERE ap.class_id = $1 
                    AND ap.date_started >= CURRENT_DATE - INTERVAL $2
                GROUP BY ap.student_id
            ) recent_metrics ON ce.student_id = recent_metrics.student_id
            WHERE ce.class_id = $1 AND ce.enrollment_status = 'active'
            ORDER BY success_probability ASC
        `, [classId, `${period} days`]);

        res.json({
            studentProgress: studentProgress.rows,
            classOverview: classOverview.rows[0],
            riskAssessment: riskAssessment.rows
        });

    } catch (error) {
        console.error('Error obteniendo analytics pedagógicos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==========================================
// PESTAÑA 5 - TORNEOS Y RETOS EDUCATIVOS
// ==========================================

// Crear torneo educativo
router.post('/tournaments', authenticateToken, requireTeacherRole, async (req, res) => {
    try {
        const teacherId = req.user.id;
        const {
            class_id,
            tournament_name,
            description,
            tournament_type,
            learning_objectives,
            curriculum_alignment,
            competencies_targeted,
            format_type,
            team_size,
            max_participants,
            assessment_criteria,
            scoring_rubric,
            peer_assessment_enabled,
            collaboration_requirements,
            research_components,
            presentation_requirements,
            registration_start,
            registration_end,
            tournament_start,
            tournament_end,
            academic_rewards,
            recognition_criteria,
            effort_recognition,
            anxiety_reduction_features
        } = req.body;

        const result = await pool.query(`
            INSERT INTO educational_tournaments (
                teacher_id, class_id, tournament_name, description,
                tournament_type, learning_objectives, curriculum_alignment,
                competencies_targeted, format_type, team_size, max_participants,
                assessment_criteria, scoring_rubric, peer_assessment_enabled,
                collaboration_requirements, research_components, presentation_requirements,
                registration_start, registration_end, tournament_start, tournament_end,
                academic_rewards, recognition_criteria, effort_recognition,
                anxiety_reduction_features
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
            RETURNING *
        `, [
            teacherId, class_id, tournament_name, description,
            tournament_type, 
            JSON.stringify(learning_objectives),
            JSON.stringify(curriculum_alignment),
            JSON.stringify(competencies_targeted),
            format_type, team_size, max_participants,
            JSON.stringify(assessment_criteria),
            JSON.stringify(scoring_rubric),
            peer_assessment_enabled,
            JSON.stringify(collaboration_requirements),
            JSON.stringify(research_components),
            JSON.stringify(presentation_requirements),
            registration_start, registration_end, tournament_start, tournament_end,
            JSON.stringify(academic_rewards),
            JSON.stringify(recognition_criteria),
            effort_recognition,
            JSON.stringify(anxiety_reduction_features)
        ]);

        res.status(201).json({
            message: 'Torneo educativo creado exitosamente',
            tournament: result.rows[0]
        });

    } catch (error) {
        console.error('Error creando torneo:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener torneos del profesor
router.get('/tournaments', authenticateToken, requireTeacherRole, async (req, res) => {
    try {
        const teacherId = req.user.id;
        const { status = 'all', class_id } = req.query;

        let query = `
            SELECT 
                et.*,
                tc.class_name,
                COUNT(DISTINCT tp.student_id) as registered_participants,
                json_agg(
                    DISTINCT jsonb_build_object(
                        'student_id', tp.student_id,
                        'nickname', u.nickname,
                        'team_name', tp.team_name,
                        'registration_date', tp.registration_date
                    )
                ) FILTER (WHERE tp.student_id IS NOT NULL) as participants
            FROM educational_tournaments et
            JOIN teacher_classes tc ON et.class_id = tc.id
            LEFT JOIN tournament_participants tp ON et.id = tp.tournament_id
            LEFT JOIN users u ON tp.student_id = u.id
            WHERE et.teacher_id = $1
        `;

        const params = [teacherId];
        let paramIndex = 2;

        if (status !== 'all') {
            query += ` AND et.status = $${paramIndex}`;
            params.push(status);
            paramIndex++;
        }

        if (class_id) {
            query += ` AND et.class_id = $${paramIndex}`;
            params.push(class_id);
        }

        query += `
            GROUP BY et.id, tc.class_name
            ORDER BY et.tournament_start DESC
        `;

        const tournaments = await pool.query(query, params);

        res.json({ tournaments: tournaments.rows });

    } catch (error) {
        console.error('Error obteniendo torneos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Inscribir estudiante en torneo
router.post('/tournaments/:tournamentId/register', authenticateToken, async (req, res) => {
    try {
        const { tournamentId } = req.params;
        const studentId = req.user.id;
        const { team_name, collaboration_preferences } = req.body;

        // Verificar que el torneo existe y está en período de registro
        const tournamentResult = await pool.query(`
            SELECT et.*, tc.class_name
            FROM educational_tournaments et
            JOIN teacher_classes tc ON et.class_id = tc.id
            WHERE et.id = $1 
            AND et.status = 'registration'
            AND NOW() BETWEEN et.registration_start AND et.registration_end
        `, [tournamentId]);

        if (tournamentResult.rows.length === 0) {
            return res.status(400).json({ 
                error: 'Torneo no disponible para registro o fuera del período de inscripción' 
            });
        }

        const tournament = tournamentResult.rows[0];

        // Verificar que el estudiante está inscrito en la clase
        const enrollmentCheck = await pool.query(`
            SELECT id FROM class_enrollments 
            WHERE class_id = $1 AND student_id = $2 AND enrollment_status = 'active'
        `, [tournament.class_id, studentId]);

        if (enrollmentCheck.rows.length === 0) {
            return res.status(403).json({ 
                error: 'No estás inscrito en esta clase' 
            });
        }

        // Verificar capacidad
        const participantCount = await pool.query(`
            SELECT COUNT(*) as count FROM tournament_participants WHERE tournament_id = $1
        `, [tournamentId]);

        if (participantCount.rows[0].count >= tournament.max_participants) {
            return res.status(400).json({ error: 'El torneo ha alcanzado su capacidad máxima' });
        }

        // Verificar si ya está registrado
        const existingRegistration = await pool.query(`
            SELECT id FROM tournament_participants 
            WHERE tournament_id = $1 AND student_id = $2
        `, [tournamentId, studentId]);

        if (existingRegistration.rows.length > 0) {
            return res.status(400).json({ error: 'Ya estás registrado en este torneo' });
        }

        // Registrar participante
        const registrationResult = await pool.query(`
            INSERT INTO tournament_participants (
                tournament_id, student_id, team_name, collaboration_preferences
            ) VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [
            tournamentId, studentId, team_name,
            JSON.stringify(collaboration_preferences)
        ]);

        res.status(201).json({
            message: `Registrado exitosamente en ${tournament.tournament_name}`,
            registration: registrationResult.rows[0]
        });

    } catch (error) {
        console.error('Error registrando en torneo:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Actualizar progreso de torneo
router.post('/tournaments/:tournamentId/progress', authenticateToken, requireTeacherRole, async (req, res) => {
    try {
        const { tournamentId } = req.params;
        const { participant_progress } = req.body; // Array de progreso de participantes

        const results = [];

        for (const progress of participant_progress) {
            const {
                participant_id,
                phase,
                score,
                feedback,
                achievements,
                collaboration_score,
                presentation_score,
                research_quality,
                creativity_score
            } = progress;

            const result = await pool.query(`
                INSERT INTO tournament_progress (
                    tournament_id, participant_id, phase, score,
                    feedback, achievements, collaboration_score,
                    presentation_score, research_quality, creativity_score
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (tournament_id, participant_id, phase)
                DO UPDATE SET
                    score = EXCLUDED.score,
                    feedback = EXCLUDED.feedback,
                    achievements = EXCLUDED.achievements,
                    collaboration_score = EXCLUDED.collaboration_score,
                    presentation_score = EXCLUDED.presentation_score,
                    research_quality = EXCLUDED.research_quality,
                    creativity_score = EXCLUDED.creativity_score,
                    updated_at = NOW()
                RETURNING *
            `, [
                tournamentId, participant_id, phase, score,
                feedback, JSON.stringify(achievements),
                collaboration_score, presentation_score,
                research_quality, creativity_score
            ]);

            results.push(result.rows[0]);
        }

        res.json({
            message: 'Progreso de torneo actualizado exitosamente',
            progress_updates: results
        });

    } catch (error) {
        console.error('Error actualizando progreso de torneo:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==========================================
// PESTAÑA 6 - HERRAMIENTAS EDUCATIVAS Y RECURSOS
// ==========================================

// Crear recurso educativo
router.post('/resources', authenticateToken, requireTeacherRole, async (req, res) => {
    try {
        const teacherId = req.user.id;
        const {
            resource_name,
            resource_type,
            subject_area,
            grade_level,
            standards_alignment,
            bloom_taxonomy_level,
            learning_objectives,
            resource_content,
            multimedia_elements,
            interactive_components,
            difficulty_level,
            estimated_duration,
            prerequisites,
            differentiation_options,
            accessibility_features,
            language_options,
            tags,
            is_public
        } = req.body;

        const result = await pool.query(`
            INSERT INTO educational_resources (
                teacher_id, resource_name, resource_type, subject_area,
                grade_level, standards_alignment, bloom_taxonomy_level,
                learning_objectives, resource_content, multimedia_elements,
                interactive_components, difficulty_level, estimated_duration,
                prerequisites, differentiation_options, accessibility_features,
                language_options, tags, is_public
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
            RETURNING *
        `, [
            teacherId, resource_name, resource_type, subject_area,
            grade_level,
            JSON.stringify(standards_alignment),
            JSON.stringify(bloom_taxonomy_level),
            JSON.stringify(learning_objectives),
            JSON.stringify(resource_content),
            JSON.stringify(multimedia_elements),
            JSON.stringify(interactive_components),
            difficulty_level, estimated_duration,
            JSON.stringify(prerequisites),
            JSON.stringify(differentiation_options),
            JSON.stringify(accessibility_features),
            JSON.stringify(language_options),
            JSON.stringify(tags),
            is_public
        ]);

        res.status(201).json({
            message: 'Recurso educativo creado exitosamente',
            resource: result.rows[0]
        });

    } catch (error) {
        console.error('Error creando recurso:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener recursos educativos
router.get('/resources', authenticateToken, requireTeacherRole, async (req, res) => {
    try {
        const teacherId = req.user.id;
        const { 
            resource_type, 
            subject_area, 
            grade_level, 
            difficulty_level,
            is_public = 'all',
            search_term 
        } = req.query;

        let query = `
            SELECT 
                er.*,
                COALESCE(AVG(rr.rating), 0) as avg_rating,
                COUNT(rr.id) as review_count
            FROM educational_resources er
            LEFT JOIN resource_reviews rr ON er.id = rr.resource_id
            WHERE er.teacher_id = $1
        `;

        const params = [teacherId];
        let paramIndex = 2;

        if (resource_type) {
            query += ` AND er.resource_type = $${paramIndex}`;
            params.push(resource_type);
            paramIndex++;
        }

        if (subject_area) {
            query += ` AND er.subject_area = $${paramIndex}`;
            params.push(subject_area);
            paramIndex++;
        }

        if (grade_level) {
            query += ` AND er.grade_level = $${paramIndex}`;
            params.push(grade_level);
            paramIndex++;
        }

        if (difficulty_level) {
            query += ` AND er.difficulty_level = $${paramIndex}`;
            params.push(difficulty_level);
            paramIndex++;
        }

        if (is_public !== 'all') {
            query += ` AND er.is_public = $${paramIndex}`;
            params.push(is_public === 'true');
            paramIndex++;
        }

        if (search_term) {
            query += ` AND (er.resource_name ILIKE $${paramIndex} OR er.tags::text ILIKE $${paramIndex})`;
            params.push(`%${search_term}%`);
        }

        query += `
            GROUP BY er.id
            ORDER BY er.created_at DESC
        `;

        const resources = await pool.query(query, params);

        res.json({ resources: resources.rows });

    } catch (error) {
        console.error('Error obteniendo recursos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear comunicación educativa
router.post('/communications', authenticateToken, requireTeacherRole, async (req, res) => {
    try {
        const teacherId = req.user.id;
        const {
            communication_type,
            subject,
            message_content,
            recipient_students,
            recipient_parents,
            class_id,
            delivery_method,
            scheduled_delivery,
            priority_level,
            academic_context,
            progress_data,
            recommendations,
            template_used,
            language
        } = req.body;

        const result = await pool.query(`
            INSERT INTO educational_communications (
                teacher_id, communication_type, subject, message_content,
                recipient_students, recipient_parents, class_id,
                delivery_method, scheduled_delivery, priority_level,
                academic_context, progress_data, recommendations,
                template_used, language
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            RETURNING *
        `, [
            teacherId, communication_type, subject, message_content,
            recipient_students, recipient_parents, class_id,
            delivery_method, scheduled_delivery, priority_level,
            JSON.stringify(academic_context),
            JSON.stringify(progress_data),
            JSON.stringify(recommendations),
            template_used, language
        ]);

        res.status(201).json({
            message: 'Comunicación creada exitosamente',
            communication: result.rows[0]
        });

    } catch (error) {
        console.error('Error creando comunicación:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Generar reporte institucional
router.post('/reports', authenticateToken, requireTeacherRole, async (req, res) => {
    try {
        const teacherId = req.user.id;
        const {
            report_name,
            report_type,
            report_period,
            class_ids,
            student_ids,
            date_range_start,
            date_range_end,
            standards_framework,
            privacy_settings
        } = req.body;

        // Generar datos del reporte basado en el tipo
        let reportData = {};
        let summaryStatistics = {};
        let performanceMetrics = {};

        if (report_type === 'progress') {
            // Generar reporte de progreso académico
            const progressData = await pool.query(`
                SELECT 
                    u.nickname,
                    ap.percentage,
                    ap.date_completed,
                    tc.class_name,
                    ca.assignment_name
                FROM academic_progress ap
                JOIN users u ON ap.student_id = u.id
                JOIN teacher_classes tc ON ap.class_id = tc.id
                JOIN content_assignments ca ON ap.assignment_id = ca.id
                WHERE tc.teacher_id = $1
                ${class_ids ? 'AND ap.class_id = ANY($2)' : ''}
                ${student_ids ? 'AND ap.student_id = ANY($3)' : ''}
                AND ap.date_completed BETWEEN $4 AND $5
                ORDER BY ap.date_completed DESC
            `, [
                teacherId,
                ...(class_ids ? [class_ids] : []),
                ...(student_ids ? [student_ids] : []),
                date_range_start,
                date_range_end
            ]);

            reportData = { academic_progress: progressData.rows };
            
            summaryStatistics = {
                total_assessments: progressData.rows.length,
                average_score: progressData.rows.reduce((sum, row) => sum + (row.percentage || 0), 0) / progressData.rows.length || 0,
                completion_rate: (progressData.rows.filter(row => row.percentage !== null).length / progressData.rows.length) * 100 || 0
            };
        }

        const result = await pool.query(`
            INSERT INTO institutional_reports (
                teacher_id, report_name, report_type, report_period,
                class_ids, student_ids, date_range_start, date_range_end,
                report_data, summary_statistics, performance_metrics,
                standards_framework, privacy_settings
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *
        `, [
            teacherId, report_name, report_type, report_period,
            class_ids, student_ids, date_range_start, date_range_end,
            JSON.stringify(reportData),
            JSON.stringify(summaryStatistics),
            JSON.stringify(performanceMetrics),
            standards_framework,
            JSON.stringify(privacy_settings)
        ]);

        // Actualizar estado a completado
        await pool.query(`
            UPDATE institutional_reports 
            SET generation_status = 'completed' 
            WHERE id = $1
        `, [result.rows[0].id]);

        res.status(201).json({
            message: 'Reporte institucional generado exitosamente',
            report: result.rows[0]
        });

    } catch (error) {
        console.error('Error generando reporte:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==========================================
// PESTAÑA 4 - ESTRATEGIAS PERSONALIZADAS Y INTERVENCIÓN
// ==========================================

// Crear intervención pedagógica
router.post('/interventions', authenticateToken, requireTeacherRole, async (req, res) => {
    try {
        const teacherId = req.user.id;
        const {
            student_id,
            class_id,
            intervention_name,
            intervention_type,
            urgency_level,
            identified_issues,
            intervention_strategy,
            learning_accommodations,
            additional_resources,
            expected_duration,
            family_involvement,
            specialist_consultation
        } = req.body;

        const result = await pool.query(`
            INSERT INTO pedagogical_interventions (
                student_id, teacher_id, class_id, intervention_name,
                intervention_type, urgency_level, identified_issues,
                intervention_strategy, learning_accommodations,
                additional_resources, expected_duration, family_involvement,
                specialist_consultation
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *
        `, [
            student_id, teacherId, class_id, intervention_name,
            intervention_type, urgency_level,
            JSON.stringify(identified_issues),
            JSON.stringify(intervention_strategy),
            JSON.stringify(learning_accommodations),
            JSON.stringify(additional_resources),
            expected_duration,
            JSON.stringify(family_involvement),
            JSON.stringify(specialist_consultation)
        ]);

        res.status(201).json({
            message: 'Intervención pedagógica creada exitosamente',
            intervention: result.rows[0]
        });

    } catch (error) {
        console.error('Error creando intervención:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener recomendaciones de IA para un estudiante
router.get('/students/:studentId/ai-recommendations', authenticateToken, requireTeacherRole, async (req, res) => {
    try {
        const { studentId } = req.params;
        const { classId } = req.query;

        // Obtener datos del estudiante para análisis
        const studentData = await pool.query(`
            SELECT 
                u.nickname,
                sap.dominant_learning_style,
                sap.strengths_mapping,
                sap.weaknesses_mapping,
                sap.motivation_profile,
                
                -- Métricas recientes
                AVG(ap.percentage) as avg_score,
                AVG(ap.time_spent) as avg_time_spent,
                AVG(at.engagement_score) as avg_engagement,
                (COUNT(CASE WHEN at.status = 'present' THEN 1 END)::DECIMAL / 
                 NULLIF(COUNT(at.status), 0)) * 100 as attendance_rate,
                
                -- Patrones de error más comunes
                array_agg(DISTINCT jsonb_array_elements_text(ap.error_patterns::jsonb)) 
                    FILTER (WHERE ap.error_patterns IS NOT NULL) as common_errors
                
            FROM users u
            LEFT JOIN student_academic_profiles sap ON u.id = sap.student_id AND sap.class_id = $2
            LEFT JOIN academic_progress ap ON u.id = ap.student_id AND ap.class_id = $2
                AND ap.date_started >= CURRENT_DATE - INTERVAL '30 days'
            LEFT JOIN attendance_tracking at ON u.id = at.student_id AND at.class_id = $2
                AND at.attendance_date >= CURRENT_DATE - INTERVAL '30 days'
            WHERE u.id = $1
            GROUP BY u.id, u.nickname, sap.dominant_learning_style, sap.strengths_mapping,
                     sap.weaknesses_mapping, sap.motivation_profile
        `, [studentId, classId]);

        if (studentData.rows.length === 0) {
            return res.status(404).json({ error: 'Estudiante no encontrado' });
        }

        const student = studentData.rows[0];

        // Generar recomendaciones basadas en IA (algoritmo de recomendación)
        const recommendations = {
            learning_style_optimization: [],
            intervention_recommendations: [],
            motivation_strategies: [],
            assessment_adaptations: [],
            family_involvement_suggestions: []
        };

        // Recomendaciones basadas en estilo de aprendizaje
        if (student.dominant_learning_style === 'visual') {
            recommendations.learning_style_optimization.push(
                'Usar más diagramas, mapas conceptuales y contenido visual',
                'Implementar organizadores gráficos para estructurar información',
                'Proporcionar ejemplos visuales y demostraciones'
            );
        } else if (student.dominant_learning_style === 'auditory') {
            recommendations.learning_style_optimization.push(
                'Incorporar explicaciones verbales detalladas',
                'Usar técnicas de repetición y discusión grupal',
                'Proporcionar grabaciones de audio para repaso'
            );
        } else if (student.dominant_learning_style === 'kinesthetic') {
            recommendations.learning_style_optimization.push(
                'Incluir actividades prácticas y manipulativas',
                'Permitir movimiento durante el aprendizaje',
                'Usar simulaciones y experimentos interactivos'
            );
        }

        // Recomendaciones basadas en rendimiento
        if (student.avg_score < 60) {
            recommendations.intervention_recommendations.push(
                'Implementar sesiones de tutoría individualizada',
                'Revisar prerrequisitos y llenar lagunas de conocimiento',
                'Considerar evaluación de necesidades especiales'
            );
        } else if (student.avg_score >= 90) {
            recommendations.intervention_recommendations.push(
                'Proporcionar actividades de enriquecimiento',
                'Asignar proyectos de investigación independiente',
                'Considerar aceleración en áreas de fortaleza'
            );
        }

        // Recomendaciones basadas en engagement
        if (student.avg_engagement < 5) {
            recommendations.motivation_strategies.push(
                'Incorporar elementos de gamificación',
                'Conectar contenido con intereses del estudiante',
                'Proporcionar más opciones y autonomía en el aprendizaje'
            );
        }

        // Recomendaciones basadas en asistencia
        if (student.attendance_rate < 80) {
            recommendations.family_involvement_suggestions.push(
                'Contactar familia para discutir barreras de asistencia',
                'Establecer plan de comunicación regular con padres',
                'Investigar factores externos que afectan asistencia'
            );
        }

        res.json({
            student_info: {
                nickname: student.nickname,
                learning_style: student.dominant_learning_style,
                avg_score: student.avg_score,
                attendance_rate: student.attendance_rate,
                engagement_level: student.avg_engagement
            },
            ai_recommendations: recommendations
        });

    } catch (error) {
        console.error('Error generando recomendaciones de IA:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Detectar automáticamente estudiantes que necesitan intervención
router.post('/detect-intervention-needs', authenticateToken, requireTeacherRole, async (req, res) => {
    try {
        // Ejecutar función de detección automática
        await pool.query('SELECT detect_intervention_needs()');

        // Obtener intervenciones creadas para el profesor
        const newInterventions = await pool.query(`
            SELECT 
                pi.*,
                u.nickname as student_nickname,
                tc.class_name
            FROM pedagogical_interventions pi
            JOIN users u ON pi.student_id = u.id
            JOIN teacher_classes tc ON pi.class_id = tc.id
            WHERE pi.teacher_id = $1 
            AND pi.status = 'planned'
            AND pi.created_at >= NOW() - INTERVAL '1 hour'
            ORDER BY pi.urgency_level DESC, pi.created_at DESC
        `, [req.user.id]);

        res.json({
            message: 'Detección de necesidades de intervención completada',
            new_interventions: newInterventions.rows
        });

    } catch (error) {
        console.error('Error detectando necesidades de intervención:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

module.exports = router;