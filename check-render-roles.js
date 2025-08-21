const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkRenderRoles() {
  try {
    console.log('📋 ROLES EN RENDER:');
    const roles = await pool.query('SELECT * FROM roles ORDER BY id;');
    roles.rows.forEach(r => console.log(`  ${r.id}: ${r.name}`));
    
    console.log('\n👥 CONTEO POR ROL:');
    const counts = await pool.query(`
      SELECT r.name, COUNT(ur.user_id) as count 
      FROM roles r 
      LEFT JOIN user_roles ur ON r.id = ur.role_id 
      GROUP BY r.name 
      ORDER BY r.name;
    `);
    counts.rows.forEach(c => console.log(`  ${c.name}: ${c.count} usuarios`));
    
    console.log('\n🔄 USUARIOS CON MÚLTIPLES ROLES:');
    const multiRoles = await pool.query(`
      SELECT u.nickname, COUNT(ur.role_id) as role_count,
             array_agg(r.name) as roles
      FROM users u
      JOIN user_roles ur ON u.id = ur.user_id
      JOIN roles r ON ur.role_id = r.id
      GROUP BY u.id, u.nickname
      HAVING COUNT(ur.role_id) > 1
      ORDER BY role_count DESC;
    `);
    
    if (multiRoles.rows.length === 0) {
      console.log('  No hay usuarios con múltiples roles');
    } else {
      multiRoles.rows.forEach(u => {
        console.log(`  ${u.nickname}: ${u.role_count} roles (${u.roles.join(', ')})`);
      });
    }
    
    console.log('\n✅ Verificación completada');
    pool.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    pool.end();
  }
}

checkRenderRoles();