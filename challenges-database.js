const { Pool } = require('pg');

// Sistema de base de datos para retos personalizados PLAYTEST
class ChallengesDatabase {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
    }

    async createChallengesSchema() {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');

            // 1. Tabla principal de retos
            await client.query(`
                CREATE TABLE IF NOT EXISTS challenges (
                    id SERIAL PRIMARY KEY,
                    creator_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    title VARCHAR(200) NOT NULL,
                    description TEXT,
                    challenge_type VARCHAR(50) NOT NULL CHECK (challenge_type IN (
                        'marathon', 'level', 'streak', 'competition', 'consolidation', 'temporal'
                    )),
                    config JSONB NOT NULL,
                    requirements JSONB DEFAULT '{}',
                    prize_luminarias INTEGER NOT NULL CHECK (prize_luminarias >= 0),
                    bonus_luminarias INTEGER DEFAULT 0,
                    max_participants INTEGER,
                    min_participation_rate DECIMAL(3,2) DEFAULT 0.30,
                    start_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    end_date TIMESTAMP WITH TIME ZONE,
                    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN (
                        'draft', 'active', 'paused', 'completed', 'cancelled'
                    )),
                    auto_accept BOOLEAN DEFAULT true,
                    luminarias_reserved INTEGER DEFAULT 0,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // 2. Participaciones en retos
            await client.query(`
                CREATE TABLE IF NOT EXISTS challenge_participants (
                    id SERIAL PRIMARY KEY,
                    challenge_id INTEGER REFERENCES challenges(id) ON DELETE CASCADE,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    status VARCHAR(20) DEFAULT 'active' CHECK (status IN (
                        'invited', 'active', 'completed', 'failed', 'abandoned'
                    )),
                    progress JSONB DEFAULT '{}',
                    current_metrics JSONB DEFAULT '{}',
                    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    completed_at TIMESTAMP WITH TIME ZONE,
                    prize_awarded INTEGER DEFAULT 0,
                    UNIQUE(challenge_id, user_id)
                )
            `);

            // 3. Actividades para seguimiento de progreso
            await client.query(`
                CREATE TABLE IF NOT EXISTS challenge_activities (
                    id SERIAL PRIMARY KEY,
                    participant_id INTEGER REFERENCES challenge_participants(id) ON DELETE CASCADE,
                    activity_type VARCHAR(50) NOT NULL,
                    activity_data JSONB NOT NULL,
                    points_earned INTEGER DEFAULT 0,
                    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    verified BOOLEAN DEFAULT false
                )
            `);

            // 4. Transferencias de Luminarias
            await client.query(`
                CREATE TABLE IF NOT EXISTS challenge_transfers (
                    id SERIAL PRIMARY KEY,
                    challenge_id INTEGER REFERENCES challenges(id) ON DELETE CASCADE,
                    from_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    to_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    amount INTEGER NOT NULL,
                    transfer_type VARCHAR(30) NOT NULL CHECK (transfer_type IN (
                        'reserve', 'award', 'refund', 'bonus', 'penalty'
                    )),
                    reference_data JSONB DEFAULT '{}',
                    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    reversed_at TIMESTAMP WITH TIME ZONE,
                    status VARCHAR(20) DEFAULT 'completed' CHECK (status IN (
                        'pending', 'completed', 'failed', 'reversed'
                    ))
                )
            `);

            // 5. Notificaciones del sistema de retos
            await client.query(`
                CREATE TABLE IF NOT EXISTS challenge_notifications (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    challenge_id INTEGER REFERENCES challenges(id) ON DELETE CASCADE,
                    notification_type VARCHAR(50) NOT NULL,
                    title VARCHAR(200) NOT NULL,
                    message TEXT NOT NULL,
                    data JSONB DEFAULT '{}',
                    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    read_at TIMESTAMP WITH TIME ZONE,
                    action_taken BOOLEAN DEFAULT false
                )
            `);

            // 6. Métricas y analytics
            await client.query(`
                CREATE TABLE IF NOT EXISTS challenge_metrics (
                    id SERIAL PRIMARY KEY,
                    challenge_id INTEGER REFERENCES challenges(id) ON DELETE CASCADE,
                    metric_date DATE DEFAULT CURRENT_DATE,
                    total_participants INTEGER DEFAULT 0,
                    active_participants INTEGER DEFAULT 0,
                    completed_participants INTEGER DEFAULT 0,
                    average_progress DECIMAL(5,2) DEFAULT 0.00,
                    luminarias_awarded INTEGER DEFAULT 0,
                    engagement_score DECIMAL(5,2) DEFAULT 0.00,
                    additional_metrics JSONB DEFAULT '{}'
                )
            `);

            // 7. Plantillas de retos
            await client.query(`
                CREATE TABLE IF NOT EXISTS challenge_templates (
                    id SERIAL PRIMARY KEY,
                    creator_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    name VARCHAR(200) NOT NULL,
                    description TEXT,
                    challenge_type VARCHAR(50) NOT NULL,
                    default_config JSONB NOT NULL,
                    suggested_prizes JSONB DEFAULT '{}',
                    usage_count INTEGER DEFAULT 0,
                    is_public BOOLEAN DEFAULT false,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Índices para optimización
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_challenges_creator_status ON challenges(creator_id, status);
                CREATE INDEX IF NOT EXISTS idx_challenges_type_status ON challenges(challenge_type, status);
                CREATE INDEX IF NOT EXISTS idx_challenges_dates ON challenges(start_date, end_date);
                CREATE INDEX IF NOT EXISTS idx_participants_user_status ON challenge_participants(user_id, status);
                CREATE INDEX IF NOT EXISTS idx_participants_challenge_status ON challenge_participants(challenge_id, status);
                CREATE INDEX IF NOT EXISTS idx_activities_participant_type ON challenge_activities(participant_id, activity_type);
                CREATE INDEX IF NOT EXISTS idx_activities_timestamp ON challenge_activities(timestamp);
                CREATE INDEX IF NOT EXISTS idx_transfers_user_type ON challenge_transfers(to_user_id, transfer_type);
                CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON challenge_notifications(user_id, read_at);
                CREATE INDEX IF NOT EXISTS idx_metrics_challenge_date ON challenge_metrics(challenge_id, metric_date);
            `);

            // Triggers para actualización automática
            await client.query(`
                CREATE OR REPLACE FUNCTION update_challenge_updated_at()
                RETURNS TRIGGER AS $$
                BEGIN
                    NEW.updated_at = CURRENT_TIMESTAMP;
                    RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;

                DROP TRIGGER IF EXISTS trigger_update_challenges_updated_at ON challenges;
                CREATE TRIGGER trigger_update_challenges_updated_at
                    BEFORE UPDATE ON challenges
                    FOR EACH ROW EXECUTE FUNCTION update_challenge_updated_at();
            `);

            // Función para reservar Luminarias automáticamente
            await client.query(`
                CREATE OR REPLACE FUNCTION reserve_challenge_luminarias()
                RETURNS TRIGGER AS $$
                DECLARE
                    estimated_cost INTEGER;
                    creator_balance INTEGER;
                BEGIN
                    IF NEW.status = 'active' AND OLD.status != 'active' THEN
                        -- Calcular costo estimado
                        estimated_cost := NEW.prize_luminarias * COALESCE(NEW.max_participants, 100);
                        
                        -- Verificar saldo del creador
                        SELECT COALESCE(luminarias_actuales, 0) INTO creator_balance
                        FROM user_profiles 
                        WHERE user_id = NEW.creator_id;
                        
                        IF creator_balance < estimated_cost THEN
                            RAISE EXCEPTION 'Saldo insuficiente. Necesitas % Luminarias, tienes %', 
                                estimated_cost, creator_balance;
                        END IF;
                        
                        -- Reservar Luminarias
                        UPDATE user_profiles 
                        SET luminarias_actuales = luminarias_actuales - estimated_cost
                        WHERE user_id = NEW.creator_id;
                        
                        NEW.luminarias_reserved := estimated_cost;
                        
                        -- Registrar transferencia de reserva
                        INSERT INTO challenge_transfers (
                            challenge_id, from_user_id, to_user_id, amount, transfer_type, reference_data
                        ) VALUES (
                            NEW.id, NEW.creator_id, NEW.creator_id, estimated_cost, 'reserve', 
                            jsonb_build_object('action', 'reserve_for_challenge')
                        );
                    END IF;
                    
                    RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;

                DROP TRIGGER IF EXISTS trigger_reserve_luminarias ON challenges;
                CREATE TRIGGER trigger_reserve_luminarias
                    BEFORE UPDATE ON challenges
                    FOR EACH ROW EXECUTE FUNCTION reserve_challenge_luminarias();
            `);

            await client.query('COMMIT');
            console.log('✅ Esquema de base de datos para retos creado exitosamente');

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Error creando esquema de retos:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Función para obtener configuración por defecto según tipo de reto
    getDefaultChallengeConfig(challengeType) {
        const defaults = {
            marathon: {
                required_blocks: [],
                min_average_score: 70,
                max_attempts_per_block: 3,
                time_limit_hours: 72,
                must_complete_all: true
            },
            level: {
                target_levels: {},
                min_consolidation_per_block: 75,
                time_limit_days: 30,
                level_mapping: {
                    'principiante': 1,
                    'intermedio': 2, 
                    'avanzado': 3,
                    'experto': 4,
                    'maestro': 5
                }
            },
            streak: {
                required_days: 7,
                min_daily_sessions: 1,
                min_daily_time_minutes: 15,
                min_daily_questions: 10,
                allowed_breaks: 1,
                break_grace_hours: 6
            },
            competition: {
                required_wins: 5,
                game_modes: ['duelo', 'trivial'],
                min_win_rate: 0.6,
                max_response_time_seconds: 30,
                min_accuracy: 0.7,
                allowed_opponents: 'any'
            },
            consolidation: {
                target_block_id: null,
                target_percentage: 85,
                specific_topics: [],
                min_weekly_progress: 5,
                time_limit_days: 21
            },
            temporal: {
                objectives: [],
                weights: {},
                bonus_early_completion: true,
                event_name: '',
                milestone_rewards: true
            }
        };
        
        return defaults[challengeType] || {};
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = ChallengesDatabase;

// Auto-ejecutar si se ejecuta directamente
if (require.main === module) {
    const db = new ChallengesDatabase();
    db.createChallengesSchema()
        .then(() => {
            console.log('Base de datos de retos configurada');
            process.exit(0);
        })
        .catch(error => {
            console.error('Error:', error);
            process.exit(1);
        });
}