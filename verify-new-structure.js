const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function verifyNewStructure() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 VERIFICANDO NUEVAS ESTRUCTURAS PARA PAP\n');
    
    // 1. Verificar tabla user_loaded_blocks
    console.log('📋 TABLA USER_LOADED_BLOCKS:');
    try {
      const exists = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'user_loaded_blocks'
        )
      `);
      
      if (exists.rows[0].exists) {
        const structure = await client.query(`
          SELECT column_name, data_type 
          FROM information_schema.columns 
          WHERE table_name = 'user_loaded_blocks' AND table_schema = 'public'
          ORDER BY ordinal_position
        `);
        
        const count = await client.query(`SELECT COUNT(*) as count FROM user_loaded_blocks`);
        
        console.log(`  ✅ Existe - ${count.rows[0].count} registros`);
        console.log(`  Columnas: ${structure.rows.map(col => col.column_name).join(', ')}`);
        
        // Mostrar algunos datos de ejemplo
        const sample = await client.query(`SELECT * FROM user_loaded_blocks LIMIT 5`);
        console.log('  Datos de ejemplo:');
        sample.rows.forEach(row => {
          console.log(`    user_id: ${row.user_id}, block_id: ${row.block_id}`);
        });
      } else {
        console.log('  ❌ No existe - necesitamos crearla o usar user_profiles.loaded_blocks');
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
    }
    
    // 2. Verificar tabla block_answers
    console.log('\n📋 TABLA BLOCK_ANSWERS:');
    try {
      const structure = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'block_answers' AND table_schema = 'public'
        ORDER BY ordinal_position
      `);
      
      const count = await client.query(`SELECT COUNT(*) as count FROM block_answers`);
      
      console.log(`  ✅ Existe - ${count.rows[0].count} registros`);
      console.log(`  Columnas: ${structure.rows.map(col => col.column_name).join(', ')}`);
      
      // Mostrar algunos datos de ejemplo
      const sample = await client.query(`SELECT * FROM block_answers LIMIT 5`);
      console.log('  Datos de ejemplo:');
      sample.rows.forEach(row => {
        console.log(`    block_id: ${row.block_id}, total_questions: ${row.total_questions}`);
      });
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
    }
    
    // 3. Verificar consulta para profesores
    console.log('\n👨‍🏫 CONSULTA PARA PROFESORES:');
    try {
      const profesoresQuery = await client.query(`
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
      
      console.log(`  ✅ ${profesoresQuery.rows.length} profesores encontrados:`);
      profesoresQuery.rows.forEach(prof => {
        console.log(`    ${prof.nickname} (${prof.first_name}): ${prof.bloques_creados} bloques, ${prof.total_preguntas} preguntas`);
      });
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
    }
    
    // 4. Verificar consulta para creadores
    console.log('\n🎨 CONSULTA PARA CREADORES:');
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
      
      console.log(`  ✅ ${creadoresQuery.rows.length} creadores encontrados:`);
      creadoresQuery.rows.forEach(creator => {
        console.log(`    ${creator.nickname} (${creator.first_name}): ${creator.bloques_creados} bloques, ${creator.total_preguntas} preguntas, ${creator.total_temas} temas`);
      });
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
    }
    
    // 5. Verificar estudiantes que han cargado bloques
    console.log('\n📚 ESTUDIANTES CON BLOQUES CARGADOS:');
    try {
      // Primero probar con user_loaded_blocks si existe
      const userLoadedExists = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'user_loaded_blocks'
        )
      `);
      
      if (userLoadedExists.rows[0].exists) {
        const estudiantesQuery = await client.query(`
          SELECT 
            b.id as block_id,
            COUNT(DISTINCT ulb.user_id) as estudiantes
          FROM blocks b
          LEFT JOIN user_loaded_blocks ulb ON b.id = ulb.block_id
          GROUP BY b.id
          ORDER BY b.id
          LIMIT 10
        `);
        
        console.log('  ✅ Usando tabla user_loaded_blocks:');
        estudiantesQuery.rows.forEach(block => {
          console.log(`    Bloque ${block.block_id}: ${block.estudiantes} estudiantes`);
        });
      } else {
        // Fallback: usar user_profiles.loaded_blocks (JSON)
        const estudiantesQuery = await client.query(`
          SELECT 
            b.id as block_id,
            COUNT(DISTINCT up.user_id) as estudiantes
          FROM blocks b
          LEFT JOIN user_profiles up ON up.loaded_blocks::jsonb ? b.id::text
          GROUP BY b.id
          ORDER BY b.id
          LIMIT 10
        `);
        
        console.log('  ✅ Usando user_profiles.loaded_blocks (JSON):');
        estudiantesQuery.rows.forEach(block => {
          console.log(`    Bloque ${block.block_id}: ${block.estudiantes} estudiantes`);
        });
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
    }
    
    console.log('\n✅ VERIFICACIÓN COMPLETADA');
    
  } catch (error) {
    console.error('❌ Error en verificación:', error);
  } finally {
    client.release();
  }
}

async function main() {
  try {
    await verifyNewStructure();
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

main();