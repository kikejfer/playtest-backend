const express = require('express');
const pool = require('../database/connection');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get user preferences
router.get('/', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT ui_preferences, game_preferences, notification_preferences, 
                   privacy_preferences, language, timezone, theme,
                   created_at, updated_at
            FROM user_preferences
            WHERE user_id = $1
        `, [req.user.id]);
        
        if (result.rows.length === 0) {
            // Return default preferences if none exist
            return res.json({
                ui_preferences: {
                    sidebar_collapsed: false,
                    grid_view: true,
                    auto_save: true
                },
                game_preferences: {
                    sound_enabled: true,
                    animations: true,
                    difficulty_preference: 'medium'
                },
                notification_preferences: {
                    email_notifications: true,
                    push_notifications: true,
                    level_up_alerts: true
                },
                privacy_preferences: {
                    profile_public: false,
                    show_progress: true,
                    show_achievements: true
                },
                language: 'es',
                timezone: 'Europe/Madrid',
                theme: 'light'
            });
        }
        
        const prefs = result.rows[0];
        res.json({
            ui_preferences: prefs.ui_preferences,
            game_preferences: prefs.game_preferences,
            notification_preferences: prefs.notification_preferences,
            privacy_preferences: prefs.privacy_preferences,
            language: prefs.language,
            timezone: prefs.timezone,
            theme: prefs.theme,
            created_at: prefs.created_at,
            updated_at: prefs.updated_at
        });
        
    } catch (error) {
        console.error('Error fetching user preferences:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update user preferences
router.put('/', authenticateToken, async (req, res) => {
    try {
        const {
            ui_preferences,
            game_preferences,
            notification_preferences,
            privacy_preferences,
            language,
            timezone,
            theme
        } = req.body;
        
        const result = await pool.query(`
            INSERT INTO user_preferences (
                user_id, ui_preferences, game_preferences, 
                notification_preferences, privacy_preferences,
                language, timezone, theme
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (user_id) DO UPDATE SET
                ui_preferences = COALESCE($2, user_preferences.ui_preferences),
                game_preferences = COALESCE($3, user_preferences.game_preferences),
                notification_preferences = COALESCE($4, user_preferences.notification_preferences),
                privacy_preferences = COALESCE($5, user_preferences.privacy_preferences),
                language = COALESCE($6, user_preferences.language),
                timezone = COALESCE($7, user_preferences.timezone),
                theme = COALESCE($8, user_preferences.theme),
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `, [
            req.user.id, 
            ui_preferences, 
            game_preferences, 
            notification_preferences, 
            privacy_preferences,
            language,
            timezone,
            theme
        ]);
        
        res.json({
            success: true,
            preferences: result.rows[0]
        });
        
    } catch (error) {
        console.error('Error updating user preferences:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get specific preference category
router.get('/:category', authenticateToken, async (req, res) => {
    try {
        const { category } = req.params;
        const validCategories = ['ui', 'game', 'notification', 'privacy'];
        
        if (!validCategories.includes(category)) {
            return res.status(400).json({ error: 'Invalid preference category' });
        }
        
        const columnName = `${category}_preferences`;
        const result = await pool.query(`
            SELECT ${columnName} as preferences
            FROM user_preferences
            WHERE user_id = $1
        `, [req.user.id]);
        
        if (result.rows.length === 0) {
            return res.json({ preferences: {} });
        }
        
        res.json({
            preferences: result.rows[0].preferences || {}
        });
        
    } catch (error) {
        console.error('Error fetching preference category:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update specific preference category
router.put('/:category', authenticateToken, async (req, res) => {
    try {
        const { category } = req.params;
        const { preferences } = req.body;
        const validCategories = ['ui', 'game', 'notification', 'privacy'];
        
        if (!validCategories.includes(category)) {
            return res.status(400).json({ error: 'Invalid preference category' });
        }
        
        if (!preferences) {
            return res.status(400).json({ error: 'Preferences data is required' });
        }
        
        const columnName = `${category}_preferences`;
        const result = await pool.query(`
            INSERT INTO user_preferences (user_id, ${columnName})
            VALUES ($1, $2)
            ON CONFLICT (user_id) DO UPDATE SET
                ${columnName} = $2,
                updated_at = CURRENT_TIMESTAMP
            RETURNING ${columnName} as preferences
        `, [req.user.id, preferences]);
        
        res.json({
            success: true,
            preferences: result.rows[0].preferences
        });
        
    } catch (error) {
        console.error('Error updating preference category:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Reset preferences to default
router.delete('/', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            DELETE FROM user_preferences
            WHERE user_id = $1
            RETURNING user_id
        `, [req.user.id]);
        
        res.json({
            success: true,
            reset: result.rows.length > 0
        });
        
    } catch (error) {
        console.error('Error resetting user preferences:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;