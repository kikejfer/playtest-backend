const express = require('express');
const { pool } = require('../database/connection');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// ========== ENDPOINTS DE BALANCE Y ESTADÍSTICAS ==========

// Obtener balance actual del usuario
router.get('/balance', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM get_user_luminarias_stats($1)',
            [req.user.id]
        );
        
        const stats = result.rows[0] || {
            current_balance: 200,
            total_earned: 200,
            total_spent: 0,
            lifetime_earnings: 200,
            transactions_count: 0,
            last_activity: new Date()
        };
        
        res.json(stats);
    } catch (error) {
        console.error('Error obteniendo balance:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener historial de transacciones con filtros
router.get('/transactions', authenticateToken, async (req, res) => {
    try {
        const {
            user_role,
            category,
            transaction_type,
            limit = 50,
            offset = 0,
            date_from,
            date_to
        } = req.query;
        
        let query = `
            SELECT 
                lt.*,
                CASE 
                    WHEN lt.from_user_id IS NOT NULL THEN fu.nickname 
                    WHEN lt.to_user_id IS NOT NULL THEN tu.nickname 
                END as related_user_nickname
            FROM luminarias_transactions lt
            LEFT JOIN users fu ON lt.from_user_id = fu.id
            LEFT JOIN users tu ON lt.to_user_id = tu.id
            WHERE lt.user_id = $1
        `;
        
        const params = [req.user.id];
        let paramIndex = 2;
        
        if (user_role) {
            query += ` AND lt.user_role = $${paramIndex}`;
            params.push(user_role);
            paramIndex++;
        }
        
        if (category) {
            query += ` AND lt.category = $${paramIndex}`;
            params.push(category);
            paramIndex++;
        }
        
        if (transaction_type) {
            query += ` AND lt.transaction_type = $${paramIndex}`;
            params.push(transaction_type);
            paramIndex++;
        }
        
        if (date_from) {
            query += ` AND lt.created_at >= $${paramIndex}`;
            params.push(date_from);
            paramIndex++;
        }
        
        if (date_to) {
            query += ` AND lt.created_at <= $${paramIndex}`;
            params.push(date_to);
            paramIndex++;
        }
        
        query += ` ORDER BY lt.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(parseInt(limit), parseInt(offset));
        
        const result = await pool.query(query, params);
        
        // Obtener total de transacciones para paginación
        let countQuery = `
            SELECT COUNT(*) as total
            FROM luminarias_transactions lt
            WHERE lt.user_id = $1
        `;
        const countParams = [req.user.id];
        let countParamIndex = 2;
        
        if (user_role) {
            countQuery += ` AND lt.user_role = $${countParamIndex}`;
            countParams.push(user_role);
            countParamIndex++;
        }
        
        if (category) {
            countQuery += ` AND lt.category = $${countParamIndex}`;
            countParams.push(category);
            countParamIndex++;
        }
        
        if (transaction_type) {
            countQuery += ` AND lt.transaction_type = $${countParamIndex}`;
            countParams.push(transaction_type);
            countParamIndex++;
        }
        
        if (date_from) {
            countQuery += ` AND lt.created_at >= $${countParamIndex}`;
            countParams.push(date_from);
            countParamIndex++;
        }
        
        if (date_to) {
            countQuery += ` AND lt.created_at <= $${countParamIndex}`;
            countParams.push(date_to);
            countParamIndex++;
        }
        
        const countResult = await pool.query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].total);
        
        res.json({
            transactions: result.rows,
            pagination: {
                total,
                limit: parseInt(limit),
                offset: parseInt(offset),
                has_more: (parseInt(offset) + parseInt(limit)) < total
            }
        });
    } catch (error) {
        console.error('Error obteniendo transacciones:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ========== ENDPOINTS DE TRANSACCIONES ==========

// Procesar transacción de Luminarias
router.post('/transaction', authenticateToken, async (req, res) => {
    try {
        const {
            transaction_type,
            amount,
            user_role,
            category,
            subcategory,
            action_type,
            description,
            reference_id,
            reference_type,
            metadata = {}
        } = req.body;
        
        // Validar campos obligatorios
        if (!transaction_type || !amount || !user_role || !category || !action_type || !description) {
            return res.status(400).json({ 
                error: 'Campos obligatorios: transaction_type, amount, user_role, category, action_type, description' 
            });
        }
        
        // Validar tipos de transacción
        const validTransactionTypes = ['earn', 'spend', 'transfer_in', 'transfer_out', 'conversion'];
        if (!validTransactionTypes.includes(transaction_type)) {
            return res.status(400).json({ error: 'Tipo de transacción inválido' });
        }
        
        // Validar roles
        const validRoles = ['user', 'creator'];
        if (!validRoles.includes(user_role)) {
            return res.status(400).json({ error: 'Rol inválido' });
        }
        
        const transactionId = await pool.query(
            'SELECT process_luminarias_transaction($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
            [
                req.user.id,
                transaction_type,
                parseInt(amount),
                user_role,
                category,
                subcategory,
                action_type,
                description,
                reference_id,
                reference_type,
                JSON.stringify(metadata)
            ]
        );
        
        res.json({
            message: 'Transacción procesada exitosamente',
            transaction_id: transactionId.rows[0].process_luminarias_transaction
        });
    } catch (error) {
        console.error('Error procesando transacción:', error);
        
        if (error.message.includes('Saldo insuficiente')) {
            return res.status(400).json({ error: error.message });
        }
        
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Transferir Luminarias entre usuarios
router.post('/transfer', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const { to_user_id, amount, description = 'Transferencia entre usuarios' } = req.body;
        
        if (!to_user_id || !amount) {
            return res.status(400).json({ error: 'Campos obligatorios: to_user_id, amount' });
        }
        
        if (parseInt(amount) <= 0) {
            return res.status(400).json({ error: 'La cantidad debe ser mayor a 0' });
        }
        
        if (req.user.id === parseInt(to_user_id)) {
            return res.status(400).json({ error: 'No puedes transferir a ti mismo' });
        }
        
        // Verificar que el usuario destino existe
        const targetUser = await client.query('SELECT id, nickname FROM users WHERE id = $1', [to_user_id]);
        if (targetUser.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario destino no encontrado' });
        }
        
        // Procesar transferencia de salida
        const outTransactionId = await client.query(
            'SELECT process_luminarias_transaction($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
            [
                req.user.id,
                'transfer_out',
                parseInt(amount),
                'user', // Asumimos rol de usuario para transferencias
                'transfers',
                'user_to_user',
                'send_transfer',
                `Transferencia enviada a ${targetUser.rows[0].nickname}: ${description}`,
                to_user_id,
                'user_transfer',
                JSON.stringify({ to_user_id, original_description: description })
            ]
        );
        
        // Procesar transferencia de entrada
        const inTransactionId = await client.query(
            'SELECT process_luminarias_transaction($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
            [
                to_user_id,
                'transfer_in',
                parseInt(amount),
                'user',
                'transfers',
                'user_to_user',
                'receive_transfer',
                `Transferencia recibida de ${req.user.nickname}: ${description}`,
                req.user.id,
                'user_transfer',
                JSON.stringify({ from_user_id: req.user.id, original_description: description })
            ]
        );
        
        // Actualizar las transacciones con referencias cruzadas
        await client.query(`
            UPDATE luminarias_transactions 
            SET from_user_id = $1, to_user_id = $2 
            WHERE id = $3
        `, [req.user.id, to_user_id, outTransactionId.rows[0].process_luminarias_transaction]);
        
        await client.query(`
            UPDATE luminarias_transactions 
            SET from_user_id = $1, to_user_id = $2 
            WHERE id = $3
        `, [req.user.id, to_user_id, inTransactionId.rows[0].process_luminarias_transaction]);
        
        await client.query('COMMIT');
        
        res.json({
            message: 'Transferencia realizada exitosamente',
            out_transaction_id: outTransactionId.rows[0].process_luminarias_transaction,
            in_transaction_id: inTransactionId.rows[0].process_luminarias_transaction,
            target_user: targetUser.rows[0].nickname
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en transferencia:', error);
        
        if (error.message.includes('Saldo insuficiente')) {
            return res.status(400).json({ error: error.message });
        }
        
        res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
        client.release();
    }
});

// ========== ENDPOINTS DE CONFIGURACIÓN ==========

// Obtener configuración de valores de Luminarias
router.get('/config', authenticateToken, async (req, res) => {
    try {
        const { category } = req.query;
        
        let query = 'SELECT * FROM luminarias_config WHERE is_active = true';
        const params = [];
        
        if (category) {
            query += ' AND category = $1';
            params.push(category);
        }
        
        query += ' ORDER BY category, subcategory, action_type';
        
        const result = await pool.query(query, params);
        
        // Organizar por categorías
        const config = result.rows.reduce((acc, row) => {
            if (!acc[row.category]) {
                acc[row.category] = {};
            }
            if (!acc[row.category][row.subcategory]) {
                acc[row.category][row.subcategory] = {};
            }
            acc[row.category][row.subcategory][row.action_type] = {
                min_amount: row.min_amount,
                max_amount: row.max_amount,
                description: row.description
            };
            return acc;
        }, {});
        
        res.json(config);
    } catch (error) {
        console.error('Error obteniendo configuración:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Actualizar configuración (solo admins)
router.put('/config/:id', authenticateToken, async (req, res) => {
    try {
        // Verificar que es administrador
        const userRoles = await pool.query(`
            SELECT r.name 
            FROM user_roles ur 
            JOIN roles r ON ur.role_id = r.id 
            WHERE ur.user_id = $1 
            AND r.name IN ('administrador_principal', 'administrador_secundario')
        `, [req.user.id]);
        
        if (userRoles.rows.length === 0) {
            return res.status(403).json({ error: 'Solo los administradores pueden modificar la configuración' });
        }
        
        const { min_amount, max_amount, description, is_active } = req.body;
        const configId = req.params.id;
        
        const result = await pool.query(`
            UPDATE luminarias_config 
            SET min_amount = $1, max_amount = $2, description = $3, is_active = $4, updated_at = CURRENT_TIMESTAMP
            WHERE id = $5
            RETURNING *
        `, [min_amount, max_amount, description, is_active, configId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Configuración no encontrada' });
        }
        
        res.json({
            message: 'Configuración actualizada exitosamente',
            config: result.rows[0]
        });
    } catch (error) {
        console.error('Error actualizando configuración:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ========== ENDPOINTS DE TIENDA ==========

// Obtener items de la tienda
router.get('/store', authenticateToken, async (req, res) => {
    try {
        const { category, target_role, subcategory } = req.query;
        
        let query = `
            SELECT * FROM luminarias_store_items 
            WHERE is_active = true
        `;
        const params = [];
        let paramIndex = 1;
        
        if (category) {
            query += ` AND category = $${paramIndex}`;
            params.push(category);
            paramIndex++;
        }
        
        if (target_role) {
            query += ` AND (target_role = $${paramIndex} OR target_role = 'both')`;
            params.push(target_role);
            paramIndex++;
        }
        
        if (subcategory) {
            query += ` AND subcategory = $${paramIndex}`;
            params.push(subcategory);
            paramIndex++;
        }
        
        query += ' ORDER BY category, subcategory, price_luminarias';
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo tienda:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Comprar item de la tienda
router.post('/store/purchase', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const { item_id, quantity = 1 } = req.body;
        
        if (!item_id) {
            return res.status(400).json({ error: 'item_id es obligatorio' });
        }
        
        // Obtener información del item
        const itemResult = await client.query(`
            SELECT * FROM luminarias_store_items 
            WHERE id = $1 AND is_active = true
        `, [item_id]);
        
        if (itemResult.rows.length === 0) {
            return res.status(404).json({ error: 'Item no encontrado o no disponible' });
        }
        
        const item = itemResult.rows[0];
        const totalPrice = item.price_luminarias * parseInt(quantity);
        
        // Verificar stock si aplica
        if (item.limited_quantity && item.stock_remaining < parseInt(quantity)) {
            return res.status(400).json({ error: 'Stock insuficiente' });
        }
        
        // Procesar transacción de pago
        const transactionId = await client.query(
            'SELECT process_luminarias_transaction($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
            [
                req.user.id,
                'spend',
                totalPrice,
                item.target_role === 'creator' ? 'creator' : 'user',
                'store_purchase',
                item.category,
                'buy_item',
                `Compra: ${item.name} (x${quantity})`,
                item_id,
                'store_item',
                JSON.stringify({ item_name: item.name, quantity, unit_price: item.price_luminarias })
            ]
        );
        
        // Registrar la compra
        const purchaseResult = await client.query(`
            INSERT INTO luminarias_purchases (
                user_id, store_item_id, transaction_id, quantity, unit_price, total_price,
                expires_at, uses_remaining, purchase_metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `, [
            req.user.id,
            item_id,
            transactionId.rows[0].process_luminarias_transaction,
            parseInt(quantity),
            item.price_luminarias,
            totalPrice,
            item.duration_days ? new Date(Date.now() + item.duration_days * 24 * 60 * 60 * 1000) : null,
            item.max_uses ? item.max_uses * parseInt(quantity) : null,
            JSON.stringify({ purchased_at: new Date(), item_metadata: item.metadata })
        ]);
        
        // Actualizar stock si aplica
        if (item.limited_quantity) {
            await client.query(`
                UPDATE luminarias_store_items 
                SET stock_remaining = stock_remaining - $1 
                WHERE id = $2
            `, [parseInt(quantity), item_id]);
        }
        
        await client.query('COMMIT');
        
        res.json({
            message: 'Compra realizada exitosamente',
            purchase: purchaseResult.rows[0],
            transaction_id: transactionId.rows[0].process_luminarias_transaction
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en compra:', error);
        
        if (error.message.includes('Saldo insuficiente')) {
            return res.status(400).json({ error: error.message });
        }
        
        res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
        client.release();
    }
});

// Obtener compras del usuario
router.get('/purchases', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                lp.*,
                lsi.name as item_name,
                lsi.description as item_description,
                lsi.category,
                lsi.subcategory,
                lsi.item_type
            FROM luminarias_purchases lp
            JOIN luminarias_store_items lsi ON lp.store_item_id = lsi.id
            WHERE lp.user_id = $1
            ORDER BY lp.created_at DESC
        `, [req.user.id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo compras:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ========== ENDPOINTS DE ESTADÍSTICAS ==========

// Obtener estadísticas de ganancia por categoría
router.get('/stats/earnings', authenticateToken, async (req, res) => {
    try {
        const { period = '30' } = req.query; // días
        
        const result = await pool.query(`
            SELECT 
                user_role,
                category,
                subcategory,
                COUNT(*) as transaction_count,
                SUM(amount) as total_earned,
                AVG(amount) as avg_amount,
                MIN(amount) as min_amount,
                MAX(amount) as max_amount
            FROM luminarias_transactions
            WHERE user_id = $1 
            AND transaction_type = 'earn'
            AND created_at >= NOW() - INTERVAL '${parseInt(period)} days'
            GROUP BY user_role, category, subcategory
            ORDER BY total_earned DESC
        `, [req.user.id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo estadísticas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener estadísticas de gasto por categoría
router.get('/stats/spending', authenticateToken, async (req, res) => {
    try {
        const { period = '30' } = req.query; // días
        
        const result = await pool.query(`
            SELECT 
                user_role,
                category,
                subcategory,
                COUNT(*) as transaction_count,
                SUM(ABS(amount)) as total_spent,
                AVG(ABS(amount)) as avg_amount,
                MIN(ABS(amount)) as min_amount,
                MAX(ABS(amount)) as max_amount
            FROM luminarias_transactions
            WHERE user_id = $1 
            AND transaction_type IN ('spend', 'transfer_out')
            AND created_at >= NOW() - INTERVAL '${parseInt(period)} days'
            GROUP BY user_role, category, subcategory
            ORDER BY total_spent DESC
        `, [req.user.id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo estadísticas de gasto:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ========== ENDPOINTS DE MARKETPLACE ==========

// Obtener servicios del marketplace
router.get('/marketplace', authenticateToken, async (req, res) => {
    try {
        const { category, provider_id } = req.query;
        
        let query = `
            SELECT 
                lm.*,
                u.nickname as provider_nickname,
                u.email as provider_email,
                COUNT(lmb.id) as total_bookings,
                COALESCE(AVG(lmb.provider_rating), 0) as avg_rating
            FROM luminarias_marketplace lm
            JOIN users u ON lm.provider_id = u.id
            LEFT JOIN luminarias_marketplace_bookings lmb ON lm.id = lmb.service_id AND lmb.status = 'completed'
            WHERE lm.is_active = true
        `;
        const params = [];
        let paramIndex = 1;
        
        if (category) {
            query += ` AND lm.category = $${paramIndex}`;
            params.push(category);
            paramIndex++;
        }
        
        if (provider_id) {
            query += ` AND lm.provider_id = $${paramIndex}`;
            params.push(provider_id);
            paramIndex++;
        }
        
        query += ` GROUP BY lm.id, u.nickname, u.email ORDER BY avg_rating DESC, lm.created_at DESC`;
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo marketplace:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear servicio en marketplace
router.post('/marketplace', authenticateToken, async (req, res) => {
    try {
        const {
            service_name,
            service_description,
            category,
            price_luminarias,
            price_real_money,
            service_type,
            duration_minutes,
            max_clients,
            requirements,
            delivery_method,
            metadata = {}
        } = req.body;
        
        if (!service_name || !service_description || !category || !price_luminarias || !service_type) {
            return res.status(400).json({ 
                error: 'Campos obligatorios: service_name, service_description, category, price_luminarias, service_type' 
            });
        }
        
        const result = await pool.query(`
            INSERT INTO luminarias_marketplace (
                provider_id, service_name, service_description, category,
                price_luminarias, price_real_money, service_type, duration_minutes,
                max_clients, requirements, delivery_method, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
        `, [
            req.user.id, service_name, service_description, category,
            price_luminarias, price_real_money, service_type, duration_minutes,
            max_clients, requirements, delivery_method, JSON.stringify(metadata)
        ]);
        
        res.json({
            message: 'Servicio creado exitosamente',
            service: result.rows[0]
        });
    } catch (error) {
        console.error('Error creando servicio:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Contratar servicio del marketplace
router.post('/marketplace/:service_id/book', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const serviceId = req.params.service_id;
        const { scheduled_at, delivery_notes } = req.body;
        
        // Obtener información del servicio
        const serviceResult = await client.query(`
            SELECT lm.*, u.nickname as provider_nickname
            FROM luminarias_marketplace lm
            JOIN users u ON lm.provider_id = u.id
            WHERE lm.id = $1 AND lm.is_active = true
        `, [serviceId]);
        
        if (serviceResult.rows.length === 0) {
            return res.status(404).json({ error: 'Servicio no encontrado' });
        }
        
        const service = serviceResult.rows[0];
        
        if (service.provider_id === req.user.id) {
            return res.status(400).json({ error: 'No puedes contratar tu propio servicio' });
        }
        
        // Verificar capacidad
        if (service.max_clients) {
            if (service.current_clients >= service.max_clients) {
                return res.status(400).json({ error: 'Servicio no disponible - capacidad máxima alcanzada' });
            }
        }
        
        // Procesar pago del cliente
        const clientTransactionId = await client.query(
            'SELECT process_luminarias_transaction($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
            [
                req.user.id,
                'spend',
                service.price_luminarias,
                'user',
                'marketplace',
                service.category,
                'book_service',
                `Contratación: ${service.service_name} por ${service.provider_nickname}`,
                serviceId,
                'marketplace_service',
                JSON.stringify({ 
                    service_name: service.service_name, 
                    provider_id: service.provider_id,
                    scheduled_at 
                })
            ]
        );
        
        // Crear la reserva
        const bookingResult = await client.query(`
            INSERT INTO luminarias_marketplace_bookings (
                service_id, client_id, provider_id, transaction_id, total_price,
                scheduled_at, duration_minutes, delivery_method, delivery_notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `, [
            serviceId,
            req.user.id,
            service.provider_id,
            clientTransactionId.rows[0].process_luminarias_transaction,
            service.price_luminarias,
            scheduled_at || null,
            service.duration_minutes,
            service.delivery_method,
            delivery_notes
        ]);
        
        // Actualizar contador de clientes
        await client.query(`
            UPDATE luminarias_marketplace 
            SET current_clients = current_clients + 1 
            WHERE id = $1
        `, [serviceId]);
        
        await client.query('COMMIT');
        
        res.json({
            message: 'Servicio contratado exitosamente',
            booking: bookingResult.rows[0],
            transaction_id: clientTransactionId.rows[0].process_luminarias_transaction
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error contratando servicio:', error);
        
        if (error.message.includes('Saldo insuficiente')) {
            return res.status(400).json({ error: error.message });
        }
        
        res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
        client.release();
    }
});

// Obtener mis contrataciones (como cliente)
router.get('/marketplace/my-bookings', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                lmb.*,
                lm.service_name,
                lm.service_description,
                lm.category,
                u.nickname as provider_nickname
            FROM luminarias_marketplace_bookings lmb
            JOIN luminarias_marketplace lm ON lmb.service_id = lm.id
            JOIN users u ON lmb.provider_id = u.id
            WHERE lmb.client_id = $1
            ORDER BY lmb.created_at DESC
        `, [req.user.id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo mis contrataciones:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener mis servicios y sus reservas (como proveedor)
router.get('/marketplace/my-services', authenticateToken, async (req, res) => {
    try {
        const servicesResult = await pool.query(`
            SELECT * FROM luminarias_marketplace 
            WHERE provider_id = $1 
            ORDER BY created_at DESC
        `, [req.user.id]);
        
        const bookingsResult = await pool.query(`
            SELECT 
                lmb.*,
                lm.service_name,
                u.nickname as client_nickname
            FROM luminarias_marketplace_bookings lmb
            JOIN luminarias_marketplace lm ON lmb.service_id = lm.id
            JOIN users u ON lmb.client_id = u.id
            WHERE lmb.provider_id = $1
            ORDER BY lmb.created_at DESC
        `, [req.user.id]);
        
        res.json({
            services: servicesResult.rows,
            bookings: bookingsResult.rows
        });
    } catch (error) {
        console.error('Error obteniendo mis servicios:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Completar servicio y liberar pago al proveedor
router.post('/marketplace/bookings/:booking_id/complete', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const bookingId = req.params.booking_id;
        const { completion_notes } = req.body;
        
        // Obtener información de la reserva
        const bookingResult = await client.query(`
            SELECT lmb.*, lm.service_name, lm.price_luminarias
            FROM luminarias_marketplace_bookings lmb
            JOIN luminarias_marketplace lm ON lmb.service_id = lm.id
            WHERE lmb.id = $1 AND lmb.provider_id = $2 AND lmb.status = 'confirmed'
        `, [bookingId, req.user.id]);
        
        if (bookingResult.rows.length === 0) {
            return res.status(404).json({ error: 'Reserva no encontrada o no autorizada' });
        }
        
        const booking = bookingResult.rows[0];
        
        // Calcular comisión (5% para marketplace interno)
        const commissionRate = 0.05;
        const commissionAmount = Math.floor(booking.total_price * commissionRate);
        const providerAmount = booking.total_price - commissionAmount;
        
        // Pagar al proveedor
        const providerTransactionId = await client.query(
            'SELECT process_luminarias_transaction($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
            [
                req.user.id,
                'earn',
                providerAmount,
                'creator',
                'marketplace',
                'service_payment',
                'complete_service',
                `Pago por servicio: ${booking.service_name} (${providerAmount} Luminarias, comisión: ${commissionAmount})`,
                booking.service_id,
                'marketplace_payment',
                JSON.stringify({ 
                    booking_id: bookingId,
                    gross_amount: booking.total_price,
                    commission: commissionAmount,
                    net_amount: providerAmount
                })
            ]
        );
        
        // Actualizar estado de la reserva
        await client.query(`
            UPDATE luminarias_marketplace_bookings 
            SET status = 'completed', completed_at = CURRENT_TIMESTAMP, delivery_notes = $1
            WHERE id = $2
        `, [completion_notes, bookingId]);
        
        // Reducir contador de clientes activos
        await client.query(`
            UPDATE luminarias_marketplace 
            SET current_clients = GREATEST(current_clients - 1, 0) 
            WHERE id = $1
        `, [booking.service_id]);
        
        await client.query('COMMIT');
        
        res.json({
            message: 'Servicio completado exitosamente',
            provider_payment: providerAmount,
            commission: commissionAmount,
            transaction_id: providerTransactionId.rows[0].process_luminarias_transaction
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error completando servicio:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
        client.release();
    }
});

// ========== ENDPOINTS DE CONVERSIÓN A DINERO REAL ==========

// Solicitar conversión a dinero real
router.post('/conversion/request', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const { 
            luminarias_amount, 
            payment_method, 
            payment_details = {} 
        } = req.body;
        
        if (!luminarias_amount || !payment_method) {
            return res.status(400).json({ 
                error: 'Campos obligatorios: luminarias_amount, payment_method' 
            });
        }
        
        // Verificar que el usuario tiene rol de creador nivel Maestro+
        const userLevel = await client.query(`
            SELECT ur.role_id, r.name, r.hierarchy_level
            FROM user_roles ur 
            JOIN roles r ON ur.role_id = r.id 
            WHERE ur.user_id = $1 
            AND r.name IN ('creador_contenido', 'profesor')
            AND r.hierarchy_level >= 3
        `, [req.user.id]);
        
        if (userLevel.rows.length === 0) {
            return res.status(403).json({ 
                error: 'Solo creadores nivel Maestro+ pueden convertir Luminarias a dinero real' 
            });
        }
        
        // Verificar mínimo de conversión (25,000 Luminarias)
        const minConversion = 25000;
        if (parseInt(luminarias_amount) < minConversion) {
            return res.status(400).json({ 
                error: `Cantidad mínima de conversión: ${minConversion} Luminarias` 
            });
        }
        
        // Calcular conversión (tasa ejemplo: 1 Luminaria = $0.004)
        const conversionRate = 0.004;
        const grossAmount = parseInt(luminarias_amount) * conversionRate;
        const commissionRate = 0.20; // 20%
        const commissionAmount = grossAmount * commissionRate;
        const netAmount = grossAmount - commissionAmount;
        
        // Procesar transacción de conversión
        const transactionId = await client.query(
            'SELECT process_luminarias_transaction($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
            [
                req.user.id,
                'conversion',
                parseInt(luminarias_amount),
                'creator',
                'conversion',
                'real_money',
                'convert_to_money',
                `Conversión a dinero real: ${luminarias_amount} Luminarias → $${netAmount.toFixed(2)} (comisión: $${commissionAmount.toFixed(2)})`,
                null,
                'money_conversion',
                JSON.stringify({ 
                    gross_amount: grossAmount,
                    commission_rate: commissionRate,
                    commission_amount: commissionAmount,
                    net_amount: netAmount,
                    payment_method
                })
            ]
        );
        
        // Crear registro de conversión
        const conversionResult = await client.query(`
            INSERT INTO luminarias_conversions (
                user_id, transaction_id, luminarias_amount, conversion_rate,
                gross_amount, commission_rate, commission_amount, net_amount,
                payment_method, payment_details
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
        `, [
            req.user.id,
            transactionId.rows[0].process_luminarias_transaction,
            parseInt(luminarias_amount),
            conversionRate,
            grossAmount,
            commissionRate,
            commissionAmount,
            netAmount,
            payment_method,
            JSON.stringify(payment_details)
        ]);
        
        await client.query('COMMIT');
        
        res.json({
            message: 'Solicitud de conversión creada exitosamente',
            conversion: conversionResult.rows[0],
            estimated_processing_time: '3-5 días hábiles'
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en solicitud de conversión:', error);
        
        if (error.message.includes('Saldo insuficiente')) {
            return res.status(400).json({ error: error.message });
        }
        
        res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
        client.release();
    }
});

// Obtener mis conversiones
router.get('/conversions', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                lc.*,
                ru.nickname as reviewed_by_nickname
            FROM luminarias_conversions lc
            LEFT JOIN users ru ON lc.reviewed_by = ru.id
            WHERE lc.user_id = $1
            ORDER BY lc.created_at DESC
        `, [req.user.id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo conversiones:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener conversiones pendientes (solo admins)
router.get('/conversions/pending', authenticateToken, async (req, res) => {
    try {
        // Verificar que es administrador
        const userRoles = await pool.query(`
            SELECT r.name 
            FROM user_roles ur 
            JOIN roles r ON ur.role_id = r.id 
            WHERE ur.user_id = $1 
            AND r.name IN ('administrador_principal', 'administrador_secundario')
        `, [req.user.id]);
        
        if (userRoles.rows.length === 0) {
            return res.status(403).json({ error: 'Solo los administradores pueden ver conversiones pendientes' });
        }
        
        const result = await pool.query(`
            SELECT 
                lc.*,
                u.nickname as user_nickname,
                u.email as user_email
            FROM luminarias_conversions lc
            JOIN users u ON lc.user_id = u.id
            WHERE lc.status = 'pending'
            ORDER BY lc.created_at ASC
        `);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo conversiones pendientes:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Aprobar/rechazar conversión (solo admins)
router.post('/conversions/:conversion_id/review', authenticateToken, async (req, res) => {
    try {
        // Verificar que es administrador
        const userRoles = await pool.query(`
            SELECT r.name 
            FROM user_roles ur 
            JOIN roles r ON ur.role_id = r.id 
            WHERE ur.user_id = $1 
            AND r.name IN ('administrador_principal', 'administrador_secundario')
        `, [req.user.id]);
        
        if (userRoles.rows.length === 0) {
            return res.status(403).json({ error: 'Solo los administradores pueden revisar conversiones' });
        }
        
        const conversionId = req.params.conversion_id;
        const { action, review_notes } = req.body; // 'approve' o 'reject'
        
        if (!action || !['approve', 'reject'].includes(action)) {
            return res.status(400).json({ error: 'Acción debe ser "approve" o "reject"' });
        }
        
        const newStatus = action === 'approve' ? 'approved' : 'rejected';
        const timestamp = action === 'approve' ? 'approved_at' : 'rejected_at';
        
        const result = await pool.query(`
            UPDATE luminarias_conversions 
            SET status = $1, reviewed_by = $2, review_notes = $3, ${timestamp} = CURRENT_TIMESTAMP
            WHERE id = $4 AND status = 'pending'
            RETURNING *
        `, [newStatus, req.user.id, review_notes, conversionId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Conversión no encontrada o ya procesada' });
        }
        
        res.json({
            message: `Conversión ${action === 'approve' ? 'aprobada' : 'rechazada'} exitosamente`,
            conversion: result.rows[0]
        });
    } catch (error) {
        console.error('Error revisando conversión:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ========== ENDPOINTS DE RETIRO MEJORADO ==========

// Endpoint mejorado para retiro directo
router.post('/withdraw', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const { 
            amount, 
            withdrawal_type = 'conversion', 
            payment_method, 
            payment_details = {},
            notes 
        } = req.body;
        
        // Validaciones
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Cantidad inválida' });
        }
        
        if (!payment_method) {
            return res.status(400).json({ error: 'Método de pago requerido' });
        }
        
        // Verificar balance suficiente
        const balanceResult = await client.query(
            'SELECT * FROM get_user_luminarias_stats($1)',
            [req.user.id]
        );
        
        const currentBalance = balanceResult.rows[0]?.current_balance || 0;
        if (currentBalance < amount) {
            return res.status(400).json({ error: 'Balance insuficiente' });
        }
        
        // Procesar retiro según tipo
        let processingFee = 0;
        let finalAmount = amount;
        
        if (withdrawal_type === 'conversion') {
            // Conversión a dinero real - requiere nivel mínimo
            const userLevel = await client.query(`
                SELECT ul.current_level_id, ld.level_name 
                FROM user_levels ul
                JOIN level_definitions ld ON ul.current_level_id = ld.id
                WHERE ul.user_id = $1 AND ul.level_type = 'creator'
            `, [req.user.id]);
            
            if (userLevel.rows.length === 0 || !['constructor', 'orador', 'visionario'].includes(userLevel.rows[0].level_name.toLowerCase())) {
                return res.status(403).json({ 
                    error: 'Retiro a dinero real requiere nivel Constructor+ en creador' 
                });
            }
            
            processingFee = Math.floor(amount * 0.05); // 5% fee
            finalAmount = amount - processingFee;
        }
        
        // Crear transacción de retiro
        const transactionId = await client.query(
            'SELECT process_luminarias_transaction($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
            [
                req.user.id,
                'spend',
                amount,
                'user',
                'withdrawal',
                withdrawal_type,
                'withdraw_funds',
                `Retiro ${withdrawal_type}: ${amount} Luminarias (${finalAmount} final, fee: ${processingFee})`,
                null,
                'withdrawal_request',
                JSON.stringify({
                    withdrawal_type,
                    payment_method,
                    payment_details,
                    processing_fee: processingFee,
                    final_amount: finalAmount,
                    notes
                })
            ]
        );
        
        // Crear registro de retiro
        const withdrawalResult = await client.query(`
            INSERT INTO luminarias_withdrawals (
                user_id, transaction_id, original_amount, processing_fee, final_amount,
                withdrawal_type, payment_method, payment_details, notes, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
            RETURNING *
        `, [
            req.user.id,
            transactionId.rows[0].process_luminarias_transaction,
            amount,
            processingFee,
            finalAmount,
            withdrawal_type,
            payment_method,
            JSON.stringify(payment_details),
            notes
        ]);
        
        await client.query('COMMIT');
        
        res.json({
            message: 'Solicitud de retiro procesada exitosamente',
            withdrawal: withdrawalResult.rows[0],
            estimated_processing_time: withdrawal_type === 'conversion' ? '5-7 días hábiles' : '2-3 días hábiles'
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en retiro:', error);
        
        if (error.message.includes('Saldo insuficiente')) {
            return res.status(400).json({ error: error.message });
        }
        
        res.status(500).json({ error: 'Error procesando retiro' });
    } finally {
        client.release();
    }
});

// Obtener mis retiros
router.get('/withdrawals', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                lw.*,
                lt.created_at as transaction_date
            FROM luminarias_withdrawals lw
            LEFT JOIN luminarias_transactions lt ON lw.transaction_id = lt.id
            WHERE lw.user_id = $1
            ORDER BY lw.created_at DESC
        `, [req.user.id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo retiros:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ========== ENDPOINTS DE CONVERSIÓN A DINERO REAL ==========

// Solicitar conversión de Luminarias a dinero real
router.post('/conversion/request', authenticateToken, async (req, res) => {
    try {
        const { luminarias_amount, payment_method, payment_details, notes } = req.body;
        
        // Validaciones básicas
        if (!luminarias_amount || luminarias_amount < 25000 || luminarias_amount > 100000) {
            return res.status(400).json({ 
                error: 'La cantidad debe estar entre 25,000 y 100,000 Luminarias' 
            });
        }
        
        if (!payment_method || !payment_details) {
            return res.status(400).json({ 
                error: 'Método de pago y detalles son requeridos' 
            });
        }
        
        // Verificar nivel de usuario (debe ser Maestro+)
        const userCheck = await pool.query(
            'SELECT creator_level FROM users WHERE id = $1',
            [req.user.id]
        );
        
        const creatorLevel = userCheck.rows[0]?.creator_level?.toLowerCase() || '';
        const isEligible = ['maestro', 'experto', 'gurú'].includes(creatorLevel);
        
        if (!isEligible) {
            return res.status(403).json({ 
                error: 'Solo usuarios nivel Maestro+ pueden solicitar conversiones' 
            });
        }
        
        // Verificar balance suficiente
        const balanceCheck = await pool.query(
            'SELECT current_balance FROM user_luminarias WHERE user_id = $1',
            [req.user.id]
        );
        
        const currentBalance = balanceCheck.rows[0]?.current_balance || 0;
        if (currentBalance < luminarias_amount) {
            return res.status(400).json({ 
                error: 'Balance insuficiente para esta conversión' 
            });
        }
        
        // Calcular valores EUR
        const minLuminarias = 25000;
        const maxLuminarias = 100000;
        const minEUR = 20;
        const maxEUR = 95;
        
        const ratio = (luminarias_amount - minLuminarias) / (maxLuminarias - minLuminarias);
        const baseEUR = minEUR + (ratio * (maxEUR - minEUR));
        const commissionAmount = baseEUR * 0.20;
        const finalAmount = baseEUR - commissionAmount;
        
        // Iniciar transacción
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Crear solicitud de conversión
            const conversionResult = await client.query(`
                INSERT INTO luminarias_conversions 
                (user_id, luminarias_amount, eur_amount, commission_amount, final_amount, 
                 payment_method, payment_details, notes, status, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', NOW())
                RETURNING id
            `, [
                req.user.id,
                luminarias_amount,
                baseEUR.toFixed(2),
                commissionAmount.toFixed(2),
                finalAmount.toFixed(2),
                payment_method,
                payment_details,
                notes || null
            ]);
            
            const conversionId = conversionResult.rows[0].id;
            
            // Crear transacción de Luminarias (reservar fondos)
            await client.query(`
                SELECT process_luminarias_transaction(
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
                )
            `, [
                req.user.id,
                'creator',
                'conversion',
                'conversion',
                `Conversión a dinero real - Solicitud #${conversionId}`,
                -luminarias_amount,
                'conversion_request',
                'luminarias_conversions',
                conversionId,
                JSON.stringify({
                    conversion_id: conversionId,
                    payment_method: payment_method,
                    eur_amount: baseEUR.toFixed(2)
                }),
                null,
                null
            ]);
            
            await client.query('COMMIT');
            
            res.json({
                success: true,
                conversion_id: conversionId,
                luminarias_amount: luminarias_amount,
                estimated_eur: `€${finalAmount.toFixed(2)}`,
                status: 'pending',
                message: 'Solicitud de conversión enviada exitosamente'
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('Error en solicitud de conversión:', error);
        res.status(500).json({ error: 'Error procesando solicitud de conversión' });
    }
});

// Obtener historial de conversiones del usuario
router.get('/conversion/history', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                id,
                luminarias_amount,
                eur_amount,
                commission_amount,
                final_amount,
                payment_method,
                payment_details,
                notes,
                status,
                admin_notes,
                created_at,
                processed_at
            FROM luminarias_conversions
            WHERE user_id = $1
            ORDER BY created_at DESC
        `, [req.user.id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo historial de conversiones:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ========== ENDPOINTS ADMINISTRATIVOS DE CONVERSIÓN ==========

// Obtener todas las solicitudes de conversión (admin)
router.get('/admin/conversions', authenticateToken, async (req, res) => {
    try {
        // Verificar permisos de administrador
        if (!req.user.role || !['admin', 'super_admin'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        
        const { status, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT 
                lc.*,
                u.nickname,
                u.email,
                u.creator_level
            FROM luminarias_conversions lc
            JOIN users u ON lc.user_id = u.id
        `;
        
        const params = [];
        let paramIndex = 1;
        
        if (status) {
            query += ` WHERE lc.status = $${paramIndex}`;
            params.push(status);
            paramIndex++;
        }
        
        query += ` ORDER BY lc.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(parseInt(limit), parseInt(offset));
        
        const result = await pool.query(query, params);
        
        // Obtener total para paginación
        let countQuery = 'SELECT COUNT(*) as total FROM luminarias_conversions';
        const countParams = [];
        
        if (status) {
            countQuery += ' WHERE status = $1';
            countParams.push(status);
        }
        
        const countResult = await pool.query(countQuery, countParams);
        
        res.json({
            conversions: result.rows,
            pagination: {
                total: parseInt(countResult.rows[0].total),
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });
    } catch (error) {
        console.error('Error obteniendo conversiones admin:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Procesar solicitud de conversión (aprobar/rechazar)
router.put('/admin/conversions/:id/process', authenticateToken, async (req, res) => {
    try {
        // Verificar permisos de administrador
        if (!req.user.role || !['admin', 'super_admin'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        
        const { id } = req.params;
        const { action, admin_notes } = req.body; // action: 'approve' o 'reject'
        
        if (!action || !['approve', 'reject'].includes(action)) {
            return res.status(400).json({ error: 'Acción inválida' });
        }
        
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Obtener datos de la conversión
            const conversionResult = await client.query(
                'SELECT * FROM luminarias_conversions WHERE id = $1 AND status = $2',
                [id, 'pending']
            );
            
            if (conversionResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Conversión no encontrada o ya procesada' });
            }
            
            const conversion = conversionResult.rows[0];
            
            if (action === 'approve') {
                // Marcar como aprobada y procesada
                await client.query(`
                    UPDATE luminarias_conversions 
                    SET status = 'processed', 
                        admin_notes = $1, 
                        processed_at = NOW(),
                        processed_by = $2
                    WHERE id = $3
                `, [admin_notes, req.user.id, id]);
                
            } else { // reject
                // Marcar como rechazada y devolver Luminarias
                await client.query(`
                    UPDATE luminarias_conversions 
                    SET status = 'rejected', 
                        admin_notes = $1, 
                        processed_at = NOW(),
                        processed_by = $2
                    WHERE id = $3
                `, [admin_notes, req.user.id, id]);
                
                // Devolver Luminarias al usuario
                await client.query(`
                    SELECT process_luminarias_transaction(
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
                    )
                `, [
                    conversion.user_id,
                    'creator',
                    'earn',
                    'conversion',
                    `Devolución por conversión rechazada #${id}`,
                    conversion.luminarias_amount,
                    'conversion_refund',
                    'luminarias_conversions',
                    id,
                    JSON.stringify({
                        original_conversion_id: id,
                        refund_reason: 'rejected'
                    }),
                    null,
                    null
                ]);
            }
            
            await client.query('COMMIT');
            
            res.json({
                success: true,
                conversion_id: id,
                action: action,
                message: `Conversión ${action === 'approve' ? 'aprobada' : 'rechazada'} exitosamente`
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('Error procesando conversión:', error);
        res.status(500).json({ error: 'Error procesando conversión' });
    }
});

// ========== ENDPOINTS ADMINISTRATIVOS ADICIONALES ==========

// Obtener estadísticas generales del sistema (admin)
router.get('/admin/stats', authenticateToken, async (req, res) => {
    try {
        // Verificar permisos de administrador
        if (!req.user.role || !['admin', 'super_admin'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        
        const statsResult = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM user_luminarias) as total_users,
                (SELECT COALESCE(SUM(current_balance), 0) FROM user_luminarias) as total_luminarias,
                (SELECT COUNT(*) FROM luminarias_transactions) as total_transactions,
                (SELECT COUNT(*) FROM luminarias_conversions WHERE status = 'pending') as pending_conversions,
                (SELECT COUNT(*) FROM luminarias_purchases WHERE created_at >= NOW() - INTERVAL '24 hours') as purchases_today,
                (SELECT COUNT(*) FROM luminarias_marketplace_bookings WHERE created_at >= NOW() - INTERVAL '7 days') as bookings_week
        `);
        
        res.json(statsResult.rows[0]);
    } catch (error) {
        console.error('Error obteniendo estadísticas admin:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener configuraciones del sistema (admin)
router.get('/admin/config', authenticateToken, async (req, res) => {
    try {
        // Verificar permisos de administrador
        if (!req.user.role || !['admin', 'super_admin'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        
        const result = await pool.query(`
            SELECT * FROM luminarias_config 
            ORDER BY target_role, category, subcategory
        `);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo configuraciones:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Actualizar configuración específica (admin)
router.put('/admin/config/:id', authenticateToken, async (req, res) => {
    try {
        // Verificar permisos de administrador
        if (!req.user.role || !['admin', 'super_admin'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        
        const { id } = req.params;
        const { min_value, max_value } = req.body;
        
        if (min_value < 0 || max_value < 0 || min_value >= max_value) {
            return res.status(400).json({ 
                error: 'Valores inválidos. El mínimo debe ser menor que el máximo y ambos positivos.' 
            });
        }
        
        const result = await pool.query(`
            UPDATE luminarias_config 
            SET min_value = $1, max_value = $2, updated_at = NOW()
            WHERE id = $3
            RETURNING *
        `, [min_value, max_value, id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Configuración no encontrada' });
        }
        
        res.json({
            success: true,
            message: 'Configuración actualizada exitosamente',
            config: result.rows[0]
        });
    } catch (error) {
        console.error('Error actualizando configuración:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Buscar usuarios (admin)
router.get('/admin/users/search', authenticateToken, async (req, res) => {
    try {
        // Verificar permisos de administrador
        if (!req.user.role || !['admin', 'super_admin'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        
        const { q, limit = 20 } = req.query;
        
        if (!q || q.length < 2) {
            return res.status(400).json({ error: 'Query de búsqueda debe tener al menos 2 caracteres' });
        }
        
        const result = await pool.query(`
            SELECT 
                u.id,
                u.nickname,
                u.email,
                u.creator_level,
                u.created_at,
                ul.current_balance,
                ul.total_earned,
                ul.total_spent,
                ul.last_activity
            FROM users u
            LEFT JOIN user_luminarias ul ON u.id = ul.user_id
            WHERE u.nickname ILIKE $1 OR u.email ILIKE $1
            ORDER BY u.created_at DESC
            LIMIT $2
        `, [`%${q}%`, parseInt(limit)]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error buscando usuarios:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Ajustar balance de usuario (admin)
router.post('/admin/users/:userId/adjust-balance', authenticateToken, async (req, res) => {
    try {
        // Verificar permisos de administrador
        if (!req.user.role || !['admin', 'super_admin'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Acceso denegado' });
        }
        
        const { userId } = req.params;
        const { amount, reason } = req.body;
        
        if (!amount || amount === 0) {
            return res.status(400).json({ error: 'Cantidad inválida' });
        }
        
        if (!reason) {
            return res.status(400).json({ error: 'Razón del ajuste es requerida' });
        }
        
        // Verificar que el usuario existe
        const userCheck = await pool.query('SELECT nickname FROM users WHERE id = $1', [userId]);
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Procesar transacción de ajuste
            await client.query(`
                SELECT process_luminarias_transaction(
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
                )
            `, [
                userId,
                'user', // Rol por defecto para ajustes
                amount > 0 ? 'earn' : 'spend',
                'admin_adjustment',
                `Ajuste administrativo: ${reason}`,
                amount,
                'admin_adjustment',
                'users',
                req.user.id,
                JSON.stringify({
                    admin_id: req.user.id,
                    adjustment_reason: reason,
                    original_amount: amount
                }),
                null,
                null
            ]);
            
            await client.query('COMMIT');
            
            res.json({
                success: true,
                message: `Balance ajustado exitosamente`,
                adjustment: {
                    user_id: userId,
                    amount: amount,
                    reason: reason,
                    admin_id: req.user.id
                }
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('Error ajustando balance:', error);
        res.status(500).json({ error: 'Error procesando ajuste de balance' });
    }
});

module.exports = router;