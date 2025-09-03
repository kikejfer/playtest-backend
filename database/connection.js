// Importa las librerías necesarias
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const databaseUrl = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: {
    // Lee el certificado CA desde el archivo
    ca: fs.readFileSync(path.join(__dirname, '..', 'ca.pem')),
    // Asegura que la aplicación verifique el certificado del servidor
    rejectUnauthorized: true, 
  },
});

// Prueba la conexión
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Error adquiriendo cliente:', err.stack);
  } else {
    console.log('✅ Conectado a la base de datos de PostgreSQL');
    release();
  }
});

// Exporta el pool para que otros módulos lo utilicen
module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};
