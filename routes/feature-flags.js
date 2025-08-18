const express = require('express');
const pool = require('../database/connection');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get all feature flags
router.get('/', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT flag_name, description, is_enabled, config, 
                   created_at, updated_at
            FROM feature_flags
            ORDER BY flag_name
        `);
        
        const flags = {};
        result.rows.forEach(row => {
            flags[row.flag_name] = {
                enabled: row.is_enabled,
                description: row.description,
                config: row.config,
                created_at: row.created_at,
                updated_at: row.updated_at
            };
        });
        
        res.json(flags);
    } catch (error) {
        console.error('Error fetching feature flags:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get specific feature flag
router.get('/:flagName', authenticateToken, async (req, res) => {
    try {
        const { flagName } = req.params;
        
        const result = await pool.query(`
            SELECT flag_name, description, is_enabled, config, 
                   created_at, updated_at
            FROM feature_flags
            WHERE flag_name = $1
        `, [flagName]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                error: 'Feature flag not found',
                enabled: false 
            });
        }
        
        const flag = result.rows[0];
        res.json({
            name: flag.flag_name,
            enabled: flag.is_enabled,
            description: flag.description,
            config: flag.config,
            created_at: flag.created_at,
            updated_at: flag.updated_at
        });
        
    } catch (error) {
        console.error('Error fetching feature flag:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update feature flag
router.put('/:flagName', authenticateToken, async (req, res) => {
    try {
        const { flagName } = req.params;
        const { enabled, description, config } = req.body;
        
        // Check if user has admin role
        const userRoles = await pool.query(`
            SELECT ur.role_name 
            FROM unified_roles ur 
            JOIN user_roles uroles ON ur.id = uroles.role_id 
            WHERE uroles.user_id = $1
        `, [req.user.id]);
        
        const hasAdminRole = userRoles.rows.some(role => 
            ['administrador_principal', 'administrador_secundario'].includes(role.role_name)
        );
        
        if (!hasAdminRole) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        
        const result = await pool.query(`
            UPDATE feature_flags 
            SET is_enabled = $1, 
                description = COALESCE($2, description),
                config = COALESCE($3, config),
                updated_at = CURRENT_TIMESTAMP
            WHERE flag_name = $4
            RETURNING *
        `, [enabled, description, config, flagName]);
        
        if (result.rows.length === 0) {
            // Create new flag if it doesn't exist
            const insertResult = await pool.query(`
                INSERT INTO feature_flags (flag_name, is_enabled, description, config)
                VALUES ($1, $2, $3, $4)
                RETURNING *
            `, [flagName, enabled, description, config || {}]);
            
            return res.json({
                success: true,
                flag: insertResult.rows[0],
                created: true
            });
        }
        
        res.json({
            success: true,
            flag: result.rows[0],
            updated: true
        });
        
    } catch (error) {
        console.error('Error updating feature flag:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create new feature flag
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { flag_name, enabled = false, description, config = {} } = req.body;
        
        if (!flag_name) {
            return res.status(400).json({ error: 'flag_name is required' });
        }
        
        // Check if user has admin role
        const userRoles = await pool.query(`
            SELECT ur.role_name 
            FROM unified_roles ur 
            JOIN user_roles uroles ON ur.id = uroles.role_id 
            WHERE uroles.user_id = $1
        `, [req.user.id]);
        
        const hasAdminRole = userRoles.rows.some(role => 
            ['administrador_principal', 'administrador_secundario'].includes(role.role_name)
        );
        
        if (!hasAdminRole) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        
        const result = await pool.query(`
            INSERT INTO feature_flags (flag_name, is_enabled, description, config)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [flag_name, enabled, description, config]);
        
        res.status(201).json({
            success: true,
            flag: result.rows[0]
        });
        
    } catch (error) {
        if (error.code === '23505') { // Unique constraint violation
            return res.status(409).json({ error: 'Feature flag already exists' });
        }
        console.error('Error creating feature flag:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete feature flag
router.delete('/:flagName', authenticateToken, async (req, res) => {
    try {
        const { flagName } = req.params;
        
        // Check if user has admin role
        const userRoles = await pool.query(`
            SELECT ur.role_name 
            FROM unified_roles ur 
            JOIN user_roles uroles ON ur.id = uroles.role_id 
            WHERE uroles.user_id = $1
        `, [req.user.id]);
        
        const hasAdminRole = userRoles.rows.some(role => 
            role.role_name === 'administrador_principal'
        );
        
        if (!hasAdminRole) {
            return res.status(403).json({ error: 'Only principal administrators can delete feature flags' });
        }
        
        const result = await pool.query(`
            DELETE FROM feature_flags 
            WHERE flag_name = $1
            RETURNING *
        `, [flagName]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Feature flag not found' });
        }
        
        res.json({
            success: true,
            deleted: result.rows[0]
        });
        
    } catch (error) {
        console.error('Error deleting feature flag:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;