const { Pool } = require('pg');

// Sistema de pagos semanales automáticos para niveles PLAYTEST
class LevelsPaymentSystem {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
    }

    // ==================== CÁLCULO DE PAGOS SEMANALES ====================

    async calculateWeeklyPayments(weekStartDate = null) {
        try {
            const startDate = weekStartDate || this.getCurrentWeekStart();
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + 6);

            console.log(`Calculando pagos semanales para la semana ${startDate.toISOString().split('T')[0]} - ${endDate.toISOString().split('T')[0]}`);

            const results = {
                week_start: startDate,
                week_end: endDate,
                creator_payments: [],
                teacher_payments: [],
                total_luminarias: 0,
                processed_count: 0
            };

            // Procesar pagos de creadores
            const creatorPayments = await this.processCreatorPayments(startDate, endDate);
            results.creator_payments = creatorPayments;

            // Procesar pagos de profesores
            const teacherPayments = await this.processTeacherPayments(startDate, endDate);
            results.teacher_payments = teacherPayments;

            // Calcular totales
            results.total_luminarias = creatorPayments.reduce((sum, p) => sum + p.total_amount, 0) + 
                                     teacherPayments.reduce((sum, p) => sum + p.total_amount, 0);
            results.processed_count = creatorPayments.length + teacherPayments.length;

            console.log(`Pagos calculados: ${results.processed_count} usuarios, ${results.total_luminarias} Luminarias totales`);

            return results;

        } catch (error) {
            console.error('Error calculating weekly payments:', error);
            throw error;
        }
    }

    async processCreatorPayments(startDate, endDate) {
        try {
            // Obtener creadores con niveles activos
            const creatorsResult = await this.pool.query(`
                SELECT 
                    ul.user_id,
                    u.nickname,
                    ul.current_level_id,
                    ld.level_name,
                    ld.weekly_luminarias,
                    ul.current_metrics,
                    ul.achieved_at
                FROM user_levels ul
                JOIN users u ON ul.user_id = u.id
                JOIN level_definitions ld ON ul.current_level_id = ld.id
                WHERE ul.level_type = 'creator'
                    AND ld.weekly_luminarias > 0
                    AND ul.achieved_at <= $2
            `, [startDate, endDate]);

            const payments = [];

            for (const creator of creatorsResult.rows) {
                const activeUsers = creator.current_metrics?.active_users || 0;
                
                // Calcular bonificaciones basadas en rendimiento
                const bonus = await this.calculateCreatorBonus(creator.user_id, activeUsers, startDate, endDate);
                
                const payment = {
                    user_id: creator.user_id,
                    nickname: creator.nickname,
                    level_type: 'creator',
                    level_id: creator.current_level_id,
                    level_name: creator.level_name,
                    base_amount: creator.weekly_luminarias,
                    bonus_amount: bonus,
                    total_amount: creator.weekly_luminarias + bonus,
                    metrics_snapshot: {
                        active_users: activeUsers,
                        level_achieved_at: creator.achieved_at,
                        bonus_calculation: {
                            growth_bonus: bonus > 0,
                            performance_multiplier: bonus / Math.max(creator.weekly_luminarias, 1)
                        }
                    }
                };

                // Verificar que no exista ya un pago para esta semana
                const existingPayment = await this.pool.query(`
                    SELECT id FROM weekly_luminarias_payments 
                    WHERE user_id = $1 AND level_type = 'creator' AND week_start_date = $2
                `, [creator.user_id, startDate]);

                if (existingPayment.rows.length === 0) {
                    payments.push(payment);
                }
            }

            return payments;

        } catch (error) {
            console.error('Error processing creator payments:', error);
            return [];
        }
    }

    async processTeacherPayments(startDate, endDate) {
        try {
            // Obtener profesores con niveles activos
            const teachersResult = await this.pool.query(`
                SELECT 
                    ul.user_id,
                    u.nickname,
                    ul.current_level_id,
                    ld.level_name,
                    ld.weekly_luminarias,
                    ul.current_metrics,
                    ul.achieved_at
                FROM user_levels ul
                JOIN users u ON ul.user_id = u.id
                JOIN level_definitions ld ON ul.current_level_id = ld.id
                WHERE ul.level_type = 'teacher'
                    AND ld.weekly_luminarias > 0
                    AND ul.achieved_at <= $2
            `, [startDate, endDate]);

            const payments = [];

            for (const teacher of teachersResult.rows) {
                const activeStudents = teacher.current_metrics?.active_students || 0;
                
                // Calcular bonificaciones basadas en rendimiento
                const bonus = await this.calculateTeacherBonus(teacher.user_id, activeStudents, startDate, endDate);
                
                const payment = {
                    user_id: teacher.user_id,
                    nickname: teacher.nickname,
                    level_type: 'teacher',
                    level_id: teacher.current_level_id,
                    level_name: teacher.level_name,
                    base_amount: teacher.weekly_luminarias,
                    bonus_amount: bonus,
                    total_amount: teacher.weekly_luminarias + bonus,
                    metrics_snapshot: {
                        active_students: activeStudents,
                        level_achieved_at: teacher.achieved_at,
                        bonus_calculation: {
                            engagement_bonus: bonus > 0,
                            performance_multiplier: bonus / Math.max(teacher.weekly_luminarias, 1)
                        }
                    }
                };

                // Verificar que no exista ya un pago para esta semana
                const existingPayment = await this.pool.query(`
                    SELECT id FROM weekly_luminarias_payments 
                    WHERE user_id = $1 AND level_type = 'teacher' AND week_start_date = $2
                `, [teacher.user_id, startDate]);

                if (existingPayment.rows.length === 0) {
                    payments.push(payment);
                }
            }

            return payments;

        } catch (error) {
            console.error('Error processing teacher payments:', error);
            return [];
        }
    }

    // ==================== CÁLCULO DE BONIFICACIONES ====================

    async calculateCreatorBonus(creatorId, currentActiveUsers, startDate, endDate) {
        try {
            // Obtener métricas de la semana anterior para comparar crecimiento
            const prevWeekStart = new Date(startDate);
            prevWeekStart.setDate(prevWeekStart.getDate() - 7);
            
            const prevWeekEnd = new Date(endDate);
            prevWeekEnd.setDate(prevWeekEnd.getDate() - 7);

            // Buscar el último pago para obtener métricas anteriores
            const prevMetrics = await this.pool.query(`
                SELECT metrics_snapshot
                FROM weekly_luminarias_payments
                WHERE user_id = $1 AND level_type = 'creator'
                    AND week_start_date = $2
                ORDER BY created_at DESC
                LIMIT 1
            `, [creatorId, prevWeekStart]);

            let bonus = 0;
            const previousActiveUsers = prevMetrics.rows.length > 0 ? 
                (prevMetrics.rows[0].metrics_snapshot?.active_users || 0) : 0;

            // Bonificación por crecimiento (10% del pago base por cada 10% de crecimiento)
            if (previousActiveUsers > 0 && currentActiveUsers > previousActiveUsers) {
                const growthRate = ((currentActiveUsers - previousActiveUsers) / previousActiveUsers) * 100;
                if (growthRate >= 10) {
                    // Obtener pago base actual
                    const levelResult = await this.pool.query(`
                        SELECT ld.weekly_luminarias
                        FROM user_levels ul
                        JOIN level_definitions ld ON ul.current_level_id = ld.id
                        WHERE ul.user_id = $1 AND ul.level_type = 'creator'
                    `, [creatorId]);

                    if (levelResult.rows.length > 0) {
                        const basePay = levelResult.rows[0].weekly_luminarias;
                        bonus = Math.round(basePay * 0.1 * Math.floor(growthRate / 10));
                        bonus = Math.min(bonus, basePay); // Máximo 100% de bonificación
                    }
                }
            }

            // Bonificación por alcanzar hitos (50+ usuarios activos = +10 Luminarias)
            if (currentActiveUsers >= 50 && currentActiveUsers < 100) {
                bonus += 10;
            } else if (currentActiveUsers >= 100 && currentActiveUsers < 500) {
                bonus += 20;
            } else if (currentActiveUsers >= 500) {
                bonus += 40;
            }

            return bonus;

        } catch (error) {
            console.error('Error calculating creator bonus:', error);
            return 0;
        }
    }

    async calculateTeacherBonus(teacherId, currentActiveStudents, startDate, endDate) {
        try {
            // Obtener métricas de la semana anterior
            const prevWeekStart = new Date(startDate);
            prevWeekStart.setDate(prevWeekStart.getDate() - 7);

            const prevMetrics = await this.pool.query(`
                SELECT metrics_snapshot
                FROM weekly_luminarias_payments
                WHERE user_id = $1 AND level_type = 'teacher'
                    AND week_start_date = $2
                ORDER BY created_at DESC
                LIMIT 1
            `, [teacherId, prevWeekStart]);

            let bonus = 0;
            const previousActiveStudents = prevMetrics.rows.length > 0 ? 
                (prevMetrics.rows[0].metrics_snapshot?.active_students || 0) : 0;

            // Bonificación por retención de estudiantes (mantener o crecer)
            if (previousActiveStudents > 0 && currentActiveStudents >= previousActiveStudents) {
                const retentionRate = currentActiveStudents / previousActiveStudents;
                if (retentionRate >= 1.1) { // 10% de crecimiento
                    const levelResult = await this.pool.query(`
                        SELECT ld.weekly_luminarias
                        FROM user_levels ul
                        JOIN level_definitions ld ON ul.current_level_id = ld.id
                        WHERE ul.user_id = $1 AND ul.level_type = 'teacher'
                    `, [teacherId]);

                    if (levelResult.rows.length > 0) {
                        const basePay = levelResult.rows[0].weekly_luminarias;
                        bonus = Math.round(basePay * 0.15); // 15% de bonificación por crecimiento
                    }
                }
            }

            // Bonificación por engagement alto (calculado usando consolidación promedio de estudiantes)
            const avgConsolidation = await this.calculateStudentAverageConsolidation(teacherId);
            if (avgConsolidation >= 80) {
                bonus += 15; // Bonus por excelencia académica
            } else if (avgConsolidation >= 70) {
                bonus += 8;
            }

            return bonus;

        } catch (error) {
            console.error('Error calculating teacher bonus:', error);
            return 0;
        }
    }

    async calculateStudentAverageConsolidation(teacherId) {
        try {
            const result = await this.pool.query(`
                SELECT COALESCE(AVG(ubc.consolidation_percentage), 0) as avg_consolidation
                FROM user_block_consolidation ubc
                JOIN blocks b ON ubc.block_id = b.id
                WHERE b.creator_id = $1
                    AND ubc.calculated_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
            `, [teacherId]);

            return parseFloat(result.rows[0].avg_consolidation) || 0;

        } catch (error) {
            console.error('Error calculating student average consolidation:', error);
            return 0;
        }
    }

    // ==================== PROCESAMIENTO DE PAGOS ====================

    async processWeeklyPayments(weekStartDate = null) {
        try {
            const paymentData = await this.calculateWeeklyPayments(weekStartDate);
            const allPayments = [...paymentData.creator_payments, ...paymentData.teacher_payments];

            const processedPayments = [];

            for (const payment of allPayments) {
                try {
                    // Insertar registro de pago
                    const paymentResult = await this.pool.query(`
                        INSERT INTO weekly_luminarias_payments (
                            user_id, level_type, level_id, week_start_date, week_end_date,
                            base_amount, bonus_amount, total_amount, metrics_snapshot, 
                            payment_status, created_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', CURRENT_TIMESTAMP)
                        RETURNING id
                    `, [
                        payment.user_id,
                        payment.level_type,
                        payment.level_id,
                        paymentData.week_start,
                        paymentData.week_end,
                        payment.base_amount,
                        payment.bonus_amount,
                        payment.total_amount,
                        JSON.stringify(payment.metrics_snapshot)
                    ]);

                    const paymentId = paymentResult.rows[0].id;

                    // Ejecutar transferencia de Luminarias
                    const transferSuccess = await this.executePayment(payment.user_id, payment.total_amount, paymentId);

                    if (transferSuccess) {
                        // Marcar como pagado
                        await this.pool.query(`
                            UPDATE weekly_luminarias_payments 
                            SET payment_status = 'paid', processed_at = CURRENT_TIMESTAMP
                            WHERE id = $1
                        `, [paymentId]);

                        processedPayments.push({
                            ...payment,
                            payment_id: paymentId,
                            status: 'paid'
                        });

                        console.log(`✅ Pago procesado: ${payment.nickname} (${payment.level_name}) - ${payment.total_amount} Luminarias`);
                    } else {
                        // Marcar como fallido
                        await this.pool.query(`
                            UPDATE weekly_luminarias_payments 
                            SET payment_status = 'failed', processed_at = CURRENT_TIMESTAMP
                            WHERE id = $1
                        `, [paymentId]);

                        console.log(`❌ Error en pago: ${payment.nickname} - ${payment.total_amount} Luminarias`);
                    }

                } catch (paymentError) {
                    console.error(`Error procesando pago para usuario ${payment.user_id}:`, paymentError);
                }
            }

            const summary = {
                week_period: `${paymentData.week_start.toISOString().split('T')[0]} - ${paymentData.week_end.toISOString().split('T')[0]}`,
                total_users: allPayments.length,
                successful_payments: processedPayments.filter(p => p.status === 'paid').length,
                failed_payments: allPayments.length - processedPayments.filter(p => p.status === 'paid').length,
                total_luminarias_distributed: processedPayments.filter(p => p.status === 'paid').reduce((sum, p) => sum + p.total_amount, 0),
                processed_at: new Date().toISOString()
            };

            console.log('📊 Resumen de pagos semanales:', summary);

            return {
                summary,
                payments: processedPayments,
                raw_calculation: paymentData
            };

        } catch (error) {
            console.error('Error processing weekly payments:', error);
            throw error;
        }
    }

    async executePayment(userId, amount, paymentId) {
        try {
            // Verificar que el usuario existe
            const userResult = await this.pool.query(`
                SELECT luminarias FROM users WHERE id = $1
            `, [userId]);

            if (userResult.rows.length === 0) {
                console.error(`Usuario ${userId} no encontrado`);
                return false;
            }

            const currentLuminarias = userResult.rows[0].luminarias || 0;
            const newBalance = currentLuminarias + amount;

            // Actualizar balance del usuario
            await this.pool.query(`
                UPDATE users SET luminarias = $1 WHERE id = $2
            `, [newBalance, userId]);

            // Registrar transacción
            await this.pool.query(`
                INSERT INTO user_transactions (
                    user_id, transaction_type, amount, description, 
                    metadata, created_at
                ) VALUES ($1, 'level_payment', $2, $3, $4, CURRENT_TIMESTAMP)
            `, [
                userId,
                amount,
                'Pago semanal por nivel',
                JSON.stringify({ 
                    payment_id: paymentId,
                    previous_balance: currentLuminarias,
                    new_balance: newBalance
                })
            ]);

            return true;

        } catch (error) {
            console.error('Error executing payment:', error);
            return false;
        }
    }

    // ==================== CONSULTAS Y REPORTES ====================

    async getPaymentHistory(userId, limit = 10) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    wlp.*,
                    ld.level_name,
                    ld.description as level_description
                FROM weekly_luminarias_payments wlp
                JOIN level_definitions ld ON wlp.level_id = ld.id
                WHERE wlp.user_id = $1
                ORDER BY wlp.week_start_date DESC
                LIMIT $2
            `, [userId, limit]);

            return result.rows;

        } catch (error) {
            console.error('Error getting payment history:', error);
            return [];
        }
    }

    async getWeeklyPaymentSummary(weekStartDate) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    level_type,
                    COUNT(*) as payment_count,
                    SUM(base_amount) as total_base,
                    SUM(bonus_amount) as total_bonus,
                    SUM(total_amount) as total_paid,
                    COUNT(CASE WHEN payment_status = 'paid' THEN 1 END) as successful_payments,
                    COUNT(CASE WHEN payment_status = 'failed' THEN 1 END) as failed_payments
                FROM weekly_luminarias_payments
                WHERE week_start_date = $1
                GROUP BY level_type
            `, [weekStartDate]);

            return result.rows;

        } catch (error) {
            console.error('Error getting weekly payment summary:', error);
            return [];
        }
    }

    async getPendingPayments() {
        try {
            const result = await this.pool.query(`
                SELECT 
                    wlp.*,
                    u.nickname,
                    ld.level_name
                FROM weekly_luminarias_payments wlp
                JOIN users u ON wlp.user_id = u.id
                JOIN level_definitions ld ON wlp.level_id = ld.id
                WHERE wlp.payment_status = 'pending'
                ORDER BY wlp.created_at ASC
            `);

            return result.rows;

        } catch (error) {
            console.error('Error getting pending payments:', error);
            return [];
        }
    }

    // ==================== UTILIDADES ====================

    getCurrentWeekStart() {
        const now = new Date();
        const dayOfWeek = now.getDay(); // 0 = domingo, 1 = lunes, etc.
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Calcular días hasta el lunes anterior
        
        const monday = new Date(now);
        monday.setDate(now.getDate() - daysToMonday);
        monday.setHours(0, 0, 0, 0);
        
        return monday;
    }

    getWeekRange(weekStartDate) {
        const startDate = new Date(weekStartDate);
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);
        endDate.setHours(23, 59, 59, 999);
        
        return { startDate, endDate };
    }

    async retryFailedPayments(weekStartDate) {
        try {
            const failedPayments = await this.pool.query(`
                SELECT * FROM weekly_luminarias_payments
                WHERE week_start_date = $1 AND payment_status = 'failed'
            `, [weekStartDate]);

            const retryResults = [];

            for (const payment of failedPayments.rows) {
                const success = await this.executePayment(payment.user_id, payment.total_amount, payment.id);
                
                if (success) {
                    await this.pool.query(`
                        UPDATE weekly_luminarias_payments 
                        SET payment_status = 'paid', processed_at = CURRENT_TIMESTAMP
                        WHERE id = $1
                    `, [payment.id]);
                    
                    retryResults.push({ payment_id: payment.id, status: 'success' });
                } else {
                    retryResults.push({ payment_id: payment.id, status: 'failed_again' });
                }
            }

            return retryResults;

        } catch (error) {
            console.error('Error retrying failed payments:', error);
            return [];
        }
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = LevelsPaymentSystem;

// Auto-ejecutar para pagos semanales si se ejecuta directamente
if (require.main === module) {
    const paymentSystem = new LevelsPaymentSystem();
    
    async function runWeeklyPayments() {
        try {
            console.log('🚀 Iniciando procesamiento de pagos semanales...');
            const results = await paymentSystem.processWeeklyPayments();
            console.log('✅ Pagos semanales completados:', results.summary);
        } catch (error) {
            console.error('❌ Error en pagos semanales:', error);
        } finally {
            await paymentSystem.close();
        }
    }
    
    runWeeklyPayments();
}