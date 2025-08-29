const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../database/connection');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { nickname, password, email, firstName, lastName } = req.body;

    if (!nickname || !password) {
      return res.status(400).json({ error: 'Nickname and password are required' });
    }

    // Verificación especial para AdminPrincipal
    if (nickname === 'AdminPrincipal' && password !== 'kikejfer') {
      return res.status(400).json({ error: 'AdminPrincipal debe usar la contraseña por defecto inicial' });
    }

    // Check if user already exists (nickname or email)
    const existingUser = await pool.query(
      'SELECT id, nickname, email FROM users WHERE nickname = $1 OR email = $2',
      [nickname, email]
    );

    if (existingUser.rows.length > 0) {
      const existing = existingUser.rows[0];
      if (existing.nickname === nickname) {
        return res.status(400).json({ error: 'El nickname ya está en uso' });
      }
      if (existing.email === email) {
        return res.status(400).json({ error: 'El email ya está registrado' });
      }
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user
    const result = await pool.query(
      'INSERT INTO users (nickname, password_hash, email, first_name, last_name) VALUES ($1, $2, $3, $4, $5) RETURNING id, nickname, email, first_name, last_name, created_at',
      [nickname, passwordHash, email, firstName, lastName]
    );

    const user = result.rows[0];

    // Create user profile
    await pool.query(
      'INSERT INTO user_profiles (user_id) VALUES ($1)',
      [user.id]
    );

    // Get user roles before generating token
    const userRolesQuery = await pool.query(`
      SELECT r.name as role_name
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = $1
    `, [user.id]);
    
    let userRoles = userRolesQuery.rows.map(row => row.role_name);
    
    // Handle role name normalization for compatibility
    userRoles = userRoles.map(role => {
      // Normalize role names to match expected format
      if (role === 'admin_secundario' || role === 'administrador_secundario') {
        return 'administrador_secundario';
      }
      if (role === 'admin_principal' || role === 'administrador_principal') {
        return 'administrador_principal';
      }
      if (role === 'creador_contenido' || role === 'profesor_creador') {
        return 'creador';
      }
      return role;
    });
    
    // DEBUG: Log roles for troubleshooting
    console.log(`🔍 DEBUG JWT - Usuario ${user.nickname} (ID: ${user.id}) tiene roles:`, userRoles);
    
    // Generate JWT token with roles
    const token = jwt.sign(
      { 
        userId: user.id, 
        nickname: user.nickname,
        roles: userRoles
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Verificar si necesita cambiar contraseña (AdminPrincipal)
    let mustChangePassword = false;
    if (nickname === 'AdminPrincipal') {
      const profile = await pool.query(
        'SELECT preferences FROM user_profiles WHERE user_id = $1',
        [user.id]
      );
      if (profile.rows.length > 0) {
        const preferences = profile.rows[0].preferences || {};
        mustChangePassword = preferences.must_change_password === true;
      }
    }

    res.status(201).json({
      message: 'User created successfully',
      token,
      user: {
        id: user.id,
        nickname: user.nickname,
        createdAt: user.created_at,
        mustChangePassword
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { nickname, password } = req.body;

    if (!nickname || !password) {
      return res.status(400).json({ error: 'Nickname and password are required' });
    }

    // Find user
    const result = await pool.query(
      'SELECT id, nickname, password_hash FROM users WHERE nickname = $1',
      [nickname]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get user roles before generating token
    const userRolesQuery = await pool.query(`
      SELECT r.name as role_name
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = $1
    `, [user.id]);
    
    let userRoles = userRolesQuery.rows.map(row => row.role_name);
    
    // Handle role name normalization for compatibility
    userRoles = userRoles.map(role => {
      // Normalize role names to match expected format
      if (role === 'admin_secundario' || role === 'administrador_secundario') {
        return 'administrador_secundario';
      }
      if (role === 'admin_principal' || role === 'administrador_principal') {
        return 'administrador_principal';
      }
      if (role === 'creador_contenido' || role === 'profesor_creador') {
        return 'creador';
      }
      return role;
    });
    
    // DEBUG: Log roles for troubleshooting
    console.log(`🔍 DEBUG JWT - Usuario ${user.nickname} (ID: ${user.id}) tiene roles:`, userRoles);
    
    // Generate JWT token with roles
    const token = jwt.sign(
      { 
        userId: user.id, 
        nickname: user.nickname,
        roles: userRoles
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        nickname: user.nickname
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify token
router.get('/verify', authenticateToken, (req, res) => {
  res.json({
    valid: true,
    user: req.user
  });
});

// Logout (optional - mainly for clearing client-side token)
router.post('/logout', authenticateToken, (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

// Cambiar contraseña obligatoria (AdminPrincipal)
router.post('/change-required-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Contraseña actual y nueva son requeridas' });
    }

    // Solo para AdminPrincipal
    if (req.user.nickname !== 'AdminPrincipal') {
      return res.status(403).json({ error: 'Esta función es solo para AdminPrincipal' });
    }

    // Verificar contraseña actual
    const user = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user.id]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const validPassword = await bcrypt.compare(currentPassword, user.rows[0].password_hash);
    if (!validPassword) {
      return res.status(400).json({ error: 'Contraseña actual incorrecta' });
    }

    // Hash nueva contraseña
    const saltRounds = 10;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Actualizar contraseña
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [newPasswordHash, req.user.id]
    );

    // Remover flag de cambio obligatorio
    await pool.query(`
      UPDATE user_profiles 
      SET preferences = COALESCE(preferences, '{}'::jsonb) - 'must_change_password'
      WHERE user_id = $1
    `, [req.user.id]);

    res.json({ message: 'Contraseña actualizada exitosamente' });

  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});


module.exports = router;