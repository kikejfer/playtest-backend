const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function verifyCompleteDBFlow() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 VERIFICACIÓN COMPLETA DEL FLUJO DE BASE DE DATOS\n');
    
    // 1. VERIFICAR CARGA DE USUARIOS POR ROLES
    console.log('👥 1. CARGA DE USUARIOS POR ROLES:');
    console.log('==================================================');
    
    const usersByRole = await client.query(`
      SELECT 
        u.id as user_id,
        u.nickname,
        u.email,
        u.first_name,
        u.last_name,
        r.id as role_id,
        r.name as role_name,
        ur.id as user_role_id
      FROM user_roles ur
      JOIN users u ON ur.user_id = u.id
      JOIN roles r ON ur.role_id = r.id
      ORDER BY u.nickname, r.name
    `);
    
    // Agrupar por tipo de rol
    const adminsList = [];
    const profesoresList = [];
    const creadoresList = [];
    const jugadoresList = [];
    
    usersByRole.rows.forEach(row => {
      const userData = {
        user_id: row.user_id,
        nickname: row.nickname,
        email: row.email,
        first_name: row.first_name,
        last_name: row.last_name,
        role_id: row.role_id,
        role_name: row.role_name,
        user_role_id: row.user_role_id
      };
      
      switch (row.role_name) {
        case 'administrador_principal':
        case 'administrador_secundario':
          adminsList.push(userData);
          break;
        case 'profesor':
          profesoresList.push(userData);
          break;
        case 'creador':
          creadoresList.push(userData);
          break;
        case 'jugador':
          jugadoresList.push(userData);
          break;
      }
    });
    
    console.log(`\n📊 RESUMEN POR ROLES:`);
    console.log(`  Administradores: ${adminsList.length}`);
    console.log(`  Profesores: ${profesoresList.length}`);
    console.log(`  Creadores: ${creadoresList.length}`);
    console.log(`  Jugadores: ${jugadoresList.length}`);
    
    console.log(`\n👑 ADMINISTRADORES:`);
    adminsList.forEach(admin => {
      console.log(`  - ${admin.nickname} (ID: ${admin.user_id}) → ${admin.role_name} (user_role_id: ${admin.user_role_id})`);
    });
    
    console.log(`\n👨‍🏫 PROFESORES:`);
    profesoresList.forEach(prof => {
      console.log(`  - ${prof.nickname} (ID: ${prof.user_id}) → ${prof.role_name} (user_role_id: ${prof.user_role_id})`);
    });
    
    console.log(`\n🎨 CREADORES:`);
    creadoresList.forEach(creator => {
      console.log(`  - ${creator.nickname} (ID: ${creator.user_id}) → ${creator.role_name} (user_role_id: ${creator.user_role_id})`);
    });
    
    console.log(`\n🎮 JUGADORES:`);
    jugadoresList.forEach(player => {
      console.log(`  - ${player.nickname} (ID: ${player.user_id}) → ${player.role_name} (user_role_id: ${player.user_role_id})`);
    });
    
    // 2. VERIFICAR USUARIOS CON MÚLTIPLES ROLES
    console.log(`\n\n🔄 2. USUARIOS CON MÚLTIPLES ROLES:`);
    console.log('==================================================');
    
    const multipleRoles = await client.query(`
      SELECT 
        u.id as user_id,
        u.nickname,
        COUNT(ur.role_id) as role_count,
        array_agg(r.name ORDER BY r.name) as roles,
        array_agg(ur.id ORDER BY r.name) as user_role_ids
      FROM users u
      JOIN user_roles ur ON u.id = ur.user_id
      JOIN roles r ON ur.role_id = r.id
      GROUP BY u.id, u.nickname
      HAVING COUNT(ur.role_id) > 1
      ORDER BY role_count DESC, u.nickname
    `);
    
    if (multipleRoles.rows.length === 0) {
      console.log('  No hay usuarios con múltiples roles');
    } else {
      multipleRoles.rows.forEach(user => {
        console.log(`  ${user.nickname} (ID: ${user.user_id}): ${user.role_count} roles`);
        console.log(`    Roles: ${user.roles.join(', ')}`);
        console.log(`    User Role IDs: ${user.user_role_ids.join(', ')}`);
      });
    }
    
    // 3. VERIFICAR BLOQUES Y SU RELACIÓN CON USER_ROLE_ID
    console.log(`\n\n📦 3. BLOQUES Y RELACIÓN CON USER_ROLE_ID:`);
    console.log('==================================================');
    
    // Verificar si la tabla blocks tiene la columna user_role_id
    const blocksStructure = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'blocks' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    
    console.log(`\n📋 ESTRUCTURA DE TABLA BLOCKS:`);
    blocksStructure.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });
    
    const hasUserRoleId = blocksStructure.rows.some(col => col.column_name === 'user_role_id');
    const hasCreatorId = blocksStructure.rows.some(col => col.column_name === 'creator_id');
    
    console.log(`\n🔍 CAMPOS RELEVANTES:`);
    console.log(`  - user_role_id: ${hasUserRoleId ? '✅ EXISTE' : '❌ NO EXISTE'}`);
    console.log(`  - creator_id: ${hasCreatorId ? '✅ EXISTE' : '❌ NO EXISTE'}`);
    
    if (hasUserRoleId) {
      // Consulta usando user_role_id (CORRECTO)
      console.log(`\n📦 BLOQUES CON USER_ROLE_ID (MÉTODO CORRECTO):`);
      const blocksWithUserRoleId = await client.query(`
        SELECT 
          b.id as block_id,
          b.name as block_name,
          b.user_role_id,
          ur.user_id,
          ur.role_id,
          u.nickname as creator_nickname,
          r.name as creator_role
        FROM blocks b
        JOIN user_roles ur ON b.user_role_id = ur.id
        JOIN users u ON ur.user_id = u.id
        JOIN roles r ON ur.role_id = r.id
        ORDER BY b.id
        LIMIT 10
      `);
      
      blocksWithUserRoleId.rows.forEach(block => {
        console.log(`  Bloque ${block.block_id}: "${block.block_name}"`);
        console.log(`    user_role_id: ${block.user_role_id}`);
        console.log(`    Creador: ${block.creator_nickname} (ID: ${block.user_id})`);
        console.log(`    Rol: ${block.creator_role}`);
        console.log('');
      });
    } else if (hasCreatorId) {
      // Consulta usando creator_id (MÉTODO ANTERIOR)
      console.log(`\n📦 BLOQUES CON CREATOR_ID (MÉTODO ANTERIOR):`);
      const blocksWithCreatorId = await client.query(`
        SELECT 
          b.id as block_id,
          b.name as block_name,
          b.creator_id,
          u.nickname as creator_nickname
        FROM blocks b
        JOIN users u ON b.creator_id = u.id
        ORDER BY b.id
        LIMIT 10
      `);
      
      blocksWithCreatorId.rows.forEach(block => {
        console.log(`  Bloque ${block.block_id}: "${block.block_name}"`);
        console.log(`    creator_id: ${block.creator_id}`);
        console.log(`    Creador: ${block.creator_nickname}`);
        console.log('');
      });
    }
    
    // 4. VERIFICAR PREGUNTAS Y TEMAS
    console.log(`\n\n❓ 4. PREGUNTAS Y TEMAS:`);
    console.log('==================================================');
    
    // Verificar estructura de tablas relacionadas
    const tables = ['block_answers', 'topic_answers', 'questions', 'answers'];
    
    for (const tableName of tables) {
      try {
        const tableExists = await client.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = $1
          )
        `, [tableName]);
        
        if (tableExists.rows[0].exists) {
          const structure = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = $1 AND table_schema = 'public'
            ORDER BY ordinal_position
          `, [tableName]);
          
          const count = await client.query(`SELECT COUNT(*) as count FROM ${tableName}`);
          
          console.log(`\n📋 TABLA ${tableName.toUpperCase()}:`);
          console.log(`  Registros: ${count.rows[0].count}`);
          console.log(`  Columnas: ${structure.rows.map(col => col.column_name).join(', ')}`);
        } else {
          console.log(`\n❌ TABLA ${tableName.toUpperCase()}: NO EXISTE`);
        }
      } catch (error) {
        console.log(`\n❌ ERROR verificando tabla ${tableName}: ${error.message}`);
      }
    }
    
    // 5. VERIFICAR CÁLCULOS DE PREGUNTAS POR BLOQUE
    console.log(`\n\n🧮 5. CÁLCULOS DE PREGUNTAS POR BLOQUE:`);
    console.log('==================================================');
    
    // Verificar desde topic_answers (según tu especificación)
    try {
      const topicAnswersExists = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'topic_answers'
        )
      `);
      
      if (topicAnswersExists.rows[0].exists) {
        console.log(`\n📊 DESDE TABLA TOPIC_ANSWERS:`);
        const topicStats = await client.query(`
          SELECT 
            ta.block_id,
            ta.topic,
            ta.total_questions,
            COUNT(*) as topic_count
          FROM topic_answers ta
          GROUP BY ta.block_id, ta.topic, ta.total_questions
          ORDER BY ta.block_id, ta.topic
          LIMIT 10
        `);
        
        topicStats.rows.forEach(stat => {
          console.log(`  Bloque ${stat.block_id} - Tema: "${stat.topic}"`);
          console.log(`    Preguntas: ${stat.total_questions}`);
        });
        
        // Resumen por bloque
        const blockSummary = await client.query(`
          SELECT 
            ta.block_id,
            COUNT(DISTINCT ta.topic) as total_topics,
            SUM(ta.total_questions) as total_questions
          FROM topic_answers ta
          GROUP BY ta.block_id
          ORDER BY ta.block_id
        `);
        
        console.log(`\n📈 RESUMEN POR BLOQUE (desde topic_answers):`);
        blockSummary.rows.forEach(summary => {
          console.log(`  Bloque ${summary.block_id}: ${summary.total_topics} temas, ${summary.total_questions} preguntas`);
        });
      }
    } catch (error) {
      console.log(`❌ Error verificando topic_answers: ${error.message}`);
    }
    
    // Verificar desde questions/answers (método alternativo)
    try {
      const questionsExists = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'questions'
        )
      `);
      
      if (questionsExists.rows[0].exists) {
        console.log(`\n📊 DESDE TABLA QUESTIONS:`);
        const questionStats = await client.query(`
          SELECT 
            q.block_id,
            q.topic,
            COUNT(*) as question_count
          FROM questions q
          GROUP BY q.block_id, q.topic
          ORDER BY q.block_id, q.topic
          LIMIT 10
        `);
        
        questionStats.rows.forEach(stat => {
          console.log(`  Bloque ${stat.block_id} - Tema: "${stat.topic}"`);
          console.log(`    Preguntas: ${stat.question_count}`);
        });
      }
    } catch (error) {
      console.log(`❌ Error verificando questions: ${error.message}`);
    }
    
    console.log('\n✅ VERIFICACIÓN COMPLETA FINALIZADA');
    
  } catch (error) {
    console.error('❌ Error en verificación:', error);
  } finally {
    client.release();
  }
}

async function main() {
  try {
    await verifyCompleteDBFlow();
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

main();