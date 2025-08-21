const { Pool } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function testRegistro() {
  const client = await pool.connect();
  
  try {
    console.log('🧪 Probando registro de usuario...');
    
    // Datos de prueba
    const testUser = {
      nickname: 'test_user_' + Date.now(),
      password: 'password123',
      email: 'test@example.com',
      firstName: 'Juan',
      lastName: 'Pérez'
    };
    
    console.log('📝 Datos de prueba:', {
      nickname: testUser.nickname,
      email: testUser.email,
      firstName: testUser.firstName,
      lastName: testUser.lastName
    });
    
    // 1. Hash de la contraseña
    console.log('🔐 Hasheando contraseña...');
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(testUser.password, saltRounds);
    console.log('✅ Contraseña hasheada');
    
    // 2. Verificar si el usuario ya existe
    console.log('🔍 Verificando si el usuario existe...');
    const existingUser = await client.query(
      'SELECT id, nickname, email FROM users WHERE nickname = $1 OR email = $2',
      [testUser.nickname, testUser.email]
    );
    
    if (existingUser.rows.length > 0) {
      console.log('⚠️ Usuario ya existe, eliminando para la prueba...');
      await client.query('DELETE FROM users WHERE nickname = $1', [testUser.nickname]);
    }
    
    // 3. Crear usuario
    console.log('👤 Creando usuario...');
    const insertQuery = `
      INSERT INTO users (nickname, password_hash, email, first_name, last_name) 
      VALUES ($1, $2, $3, $4, $5) 
      RETURNING id, nickname, email, first_name, last_name, created_at
    `;
    
    const result = await client.query(insertQuery, [
      testUser.nickname,
      passwordHash,
      testUser.email,
      testUser.firstName,
      testUser.lastName
    ]);
    
    const newUser = result.rows[0];
    console.log('✅ Usuario creado exitosamente:', {
      id: newUser.id,
      nickname: newUser.nickname,
      email: newUser.email,
      firstName: newUser.first_name,
      lastName: newUser.last_name,
      createdAt: newUser.created_at
    });
    
    // 4. Crear perfil de usuario
    console.log('📋 Creando perfil de usuario...');
    await client.query(
      'INSERT INTO user_profiles (user_id) VALUES ($1)',
      [newUser.id]
    );
    console.log('✅ Perfil creado');
    
    // 5. Verificar que todo se creó correctamente
    console.log('🔍 Verificando datos creados...');
    const verification = await client.query(`
      SELECT 
        u.id, u.nickname, u.email, u.first_name, u.last_name, u.created_at,
        up.id as profile_id, up.answer_history, up.stats, up.preferences, up.loaded_blocks
      FROM users u
      LEFT JOIN user_profiles up ON u.id = up.user_id
      WHERE u.id = $1
    `, [newUser.id]);
    
    if (verification.rows.length > 0) {
      const userData = verification.rows[0];
      console.log('✅ Verificación exitosa:', {
        user: {
          id: userData.id,
          nickname: userData.nickname,
          email: userData.email,
          firstName: userData.first_name,
          lastName: userData.last_name
        },
        profile: {
          profileId: userData.profile_id,
          answerHistory: userData.answer_history,
          stats: userData.stats,
          preferences: userData.preferences,
          loadedBlocks: userData.loaded_blocks
        }
      });
    }
    
    // 6. Limpiar datos de prueba
    console.log('🧹 Limpiando datos de prueba...');
    await client.query('DELETE FROM users WHERE id = $1', [newUser.id]);
    console.log('✅ Limpieza completada');
    
    console.log('🎉 ¡Prueba de registro exitosa! La estructura de la base de datos está correcta.');
    
  } catch (error) {
    console.error('❌ Error en la prueba de registro:', error);
    console.error('Detalle del error:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  try {
    await testRegistro();
  } catch (error) {
    console.error('❌ Falló la prueba:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();