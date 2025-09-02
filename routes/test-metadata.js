const express = require('express');
const router = express.Router();
const pool = require('../database/connection');

// Test endpoint to verify metadata tables and data
router.get('/', async (req, res) => {
  try {
    console.log('🔍 Testing metadata tables...');
    
    // Check if tables exist and get their data
    const results = {};
    
    try {
      const typesResult = await pool.query('SELECT id, name FROM block_types ORDER BY id');
      results.types = {
        exists: true,
        count: typesResult.rows.length,
        data: typesResult.rows
      };
    } catch (error) {
      results.types = { exists: false, error: error.message };
    }
    
    try {
      const levelsResult = await pool.query('SELECT id, name FROM block_levels ORDER BY id'); 
      results.levels = {
        exists: true,
        count: levelsResult.rows.length,
        data: levelsResult.rows
      };
    } catch (error) {
      results.levels = { exists: false, error: error.message };
    }
    
    try {
      const statesResult = await pool.query('SELECT id, name FROM block_states ORDER BY id');
      results.states = {
        exists: true,
        count: statesResult.rows.length, 
        data: statesResult.rows
      };
    } catch (error) {
      results.states = { exists: false, error: error.message };
    }
    
    console.log('✅ Metadata test results:', results);
    res.json({
      success: true,
      message: 'Metadata tables verification completed',
      results: results
    });
    
  } catch (error) {
    console.error('❌ Error testing metadata:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

module.exports = router;