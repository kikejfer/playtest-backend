const bcrypt = require('bcrypt');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function addAdminSupport() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Adding admin support...');
    
    // Add is_admin column to users table if it doesn't exist
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;
    `);
    console.log('✅ Added is_admin column to users table');
    
    // Check if admin user exists
    const adminCheck = await client.query(
      "SELECT id, nickname FROM users WHERE nickname = 'admin'"
    );
    
    if (adminCheck.rows.length > 0) {
      console.log('📝 Admin user already exists, updating...');
      // Update existing admin user with new password
      const saltRounds = 10;
      const adminPassword = 'kikejfer75';
      const passwordHash = await bcrypt.hash(adminPassword, saltRounds);
      
      await client.query(
        "UPDATE users SET is_admin = true, password_hash = $1 WHERE nickname = 'admin'",
        [passwordHash]
      );
      console.log('✅ Updated existing admin user with new password');
      console.log('📧 Admin credentials:');
      console.log('   Username: admin');
      console.log('   Password: kikejfer75');
    } else {
      console.log('👤 Creating admin user...');
      // Create admin user with password "kikejfer75"
      const saltRounds = 10;
      const adminPassword = 'kikejfer75';
      const passwordHash = await bcrypt.hash(adminPassword, saltRounds);
      
      const result = await client.query(`
        INSERT INTO users (nickname, password_hash, is_admin, email) 
        VALUES ('admin', $1, true, 'admin@playtest.local') 
        RETURNING id, nickname
      `, [passwordHash]);
      
      const adminUser = result.rows[0];
      
      // Create admin profile
      await client.query(
        'INSERT INTO user_profiles (user_id) VALUES ($1)',
        [adminUser.id]
      );
      
      console.log('✅ Created admin user:', adminUser);
      console.log('📧 Admin credentials:');
      console.log('   Username: admin');
      console.log('   Password: kikejfer75');
    }
    
    console.log('🎉 Admin support added successfully!');
    
  } catch (error) {
    console.error('❌ Failed to add admin support:', error);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

addAdminSupport();