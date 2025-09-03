const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const databaseUrl = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: {
    // Lee el certificado CA desde el archivo
    ca: fs.readFileSync(path.join(__dirname, '..', 'ca.pem')),
    // Esta línea es crucial para que no intente verificar un certificado de la CA
    rejectUnauthorized: false, 
  },
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Error adquiriendo cliente:', err.stack);
  } else {
    console.log('✅ Conectado a la base de datos de PostgreSQL');
    release();
  }
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};
