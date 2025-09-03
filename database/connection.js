//const { Pool } = require('pg');
//require('dotenv').config();

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

//const pool = new Pool({
//  connectionString: process.env.DATABASE_URL,
//  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
//});

const databaseUrl = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: {
    // La clave es el ".." que te permite ir al directorio padre
    ca: fs.readFileSync(path.join(__dirname, '..', 'ca.pem')),
    rejectUnauthorized: true, 
  },
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
