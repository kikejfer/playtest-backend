const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function testEndpoint() {
  const client = await pool.connect();
  
  try {
    console.log('🧪 TESTING ADMIN-PRINCIPAL-PANEL ENDPOINT LOGIC\n');
    
    // Probar cada consulta por separado para encontrar el error
    
    // 1. Consulta básica de roles
    console.log('1️⃣ Testing role counts query...');
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
      console.log('✅ Role counts query successful:', roleCountsQuery.rows.length, 'roles');
    } catch (error) {
      console.log('❌ Role counts query failed:', error.message);
    }
    
    // 2. Consulta de profesores detallados
    console.log('\n2️⃣ Testing profesores detallados query...');
    try {
      const profesoresDetallados = await client.query(`
        SELECT 
          u.id as user_id,
          u.nickname,
          u.first_name,
          u.email,
          ur.id as user_role_id,
          COUNT(DISTINCT b.id) as bloques_creados,
          COALESCE(SUM(ba.total_questions), 0) as total_preguntas
        FROM users u
        JOIN user_roles ur ON u.id = ur.user_id
        JOIN roles r ON ur.role_id = r.id
        LEFT JOIN blocks b ON ur.id = b.user_role_id
        LEFT JOIN block_answers ba ON b.id = ba.block_id
        WHERE r.name = 'profesor'
        GROUP BY u.id, u.nickname, u.first_name, u.email, ur.id
        ORDER BY u.nickname
      `);
      console.log('✅ Profesores detallados query successful:', profesoresDetallados.rows.length, 'profesores');
      profesoresDetallados.rows.forEach(prof => {
        console.log(`  - ${prof.nickname}: ${prof.bloques_creados} bloques, ${prof.total_preguntas} preguntas`);
      });
    } catch (error) {
      console.log('❌ Profesores detallados query failed:', error.message);
    }
    
    // 3. Consulta de creadores detallados
    console.log('\n3️⃣ Testing creadores detallados query...');
    try {
      const creadoresDetallados = await client.query(`
        SELECT 
          u.id as user_id,
          u.nickname,
          u.first_name,
          u.email,
          ur.id as user_role_id,
          COUNT(DISTINCT b.id) as bloques_creados,
          COALESCE(SUM(ba.total_questions), 0) as total_preguntas,
          COUNT(DISTINCT ta.id) as total_temas
        FROM users u
        JOIN user_roles ur ON u.id = ur.user_id
        JOIN roles r ON ur.role_id = r.id
        LEFT JOIN blocks b ON ur.id = b.user_role_id
        LEFT JOIN block_answers ba ON b.id = ba.block_id
        LEFT JOIN topic_answers ta ON b.id = ta.block_id
        WHERE r.name = 'creador'
        GROUP BY u.id, u.nickname, u.first_name, u.email, ur.id
        ORDER BY u.nickname
      `);
      console.log('✅ Creadores detallados query successful:', creadoresDetallados.rows.length, 'creadores');
      creadoresDetallados.rows.forEach(creator => {
        console.log(`  - ${creator.nickname}: ${creator.bloques_creados} bloques, ${creator.total_preguntas} preguntas, ${creator.total_temas} temas`);
      });
    } catch (error) {
      console.log('❌ Creadores detallados query failed:', error.message);
    }
    
    // 4. Consulta de estudiantes por bloque
    console.log('\n4️⃣ Testing estudiantes por bloque query...');
    try {
      const estudiantesQuery = await client.query(`
        SELECT 
          b.id as block_id,
          COUNT(DISTINCT up.user_id) as estudiantes
        FROM blocks b
        LEFT JOIN user_profiles up ON up.loaded_blocks::jsonb ? b.id::text
        GROUP BY b.id
      `);
      console.log('✅ Estudiantes query successful:', estudiantesQuery.rows.length, 'blocks');
    } catch (error) {
      console.log('❌ Estudiantes query failed:', error.message);
    }
    
    // 5. Verificar que todas las tablas existen
    console.log('\n5️⃣ Checking table existence...');
    const tables = ['users', 'user_roles', 'roles', 'blocks', 'block_answers', 'topic_answers', 'user_profiles'];
    
    for (const tableName of tables) {
      try {
        const exists = await client.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = $1
          )
        `, [tableName]);
        
        const count = await client.query(`SELECT COUNT(*) as count FROM ${tableName}`);
        console.log(`  ✅ ${tableName}: exists, ${count.rows[0].count} records`);
      } catch (error) {
        console.log(`  ❌ ${tableName}: ${error.message}`);
      }
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
    await testEndpoint();
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

main();