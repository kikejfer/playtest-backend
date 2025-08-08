const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../database/connection');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { nickname, password, email } = req.body;

    if (!nickname || !password) {
      return res.status(400).json({ error: 'Nickname and password are required' });
    }

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE nickname = $1',
      [nickname]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user
    const result = await pool.query(
      'INSERT INTO users (nickname, password_hash, email) VALUES ($1, $2, $3) RETURNING id, nickname, created_at',
      [nickname, passwordHash, email]
    );

    const user = result.rows[0];

    // Create user profile
    await pool.query(
      'INSERT INTO user_profiles (user_id) VALUES ($1)',
      [user.id]
    );

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, nickname: user.nickname },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'User created successfully',
      token,
      user: {
        id: user.id,
        nickname: user.nickname,
        createdAt: user.created_at
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

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, nickname: user.nickname },
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

module.exports = router;