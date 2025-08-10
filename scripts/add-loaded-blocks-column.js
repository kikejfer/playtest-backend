const pool = require('../database/connection');

async function addLoadedBlocksColumn() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Adding loaded_blocks column to user_profiles table...');
    
    // Check if column already exists
    const columnCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'user_profiles' 
      AND column_name = 'loaded_blocks'
    `);
    
    if (columnCheck.rows.length > 0) {
      console.log('✅ Column loaded_blocks already exists');
      return;
    }
    
    // Add the column
    await client.query(`
      ALTER TABLE user_profiles 
      ADD COLUMN loaded_blocks JSONB DEFAULT '[]'
    `);
    
    console.log('✅ Successfully added loaded_blocks column to user_profiles table');
    
  } catch (error) {
    console.error('❌ Error adding loaded_blocks column:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run migration if called directly
if (require.main === module) {
  addLoadedBlocksColumn()
    .then(() => {
      console.log('🎉 Migration completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 Migration failed:', error);
      process.exit(1);
    });
}

module.exports = addLoadedBlocksColumn;