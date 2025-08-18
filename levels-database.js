const { Pool } = require('pg');

// Sistema de base de datos para niveles PLAYTEST
class LevelsDatabase {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
    }

    async createLevelsSchema() {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');

            // 1. Tabla de definiciones de niveles
            await client.query(`
                CREATE TABLE IF NOT EXISTS level_definitions (
                    id SERIAL PRIMARY KEY,
                    level_type VARCHAR(20) NOT NULL CHECK (level_type IN ('creator', 'teacher', 'user')),
                    level_name VARCHAR(50) NOT NULL,
                    level_order INTEGER NOT NULL,
                    min_threshold INTEGER NOT NULL,
                    max_threshold INTEGER,
                    weekly_luminarias INTEGER DEFAULT 0,
                    benefits JSONB DEFAULT '{}',
                    badge_config JSONB DEFAULT '{}',
                    description TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(level_type, level_name),
                    UNIQUE(level_type, level_order)
                )
            `);

            // 2. Tabla de niveles actuales de usuarios
            await client.query(`
                CREATE TABLE IF NOT EXISTS user_levels (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    level_type VARCHAR(20) NOT NULL CHECK (level_type IN ('creator', 'teacher', 'user')),
                    block_id INTEGER REFERENCES blocks(id) ON DELETE CASCADE, -- Solo para tipo 'user'
                    current_level_id INTEGER REFERENCES level_definitions(id),
                    current_metrics JSONB DEFAULT '{}',
                    last_calculated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    achieved_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, level_type, block_id),
                    CHECK (
                        (level_type = 'user' AND block_id IS NOT NULL) OR 
                        (level_type IN ('creator', 'teacher') AND block_id IS NULL)
                    )
                )
            `);

            // 3. Historial de progresión de niveles
            await client.query(`
                CREATE TABLE IF NOT EXISTS level_progression_history (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    level_type VARCHAR(20) NOT NULL,
                    block_id INTEGER REFERENCES blocks(id) ON DELETE CASCADE,
                    previous_level_id INTEGER REFERENCES level_definitions(id),
                    new_level_id INTEGER REFERENCES level_definitions(id),
                    promotion_metrics JSONB DEFAULT '{}',
                    promoted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    notification_sent BOOLEAN DEFAULT false
                )
            `);

            // 4. Métricas de actividad de usuarios
            await client.query(`
                CREATE TABLE IF NOT EXISTS user_activity_metrics (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    block_id INTEGER REFERENCES blocks(id) ON DELETE CASCADE,
                    metric_date DATE DEFAULT CURRENT_DATE,
                    sessions_count INTEGER DEFAULT 0,
                    questions_answered INTEGER DEFAULT 0,
                    correct_answers INTEGER DEFAULT 0,
                    time_spent_minutes INTEGER DEFAULT 0,
                    games_played INTEGER DEFAULT 0,
                    consolidation_percentage DECIMAL(5,2) DEFAULT 0.00,
                    is_active BOOLEAN DEFAULT true,
                    last_activity TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, block_id, metric_date)
                )
            `);

            // 5. Pagos semanales de Luminarias
            await client.query(`
                CREATE TABLE IF NOT EXISTS weekly_luminarias_payments (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    level_type VARCHAR(20) NOT NULL,
                    level_id INTEGER REFERENCES level_definitions(id),
                    week_start_date DATE NOT NULL,
                    week_end_date DATE NOT NULL,
                    base_amount INTEGER NOT NULL,
                    bonus_amount INTEGER DEFAULT 0,
                    total_amount INTEGER NOT NULL,
                    metrics_snapshot JSONB DEFAULT '{}',
                    payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'cancelled')),
                    processed_at TIMESTAMP WITH TIME ZONE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, level_type, week_start_date)
                )
            `);

            // 6. Tabla de consolidación por bloque y usuario
            await client.query(`
                CREATE TABLE IF NOT EXISTS user_block_consolidation (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    block_id INTEGER REFERENCES blocks(id) ON DELETE CASCADE,
                    total_questions INTEGER DEFAULT 0,
                    answered_questions INTEGER DEFAULT 0,
                    correct_answers INTEGER DEFAULT 0,
                    consolidation_percentage DECIMAL(5,2) DEFAULT 0.00,
                    last_activity TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, block_id)
                )
            `);

            // 7. Beneficios activos por nivel
            await client.query(`
                CREATE TABLE IF NOT EXISTS user_level_benefits (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    level_type VARCHAR(20) NOT NULL,
                    benefit_type VARCHAR(50) NOT NULL,
                    benefit_data JSONB DEFAULT '{}',
                    is_active BOOLEAN DEFAULT true,
                    activated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP WITH TIME ZONE
                )
            `);

            // Índices para optimización
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_user_levels_user_type ON user_levels(user_id, level_type);
                CREATE INDEX IF NOT EXISTS idx_user_levels_block ON user_levels(user_id, block_id);
                CREATE INDEX IF NOT EXISTS idx_activity_metrics_user_date ON user_activity_metrics(user_id, metric_date);
                CREATE INDEX IF NOT EXISTS idx_activity_metrics_block_date ON user_activity_metrics(block_id, metric_date);
                CREATE INDEX IF NOT EXISTS idx_consolidation_user_block ON user_block_consolidation(user_id, block_id);
                CREATE INDEX IF NOT EXISTS idx_progression_history_user ON level_progression_history(user_id, promoted_at);
                CREATE INDEX IF NOT EXISTS idx_weekly_payments_user_week ON weekly_luminarias_payments(user_id, week_start_date);
                CREATE INDEX IF NOT EXISTS idx_level_benefits_user_active ON user_level_benefits(user_id, is_active);
            `);

            // Función para calcular consolidación
            await client.query(`
                CREATE OR REPLACE FUNCTION calculate_user_consolidation(p_user_id INTEGER, p_block_id INTEGER)
                RETURNS DECIMAL AS $$
                DECLARE
                    total_q INTEGER;
                    answered_q INTEGER;
                    correct_q INTEGER;
                    consolidation DECIMAL;
                BEGIN
                    -- Contar preguntas totales del bloque
                    SELECT COUNT(*) INTO total_q
                    FROM questions q
                    WHERE q.block_id = p_block_id;
                    
                    IF total_q = 0 THEN
                        RETURN 0;
                    END IF;
                    
                    -- Contar respuestas del usuario para este bloque
                    SELECT 
                        COUNT(DISTINCT ua.question_id),
                        COUNT(DISTINCT CASE WHEN ua.is_correct THEN ua.question_id END)
                    INTO answered_q, correct_q
                    FROM user_answers ua
                    JOIN questions q ON ua.question_id = q.id
                    WHERE ua.user_id = p_user_id 
                        AND q.block_id = p_block_id;
                    
                    -- Calcular consolidación basada en respuestas correctas únicas
                    consolidation := (correct_q::DECIMAL / total_q::DECIMAL) * 100;
                    
                    -- Actualizar tabla de consolidación
                    INSERT INTO user_block_consolidation (
                        user_id, block_id, total_questions, answered_questions, 
                        correct_answers, consolidation_percentage, calculated_at
                    ) VALUES (
                        p_user_id, p_block_id, total_q, answered_q, 
                        correct_q, consolidation, CURRENT_TIMESTAMP
                    )
                    ON CONFLICT (user_id, block_id) DO UPDATE SET
                        total_questions = EXCLUDED.total_questions,
                        answered_questions = EXCLUDED.answered_questions,
                        correct_answers = EXCLUDED.correct_answers,
                        consolidation_percentage = EXCLUDED.consolidation_percentage,
                        calculated_at = EXCLUDED.calculated_at,
                        last_activity = CURRENT_TIMESTAMP;
                    
                    RETURN consolidation;
                END;
                $$ LANGUAGE plpgsql;
            `);

            // Función para calcular usuarios activos de un creador
            await client.query(`
                CREATE OR REPLACE FUNCTION count_active_users_for_creator(p_creator_id INTEGER, p_days INTEGER DEFAULT 30)
                RETURNS INTEGER AS $$
                DECLARE
                    active_count INTEGER;
                BEGIN
                    -- Usuarios que han jugado bloques del creador en los últimos p_days días
                    SELECT COUNT(DISTINCT gp.user_id) INTO active_count
                    FROM game_players gp
                    JOIN games g ON gp.game_id = g.id
                    JOIN blocks b ON CAST(b.id AS TEXT) = ANY(SELECT jsonb_object_keys(g.config))
                    WHERE b.creator_id = p_creator_id
                        AND g.created_at >= CURRENT_TIMESTAMP - INTERVAL '%d days' % p_days
                        AND g.status = 'completed';
                    
                    RETURN COALESCE(active_count, 0);
                END;
                $$ LANGUAGE plpgsql;
            `);

            // Función para calcular alumnos activos de un profesor
            await client.query(`
                CREATE OR REPLACE FUNCTION count_active_students_for_teacher(p_teacher_id INTEGER, p_days INTEGER DEFAULT 30)
                RETURNS INTEGER AS $$
                DECLARE
                    active_count INTEGER;
                BEGIN
                    -- Contar usuarios activos asignados a este profesor
                    -- Esto requiere una relación profesor-alumno que puede definirse
                    -- Por ahora, contamos usuarios que han interactuado con bloques del profesor
                    SELECT COUNT(DISTINCT gp.user_id) INTO active_count
                    FROM game_players gp
                    JOIN games g ON gp.game_id = g.id
                    JOIN blocks b ON CAST(b.id AS TEXT) = ANY(SELECT jsonb_object_keys(g.config))
                    WHERE b.creator_id = p_teacher_id
                        AND g.created_at >= CURRENT_TIMESTAMP - INTERVAL '%d days' % p_days
                        AND g.status = 'completed'
                        AND gp.user_id != p_teacher_id; -- Excluir al propio profesor
                    
                    RETURN COALESCE(active_count, 0);
                END;
                $$ LANGUAGE plpgsql;
            `);

            // Trigger para actualizar niveles automáticamente
            await client.query(`
                CREATE OR REPLACE FUNCTION update_user_levels()
                RETURNS TRIGGER AS $$
                BEGIN
                    -- Actualizar nivel de usuario por bloque cuando cambia consolidación
                    IF TG_TABLE_NAME = 'user_block_consolidation' THEN
                        PERFORM update_user_level_by_consolidation(NEW.user_id, NEW.block_id, NEW.consolidation_percentage);
                    END IF;
                    
                    -- Actualizar niveles de creador/profesor cuando cambia actividad
                    IF TG_TABLE_NAME = 'user_activity_metrics' THEN
                        PERFORM update_creator_teacher_levels(NEW.user_id);
                    END IF;
                    
                    RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;

                DROP TRIGGER IF EXISTS trigger_update_consolidation_levels ON user_block_consolidation;
                CREATE TRIGGER trigger_update_consolidation_levels
                    AFTER INSERT OR UPDATE ON user_block_consolidation
                    FOR EACH ROW EXECUTE FUNCTION update_user_levels();

                DROP TRIGGER IF EXISTS trigger_update_activity_levels ON user_activity_metrics;
                CREATE TRIGGER trigger_update_activity_levels
                    AFTER INSERT OR UPDATE ON user_activity_metrics
                    FOR EACH ROW EXECUTE FUNCTION update_user_levels();
            `);

            // Función para actualizar nivel de usuario por consolidación
            await client.query(`
                CREATE OR REPLACE FUNCTION update_user_level_by_consolidation(p_user_id INTEGER, p_block_id INTEGER, p_consolidation DECIMAL)
                RETURNS VOID AS $$
                DECLARE
                    new_level_id INTEGER;
                    current_level_id INTEGER;
                    level_record RECORD;
                BEGIN
                    -- Determinar nuevo nivel basado en consolidación
                    SELECT id INTO new_level_id
                    FROM level_definitions
                    WHERE level_type = 'user'
                        AND p_consolidation >= min_threshold
                        AND (max_threshold IS NULL OR p_consolidation <= max_threshold)
                    ORDER BY level_order DESC
                    LIMIT 1;
                    
                    IF new_level_id IS NULL THEN
                        -- Nivel más bajo por defecto
                        SELECT id INTO new_level_id
                        FROM level_definitions
                        WHERE level_type = 'user'
                        ORDER BY level_order ASC
                        LIMIT 1;
                    END IF;
                    
                    -- Obtener nivel actual
                    SELECT current_level_id INTO current_level_id
                    FROM user_levels
                    WHERE user_id = p_user_id 
                        AND level_type = 'user' 
                        AND block_id = p_block_id;
                    
                    -- Si hay cambio de nivel
                    IF current_level_id IS NULL OR current_level_id != new_level_id THEN
                        -- Actualizar o insertar nivel actual
                        INSERT INTO user_levels (user_id, level_type, block_id, current_level_id, current_metrics, achieved_at)
                        VALUES (p_user_id, 'user', p_block_id, new_level_id, 
                                jsonb_build_object('consolidation', p_consolidation), CURRENT_TIMESTAMP)
                        ON CONFLICT (user_id, level_type, block_id) DO UPDATE SET
                            current_level_id = EXCLUDED.current_level_id,
                            current_metrics = EXCLUDED.current_metrics,
                            achieved_at = EXCLUDED.achieved_at,
                            last_calculated = CURRENT_TIMESTAMP;
                        
                        -- Registrar en historial si hay cambio
                        IF current_level_id IS NOT NULL AND current_level_id != new_level_id THEN
                            INSERT INTO level_progression_history (
                                user_id, level_type, block_id, previous_level_id, new_level_id, 
                                promotion_metrics, promoted_at
                            ) VALUES (
                                p_user_id, 'user', p_block_id, current_level_id, new_level_id,
                                jsonb_build_object('consolidation', p_consolidation, 'trigger', 'auto_consolidation'),
                                CURRENT_TIMESTAMP
                            );
                        END IF;
                    END IF;
                END;
                $$ LANGUAGE plpgsql;
            `);

            // Función para actualizar niveles de creador/profesor
            await client.query(`
                CREATE OR REPLACE FUNCTION update_creator_teacher_levels(p_user_id INTEGER)
                RETURNS VOID AS $$
                DECLARE
                    active_users INTEGER;
                    active_students INTEGER;
                    new_creator_level INTEGER;
                    new_teacher_level INTEGER;
                    current_creator_level INTEGER;
                    current_teacher_level INTEGER;
                BEGIN
                    -- Calcular usuarios activos para creador
                    SELECT count_active_users_for_creator(p_user_id) INTO active_users;
                    
                    -- Calcular estudiantes activos para profesor
                    SELECT count_active_students_for_teacher(p_user_id) INTO active_students;
                    
                    -- Determinar nuevo nivel de creador
                    SELECT id INTO new_creator_level
                    FROM level_definitions
                    WHERE level_type = 'creator'
                        AND active_users >= min_threshold
                        AND (max_threshold IS NULL OR active_users <= max_threshold)
                    ORDER BY level_order DESC
                    LIMIT 1;
                    
                    -- Determinar nuevo nivel de profesor
                    SELECT id INTO new_teacher_level
                    FROM level_definitions
                    WHERE level_type = 'teacher'
                        AND active_students >= min_threshold
                        AND (max_threshold IS NULL OR active_students <= max_threshold)
                    ORDER BY level_order DESC
                    LIMIT 1;
                    
                    -- Obtener niveles actuales
                    SELECT current_level_id INTO current_creator_level
                    FROM user_levels
                    WHERE user_id = p_user_id AND level_type = 'creator';
                    
                    SELECT current_level_id INTO current_teacher_level
                    FROM user_levels
                    WHERE user_id = p_user_id AND level_type = 'teacher';
                    
                    -- Actualizar nivel de creador si es necesario
                    IF new_creator_level IS NOT NULL AND 
                       (current_creator_level IS NULL OR current_creator_level != new_creator_level) THEN
                        
                        INSERT INTO user_levels (user_id, level_type, current_level_id, current_metrics, achieved_at)
                        VALUES (p_user_id, 'creator', new_creator_level, 
                                jsonb_build_object('active_users', active_users), CURRENT_TIMESTAMP)
                        ON CONFLICT (user_id, level_type, block_id) DO UPDATE SET
                            current_level_id = EXCLUDED.current_level_id,
                            current_metrics = EXCLUDED.current_metrics,
                            achieved_at = EXCLUDED.achieved_at,
                            last_calculated = CURRENT_TIMESTAMP;
                        
                        -- Historial de creador
                        IF current_creator_level IS NOT NULL AND current_creator_level != new_creator_level THEN
                            INSERT INTO level_progression_history (
                                user_id, level_type, previous_level_id, new_level_id, promotion_metrics, promoted_at
                            ) VALUES (
                                p_user_id, 'creator', current_creator_level, new_creator_level,
                                jsonb_build_object('active_users', active_users), CURRENT_TIMESTAMP
                            );
                        END IF;
                    END IF;
                    
                    -- Actualizar nivel de profesor si es necesario
                    IF new_teacher_level IS NOT NULL AND 
                       (current_teacher_level IS NULL OR current_teacher_level != new_teacher_level) THEN
                        
                        INSERT INTO user_levels (user_id, level_type, current_level_id, current_metrics, achieved_at)
                        VALUES (p_user_id, 'teacher', new_teacher_level, 
                                jsonb_build_object('active_students', active_students), CURRENT_TIMESTAMP)
                        ON CONFLICT (user_id, level_type, block_id) DO UPDATE SET
                            current_level_id = EXCLUDED.current_level_id,
                            current_metrics = EXCLUDED.current_metrics,
                            achieved_at = EXCLUDED.achieved_at,
                            last_calculated = CURRENT_TIMESTAMP;
                        
                        -- Historial de profesor
                        IF current_teacher_level IS NOT NULL AND current_teacher_level != new_teacher_level THEN
                            INSERT INTO level_progression_history (
                                user_id, level_type, previous_level_id, new_level_id, promotion_metrics, promoted_at
                            ) VALUES (
                                p_user_id, 'teacher', current_teacher_level, new_teacher_level,
                                jsonb_build_object('active_students', active_students), CURRENT_TIMESTAMP
                            );
                        END IF;
                    END IF;
                END;
                $$ LANGUAGE plpgsql;
            `);

            await client.query('COMMIT');
            console.log('✅ Esquema de base de datos para niveles creado exitosamente');

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Error creando esquema de niveles:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    async insertDefaultLevelDefinitions() {
        try {
            console.log('📊 Insertando definiciones de niveles por defecto...');

            // Niveles para Creadores de Contenido
            const creatorLevels = [
                { name: 'Semilla', order: 1, min: 1, max: 49, weekly: 40, description: 'Creador principiante con audiencia inicial' },
                { name: 'Chispa', order: 2, min: 50, max: 149, weekly: 60, description: 'Creador con crecimiento constante' },
                { name: 'Constructor', order: 3, min: 150, max: 499, weekly: 90, description: 'Creador establecido con audiencia sólida' },
                { name: 'Orador', order: 4, min: 500, max: 999, weekly: 130, description: 'Creador influyente con gran alcance' },
                { name: 'Visionario', order: 5, min: 1000, max: null, weekly: 180, description: 'Creador líder con impacto masivo' }
            ];

            // Niveles para Profesores
            const teacherLevels = [
                { name: 'Guía', order: 1, min: 1, max: 15, weekly: 50, description: 'Profesor con grupo pequeño' },
                { name: 'Instructor', order: 2, min: 16, max: 35, weekly: 75, description: 'Profesor con clase mediana' },
                { name: 'Consejero', order: 3, min: 36, max: 60, weekly: 110, description: 'Profesor con múltiples grupos' },
                { name: 'Erudito', order: 4, min: 61, max: 100, weekly: 150, description: 'Profesor con gran número de estudiantes' },
                { name: 'Maestro Jedi', order: 5, min: 101, max: null, weekly: 200, description: 'Profesor maestro con impacto institucional' }
            ];

            // Niveles para Usuarios (por bloque)
            const userLevels = [
                { name: 'Aprendiz', order: 1, min: 0, max: 25, weekly: 0, description: 'Iniciando el aprendizaje' },
                { name: 'Explorador', order: 2, min: 26, max: 50, weekly: 0, description: 'Explorando nuevos conceptos' },
                { name: 'Estratega', order: 3, min: 51, max: 80, weekly: 0, description: 'Dominando estrategias avanzadas' },
                { name: 'Sabio', order: 4, min: 81, max: 95, weekly: 0, description: 'Conocimiento experto del tema' },
                { name: 'Gran Maestro', order: 5, min: 96, max: 100, weekly: 0, description: 'Maestría completa del bloque' }
            ];

            // Insertar niveles de creadores
            for (const level of creatorLevels) {
                await this.pool.query(`
                    INSERT INTO level_definitions (
                        level_type, level_name, level_order, min_threshold, max_threshold, 
                        weekly_luminarias, description, benefits, badge_config
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (level_type, level_name) DO UPDATE SET
                        min_threshold = EXCLUDED.min_threshold,
                        max_threshold = EXCLUDED.max_threshold,
                        weekly_luminarias = EXCLUDED.weekly_luminarias,
                        description = EXCLUDED.description
                `, [
                    'creator', level.name, level.order, level.min, level.max, level.weekly,
                    level.description,
                    JSON.stringify({
                        challenge_creation_boost: level.order * 10,
                        analytics_access: level.order >= 3,
                        premium_templates: level.order >= 4,
                        priority_support: level.order >= 5
                    }),
                    JSON.stringify({
                        icon: `creator-${level.order}`,
                        color: ['#8B5CF6', '#06B6D4', '#10B981', '#F59E0B', '#EF4444'][level.order - 1],
                        gradient: true
                    })
                ]);
            }

            // Insertar niveles de profesores
            for (const level of teacherLevels) {
                await this.pool.query(`
                    INSERT INTO level_definitions (
                        level_type, level_name, level_order, min_threshold, max_threshold, 
                        weekly_luminarias, description, benefits, badge_config
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (level_type, level_name) DO UPDATE SET
                        min_threshold = EXCLUDED.min_threshold,
                        max_threshold = EXCLUDED.max_threshold,
                        weekly_luminarias = EXCLUDED.weekly_luminarias,
                        description = EXCLUDED.description
                `, [
                    'teacher', level.name, level.order, level.min, level.max, level.weekly,
                    level.description,
                    JSON.stringify({
                        student_management_tools: true,
                        advanced_reports: level.order >= 3,
                        custom_assignments: level.order >= 4,
                        institutional_features: level.order >= 5
                    }),
                    JSON.stringify({
                        icon: `teacher-${level.order}`,
                        color: ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444'][level.order - 1],
                        gradient: true
                    })
                ]);
            }

            // Insertar niveles de usuarios
            for (const level of userLevels) {
                await this.pool.query(`
                    INSERT INTO level_definitions (
                        level_type, level_name, level_order, min_threshold, max_threshold, 
                        weekly_luminarias, description, benefits, badge_config
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (level_type, level_name) DO UPDATE SET
                        min_threshold = EXCLUDED.min_threshold,
                        max_threshold = EXCLUDED.max_threshold,
                        description = EXCLUDED.description
                `, [
                    'user', level.name, level.order, level.min, level.max, level.weekly,
                    level.description,
                    JSON.stringify({
                        challenge_access: level.order >= 2 ? 'intermediate' : 'basic',
                        advanced_challenges: level.order >= 3,
                        expert_challenges: level.order >= 4,
                        mastery_challenges: level.order >= 5,
                        bonus_rewards: level.order * 5
                    }),
                    JSON.stringify({
                        icon: `user-${level.order}`,
                        color: ['#6B7280', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444'][level.order - 1],
                        gradient: level.order >= 4
                    })
                ]);
            }

            console.log('✅ Definiciones de niveles insertadas exitosamente');

        } catch (error) {
            console.error('❌ Error insertando definiciones de niveles:', error);
            throw error;
        }
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = LevelsDatabase;

// Auto-ejecutar si se ejecuta directamente
if (require.main === module) {
    const db = new LevelsDatabase();
    
    async function setup() {
        try {
            await db.createLevelsSchema();
            await db.insertDefaultLevelDefinitions();
            console.log('✅ Sistema de niveles configurado completamente');
        } catch (error) {
            console.error('❌ Error en configuración:', error);
        } finally {
            await db.close();
        }
    }
    
    setup();
}