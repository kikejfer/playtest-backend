const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

async function testMetadata() {
  try {
    console.log('🔍 Conectando a la base de datos...');
    
    // Test connection
    await pool.query('SELECT NOW()');
    console.log('✅ Conexión exitosa');
    
    // Get block types
    console.log('\n📋 BLOCK_TYPES:');
    const types = await pool.query('SELECT id, name, description FROM block_types ORDER BY id');
    console.table(types.rows);
    
    // Get block levels  
    console.log('\n📊 BLOCK_LEVELS:');
    const levels = await pool.query('SELECT id, name, description FROM block_levels ORDER BY id');
    console.table(levels.rows);
    
    // Get block states
    console.log('\n⚡ BLOCK_STATES:');
    const states = await pool.query('SELECT id, name, description FROM block_states ORDER BY id');
    console.table(states.rows);
    
    // Check if tables exist and have data
    const counts = await pool.query(`
      SELECT 
        'block_types' as table_name,
        COUNT(*) as record_count
      FROM block_types
      UNION ALL
      SELECT 
        'block_levels' as table_name,
        COUNT(*) as record_count  
      FROM block_levels
      UNION ALL
      SELECT
        'block_states' as table_name,
        COUNT(*) as record_count
      FROM block_states
    `);
    
    console.log('\n📈 RESUMEN DE TABLAS:');
    console.table(counts.rows);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    
    if (error.message.includes('relation') && error.message.includes('does not exist')) {
      console.log('\n⚠️  Parece que las tablas de metadatos no existen. ¿Necesitas crearlas?');
    }
  } finally {
    await pool.end();
  }
}

testMetadata();