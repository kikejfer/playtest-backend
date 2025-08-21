#!/usr/bin/env node

/**
 * Database Initialization Script for Render
 * This script initializes the PostgreSQL database with the core schema needed for user registration
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initRenderDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Inicializando base de datos para Render...');
    
    // Create core tables for user registration and authentication
    console.log('📊 Creando tablas principales...');
    
    // 1. Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        nickname VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100),
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        first_name VARCHAR(100),
        last_name VARCHAR(100)
      );
    `);
    console.log('✅ Tabla users creada');
    
    // 2. User profiles table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        answer_history JSONB DEFAULT '[]',
        stats JSONB DEFAULT '{}',
        preferences JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        loaded_blocks JSONB DEFAULT '[]'
      );
    `);
    console.log('✅ Tabla user_profiles creada');
    
    // 3. Roles table
    await client.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tabla roles creada');
    
    // 4. User roles table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_roles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, role_id)
      );
    `);
    console.log('✅ Tabla user_roles creada');
    
    // 5. Blocks table (restructured)
    await client.query(`
      CREATE TABLE IF NOT EXISTS blocks (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        user_role_id INTEGER REFERENCES user_roles(id),
        is_public BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        image_url TEXT,
        observaciones TEXT
      );
    `);
    console.log('✅ Tabla blocks creada');
    
    // 6. Questions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS questions (
        id SERIAL PRIMARY KEY,
        block_id INTEGER REFERENCES blocks(id) ON DELETE CASCADE,
        text_question TEXT NOT NULL,
        topic VARCHAR(100),
        difficulty INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        explanation TEXT
      );
    `);
    console.log('✅ Tabla questions creada');
    
    // 7. Answers table
    await client.query(`
      CREATE TABLE IF NOT EXISTS answers (
        id SERIAL PRIMARY KEY,
        question_id INTEGER REFERENCES questions(id) ON DELETE CASCADE,
        answer_text TEXT NOT NULL,
        is_correct BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tabla answers creada');
    
    // 8. Games table
    await client.query(`
      CREATE TABLE IF NOT EXISTS games (
        id SERIAL PRIMARY KEY,
        game_type VARCHAR(50) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        config JSONB DEFAULT '{}',
        game_state JSONB DEFAULT '{}',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tabla games creada');
    
    // 9. User sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        session_token VARCHAR(255) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tabla user_sessions creada');
    
    // Create indexes
    console.log('📈 Creando índices...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_nickname ON users(nickname);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);
      CREATE INDEX IF NOT EXISTS idx_blocks_user_role_id ON blocks(user_role_id);
      CREATE INDEX IF NOT EXISTS idx_blocks_is_public ON blocks(is_public);
      CREATE INDEX IF NOT EXISTS idx_questions_block_id ON questions(block_id);
      CREATE INDEX IF NOT EXISTS idx_answers_question_id ON answers(question_id);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
    `);
    console.log('✅ Índices creados');
    
    // Insert default roles
    console.log('🎭 Insertando roles por defecto...');
    await client.query(`
      INSERT INTO roles (name, description) VALUES
        ('administrador_principal', 'Administrator with full system access'),
        ('administrador_secundario', 'Secondary administrator with limited access'),
        ('creador_contenido', 'Content creator with block creation permissions'),
        ('profesor', 'Teacher with student management permissions'),
        ('usuario', 'Regular user with basic access')
      ON CONFLICT (name) DO NOTHING;
    `);
    console.log('✅ Roles insertados');
    
    // Create triggers for updated_at
    console.log('⚡ Creando triggers...');
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.updated_at = CURRENT_TIMESTAMP;
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    
    await client.query(`
      DROP TRIGGER IF EXISTS update_users_updated_at ON users;
      CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
      CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      DROP TRIGGER IF EXISTS update_blocks_updated_at ON blocks;
      CREATE TRIGGER update_blocks_updated_at BEFORE UPDATE ON blocks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      DROP TRIGGER IF EXISTS update_questions_updated_at ON questions;
      CREATE TRIGGER update_questions_updated_at BEFORE UPDATE ON questions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      DROP TRIGGER IF EXISTS update_games_updated_at ON games;
      CREATE TRIGGER update_games_updated_at BEFORE UPDATE ON games FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);
    console.log('✅ Triggers creados');
    
    // Verify tables exist
    console.log('🔍 Verificando tablas...');
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);
    
    console.log('📋 Tablas creadas:');
    tables.rows.forEach(table => {
      console.log(`  - ${table.table_name}`);
    });
    
    console.log('🎉 Inicialización de base de datos completada para Render!');
    
  } catch (error) {
    console.error('❌ Error inicializando base de datos:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  try {
    await initRenderDatabase();
    console.log('✅ Proceso completado exitosamente');
  } catch (error) {
    console.error('❌ Proceso falló:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { initRenderDatabase };