const ChallengesDatabase = require('./challenges-database');
const ChallengesValidator = require('./challenges-validator');
const ChallengesNotificationSystem = require('./challenges-notifications');

// Script de configuración completa del sistema de retos
class ChallengesSetup {
    constructor() {
        this.db = new ChallengesDatabase();
        this.validator = new ChallengesValidator();
        this.notificationSystem = new ChallengesNotificationSystem();
    }

    async setupCompleteSystem() {
        try {
            console.log('🚀 Iniciando configuración del sistema de retos PLAYTEST...');

            // 1. Crear esquema de base de datos
            console.log('\n📊 Configurando base de datos...');
            await this.db.createChallengesSchema();

            // 2. Crear plantillas predefinidas
            console.log('\n📝 Creando plantillas predefinidas...');
            await this.createDefaultTemplates();

            // 3. Configurar cron jobs
            console.log('\n⏰ Configurando tareas automáticas...');
            await this.setupCronJobs();

            // 4. Crear retos de ejemplo (opcional)
            console.log('\n🎯 Creando retos de ejemplo...');
            await this.createSampleChallenges();

            console.log('\n✅ ¡Sistema de retos configurado exitosamente!');
            console.log('\n📋 Resumen de configuración:');
            console.log('   ✓ Base de datos configurada');
            console.log('   ✓ Plantillas predefinidas creadas');
            console.log('   ✓ Validaciones automáticas configuradas');
            console.log('   ✓ Sistema de notificaciones activo');
            console.log('   ✓ Analytics habilitados');
            console.log('\n🎉 ¡El sistema está listo para usar!');

        } catch (error) {
            console.error('❌ Error configurando sistema de retos:', error);
            throw error;
        }
    }

    async createDefaultTemplates() {
        try {
            const { Pool } = require('pg');
            const pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });

            // Obtener o crear usuario AdminPrincipal
            let adminUser = await pool.query(`
                SELECT id FROM users WHERE nickname = 'AdminPrincipal'
            `);

            if (adminUser.rows.length === 0) {
                console.log('⚠️  Usuario AdminPrincipal no encontrado. Creando...');
                const bcrypt = require('bcrypt');
                const hashedPassword = await bcrypt.hash('kikejfer', 10);
                
                adminUser = await pool.query(`
                    INSERT INTO users (nickname, email, password_hash) 
                    VALUES ('AdminPrincipal', 'admin@playtest.com', $1) 
                    RETURNING id
                `, [hashedPassword]);
            }

            const adminId = adminUser.rows[0].id;

            const templates = [
                {
                    name: 'Maratón Básico',
                    description: 'Completar una serie de bloques con nota mínima',
                    challenge_type: 'marathon',
                    default_config: {
                        required_blocks: [],
                        min_average_score: 70,
                        max_attempts_per_block: 3,
                        time_limit_hours: 72,
                        must_complete_all: true
                    },
                    suggested_prizes: { min: 100, max: 200, optimal: 150 }
                },
                {
                    name: 'Racha de Estudio',
                    description: 'Mantener actividad diaria por días consecutivos',
                    challenge_type: 'streak',
                    default_config: {
                        required_days: 7,
                        min_daily_sessions: 1,
                        min_daily_time_minutes: 15,
                        min_daily_questions: 10,
                        allowed_breaks: 1
                    },
                    suggested_prizes: { min: 30, max: 80, optimal: 50 }
                },
                {
                    name: 'Duelos Competitivos',
                    description: 'Ganar duelos contra otros jugadores',
                    challenge_type: 'competition',
                    default_config: {
                        required_wins: 5,
                        game_modes: ['duelo', 'trivial'],
                        min_win_rate: 0.6,
                        min_accuracy: 0.7,
                        allowed_opponents: 'any'
                    },
                    suggested_prizes: { min: 40, max: 120, optimal: 80 }
                },
                {
                    name: 'Maestría en Bloque',
                    description: 'Alcanzar alto porcentaje de consolidación',
                    challenge_type: 'consolidation',
                    default_config: {
                        target_block_id: null,
                        target_percentage: 85,
                        specific_topics: [],
                        min_weekly_progress: 5,
                        time_limit_days: 21
                    },
                    suggested_prizes: { min: 60, max: 150, optimal: 100 }
                },
                {
                    name: 'Subida de Nivel',
                    description: 'Avanzar niveles en bloques específicos',
                    challenge_type: 'level',
                    default_config: {
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
                    suggested_prizes: { min: 50, max: 100, optimal: 75 }
                },
                {
                    name: 'Evento Especial',
                    description: 'Objetivos combinados durante evento temporal',
                    challenge_type: 'temporal',
                    default_config: {
                        objectives: [],
                        weights: {},
                        bonus_early_completion: true,
                        event_name: '',
                        milestone_rewards: true
                    },
                    suggested_prizes: { min: 80, max: 200, optimal: 140 }
                }
            ];

            for (const template of templates) {
                await pool.query(`
                    INSERT INTO challenge_templates (
                        creator_id, name, description, challenge_type, 
                        default_config, suggested_prizes, is_public
                    ) VALUES ($1, $2, $3, $4, $5, $6, true)
                    ON CONFLICT (creator_id, name) DO UPDATE SET
                        description = EXCLUDED.description,
                        default_config = EXCLUDED.default_config,
                        suggested_prizes = EXCLUDED.suggested_prizes
                `, [
                    adminId,
                    template.name,
                    template.description,
                    template.challenge_type,
                    JSON.stringify(template.default_config),
                    JSON.stringify(template.suggested_prizes)
                ]);
            }

            console.log(`   ✓ ${templates.length} plantillas predefinidas creadas`);

        } catch (error) {
            console.error('Error creando plantillas:', error);
            throw error;
        }
    }

    async setupCronJobs() {
        try {
            // Configurar tareas periódicas usando node-cron si está disponible
            try {
                const cron = require('node-cron');
                
                // Validaciones automáticas cada 10 minutos
                cron.schedule('*/10 * * * *', async () => {
                    console.log('🔄 Ejecutando validaciones automáticas...');
                    try {
                        await this.validator.runPeriodicValidations();
                    } catch (error) {
                        console.error('Error en validaciones automáticas:', error);
                    }
                });

                // Notificaciones cada 30 minutos
                cron.schedule('*/30 * * * *', async () => {
                    console.log('📨 Ejecutando notificaciones automáticas...');
                    try {
                        await this.notificationSystem.runPeriodicNotifications();
                    } catch (error) {
                        console.error('Error en notificaciones automáticas:', error);
                    }
                });

                // Métricas diarias a las 2 AM
                cron.schedule('0 2 * * *', async () => {
                    console.log('📊 Actualizando métricas diarias...');
                    try {
                        await this.updateDailyMetrics();
                    } catch (error) {
                        console.error('Error actualizando métricas:', error);
                    }
                });

                console.log('   ✓ Tareas automáticas configuradas:');
                console.log('     - Validaciones cada 10 minutos');
                console.log('     - Notificaciones cada 30 minutos');
                console.log('     - Métricas diarias a las 2 AM');

            } catch (cronError) {
                console.log('   ⚠️  node-cron no disponible, configurando intervalos básicos...');
                
                // Fallback con setInterval
                setInterval(async () => {
                    try {
                        await this.validator.runPeriodicValidations();
                    } catch (error) {
                        console.error('Error en validaciones:', error);
                    }
                }, 10 * 60 * 1000); // 10 minutos

                setInterval(async () => {
                    try {
                        await this.notificationSystem.runPeriodicNotifications();
                    } catch (error) {
                        console.error('Error en notificaciones:', error);
                    }
                }, 30 * 60 * 1000); // 30 minutos

                console.log('   ✓ Intervalos básicos configurados');
            }

        } catch (error) {
            console.error('Error configurando cron jobs:', error);
            throw error;
        }
    }

    async createSampleChallenges() {
        try {
            const { Pool } = require('pg');
            const pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });

            // Obtener AdminPrincipal
            const adminResult = await pool.query(`
                SELECT id FROM users WHERE nickname = 'AdminPrincipal'
            `);

            if (adminResult.rows.length === 0) {
                console.log('   ⚠️  AdminPrincipal no encontrado, saltando retos de ejemplo');
                return;
            }

            const adminId = adminResult.rows[0].id;

            // Obtener algunos bloques para usar en ejemplos
            const blocksResult = await pool.query(`
                SELECT id, title FROM blocks LIMIT 3
            `);

            if (blocksResult.rows.length === 0) {
                console.log('   ⚠️  No hay bloques disponibles, saltando retos de ejemplo');
                return;
            }

            const sampleChallenges = [
                {
                    title: '🏃‍♂️ Maratón de Bienvenida',
                    description: 'Completa tus primeros bloques y familiarízate con la plataforma',
                    challenge_type: 'marathon',
                    config: {
                        required_blocks: [blocksResult.rows[0].id],
                        min_average_score: 60,
                        max_attempts_per_block: 5,
                        time_limit_hours: 168, // 1 semana
                        must_complete_all: true
                    },
                    prize_luminarias: 50,
                    bonus_luminarias: 20,
                    end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 días
                    auto_accept: true
                },
                {
                    title: '🔥 Racha Principiante',
                    description: 'Mantén una racha de estudio de 5 días consecutivos',
                    challenge_type: 'streak',
                    config: {
                        required_days: 5,
                        min_daily_sessions: 1,
                        min_daily_time_minutes: 10,
                        min_daily_questions: 5,
                        allowed_breaks: 1
                    },
                    prize_luminarias: 30,
                    bonus_luminarias: 10,
                    end_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 2 semanas
                    auto_accept: true
                }
            ];

            for (const challenge of sampleChallenges) {
                const result = await pool.query(`
                    INSERT INTO challenges (
                        creator_id, title, description, challenge_type, config,
                        prize_luminarias, bonus_luminarias, end_date, auto_accept, status
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
                    RETURNING id
                `, [
                    adminId,
                    challenge.title,
                    challenge.description,
                    challenge.challenge_type,
                    JSON.stringify(challenge.config),
                    challenge.prize_luminarias,
                    challenge.bonus_luminarias,
                    challenge.end_date,
                    challenge.auto_accept
                ]);

                console.log(`   ✓ Reto de ejemplo creado: ${challenge.title} (ID: ${result.rows[0].id})`);
            }

        } catch (error) {
            console.error('Error creando retos de ejemplo:', error);
            // No lanzar error aquí ya que es opcional
        }
    }

    async updateDailyMetrics() {
        try {
            const { Pool } = require('pg');
            const pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });

            // Actualizar métricas para todos los retos activos
            const activeChallenges = await pool.query(`
                SELECT id FROM challenges WHERE status = 'active'
            `);

            for (const challenge of activeChallenges.rows) {
                const metrics = await pool.query(`
                    SELECT 
                        COUNT(cp.id) as total_participants,
                        COUNT(CASE WHEN cp.status = 'active' THEN 1 END) as active_participants,
                        COUNT(CASE WHEN cp.status = 'completed' THEN 1 END) as completed_participants,
                        COALESCE(AVG(
                            CASE WHEN cp.current_metrics ? 'progress_percentage' 
                            THEN (cp.current_metrics->>'progress_percentage')::decimal 
                            ELSE 0 END
                        ), 0) as average_progress,
                        COALESCE(SUM(cp.prize_awarded), 0) as luminarias_awarded
                    FROM challenge_participants cp
                    WHERE cp.challenge_id = $1
                `, [challenge.id]);

                const data = metrics.rows[0];
                const engagementScore = this.calculateEngagementScore(data);

                await pool.query(`
                    INSERT INTO challenge_metrics (
                        challenge_id, metric_date, total_participants, active_participants,
                        completed_participants, average_progress, luminarias_awarded, engagement_score
                    ) VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (challenge_id, metric_date) DO UPDATE SET
                        total_participants = EXCLUDED.total_participants,
                        active_participants = EXCLUDED.active_participants,
                        completed_participants = EXCLUDED.completed_participants,
                        average_progress = EXCLUDED.average_progress,
                        luminarias_awarded = EXCLUDED.luminarias_awarded,
                        engagement_score = EXCLUDED.engagement_score
                `, [
                    challenge.id,
                    data.total_participants,
                    data.active_participants,
                    data.completed_participants,
                    data.average_progress,
                    data.luminarias_awarded,
                    engagementScore
                ]);
            }

            console.log(`   ✓ Métricas actualizadas para ${activeChallenges.rows.length} retos`);

        } catch (error) {
            console.error('Error actualizando métricas diarias:', error);
        }
    }

    calculateEngagementScore(data) {
        // Fórmula simple de engagement basada en participación y progreso
        const participationScore = Math.min(data.total_participants / 10, 10); // Máximo 10 puntos
        const progressScore = (data.average_progress / 100) * 10; // Máximo 10 puntos
        const completionScore = data.total_participants > 0 ? 
            (data.completed_participants / data.total_participants) * 10 : 0; // Máximo 10 puntos

        return Math.round((participationScore + progressScore + completionScore) / 3 * 10) / 10;
    }

    async checkSystemHealth() {
        try {
            const { Pool } = require('pg');
            const pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });

            // Verificar conexión a base de datos
            await pool.query('SELECT 1');

            // Verificar tablas principales
            const tables = ['challenges', 'challenge_participants', 'challenge_activities', 
                          'challenge_transfers', 'challenge_notifications', 'challenge_metrics'];
            
            for (const table of tables) {
                const result = await pool.query(`
                    SELECT COUNT(*) FROM information_schema.tables 
                    WHERE table_name = $1
                `, [table]);
                
                if (result.rows[0].count === '0') {
                    throw new Error(`Tabla ${table} no existe`);
                }
            }

            // Verificar retos activos
            const activeChallenges = await pool.query(`
                SELECT COUNT(*) as count FROM challenges WHERE status = 'active'
            `);

            const healthReport = {
                status: 'healthy',
                database_connected: true,
                tables_verified: tables.length,
                active_challenges: parseInt(activeChallenges.rows[0].count),
                last_check: new Date().toISOString()
            };

            return healthReport;

        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                last_check: new Date().toISOString()
            };
        }
    }

    async close() {
        await this.db.close();
        await this.validator.close();
        await this.notificationSystem.close();
    }
}

// Permitir ejecución directa del script
if (require.main === module) {
    const setup = new ChallengesSetup();
    setup.setupCompleteSystem()
        .then(async () => {
            console.log('\n🔍 Verificando estado del sistema...');
            const health = await setup.checkSystemHealth();
            console.log('📊 Estado del sistema:', health);
            
            await setup.close();
            process.exit(0);
        })
        .catch(async (error) => {
            console.error('💥 Error en configuración:', error);
            await setup.close();
            process.exit(1);
        });
}

module.exports = ChallengesSetup;