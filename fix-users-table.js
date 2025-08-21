const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function fixUsersTable() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Arreglando tabla users para registro...');
    
    // Verificar estructura actual
    const currentColumns = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'users' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);
    
    console.log('📊 Columnas actuales en users:');
    currentColumns.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });
    
    // Añadir columnas que faltan
    const columnsToAdd = [
      'first_name VARCHAR(100)',
      'last_name VARCHAR(100)'
    ];
    
    for (const column of columnsToAdd) {
      const columnName = column.split(' ')[0];
      const exists = currentColumns.rows.some(row => row.column_name === columnName);
      
      if (!exists) {
        console.log(`➕ Añadiendo columna: ${columnName}`);
        await client.query(`ALTER TABLE users ADD COLUMN ${column}`);
      } else {
        console.log(`✅ Columna ya existe: ${columnName}`);
      }
    }
    
    // Migrar datos si existen columnas antiguas
    const oldColumns = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'users' AND table_schema = 'public' 
      AND column_name IN ('nombre', 'apellido')
    `);
    
    if (oldColumns.rows.length > 0) {
      console.log('🔄 Migrando datos de nombre/apellido a first_name/last_name...');
      
      if (oldColumns.rows.some(row => row.column_name === 'nombre')) {
        await client.query(`
          UPDATE users SET first_name = nombre 
          WHERE nombre IS NOT NULL AND first_name IS NULL
        `);
      }
      
      if (oldColumns.rows.some(row => row.column_name === 'apellido')) {
        await client.query(`
          UPDATE users SET last_name = apellido 
          WHERE apellido IS NOT NULL AND last_name IS NULL
        `);
      }
      
      // Eliminar columnas antiguas
      console.log('🗑️ Eliminando columnas antiguas...');
      if (oldColumns.rows.some(row => row.column_name === 'nombre')) {
        await client.query('ALTER TABLE users DROP COLUMN nombre');
      }
      if (oldColumns.rows.some(row => row.column_name === 'apellido')) {
        await client.query('ALTER TABLE users DROP COLUMN apellido');
      }
    }
    
    // Verificar estructura final
    const finalColumns = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'users' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);
    
    console.log('✅ Estructura final de users:');
    finalColumns.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });
    
    // Test de registro simulado
    console.log('🧪 Probando estructura para registro...');
    const testQuery = `
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'users' AND table_schema = 'public' 
      AND column_name IN ('nickname', 'password_hash', 'email', 'first_name', 'last_name')
    `;
    const requiredCols = await client.query(testQuery);
    
    const expectedCols = ['nickname', 'password_hash', 'email', 'first_name', 'last_name'];
    const existingCols = requiredCols.rows.map(row => row.column_name);
    
    console.log('🔍 Verificación de columnas requeridas:');
    expectedCols.forEach(col => {
      if (existingCols.includes(col)) {
        console.log(`  ✅ ${col}: OK`);
      } else {
        console.log(`  ❌ ${col}: FALTA`);
      }
    });
    
    console.log('🎉 Arreglo de tabla users completado');
    
  } catch (error) {
    console.error('❌ Error arreglando tabla users:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  try {
    await fixUsersTable();
  } catch (error) {
    console.error('❌ Falló el arreglo:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();