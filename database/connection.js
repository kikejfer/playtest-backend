const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Error acquiring client:', err.stack);
  } else {
    console.log('✅ Connected to PostgreSQL database');
    release();
  }
});

module.exports = pool;