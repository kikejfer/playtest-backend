const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('❌ DATABASE_URL no está definida en las variables de entorno');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes('sslmode=no-verify') ? {
    // Aiven con sslmode=no-verify
    rejectUnauthorized: false,
  } : {
    // Configuración SSL con certificado CA (Aiven) - configuración completa
    ca: fs.readFileSync(path.join(__dirname, 'ca.pem')),
    rejectUnauthorized: true,
    servername: 'lumiquiz-db-enferlo-lumiquiz.d.aivencloud.com',
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
