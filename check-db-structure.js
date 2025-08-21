const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function checkDatabaseStructure() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Verificando estructura de base de datos PostgreSQL...\n');
    
    // 1. Listar todas las tablas
    console.log('📋 TABLAS EXISTENTES:');
    const tablesResult = await client.query(`
      SELECT table_name, table_type
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    if (tablesResult.rows.length === 0) {
      console.log('❌ No se encontraron tablas en el esquema public');
    } else {
      tablesResult.rows.forEach(table => {
        console.log(`  - ${table.table_name} (${table.table_type})`);
      });
    }
    console.log();
    
    // 2. Verificar tablas críticas específicamente
    const criticalTables = ['users', 'user_profiles', 'roles', 'user_roles', 'blocks', 'questions', 'answers'];
    
    console.log('🎯 VERIFICACIÓN DE TABLAS CRÍTICAS:');
    for (const tableName of criticalTables) {
      try {
        const exists = await client.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = $1
          );
        `, [tableName]);
        
        const status = exists.rows[0].exists ? '✅' : '❌';
        console.log(`  ${status} ${tableName}: ${exists.rows[0].exists ? 'existe' : 'NO EXISTE'}`);
        
        // Si existe, mostrar columnas
        if (exists.rows[0].exists) {
          const columnsResult = await client.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = $1 AND table_schema = 'public'
            ORDER BY ordinal_position;
          `, [tableName]);
          
          console.log(`    Columnas: ${columnsResult.rows.map(col => col.column_name).join(', ')}`);
        }
      } catch (error) {
        console.log(`  ❌ Error verificando ${tableName}:`, error.message);
      }
    }
    console.log();
    
    // 3. Si users existe, mostrar algunos datos
    try {
      const userExists = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'users'
        );
      `);
      
      if (userExists.rows[0].exists) {
        console.log('👥 USUARIOS EXISTENTES:');
        const usersResult = await client.query('SELECT id, nickname, email, first_name, last_name, created_at FROM users ORDER BY id LIMIT 10');
        
        if (usersResult.rows.length === 0) {
          console.log('  No hay usuarios registrados');
        } else {
          usersResult.rows.forEach(user => {
            console.log(`  ${user.id}: ${user.nickname} (${user.first_name} ${user.last_name}) - ${user.email}`);
          });
        }
        console.log();
      }
    } catch (error) {
      console.log('❌ Error verificando usuarios:', error.message);
    }
    
    // 4. Verificar conexión y versión de PostgreSQL
    console.log('🔗 INFORMACIÓN DE CONEXIÓN:');
    try {
      const versionResult = await client.query('SELECT version();');
      console.log(`  PostgreSQL: ${versionResult.rows[0].version.split(' ')[1]}`);
      
      const dbResult = await client.query('SELECT current_database(), current_user;');
      console.log(`  Base de datos: ${dbResult.rows[0].current_database}`);
      console.log(`  Usuario: ${dbResult.rows[0].current_user}`);
    } catch (error) {
      console.log('❌ Error obteniendo información de conexión:', error.message);
    }
    console.log();
    
    console.log('✅ Verificación de estructura completada');
    
  } catch (error) {
    console.error('❌ Error verificando estructura:', error);
  } finally {
    client.release();
  }
}

async function main() {
  try {
    await checkDatabaseStructure();
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

main();