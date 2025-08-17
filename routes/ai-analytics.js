const express = require('express');
const router = express.Router();
const pool = require('../database/connection');
const { authenticateToken } = require('../middleware/auth');

// ==========================================
// ANALYTICS PREDICTIVOS Y IA PEDAGÓGICA
// Sistema avanzado de predicción y recomendaciones educativas
// ==========================================

// Middleware para verificar permisos de profesor o administrador
const requireEducatorRole = async (req, res, next) => {
    try {
        const educatorCheck = await pool.query(`
            SELECT ur.id FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = $1 AND r.name IN ('profesor', 'administrador_principal', 'administrador_secundario')
        `, [req.user.id]);
        
        if (educatorCheck.rows.length === 0) {
            return res.status(403).json({ 
                error: 'Acceso denegado: se requiere rol de educador'
            });
        }
        
        next();
    } catch (error) {
        console.error('Error verificando rol de educador:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};

// ==========================================
// PREDICCIÓN DE RENDIMIENTO ACADÉMICO
// ==========================================

// Predecir rendimiento futuro de estudiantes
router.post('/predict/student-performance', authenticateToken, requireEducatorRole, async (req, res) => {
    try {
        const { student_ids, class_id, prediction_timeframe = 30 } = req.body;

        const predictions = [];

        for (const studentId of student_ids) {
            // Obtener datos históricos del estudiante
            const historicalData = await pool.query(`
                SELECT 
                    AVG(ap.percentage) as avg_score,
                    COUNT(ap.id) as total_assessments,
                    AVG(at.engagement_score) as avg_engagement,
                    AVG(CASE WHEN at.status = 'present' THEN 1 ELSE 0 END) * 100 as attendance_rate,
                    STDDEV(ap.percentage) as score_variability,
                    
                    -- Tendencia temporal (últimos vs primeros registros)
                    (
                        SELECT AVG(percentage) FROM academic_progress 
                        WHERE student_id = $1 AND class_id = $2 
                        AND date_completed >= CURRENT_DATE - INTERVAL '14 days'
                    ) as recent_avg,
                    (
                        SELECT AVG(percentage) FROM academic_progress 
                        WHERE student_id = $1 AND class_id = $2 
                        AND date_completed < CURRENT_DATE - INTERVAL '14 days'
                        AND date_completed >= CURRENT_DATE - INTERVAL '60 days'
                    ) as older_avg
                    
                FROM academic_progress ap
                LEFT JOIN attendance_tracking at ON ap.student_id = at.student_id 
                    AND ap.class_id = at.class_id
                WHERE ap.student_id = $1 AND ap.class_id = $2
                AND ap.date_completed >= CURRENT_DATE - INTERVAL '90 days'
            `, [studentId, class_id]);

            const data = historicalData.rows[0];

            // Algoritmo de predicción simple basado en tendencias
            const prediction = await generatePerformancePrediction(data, prediction_timeframe);

            predictions.push({
                student_id: studentId,
                ...prediction
            });
        }

        res.json({
            predictions,
            prediction_timeframe,
            generated_at: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error en predicción de rendimiento:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Identificar estudiantes en riesgo académico
router.get('/risk-assessment/class/:classId', authenticateToken, requireEducatorRole, async (req, res) => {
    try {
        const { classId } = req.params;
        const { threshold = 'medium' } = req.query;

        const riskAnalysis = await pool.query(`
            SELECT 
                u.id as student_id,
                u.nickname,
                
                -- Métricas de rendimiento
                COALESCE(AVG(ap.percentage), 0) as avg_score,
                COALESCE(COUNT(ap.id), 0) as total_assessments,
                COALESCE(STDDEV(ap.percentage), 0) as score_variability,
                
                -- Métricas de asistencia
                COALESCE(AVG(CASE WHEN at.status = 'present' THEN 1 ELSE 0 END) * 100, 0) as attendance_rate,
                COALESCE(AVG(at.engagement_score), 0) as avg_engagement,
                
                -- Tendencias recientes
                (
                    SELECT AVG(percentage) FROM academic_progress 
                    WHERE student_id = u.id AND class_id = $1 
                    AND date_completed >= CURRENT_DATE - INTERVAL '14 days'
                ) as recent_performance,
                
                -- Intervenciones activas
                COUNT(pi.id) as active_interventions,
                
                -- Perfil académico
                sap.weaknesses_mapping,
                sap.dominant_learning_style
                
            FROM class_enrollments ce
            JOIN users u ON ce.student_id = u.id
            LEFT JOIN academic_progress ap ON u.id = ap.student_id AND ap.class_id = $1
                AND ap.date_completed >= CURRENT_DATE - INTERVAL '60 days'
            LEFT JOIN attendance_tracking at ON u.id = at.student_id AND at.class_id = $1
                AND at.attendance_date >= CURRENT_DATE - INTERVAL '30 days'
            LEFT JOIN pedagogical_interventions pi ON u.id = pi.student_id 
                AND pi.class_id = $1 AND pi.status = 'active'
            LEFT JOIN student_academic_profiles sap ON u.id = sap.student_id AND sap.class_id = $1
            WHERE ce.class_id = $1 AND ce.enrollment_status = 'active'
            GROUP BY u.id, u.nickname, sap.weaknesses_mapping, sap.dominant_learning_style
            ORDER BY avg_score ASC, attendance_rate ASC
        `, [classId]);

        // Calcular niveles de riesgo usando algoritmo de puntuación
        const studentsWithRisk = riskAnalysis.rows.map(student => {
            const riskScore = calculateRiskScore(student);
            const riskLevel = determineRiskLevel(riskScore, threshold);
            
            return {
                ...student,
                risk_score: riskScore,
                risk_level: riskLevel,
                ai_recommendations: generateRiskRecommendations(student, riskLevel)
            };
        });

        // Filtrar por nivel de riesgo si se especifica
        const filteredStudents = threshold === 'all' 
            ? studentsWithRisk 
            : studentsWithRisk.filter(s => s.risk_level !== 'low');

        res.json({
            risk_assessment: filteredStudents,
            threshold_used: threshold,
            total_students: studentsWithRisk.length,
            at_risk_count: filteredStudents.length
        });

    } catch (error) {
        console.error('Error en evaluación de riesgo:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==========================================
// RECOMENDACIONES PERSONALIZADAS
// ==========================================

// Generar recomendaciones de contenido personalizado
router.post('/recommendations/content', authenticateToken, requireEducatorRole, async (req, res) => {
    try {
        const { student_id, class_id, content_type = 'all' } = req.body;

        // Obtener perfil del estudiante
        const studentProfile = await pool.query(`
            SELECT 
                u.nickname,
                sap.dominant_learning_style,
                sap.strengths_mapping,
                sap.weaknesses_mapping,
                sap.learning_preferences,
                sap.motivation_profile,
                
                -- Historial de rendimiento
                AVG(ap.percentage) as avg_performance,
                AVG(ap.time_spent) as avg_time_spent,
                
                -- Patrones de error más comunes
                array_agg(DISTINCT jsonb_array_elements_text(ap.error_patterns::jsonb)) 
                    FILTER (WHERE ap.error_patterns IS NOT NULL) as common_errors
                
            FROM users u
            LEFT JOIN student_academic_profiles sap ON u.id = sap.student_id AND sap.class_id = $2
            LEFT JOIN academic_progress ap ON u.id = ap.student_id AND ap.class_id = $2
                AND ap.date_completed >= CURRENT_DATE - INTERVAL '30 days'
            WHERE u.id = $1
            GROUP BY u.id, u.nickname, sap.dominant_learning_style, sap.strengths_mapping,
                     sap.weaknesses_mapping, sap.learning_preferences, sap.motivation_profile
        `, [student_id, class_id]);

        if (studentProfile.rows.length === 0) {
            return res.status(404).json({ error: 'Estudiante no encontrado' });
        }

        const profile = studentProfile.rows[0];

        // Generar recomendaciones usando IA
        const recommendations = await generateContentRecommendations(profile, content_type);

        // Obtener recursos disponibles que coincidan con las recomendaciones
        const availableResources = await pool.query(`
            SELECT 
                er.*,
                COALESCE(AVG(rr.effectiveness_score), 0) as avg_effectiveness
            FROM educational_resources er
            LEFT JOIN resource_reviews rr ON er.id = rr.resource_id
            WHERE er.is_published = true
            AND (er.grade_level = $1 OR $1 IS NULL)
            AND (er.resource_type = ANY($2) OR $2 IS NULL)
            GROUP BY er.id
            ORDER BY avg_effectiveness DESC, er.usage_count DESC
            LIMIT 20
        `, [
            profile.grade_level,
            content_type === 'all' ? null : [content_type]
        ]);

        res.json({
            student_profile: {
                nickname: profile.nickname,
                learning_style: profile.dominant_learning_style,
                avg_performance: profile.avg_performance
            },
            ai_recommendations: recommendations,
            recommended_resources: availableResources.rows,
            generated_at: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error generando recomendaciones de contenido:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==========================================
// ANÁLISIS DE PATRONES DE APRENDIZAJE
// ==========================================

// Analizar patrones de aprendizaje de la clase
router.get('/patterns/class/:classId', authenticateToken, requireEducatorRole, async (req, res) => {
    try {
        const { classId } = req.params;
        const { timeframe = 30 } = req.query;

        // Análisis de patrones temporales
        const temporalPatterns = await pool.query(`
            SELECT 
                EXTRACT(hour FROM ap.date_completed) as hour_of_day,
                EXTRACT(dow FROM ap.date_completed) as day_of_week,
                AVG(ap.percentage) as avg_performance,
                COUNT(*) as activity_count,
                AVG(ap.time_spent) as avg_time_spent
            FROM academic_progress ap
            WHERE ap.class_id = $1 
            AND ap.date_completed >= CURRENT_DATE - INTERVAL '${timeframe} days'
            GROUP BY EXTRACT(hour FROM ap.date_completed), EXTRACT(dow FROM ap.date_completed)
            ORDER BY hour_of_day, day_of_week
        `, [classId]);

        // Análisis de dificultad vs rendimiento
        const difficultyAnalysis = await pool.query(`
            SELECT 
                ca.difficulty_level,
                AVG(ap.percentage) as avg_score,
                COUNT(ap.id) as attempts,
                AVG(ap.time_spent) as avg_time,
                STDDEV(ap.percentage) as score_variance
            FROM academic_progress ap
            JOIN content_assignments ca ON ap.assignment_id = ca.id
            WHERE ap.class_id = $1 
            AND ap.date_completed >= CURRENT_DATE - INTERVAL '${timeframe} days'
            GROUP BY ca.difficulty_level
            ORDER BY ca.difficulty_level
        `, [classId]);

        // Análisis de estilos de aprendizaje vs rendimiento
        const learningStyleAnalysis = await pool.query(`
            SELECT 
                sap.dominant_learning_style,
                COUNT(DISTINCT sap.student_id) as student_count,
                AVG(ap.percentage) as avg_performance,
                AVG(at.engagement_score) as avg_engagement
            FROM student_academic_profiles sap
            LEFT JOIN academic_progress ap ON sap.student_id = ap.student_id 
                AND sap.class_id = ap.class_id
                AND ap.date_completed >= CURRENT_DATE - INTERVAL '${timeframe} days'
            LEFT JOIN attendance_tracking at ON sap.student_id = at.student_id 
                AND sap.class_id = at.class_id
                AND at.attendance_date >= CURRENT_DATE - INTERVAL '${timeframe} days'
            WHERE sap.class_id = $1
            GROUP BY sap.dominant_learning_style
            ORDER BY avg_performance DESC
        `, [classId]);

        // Generar insights usando IA
        const aiInsights = generateLearningPatternInsights({
            temporal: temporalPatterns.rows,
            difficulty: difficultyAnalysis.rows,
            learning_styles: learningStyleAnalysis.rows
        });

        res.json({
            temporal_patterns: temporalPatterns.rows,
            difficulty_analysis: difficultyAnalysis.rows,
            learning_style_analysis: learningStyleAnalysis.rows,
            ai_insights: aiInsights,
            timeframe_days: timeframe,
            analyzed_at: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error en análisis de patrones:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ==========================================
// FUNCIONES DE IA Y ALGORITMOS PREDICTIVOS
// ==========================================

async function generatePerformancePrediction(historicalData, timeframeDays) {
    const {
        avg_score,
        total_assessments,
        avg_engagement,
        attendance_rate,
        score_variability,
        recent_avg,
        older_avg
    } = historicalData;

    // Calcular tendencia
    const trend = recent_avg && older_avg ? (recent_avg - older_avg) : 0;
    
    // Algoritmo de predicción simple
    let predictedScore = avg_score || 0;
    
    // Ajustar por tendencia
    if (trend !== 0) {
        predictedScore += (trend * 0.3);
    }
    
    // Ajustar por engagement
    if (avg_engagement < 5) {
        predictedScore -= 5;
    } else if (avg_engagement > 8) {
        predictedScore += 3;
    }
    
    // Ajustar por asistencia
    if (attendance_rate < 80) {
        predictedScore -= 8;
    } else if (attendance_rate > 95) {
        predictedScore += 2;
    }
    
    // Calcular confianza basada en cantidad de datos
    const confidence = Math.min(0.95, Math.max(0.3, (total_assessments || 0) / 10));
    
    // Calcular margen de error basado en variabilidad
    const marginOfError = (score_variability || 10) * 0.5;
    
    return {
        predicted_score: Math.max(0, Math.min(100, predictedScore)),
        confidence_level: confidence,
        trend_direction: trend > 2 ? 'improving' : trend < -2 ? 'declining' : 'stable',
        margin_of_error: marginOfError,
        factors_considered: {
            historical_average: avg_score,
            recent_trend: trend,
            engagement_level: avg_engagement,
            attendance_rate: attendance_rate,
            data_points: total_assessments
        }
    };
}

function calculateRiskScore(studentData) {
    let riskScore = 0;
    
    // Factor de rendimiento académico (40% del peso)
    if (studentData.avg_score < 60) riskScore += 40;
    else if (studentData.avg_score < 70) riskScore += 25;
    else if (studentData.avg_score < 80) riskScore += 10;
    
    // Factor de asistencia (30% del peso)
    if (studentData.attendance_rate < 70) riskScore += 30;
    else if (studentData.attendance_rate < 80) riskScore += 20;
    else if (studentData.attendance_rate < 90) riskScore += 10;
    
    // Factor de engagement (20% del peso)
    if (studentData.avg_engagement < 4) riskScore += 20;
    else if (studentData.avg_engagement < 6) riskScore += 15;
    else if (studentData.avg_engagement < 7) riskScore += 5;
    
    // Factor de variabilidad en rendimiento (10% del peso)
    if (studentData.score_variability > 25) riskScore += 10;
    else if (studentData.score_variability > 15) riskScore += 5;
    
    return Math.min(100, riskScore);
}

function determineRiskLevel(riskScore, threshold) {
    if (threshold === 'strict') {
        if (riskScore >= 30) return 'high';
        if (riskScore >= 15) return 'medium';
        return 'low';
    } else if (threshold === 'lenient') {
        if (riskScore >= 60) return 'high';
        if (riskScore >= 35) return 'medium';
        return 'low';
    } else { // medium
        if (riskScore >= 45) return 'high';
        if (riskScore >= 25) return 'medium';
        return 'low';
    }
}

function generateRiskRecommendations(studentData, riskLevel) {
    const recommendations = [];
    
    if (riskLevel === 'high') {
        recommendations.push('Intervención inmediata requerida');
        recommendations.push('Contactar a la familia');
        recommendations.push('Evaluación de necesidades especiales');
        recommendations.push('Tutoría individualizada');
    } else if (riskLevel === 'medium') {
        recommendations.push('Monitoreo cercano');
        recommendations.push('Apoyo académico adicional');
        recommendations.push('Estrategias de motivación');
    }
    
    if (studentData.attendance_rate < 80) {
        recommendations.push('Investigar barreras de asistencia');
    }
    
    if (studentData.avg_engagement < 5) {
        recommendations.push('Implementar estrategias de gamificación');
    }
    
    return recommendations;
}

async function generateContentRecommendations(profile, contentType) {
    const recommendations = {
        priority_areas: [],
        learning_strategies: [],
        content_suggestions: [],
        motivation_techniques: []
    };
    
    // Recomendaciones basadas en estilo de aprendizaje
    if (profile.dominant_learning_style === 'visual') {
        recommendations.learning_strategies.push(
            'Usar más contenido visual y diagramas',
            'Implementar mapas conceptuales',
            'Proporcionar organizadores gráficos'
        );
    } else if (profile.dominant_learning_style === 'auditory') {
        recommendations.learning_strategies.push(
            'Incluir explicaciones verbales detalladas',
            'Usar técnicas de repetición y discusión',
            'Proporcionar grabaciones de audio'
        );
    } else if (profile.dominant_learning_style === 'kinesthetic') {
        recommendations.learning_strategies.push(
            'Incluir actividades prácticas',
            'Permitir movimiento durante el aprendizaje',
            'Usar simulaciones interactivas'
        );
    }
    
    // Recomendaciones basadas en rendimiento
    if (profile.avg_performance < 70) {
        recommendations.priority_areas.push('Refuerzo de conceptos básicos');
        recommendations.content_suggestions.push('Contenido de nivel introductorio');
    } else if (profile.avg_performance > 90) {
        recommendations.priority_areas.push('Actividades de enriquecimiento');
        recommendations.content_suggestions.push('Proyectos de investigación avanzados');
    }
    
    // Recomendaciones de motivación
    recommendations.motivation_techniques.push(
        'Establecer metas alcanzables a corto plazo',
        'Proporcionar feedback inmediato y específico',
        'Celebrar pequeños logros'
    );
    
    return recommendations;
}

function generateLearningPatternInsights(patterns) {
    const insights = [];
    
    // Análisis temporal
    const temporalData = patterns.temporal;
    if (temporalData.length > 0) {
        const bestHours = temporalData
            .filter(p => p.activity_count > 5)
            .sort((a, b) => b.avg_performance - a.avg_performance)
            .slice(0, 3);
        
        if (bestHours.length > 0) {
            insights.push({
                type: 'temporal',
                insight: `Los estudiantes tienen mejor rendimiento durante las horas: ${bestHours.map(h => h.hour_of_day).join(', ')}`,
                recommendation: 'Considerar programar actividades importantes durante estos horarios'
            });
        }
    }
    
    // Análisis de dificultad
    const difficultyData = patterns.difficulty;
    if (difficultyData.length > 0) {
        const highDifficultyLowPerformance = difficultyData
            .filter(d => d.difficulty_level > 7 && d.avg_score < 60);
        
        if (highDifficultyLowPerformance.length > 0) {
            insights.push({
                type: 'difficulty',
                insight: 'Los estudiantes tienen dificultades significativas con contenido de alta dificultad',
                recommendation: 'Implementar preparación gradual y apoyo adicional para contenido avanzado'
            });
        }
    }
    
    // Análisis de estilos de aprendizaje
    const styleData = patterns.learning_styles;
    if (styleData.length > 0) {
        const bestPerformingStyle = styleData
            .sort((a, b) => b.avg_performance - a.avg_performance)[0];
        
        if (bestPerformingStyle) {
            insights.push({
                type: 'learning_style',
                insight: `Los estudiantes ${bestPerformingStyle.dominant_learning_style} muestran el mejor rendimiento promedio`,
                recommendation: `Incorporar más estrategias ${bestPerformingStyle.dominant_learning_style} en el curriculum`
            });
        }
    }
    
    return insights;
}

module.exports = router;