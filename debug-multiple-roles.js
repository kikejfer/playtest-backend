const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function debugMultipleRoles() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Debugging usuarios con múltiples roles...\n');
    
    // 1. Contar roles únicos
    console.log('📋 ROLES EN LA BASE DE DATOS:');
    const rolesResult = await client.query('SELECT id, name FROM roles ORDER BY id');
    rolesResult.rows.forEach(role => {
      console.log(`  ${role.id}: ${role.name}`);
    });
    console.log(`Total roles: ${rolesResult.rows.length}\n`);
    
    // 2. Contar asignaciones de roles (puede haber duplicados por múltiples roles)
    console.log('👥 ASIGNACIONES DE ROLES:');
    const assignmentsResult = await client.query(`
      SELECT 
        ur.id,
        u.id as user_id,
        u.nickname,
        r.id as role_id,
        r.name as role_name
      FROM user_roles ur
      JOIN users u ON ur.user_id = u.id
      JOIN roles r ON ur.role_id = r.id
      ORDER BY u.id, r.id
    `);
    
    assignmentsResult.rows.forEach(assignment => {
      console.log(`  Asignación ${assignment.id}: Usuario ${assignment.user_id} (${assignment.nickname}) → Rol ${assignment.role_id} (${assignment.role_name})`);
    });
    console.log(`Total asignaciones: ${assignmentsResult.rows.length}\n`);
    
    // 3. Agrupar por usuario para ver múltiples roles
    console.log('🔄 USUARIOS CON SUS ROLES:');
    const usersWithRolesResult = await client.query(`
      SELECT 
        u.id,
        u.nickname,
        COUNT(ur.role_id) as role_count,
        STRING_AGG(r.name ORDER BY r.name, ', ') as roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      GROUP BY u.id, u.nickname
      ORDER BY u.id
    `);
    
    usersWithRolesResult.rows.forEach(user => {
      const status = user.role_count > 1 ? '🔄 MÚLTIPLES' : user.role_count === 1 ? '✅ ÚNICO' : '❌ SIN ROLES';
      console.log(`  ${status} Usuario ${user.id} (${user.nickname}): ${user.role_count} roles`);
      console.log(`       Roles: ${user.roles || 'NINGUNO'}`);
    });
    console.log();
    
    // 4. Contar por tipo de rol (simulando la lógica del backend)
    console.log('📊 CONTEO POR TIPO DE ROL:');
    const countByRoleResult = await client.query(`
      SELECT 
        r.name as role_name,
        COUNT(DISTINCT ur.user_id) as unique_users,
        COUNT(ur.user_id) as total_assignments
      FROM roles r
      LEFT JOIN user_roles ur ON r.id = ur.role_id
      GROUP BY r.name
      ORDER BY r.name
    `);
    
    countByRoleResult.rows.forEach(roleCount => {
      console.log(`  ${roleCount.role_name}:`);
      console.log(`    - Usuarios únicos: ${roleCount.unique_users}`);
      console.log(`    - Total asignaciones: ${roleCount.total_assignments}`);
    });
    console.log();
    
    // 5. Calcular totales como lo hace el frontend
    console.log('🎯 CÁLCULO TIPO FRONTEND:');
    let admins = 0, profesores = 0, creadores = 0, jugadores = 0, usuarios = 0;
    
    countByRoleResult.rows.forEach(roleCount => {
      const count = parseInt(roleCount.unique_users);
      switch (roleCount.role_name) {
        case 'administrador_principal':
        case 'administrador_secundario':
          admins += count;
          break;
        case 'profesor':
          profesores += count;
          break;
        case 'creador_contenido':
          creadores += count;
          break;
        case 'usuario':
          usuarios += count;
          break;
      }
    });
    
    // Los "jugadores" podrían ser usuarios con cualquier rol que han jugado
    // Vamos a contar todos los usuarios que tienen algún rol
    const playersResult = await client.query(`
      SELECT COUNT(DISTINCT ur.user_id) as total_players
      FROM user_roles ur
    `);
    jugadores = parseInt(playersResult.rows[0].total_players);
    
    console.log(`  Admins: ${admins} (admin_principal + admin_secundario)`);
    console.log(`  Profesores: ${profesores}`);
    console.log(`  Creadores: ${creadores}`);
    console.log(`  Usuarios: ${usuarios}`);
    console.log(`  Jugadores: ${jugadores} (todos con roles)`);
    console.log();
    
    // 6. Comparar con lo que muestra el frontend
    console.log('🆚 COMPARACIÓN:');
    console.log('PostgreSQL calculado:', { admins, profesores, creadores, jugadores, usuarios });
    console.log('Frontend mostraba: {admins: 3, profesores: 2, creadores: 2, jugadores: 2, usuarios: 0}');
    console.log('PostgreSQL real que dijiste: 2 admin_secundarios, 3 creadores, 2 profesores, 4 jugadores');
    console.log();
    
    // 7. Verificar si hay inconsistencias
    console.log('⚠️ POSIBLES PROBLEMAS:');
    if (admins !== 3) {
      console.log(`  - Admins: Frontend esperaba 3, PostgreSQL tiene ${admins}`);
    }
    if (profesores !== 2) {
      console.log(`  - Profesores: Frontend esperaba 2, PostgreSQL tiene ${profesores}`);
    }
    if (creadores !== 2) {
      console.log(`  - Creadores: Frontend esperaba 2, PostgreSQL tiene ${creadores}`);
    }
    if (jugadores !== 2) {
      console.log(`  - Jugadores: Frontend esperaba 2, PostgreSQL tiene ${jugadores}`);
    }
    
    console.log('\n✅ Debug completado');
    
  } catch (error) {
    console.error('❌ Error en debug:', error);
  } finally {
    client.release();
  }
}

async function main() {
  try {
    await debugMultipleRoles();
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

main();