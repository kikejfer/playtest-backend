const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function migrate() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Starting database migration...');
    
    // Read and execute schema file
    const schemaPath = path.join(__dirname, '..', '..', 'database-schema.sql');
    const schemaSQL = fs.readFileSync(schemaPath, 'utf8');
    
    await client.query(schemaSQL);
    
    console.log('✅ Database migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();