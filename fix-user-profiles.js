const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function fixUserProfiles() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Verificando tabla user_profiles...');
    
    // Crear tabla user_profiles si no existe
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        answer_history JSONB DEFAULT '[]',
        stats JSONB DEFAULT '{}',
        preferences JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        loaded_blocks JSONB DEFAULT '[]'
      )
    `);
    
    console.log('✅ Tabla user_profiles verificada/creada');
    
    // Verificar estructura
    const columns = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'user_profiles' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);
    
    console.log('📊 Columnas en user_profiles:');
    columns.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });
    
  } catch (error) {
    console.error('❌ Error con user_profiles:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  try {
    await fixUserProfiles();
  } catch (error) {
    console.error('❌ Falló:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();