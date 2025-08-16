#!/usr/bin/env node

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runEscalation() {
    try {
        console.log(`🔄 [${new Date().toISOString()}] Running ticket escalation check...`);
        
        const result = await pool.query('SELECT escalate_tickets() as escalated_count');
        const escalatedCount = result.rows[0].escalated_count;
        
        if (escalatedCount > 0) {
            console.log(`✅ [${new Date().toISOString()}] Escalated ${escalatedCount} ticket(s)`);
        } else {
            console.log(`ℹ️  [${new Date().toISOString()}] No tickets needed escalation`);
        }
        
        return escalatedCount;
    } catch (error) {
        console.error(`❌ [${new Date().toISOString()}] Error during escalation:`, error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

// Run if called directly
if (require.main === module) {
    runEscalation()
        .then(count => {
            console.log(`🎯 [${new Date().toISOString()}] Escalation job completed - ${count} tickets escalated`);
            process.exit(0);
        })
        .catch(error => {
            console.error(`💥 [${new Date().toISOString()}] Escalation job failed:`, error.message);
            process.exit(1);
        });
}

module.exports = runEscalation;