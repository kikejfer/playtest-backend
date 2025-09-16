const jwt = require('jsonwebtoken');
const pool = require('../database/connection');

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  console.log('🔐 Auth check for endpoint:', req.method, req.path);
  console.log('🔐 Auth header present:', !!authHeader);
  console.log('🔐 Token present:', !!token);

  if (!token) {
    console.log('❌ No token provided');
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    console.log('🔐 Verifying JWT token...');
    console.log('🔐 JWT_SECRET present:', !!process.env.JWT_SECRET);
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('✅ Token decoded successfully, user ID:', decoded.userId);
    
    // Verify user still exists and session is valid
    const result = await pool.query(
      'SELECT u.id, u.nickname FROM users u WHERE u.id = $1',
      [decoded.userId]
    );

    console.log('🔍 User lookup result:', result.rows.length, 'users found');

    if (result.rows.length === 0) {
      console.log('❌ User not found in database');
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = {
      id: decoded.userId,
      nickname: result.rows[0].nickname,
      roles: decoded.roles || []
    };
    
    console.log('✅ Authentication successful for user:', req.user.nickname);
    next();
  } catch (error) {
    console.error('❌ Auth error:', error.message);
    console.error('❌ Auth error type:', error.name);
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

module.exports = { authenticateToken };