const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function testMinimalEndpoint() {
  const client = await pool.connect();
  
  try {
    console.log('🧪 TESTING MINIMAL ENDPOINT COMPONENTS\n');
    
    // Test cada parte del endpoint actual por separado
    
    console.log('1️⃣ Testing basic role counts (current code)...');
    try {
      const roleCountsQuery = await client.query(`
        SELECT 
          r.name as role_name,
          COUNT(DISTINCT ur.user_id) as unique_count
        FROM roles r
        LEFT JOIN user_roles ur ON r.id = ur.role_id
        GROUP BY r.name
        ORDER BY r.name
      `);
      
      let admins = 0, profesores_count = 0, creadores_count = 0, jugadores_count = 0, usuarios_count = 0;
      
      roleCountsQuery.rows.forEach(row => {
        switch (row.role_name) {
          case 'administrador_principal':
          case 'administrador_secundario':
            admins += parseInt(row.unique_count);
            break;
          case 'profesor':
            profesores_count += parseInt(row.unique_count);
            break;
          case 'creador':
            creadores_count += parseInt(row.unique_count);
            break;
          case 'jugador':
            jugadores_count += parseInt(row.unique_count);
            break;
          case 'usuario':
            usuarios_count += parseInt(row.unique_count);
            break;
        }
      });
      
      console.log('✅ Role counts successful:', {admins, profesores_count, creadores_count, jugadores_count, usuarios_count});
    } catch (error) {
      console.log('❌ Role counts failed:', error.message);
      return;
    }
    
    console.log('\n2️⃣ Testing admin users query...');
    try {
      const adminUsers = await client.query(`
        SELECT DISTINCT 
          u.id, 
          u.nickname, 
          COALESCE(u.email, 'Sin email') as email,
          r.name as role_name
        FROM users u
        INNER JOIN user_roles ur ON u.id = ur.user_id
        INNER JOIN roles r ON ur.role_id = r.id
        WHERE r.name IN ('administrador_principal', 'administrador_secundario')
        ORDER BY u.id
      `);
      console.log('✅ Admin users successful:', adminUsers.rows.length, 'admins');
    } catch (error) {
      console.log('❌ Admin users failed:', error.message);
      return;
    }
    
    console.log('\n3️⃣ Testing users with roles query...');
    try {
      const usersWithRolesQuery = await client.query(`
        SELECT DISTINCT u.id, u.nickname, COALESCE(u.email, 'Sin email') as email
        FROM users u
        INNER JOIN user_roles ur ON u.id = ur.user_id
        INNER JOIN roles r ON ur.role_id = r.id
        WHERE r.name IN ('profesor', 'creador', 'administrador_principal', 'administrador_secundario', 'jugador') 
        OR r.id = 5
        ORDER BY u.id
      `);
      console.log('✅ Users with roles successful:', usersWithRolesQuery.rows.length, 'users');
    } catch (error) {
      console.log('❌ Users with roles failed:', error.message);
      return;
    }
    
    console.log('\n4️⃣ Testing all users query...');
    try {
      const allUsers = await client.query('SELECT id, nickname, COALESCE(email, \'Sin email\') as email FROM users ORDER BY id');
      console.log('✅ All users successful:', allUsers.rows.length, 'users');
    } catch (error) {
      console.log('❌ All users failed:', error.message);
      return;
    }
    
    console.log('\n✅ ALL QUERIES SUCCESSFUL - Error must be elsewhere');
    
  } catch (error) {
    console.error('❌ Error in testing:', error);
  } finally {
    client.release();
  }
}

async function main() {
  try {
    await testMinimalEndpoint();
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

main();