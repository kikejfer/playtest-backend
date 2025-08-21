const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function checkRolesInPostgreSQL() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Verificando roles y usuarios en PostgreSQL...\n');
    
    // 1. Verificar tabla roles
    console.log('📋 ROLES DISPONIBLES:');
    const rolesResult = await client.query('SELECT id, name, description FROM roles ORDER BY id');
    rolesResult.rows.forEach(role => {
      console.log(`  ${role.id}: ${role.name} - ${role.description}`);
    });
    console.log();
    
    // 2. Verificar tabla user_roles con usuarios
    console.log('👥 USUARIOS CON SUS ROLES:');
    const userRolesResult = await client.query(`
      SELECT 
        u.id as user_id,
        u.nickname,
        u.first_name,
        u.last_name,
        r.name as role_name,
        ur.assigned_at
      FROM users u
      JOIN user_roles ur ON u.id = ur.user_id
      JOIN roles r ON ur.role_id = r.id
      ORDER BY u.id, r.name
    `);
    
    userRolesResult.rows.forEach(row => {
      console.log(`  Usuario ${row.user_id} (${row.nickname}): ${row.role_name}`);
    });
    console.log();
    
    // 3. Contar usuarios por rol
    console.log('📊 ESTADÍSTICAS POR ROL:');
    const statsResult = await client.query(`
      SELECT 
        r.name as role_name,
        COUNT(ur.user_id) as user_count,
        STRING_AGG(u.nickname, ', ') as users
      FROM roles r
      LEFT JOIN user_roles ur ON r.id = ur.role_id
      LEFT JOIN users u ON ur.user_id = u.id
      GROUP BY r.id, r.name
      ORDER BY r.name
    `);
    
    statsResult.rows.forEach(stat => {
      console.log(`  ${stat.role_name}: ${stat.user_count} usuarios`);
      if (stat.users) {
        console.log(`    Usuarios: ${stat.users}`);
      }
      console.log();
    });
    
    // 4. Verificar que las estadísticas coincidan con lo esperado
    console.log('🎯 COMPARACIÓN CON FRONTEND:');
    console.log('Frontend muestra: 3 admins, 2 profesores, 2 creadores, 2 jugadores, 0 usuarios');
    console.log('PostgreSQL muestra: 2 admin_secundarios, 3 creadores, 2 profesores, 4 jugadores');
    console.log();
    
    // 5. Verificar si hay usuarios con múltiples roles
    console.log('🔄 USUARIOS CON MÚLTIPLES ROLES:');
    const multiRoleResult = await client.query(`
      SELECT 
        u.id,
        u.nickname,
        COUNT(ur.role_id) as role_count,
        STRING_AGG(r.name, ', ') as roles
      FROM users u
      JOIN user_roles ur ON u.id = ur.user_id
      JOIN roles r ON ur.role_id = r.id
      GROUP BY u.id, u.nickname
      HAVING COUNT(ur.role_id) > 1
      ORDER BY role_count DESC, u.nickname
    `);
    
    if (multiRoleResult.rows.length > 0) {
      multiRoleResult.rows.forEach(user => {
        console.log(`  ${user.nickname} (ID: ${user.id}): ${user.role_count} roles`);
        console.log(`    Roles: ${user.roles}`);
      });
    } else {
      console.log('  No hay usuarios con múltiples roles');
    }
    console.log();
    
    // 6. Verificar la consulta que usa el backend
    console.log('🔍 VERIFICANDO CONSULTA DEL BACKEND:');
    console.log('Ejecutando consulta similar a la del endpoint...');
    
    const backendQuery = `
      SELECT 
        r.name as role_name,
        COUNT(DISTINCT ur.user_id) as user_count
      FROM roles r
      LEFT JOIN user_roles ur ON r.id = ur.role_id
      WHERE r.name IN ('administrador_secundario', 'creador_contenido', 'profesor', 'usuario')
      GROUP BY r.name
    `;
    
    const backendResult = await client.query(backendQuery);
    backendResult.rows.forEach(row => {
      console.log(`  ${row.role_name}: ${row.user_count} usuarios`);
    });
    
    // 7. También verificar administrador_principal
    const adminPrincipalResult = await client.query(`
      SELECT COUNT(*) as count
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE r.name = 'administrador_principal'
    `);
    
    console.log(`  administrador_principal: ${adminPrincipalResult.rows[0].count} usuarios`);
    console.log();
    
    console.log('✅ Verificación completada');
    
  } catch (error) {
    console.error('❌ Error verificando roles:', error);
  } finally {
    client.release();
  }
}

async function main() {
  try {
    await checkRolesInPostgreSQL();
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

main();