const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function testPASEndpoint() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 TESTING PAS ENDPOINT SPECIFIC QUERIES\n');
    
    const currentAdminId = 10; // kikejfer
    console.log(`🎯 Testing with admin ID: ${currentAdminId}`);
    
    // Test profesores query
    console.log('\n1️⃣ Testing profesores detallados query...');
    try {
      const profesoresQuery = await client.query(`
        SELECT 
            u.id as user_id,
            u.nickname,
            u.first_name,
            u.email,
            ur.id as user_role_id,
            COUNT(DISTINCT b.id) as bloques_creados,
            COUNT(DISTINCT ulb.user_id) as estudiantes,
            COALESCE(SUM(ba.total_questions), 0) as total_preguntas,
            COALESCE(u_admin.nickname, 'Administrador Principal') as assigned_admin_nickname
        FROM users u
        JOIN user_roles ur ON u.id = ur.user_id
        JOIN roles r ON ur.role_id = r.id
        LEFT JOIN admin_assignments aa ON u.id = aa.assigned_user_id
        LEFT JOIN users u_admin ON aa.admin_id = u_admin.id
        LEFT JOIN blocks b ON ur.id = b.user_role_id
        LEFT JOIN block_answers ba ON b.id = ba.block_id
        LEFT JOIN user_loaded_blocks ulb ON b.id = ulb.block_id
        WHERE r.name = 'profesor' AND aa.admin_id = $1
        GROUP BY u.id, u.nickname, u.first_name, u.email, ur.id, u_admin.nickname
        ORDER BY u.nickname
      `, [currentAdminId]);
      
      console.log(`✅ Profesores query successful: ${profesoresQuery.rows.length} profesores`);
      profesoresQuery.rows.forEach(prof => {
        console.log(`  - ${prof.nickname} (${prof.user_id}): ${prof.bloques_creados} bloques, ${prof.estudiantes} estudiantes, ${prof.total_preguntas} preguntas, admin: ${prof.assigned_admin_nickname}`);
      });
    } catch (error) {
      console.log('❌ Profesores query failed:', error.message);
    }
    
    // Test creadores query
    console.log('\n2️⃣ Testing creadores detallados query...');
    try {
      const creadoresQuery = await client.query(`
        SELECT 
            u.id as user_id,
            u.nickname,
            u.first_name,
            u.email,
            ur.id as user_role_id,
            COUNT(DISTINCT b.id) as bloques_creados,
            COALESCE(SUM(ba.total_questions), 0) as total_preguntas,
            COUNT(DISTINCT ta.id) as total_temas,
            COUNT(DISTINCT ulb.user_id) as total_usuarios,
            COALESCE(u_admin.nickname, 'Administrador Principal') as assigned_admin_nickname
        FROM users u
        JOIN user_roles ur ON u.id = ur.user_id
        JOIN roles r ON ur.role_id = r.id
        LEFT JOIN admin_assignments aa ON u.id = aa.assigned_user_id
        LEFT JOIN users u_admin ON aa.admin_id = u_admin.id
        LEFT JOIN blocks b ON ur.id = b.user_role_id
        LEFT JOIN block_answers ba ON b.id = ba.block_id
        LEFT JOIN topic_answers ta ON b.id = ta.block_id
        LEFT JOIN user_loaded_blocks ulb ON b.id = ulb.block_id
        WHERE r.name = 'creador' AND aa.admin_id = $1
        GROUP BY u.id, u.nickname, u.first_name, u.email, ur.id, u_admin.nickname
        ORDER BY u.nickname
      `, [currentAdminId]);
      
      console.log(`✅ Creadores query successful: ${creadoresQuery.rows.length} creadores`);
      creadoresQuery.rows.forEach(creator => {
        console.log(`  - ${creator.nickname} (${creator.user_id}): ${creator.bloques_creados} bloques, ${creator.total_preguntas} preguntas, ${creator.total_temas} temas, ${creator.total_usuarios} usuarios, admin: ${creator.assigned_admin_nickname}`);
      });
    } catch (error) {
      console.log('❌ Creadores query failed:', error.message);
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
    await testPASEndpoint();
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

main();