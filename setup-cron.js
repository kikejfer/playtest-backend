const cron = require('node-cron');
const runEscalation = require('./escalation-cron');

class EscalationScheduler {
    constructor() {
        this.job = null;
        this.isRunning = false;
    }

    start() {
        if (this.isRunning) {
            console.log('⚠️  Escalation scheduler is already running');
            return;
        }

        // Run every hour at minute 0
        this.job = cron.schedule('0 * * * *', async () => {
            try {
                console.log('🕐 Scheduled escalation job starting...');
                await runEscalation();
            } catch (error) {
                console.error('💥 Scheduled escalation job failed:', error.message);
            }
        }, {
            scheduled: false,
            timezone: "Europe/Madrid"
        });

        this.job.start();
        this.isRunning = true;
        
        console.log('✅ Escalation scheduler started - running every hour');
        console.log('   Next run: Every hour at minute 0');
        console.log('   Timezone: Europe/Madrid');
    }

    stop() {
        if (this.job) {
            this.job.stop();
            this.job = null;
        }
        this.isRunning = false;
        console.log('🛑 Escalation scheduler stopped');
    }

    async runNow() {
        console.log('🚀 Running escalation manually...');
        try {
            const count = await runEscalation();
            console.log(`✅ Manual escalation completed - ${count} tickets escalated`);
            return count;
        } catch (error) {
            console.error('❌ Manual escalation failed:', error.message);
            throw error;
        }
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            schedule: '0 * * * * (every hour)',
            timezone: 'Europe/Madrid',
            nextRun: this.job ? 'Every hour at minute 0' : 'Not scheduled'
        };
    }
}

module.exports = EscalationScheduler;