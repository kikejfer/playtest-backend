const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function verifyRolesDirect() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Verificación directa de roles...\n');
    
    // 1. Verificar tabla roles
    console.log('📋 TABLA ROLES:');
    try {
      const rolesResult = await client.query('SELECT id, name, description, created_at FROM roles ORDER BY id');
      if (rolesResult.rows.length === 0) {
        console.log('❌ La tabla roles existe pero está vacía');
      } else {
        rolesResult.rows.forEach(role => {
          console.log(`  ${role.id}: ${role.name} - ${role.description || 'Sin descripción'}`);
        });
      }
    } catch (error) {
      console.log('❌ Error accediendo a tabla roles:', error.message);
    }
    console.log();
    
    // 2. Verificar tabla user_roles  
    console.log('👥 TABLA USER_ROLES:');
    try {
      const userRolesResult = await client.query(`
        SELECT ur.id, ur.user_id, ur.role_id, ur.assigned_at,
               u.nickname, r.name as role_name
        FROM user_roles ur
        LEFT JOIN users u ON ur.user_id = u.id
        LEFT JOIN roles r ON ur.role_id = r.id
        ORDER BY ur.user_id, ur.role_id
      `);
      
      if (userRolesResult.rows.length === 0) {
        console.log('❌ La tabla user_roles existe pero está vacía');
      } else {
        userRolesResult.rows.forEach(userRole => {
          console.log(`  ${userRole.id}: Usuario ${userRole.user_id} (${userRole.nickname || 'SIN_NICK'}) → Rol ${userRole.role_id} (${userRole.role_name || 'SIN_ROL'})`);
        });
      }
    } catch (error) {
      console.log('❌ Error accediendo a tabla user_roles:', error.message);
    }
    console.log();
    
    // 3. Ejecutar la consulta exacta que usa el backend
    console.log('🎯 CONSULTA DEL BACKEND (simulación):');
    try {
      const backendQuery = `
        SELECT 
          r.name as role_name,
          COUNT(DISTINCT ur.user_id) as count
        FROM roles r
        LEFT JOIN user_roles ur ON r.id = ur.role_id
        GROUP BY r.name
        ORDER BY r.name
      `;
      
      const backendResult = await client.query(backendQuery);
      console.log('Resultados de la consulta del backend:');
      
      let totalAdmins = 0;
      let totalProfesores = 0;
      let totalCreadores = 0;
      let totalJugadores = 0;
      let totalUsuarios = 0;
      
      backendResult.rows.forEach(row => {
        console.log(`  ${row.role_name}: ${row.count} usuarios`);
        
        // Sumar según el tipo de rol
        if (row.role_name.includes('administrador')) {
          totalAdmins += parseInt(row.count);
        } else if (row.role_name === 'profesor') {
          totalProfesores += parseInt(row.count);
        } else if (row.role_name === 'creador_contenido') {
          totalCreadores += parseInt(row.count);
        } else if (row.role_name === 'usuario') {
          totalUsuarios += parseInt(row.count);
        }
        // Los "jugadores" pueden ser usuarios con rol "usuario" o un rol específico
      });
      
      console.log('\n📊 TOTALES CALCULADOS:');
      console.log(`  Admins: ${totalAdmins}`);
      console.log(`  Profesores: ${totalProfesores}`);
      console.log(`  Creadores: ${totalCreadores}`);  
      console.log(`  Usuarios: ${totalUsuarios}`);
      console.log(`  Jugadores: (depende de la lógica específica)`);
      
    } catch (error) {
      console.log('❌ Error en consulta del backend:', error.message);
    }
    console.log();
    
    // 4. Verificar usuarios con múltiples roles
    console.log('🔄 USUARIOS CON MÚLTIPLES ROLES:');
    try {
      const multiRoleQuery = `
        SELECT 
          u.id,
          u.nickname,
          COUNT(ur.role_id) as role_count,
          STRING_AGG(r.name, ', ') as roles
        FROM users u
        LEFT JOIN user_roles ur ON u.id = ur.user_id
        LEFT JOIN roles r ON ur.role_id = r.id
        GROUP BY u.id, u.nickname
        HAVING COUNT(ur.role_id) > 1
        ORDER BY role_count DESC, u.nickname
      `;
      
      const multiRoleResult = await client.query(multiRoleQuery);
      
      if (multiRoleResult.rows.length === 0) {
        console.log('  No hay usuarios con múltiples roles');
      } else {
        multiRoleResult.rows.forEach(user => {
          console.log(`  ${user.nickname} (ID: ${user.id}): ${user.role_count} roles`);
          console.log(`    Roles: ${user.roles}`);
        });
      }
    } catch (error) {
      console.log('❌ Error verificando múltiples roles:', error.message);
    }
    console.log();
    
    // 5. Mostrar todos los usuarios y sus roles (o falta de roles)
    console.log('👤 TODOS LOS USUARIOS Y SUS ROLES:');
    try {
      const allUsersQuery = `
        SELECT 
          u.id,
          u.nickname,
          u.first_name,
          u.last_name,
          COALESCE(STRING_AGG(r.name, ', '), 'SIN ROLES') as roles
        FROM users u
        LEFT JOIN user_roles ur ON u.id = ur.user_id
        LEFT JOIN roles r ON ur.role_id = r.id
        GROUP BY u.id, u.nickname, u.first_name, u.last_name
        ORDER BY u.id
      `;
      
      const allUsersResult = await client.query(allUsersQuery);
      allUsersResult.rows.forEach(user => {
        console.log(`  ${user.id}: ${user.nickname} (${user.first_name || 'N/A'} ${user.last_name || 'N/A'}) → ${user.roles}`);
      });
    } catch (error) {
      console.log('❌ Error listando usuarios:', error.message);
    }
    
    console.log('\n✅ Verificación directa completada');
    
  } catch (error) {
    console.error('❌ Error en verificación:', error);
  } finally {
    client.release();
  }
}

async function main() {
  try {
    await verifyRolesDirect();
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

main();