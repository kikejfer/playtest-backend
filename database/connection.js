const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: databaseUrl,
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
