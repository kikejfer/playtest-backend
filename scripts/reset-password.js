const bcrypt = require('bcrypt');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function resetPassword() {
  const client = await pool.connect();
  
  try {
    // Get command line arguments
    const args = process.argv.slice(2);
    if (args.length !== 2) {
      console.log('❌ Usage: node reset-password.js <username> <new_password>');
      console.log('');
      console.log('Examples:');
      console.log('  node reset-password.js admin kikejfer75');
      console.log('  node reset-password.js player1 newpassword123');
      console.log('');
      console.log('Available users:');
      
      const users = await client.query('SELECT nickname FROM users ORDER BY created_at');
      users.rows.forEach(user => {
        console.log(`  - ${user.nickname}`);
      });
      
      return;
    }
    
    const [username, newPassword] = args;
    
    console.log(`🔐 Resetting password for user: ${username}`);
    
    // Check if user exists
    const userCheck = await client.query(
      'SELECT id, nickname FROM users WHERE nickname = $1',
      [username]
    );
    
    if (userCheck.rows.length === 0) {
      console.log(`❌ User '${username}' not found`);
      return;
    }
    
    // Hash new password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);
    
    // Update password
    await client.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE nickname = $2',
      [passwordHash, username]
    );
    
    console.log(`✅ Password updated successfully for user '${username}'`);
    console.log(`📧 New credentials:`);
    console.log(`   Username: ${username}`);
    console.log(`   Password: ${newPassword}`);
    
  } catch (error) {
    console.error('❌ Error resetting password:', error);
  } finally {
    client.release();
    pool.end();
  }
}

resetPassword();