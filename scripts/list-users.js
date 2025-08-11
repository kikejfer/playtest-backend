const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function listUsers() {
  const client = await pool.connect();
  
  try {
    console.log('👥 Listing all users in database...\n');
    
    const result = await pool.query(`
      SELECT u.id, u.nickname, u.email, u.created_at,
        COUNT(DISTINCT b.id) as created_blocks,
        COUNT(DISTINCT q.id) as created_questions
      FROM users u
      LEFT JOIN blocks b ON u.id = b.creator_id
      LEFT JOIN questions q ON b.id = q.block_id
      GROUP BY u.id, u.nickname, u.email, u.created_at
      ORDER BY u.created_at ASC
    `);
    
    if (result.rows.length === 0) {
      console.log('No users found in database.');
      return;
    }
    
    console.log('┌─────┬─────────────────┬─────────────────────┬─────────────┬─────────┬────────────┐');
    console.log('│ ID  │ Nickname        │ Email               │ Created     │ Blocks  │ Questions  │');
    console.log('├─────┼─────────────────┼─────────────────────┼─────────────┼─────────┼────────────┤');
    
    result.rows.forEach(user => {
      const id = user.id.toString().padEnd(3);
      const nickname = (user.nickname || 'N/A').padEnd(15);
      const email = (user.email || 'N/A').padEnd(19);
      const created = user.created_at.toISOString().split('T')[0].padEnd(11);
      const blocks = user.created_blocks.toString().padEnd(7);
      const questions = user.created_questions.toString().padEnd(10);
      
      console.log(`│ ${id} │ ${nickname} │ ${email} │ ${created} │ ${blocks} │ ${questions} │`);
    });
    
    console.log('└─────┴─────────────────┴─────────────────────┴─────────────┴─────────┴────────────┘');
    console.log(`\nTotal users: ${result.rows.length}`);
    
  } catch (error) {
    console.error('❌ Error listing users:', error);
  } finally {
    client.release();
    pool.end();
  }
}

listUsers();