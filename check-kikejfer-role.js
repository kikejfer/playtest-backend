const { Pool } = require('pg');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const pool = new Pool();

async function checkKikejferRole() {
  try {
    console.log('🔍 Checking kikejfer roles in database...');
    
    const result = await pool.query(`
      SELECT u.id, u.nickname, r.name as role_name, ur.id as user_role_id
      FROM users u
      JOIN user_roles ur ON u.id = ur.user_id
      JOIN roles r ON ur.role_id = r.id
      WHERE u.nickname = 'kikejfer'
      ORDER BY r.name
    `);
    
    if (result.rows.length === 0) {
      console.log('❌ No roles found for kikejfer');
    } else {
      console.log(`✅ Found ${result.rows.length} role(s) for kikejfer:`);
      result.rows.forEach(row => {
        console.log(`  - Role: ${row.role_name} (User ID: ${row.id}, Role Assignment ID: ${row.user_role_id})`);
      });
    }
    
    // Also check if user exists without roles
    const userCheck = await pool.query(`
      SELECT id, nickname FROM users WHERE nickname = 'kikejfer'
    `);
    
    if (userCheck.rows.length > 0) {
      console.log(`\n✅ User kikejfer exists with ID: ${userCheck.rows[0].id}`);
    } else {
      console.log('\n❌ User kikejfer does not exist in database');
    }
    
  } catch (error) {
    console.error('❌ Error checking kikejfer role:', error);
  } finally {
    await pool.end();
  }
}

checkKikejferRole();