const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function deleteUser() {
  const client = await pool.connect();
  
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1) {
      console.log('❌ Usage: node delete-user.js <username>');
      console.log('');
      console.log('Example:');
      console.log('  node delete-user.js admin');
      console.log('');
      console.log('⚠️  WARNING: This will delete the user and ALL their data!');
      return;
    }
    
    const username = args[0];
    
    console.log(`🗑️  Attempting to delete user: ${username}`);
    
    // Check if user exists
    const userCheck = await client.query(
      'SELECT id, nickname FROM users WHERE nickname = $1',
      [username]
    );
    
    if (userCheck.rows.length === 0) {
      console.log(`❌ User '${username}' not found`);
      return;
    }
    
    const userId = userCheck.rows[0].id;
    console.log(`📋 Found user ID: ${userId}`);
    
    await client.query('BEGIN');
    
    try {
      // Delete in correct order to avoid foreign key violations
      
      // 1. Delete answers for questions in user's blocks
      const deleteAnswers = await client.query(`
        DELETE FROM answers 
        WHERE question_id IN (
          SELECT q.id FROM questions q 
          JOIN blocks b ON q.block_id = b.id 
          WHERE b.creator_id = $1
        )
      `, [userId]);
      console.log(`🗑️  Deleted ${deleteAnswers.rowCount} answers`);
      
      // 2. Delete questions from user's blocks
      const deleteQuestions = await client.query(`
        DELETE FROM questions 
        WHERE block_id IN (
          SELECT id FROM blocks WHERE creator_id = $1
        )
      `, [userId]);
      console.log(`🗑️  Deleted ${deleteQuestions.rowCount} questions`);
      
      // 3. Delete user's blocks
      const deleteBlocks = await client.query(
        'DELETE FROM blocks WHERE creator_id = $1',
        [userId]
      );
      console.log(`🗑️  Deleted ${deleteBlocks.rowCount} blocks`);
      
      // 4. Delete user profile
      const deleteProfile = await client.query(
        'DELETE FROM user_profiles WHERE user_id = $1',
        [userId]
      );
      console.log(`🗑️  Deleted user profile (${deleteProfile.rowCount} rows)`);
      
      // 5. Finally delete the user
      const deleteUser = await client.query(
        'DELETE FROM users WHERE id = $1',
        [userId]
      );
      console.log(`🗑️  Deleted user (${deleteUser.rowCount} rows)`);
      
      await client.query('COMMIT');
      
      console.log(`✅ User '${username}' and all associated data deleted successfully!`);
      console.log(`🎯 You can now register a new user with the username '${username}'`);
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    
  } catch (error) {
    console.error('❌ Error deleting user:', error);
    console.error('💡 The user might have associated data that prevents deletion.');
  } finally {
    client.release();
    pool.end();
  }
}

deleteUser();