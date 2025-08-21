const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkJugadores() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 CHECKING JUGADORES DATA\n');
    
    // 1. Ver todos los roles disponibles
    console.log('1️⃣ Available roles:');
    const roles = await client.query('SELECT id, name FROM roles ORDER BY id');
    roles.rows.forEach(role => {
      console.log(`  - ${role.id}: ${role.name}`);
    });
    
    // 2. Contar usuarios por rol
    console.log('\n2️⃣ User count by role:');
    const userCounts = await client.query(`
      SELECT r.name, COUNT(ur.user_id) as count
      FROM roles r 
      LEFT JOIN user_roles ur ON r.id = ur.role_id 
      GROUP BY r.name 
      ORDER BY r.name
    `);
    userCounts.rows.forEach(row => {
      console.log(`  - ${row.name}: ${row.count} users`);
    });
    
    // 3. Ver usuarios específicos con rol 'jugador'
    console.log('\n3️⃣ Users with jugador role:');
    const jugadores = await client.query(`
      SELECT u.id, u.nickname, u.email
      FROM users u
      JOIN user_roles ur ON u.id = ur.user_id
      JOIN roles r ON ur.role_id = r.id
      WHERE r.name = 'jugador'
      ORDER BY u.id
    `);
    
    if (jugadores.rows.length > 0) {
      jugadores.rows.forEach(user => {
        console.log(`  - ${user.id}: ${user.nickname} (${user.email})`);
      });
    } else {
      console.log('  ❌ No users found with jugador role');
    }
    
    // 4. Ver todos los usuarios y sus roles
    console.log('\n4️⃣ All users and their roles:');
    const allUsersRoles = await client.query(`
      SELECT u.id, u.nickname, r.name as role_name
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      ORDER BY u.id, r.name
    `);
    
    allUsersRoles.rows.forEach(row => {
      console.log(`  - ${row.id}: ${row.nickname} → ${row.role_name || 'NO ROLE'}`);
    });
    
    console.log('\n✅ CHECK COMPLETED');
    
  } catch (error) {
    console.error('❌ Error checking jugadores:', error);
  } finally {
    client.release();
  }
}

async function main() {
  try {
    await checkJugadores();
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

main();