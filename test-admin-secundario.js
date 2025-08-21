const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function testAdminSecundarioEndpoint() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 TESTING ADMIN-SECUNDARIO-PANEL ENDPOINT LOGIC\n');
    
    // 1. Verificar que existe la tabla admin_assignments
    console.log('1️⃣ Checking admin_assignments table...');
    try {
      const adminAssignmentsExists = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'admin_assignments'
        )
      `);
      
      if (adminAssignmentsExists.rows[0].exists) {
        const count = await client.query(`SELECT COUNT(*) as count FROM admin_assignments`);
        console.log(`✅ admin_assignments: exists, ${count.rows[0].count} records`);
        
        // Mostrar algunos datos de ejemplo
        const sample = await client.query(`SELECT * FROM admin_assignments LIMIT 5`);
        console.log('📋 Sample admin_assignments data:', sample.rows);
      } else {
        console.log('❌ admin_assignments table does not exist');
      }
    } catch (error) {
      console.log('❌ admin_assignments table error:', error.message);
    }
    
    // 2. Probar las consultas específicas del endpoint
    console.log('\n2️⃣ Testing admin secundario queries...');
    const testAdminId = 1; // Usar ID de prueba
    
    try {
      const profesoresQuery = await client.query(`
        SELECT COUNT(DISTINCT u.id) as count
        FROM users u
        JOIN user_roles ur ON u.id = ur.user_id
        JOIN roles r ON ur.role_id = r.id
        LEFT JOIN admin_assignments aa ON u.id = aa.assigned_user_id
        WHERE r.name = 'profesor' AND (aa.admin_id = $1 OR aa.admin_id IS NULL)
      `, [testAdminId]);
      
      console.log(`✅ Profesores query successful: ${profesoresQuery.rows[0].count} profesores`);
    } catch (error) {
      console.log('❌ Profesores query failed:', error.message);
    }
    
    try {
      const creadoresQuery = await client.query(`
        SELECT COUNT(DISTINCT u.id) as count
        FROM users u
        JOIN user_roles ur ON u.id = ur.user_id
        JOIN roles r ON ur.role_id = r.id
        LEFT JOIN admin_assignments aa ON u.id = aa.assigned_user_id
        WHERE r.name = 'creador' AND (aa.admin_id = $1 OR aa.admin_id IS NULL)
      `, [testAdminId]);
      
      console.log(`✅ Creadores query successful: ${creadoresQuery.rows[0].count} creadores`);
    } catch (error) {
      console.log('❌ Creadores query failed:', error.message);
    }
    
    try {
      const jugadoresQuery = await client.query(`
        SELECT COUNT(DISTINCT u.id) as count
        FROM users u
        JOIN user_roles ur ON u.id = ur.user_id
        JOIN roles r ON ur.role_id = r.id
        LEFT JOIN admin_assignments aa ON u.id = aa.assigned_user_id
        WHERE r.name = 'jugador' AND (aa.admin_id = $1 OR aa.admin_id IS NULL)
      `, [testAdminId]);
      
      console.log(`✅ Jugadores query successful: ${jugadoresQuery.rows[0].count} jugadores`);
    } catch (error) {
      console.log('❌ Jugadores query failed:', error.message);
    }
    
    try {
      const bloquesQuery = await client.query(`
        SELECT COUNT(DISTINCT b.id) as count
        FROM blocks b
        JOIN user_roles ur ON b.user_role_id = ur.id
        JOIN users u ON ur.user_id = u.id
        LEFT JOIN admin_assignments aa ON u.id = aa.assigned_user_id
        WHERE aa.admin_id = $1 OR aa.admin_id IS NULL
      `, [testAdminId]);
      
      console.log(`✅ Bloques query successful: ${bloquesQuery.rows[0].count} bloques`);
    } catch (error) {
      console.log('❌ Bloques query failed:', error.message);
    }
    
    console.log('\n✅ TESTING COMPLETED');
    
  } catch (error) {
    console.error('❌ Error in testing:', error);
  } finally {
    client.release();
  }
}

async function main() {
  try {
    await testAdminSecundarioEndpoint();
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

main();