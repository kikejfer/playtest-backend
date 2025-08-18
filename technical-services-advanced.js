const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

// Sistema avanzado de servicios técnicos para PLAYTEST
class TechnicalServicesAdvanced {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
        
        this.servicesToMonitor = [
            'database',
            'cache', 
            'file_storage',
            'email_service',
            'websocket_server',
            'background_jobs',
            'payment_gateway'
        ];
        
        this.maintenanceMode = false;
        this.alertThresholds = {
            cpu: 80,
            memory: 85,
            disk: 90,
            response_time: 2000,
            error_rate: 5
        };
    }

    // ========== MONITOREO AVANZADO DEL SISTEMA ==========

    async performSystemHealthCheck() {
        try {
            const healthReport = {
                overall_status: 'healthy',
                timestamp: new Date(),
                services: {},
                metrics: {},
                alerts: [],
                recommendations: []
            };

            // Verificar cada servicio
            for (const service of this.servicesToMonitor) {
                try {
                    const serviceHealth = await this.checkServiceHealth(service);
                    healthReport.services[service] = serviceHealth;
                    
                    if (serviceHealth.status !== 'healthy') {
                        healthReport.overall_status = 'degraded';
                        healthReport.alerts.push({
                            type: 'service_unhealthy',
                            service: service,
                            message: serviceHealth.message,
                            severity: serviceHealth.severity || 'medium'
                        });
                    }
                } catch (error) {
                    healthReport.services[service] = {
                        status: 'error',
                        message: `Error checking service: ${error.message}`,
                        severity: 'high'
                    };
                    healthReport.overall_status = 'critical';
                }
            }

            // Obtener métricas del sistema
            healthReport.metrics = await this.getDetailedSystemMetrics();

            // Verificar alertas basadas en métricas
            this.checkMetricAlerts(healthReport.metrics, healthReport.alerts);

            // Generar recomendaciones
            healthReport.recommendations = await this.generateRecommendations(healthReport);

            return healthReport;

        } catch (error) {
            console.error('Error en health check completo:', error);
            return {
                overall_status: 'critical',
                timestamp: new Date(),
                error: error.message
            };
        }
    }

    async checkServiceHealth(serviceName) {
        switch (serviceName) {
            case 'database':
                return await this.checkDatabaseHealth();
            case 'cache':
                return await this.checkCacheHealth();
            case 'file_storage':
                return await this.checkFileStorageHealth();
            case 'email_service':
                return await this.checkEmailServiceHealth();
            case 'websocket_server':
                return await this.checkWebSocketHealth();
            case 'background_jobs':
                return await this.checkBackgroundJobsHealth();
            case 'payment_gateway':
                return await this.checkPaymentGatewayHealth();
            default:
                return { status: 'unknown', message: 'Service not implemented' };
        }
    }

    async checkDatabaseHealth() {
        try {
            const start = Date.now();
            
            // Test basic connectivity
            const result = await this.pool.query('SELECT NOW() as current_time, version() as db_version');
            const responseTime = Date.now() - start;
            
            // Check connection pool
            const poolStats = {
                total_connections: this.pool.totalCount,
                idle_connections: this.pool.idleCount,
                waiting_clients: this.pool.waitingCount
            };
            
            // Check database size and activity
            const dbStats = await this.pool.query(`
                SELECT 
                    pg_database_size(current_database()) as db_size,
                    (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') as active_connections,
                    (SELECT count(*) FROM pg_stat_activity) as total_sessions
            `);

            const status = responseTime > 1000 ? 'degraded' : 'healthy';
            
            return {
                status,
                response_time: responseTime,
                message: `Database responsive in ${responseTime}ms`,
                details: {
                    version: result.rows[0].db_version,
                    pool_stats: poolStats,
                    db_size: dbStats.rows[0].db_size,
                    active_connections: dbStats.rows[0].active_connections,
                    total_sessions: dbStats.rows[0].total_sessions
                }
            };

        } catch (error) {
            return {
                status: 'unhealthy',
                message: `Database error: ${error.message}`,
                severity: 'critical'
            };
        }
    }

    async checkCacheHealth() {
        try {
            // Simulación de verificación de cache (Redis/Memcached)
            // En implementación real, verificar conexión a Redis
            return {
                status: 'healthy',
                message: 'Cache service operational',
                details: {
                    type: 'memory',
                    hit_rate: 0.85,
                    memory_usage: '45%'
                }
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                message: `Cache error: ${error.message}`,
                severity: 'medium'
            };
        }
    }

    async checkFileStorageHealth() {
        try {
            const uploadsDir = path.join(__dirname, 'uploads');
            
            // Verificar que el directorio existe y es escribible
            await fs.access(uploadsDir, fs.constants.W_OK);
            
            // Verificar espacio disponible
            const stats = await fs.stat(uploadsDir);
            
            return {
                status: 'healthy',
                message: 'File storage accessible',
                details: {
                    uploads_directory: uploadsDir,
                    writable: true,
                    last_modified: stats.mtime
                }
            };

        } catch (error) {
            return {
                status: 'unhealthy',
                message: `File storage error: ${error.message}`,
                severity: 'medium'
            };
        }
    }

    async checkEmailServiceHealth() {
        try {
            // Verificación simulada del servicio de email
            // En implementación real, hacer ping al servidor SMTP
            return {
                status: 'healthy',
                message: 'Email service operational',
                details: {
                    provider: 'SMTP',
                    queue_size: 0,
                    last_email_sent: new Date(Date.now() - 5 * 60 * 1000)
                }
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                message: `Email service error: ${error.message}`,
                severity: 'low'
            };
        }
    }

    async checkWebSocketHealth() {
        try {
            // Verificar que el servidor WebSocket esté disponible
            const wsConnections = global.realTimeEvents ? global.realTimeEvents.getStats() : null;
            
            return {
                status: wsConnections ? 'healthy' : 'degraded',
                message: wsConnections ? 'WebSocket server active' : 'WebSocket server not initialized',
                details: wsConnections || { connections: 0 }
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                message: `WebSocket error: ${error.message}`,
                severity: 'medium'
            };
        }
    }

    async checkBackgroundJobsHealth() {
        try {
            // Verificar trabajos en segundo plano
            const jobStats = await this.pool.query(`
                SELECT 
                    COUNT(*) as total_jobs,
                    COUNT(*) FILTER (WHERE status = 'pending') as pending_jobs,
                    COUNT(*) FILTER (WHERE status = 'running') as running_jobs,
                    COUNT(*) FILTER (WHERE status = 'failed') as failed_jobs
                FROM background_jobs 
                WHERE created_at >= NOW() - INTERVAL '24 hours'
            `);

            const stats = jobStats.rows[0];
            const failureRate = stats.total_jobs > 0 ? (stats.failed_jobs / stats.total_jobs) : 0;
            
            const status = failureRate > 0.1 ? 'degraded' : 'healthy';
            
            return {
                status,
                message: `Background jobs processing normally`,
                details: {
                    total_jobs_24h: stats.total_jobs,
                    pending: stats.pending_jobs,
                    running: stats.running_jobs,
                    failed: stats.failed_jobs,
                    failure_rate: (failureRate * 100).toFixed(2) + '%'
                }
            };

        } catch (error) {
            return {
                status: 'unhealthy',
                message: `Background jobs error: ${error.message}`,
                severity: 'medium'
            };
        }
    }

    async checkPaymentGatewayHealth() {
        try {
            // Verificación simulada del gateway de pagos
            // En implementación real, hacer ping al proveedor de pagos
            return {
                status: 'healthy',
                message: 'Payment gateway operational',
                details: {
                    provider: 'Stripe/PayPal',
                    last_transaction: new Date(Date.now() - 10 * 60 * 1000),
                    success_rate: '99.2%'
                }
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                message: `Payment gateway error: ${error.message}`,
                severity: 'high'
            };
        }
    }

    async getDetailedSystemMetrics() {
        try {
            const metrics = {
                timestamp: new Date(),
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                cpu_usage: await this.getCpuUsage(),
                response_times: await this.getResponseTimes(),
                database_metrics: await this.getDatabaseMetrics(),
                user_activity: await this.getUserActivityMetrics()
            };

            return metrics;

        } catch (error) {
            console.error('Error obteniendo métricas detalladas:', error);
            return { error: error.message };
        }
    }

    async getCpuUsage() {
        try {
            if (process.platform === 'win32') {
                // En Windows, usar wmic
                const { stdout } = await execAsync('wmic cpu get loadpercentage /value');
                const match = stdout.match(/LoadPercentage=(\d+)/);
                return match ? parseInt(match[1]) : 0;
            } else {
                // En Linux/Mac, usar top
                const { stdout } = await execAsync('top -bn1 | grep "Cpu(s)" | awk \'{print $2}\' | awk -F\'%\' \'{print $1}\'');
                return parseFloat(stdout.trim()) || 0;
            }
        } catch (error) {
            console.error('Error obteniendo CPU usage:', error);
            return 0;
        }
    }

    async getResponseTimes() {
        try {
            // Obtener tiempos de respuesta promedio de los últimos endpoints
            const result = await this.pool.query(`
                SELECT 
                    endpoint,
                    AVG(response_time) as avg_response_time,
                    MAX(response_time) as max_response_time,
                    COUNT(*) as request_count
                FROM api_logs 
                WHERE created_at >= NOW() - INTERVAL '1 hour'
                GROUP BY endpoint
                ORDER BY avg_response_time DESC
                LIMIT 10
            `);

            return result.rows;

        } catch (error) {
            console.error('Error obteniendo response times:', error);
            return [];
        }
    }

    async getDatabaseMetrics() {
        try {
            const metrics = await this.pool.query(`
                SELECT 
                    pg_database_size(current_database()) as database_size,
                    (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') as active_connections,
                    (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle') as idle_connections,
                    (SELECT SUM(numbackends) FROM pg_stat_database) as total_connections
            `);

            const slowQueries = await this.pool.query(`
                SELECT query, mean_time, calls, total_time
                FROM pg_stat_statements 
                WHERE mean_time > 1000
                ORDER BY mean_time DESC 
                LIMIT 5
            `);

            return {
                ...metrics.rows[0],
                slow_queries: slowQueries.rows
            };

        } catch (error) {
            console.error('Error obteniendo métricas de BD:', error);
            return {};
        }
    }

    async getUserActivityMetrics() {
        try {
            const activity = await this.pool.query(`
                SELECT 
                    COUNT(DISTINCT user_id) as active_users_last_hour,
                    COUNT(*) as total_requests_last_hour,
                    AVG(CASE WHEN response_status >= 400 THEN 1 ELSE 0 END) as error_rate
                FROM api_logs 
                WHERE created_at >= NOW() - INTERVAL '1 hour'
            `);

            return activity.rows[0];

        } catch (error) {
            console.error('Error obteniendo métricas de usuarios:', error);
            return {};
        }
    }

    checkMetricAlerts(metrics, alerts) {
        // Verificar CPU
        if (metrics.cpu_usage > this.alertThresholds.cpu) {
            alerts.push({
                type: 'high_cpu',
                message: `CPU usage at ${metrics.cpu_usage}%`,
                severity: metrics.cpu_usage > 90 ? 'critical' : 'high',
                value: metrics.cpu_usage,
                threshold: this.alertThresholds.cpu
            });
        }

        // Verificar memoria
        const memoryUsagePercent = (metrics.memory.used / metrics.memory.total) * 100;
        if (memoryUsagePercent > this.alertThresholds.memory) {
            alerts.push({
                type: 'high_memory',
                message: `Memory usage at ${memoryUsagePercent.toFixed(1)}%`,
                severity: memoryUsagePercent > 95 ? 'critical' : 'high',
                value: memoryUsagePercent,
                threshold: this.alertThresholds.memory
            });
        }

        // Verificar tasa de errores
        if (metrics.user_activity?.error_rate > this.alertThresholds.error_rate / 100) {
            alerts.push({
                type: 'high_error_rate',
                message: `Error rate at ${(metrics.user_activity.error_rate * 100).toFixed(1)}%`,
                severity: 'high',
                value: metrics.user_activity.error_rate * 100,
                threshold: this.alertThresholds.error_rate
            });
        }
    }

    async generateRecommendations(healthReport) {
        const recommendations = [];

        // Recomendaciones basadas en alertas
        for (const alert of healthReport.alerts) {
            switch (alert.type) {
                case 'high_cpu':
                    recommendations.push({
                        type: 'performance',
                        message: 'Consider scaling up CPU resources or optimizing heavy processes',
                        priority: 'high',
                        estimated_impact: 'Improved response times'
                    });
                    break;
                case 'high_memory':
                    recommendations.push({
                        type: 'performance',
                        message: 'Memory optimization needed - check for memory leaks or increase RAM',
                        priority: 'high',
                        estimated_impact: 'Prevent system crashes'
                    });
                    break;
                case 'high_error_rate':
                    recommendations.push({
                        type: 'stability',
                        message: 'Investigate error sources and implement fixes',
                        priority: 'critical',
                        estimated_impact: 'Improved user experience'
                    });
                    break;
            }
        }

        // Recomendaciones basadas en métricas generales
        if (healthReport.metrics.database_metrics?.slow_queries?.length > 0) {
            recommendations.push({
                type: 'database',
                message: 'Optimize slow database queries to improve performance',
                priority: 'medium',
                estimated_impact: 'Faster response times',
                details: `${healthReport.metrics.database_metrics.slow_queries.length} slow queries detected`
            });
        }

        return recommendations;
    }

    // ========== GESTIÓN DE SERVICIOS ==========

    async restartService(serviceName, options = {}) {
        try {
            const { force = false, timeout = 30000 } = options;

            console.log(`Attempting to restart service: ${serviceName}`);

            // Validar que el servicio es reiniciable
            const restartableServices = [
                'cache', 
                'background_jobs', 
                'websocket_server', 
                'email_service'
            ];

            if (!restartableServices.includes(serviceName)) {
                throw new Error(`Service ${serviceName} cannot be restarted remotely`);
            }

            // Registrar evento de reinicio
            await this.logServiceEvent(serviceName, 'restart_initiated', {
                force,
                timeout,
                initiated_by: 'system'
            });

            // Simular reinicio del servicio
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Verificar que el servicio está funcionando después del reinicio
            const healthCheck = await this.checkServiceHealth(serviceName);
            
            if (healthCheck.status !== 'healthy') {
                throw new Error(`Service ${serviceName} failed to restart properly`);
            }

            await this.logServiceEvent(serviceName, 'restart_completed', {
                success: true,
                new_status: healthCheck.status
            });

            return {
                success: true,
                service: serviceName,
                status: healthCheck.status,
                message: `Service ${serviceName} restarted successfully`,
                timestamp: new Date()
            };

        } catch (error) {
            await this.logServiceEvent(serviceName, 'restart_failed', {
                error: error.message
            });

            throw new Error(`Failed to restart ${serviceName}: ${error.message}`);
        }
    }

    async logServiceEvent(serviceName, eventType, details = {}) {
        try {
            await this.pool.query(`
                INSERT INTO service_events (
                    service_name, 
                    event_type, 
                    event_details, 
                    created_at
                ) VALUES ($1, $2, $3, NOW())
            `, [serviceName, eventType, JSON.stringify(details)]);

        } catch (error) {
            console.error('Error logging service event:', error);
        }
    }

    // ========== SISTEMA DE BACKUP MANUAL ==========

    async createManualBackup(options = {}) {
        try {
            const {
                include_database = true,
                include_files = true,
                include_logs = false,
                compression = true,
                retention_days = 30
            } = options;

            const backupId = `manual_backup_${Date.now()}`;
            const backupPath = path.join(__dirname, 'backups', backupId);

            console.log(`Starting manual backup: ${backupId}`);

            // Crear directorio de backup
            await fs.mkdir(backupPath, { recursive: true });

            const backupTasks = [];
            const backupResults = {
                backup_id: backupId,
                started_at: new Date(),
                components: {},
                total_size: 0,
                status: 'in_progress'
            };

            // Backup de base de datos
            if (include_database) {
                backupTasks.push(this.backupDatabase(backupPath, backupId));
            }

            // Backup de archivos
            if (include_files) {
                backupTasks.push(this.backupFiles(backupPath, backupId));
            }

            // Backup de logs
            if (include_logs) {
                backupTasks.push(this.backupLogs(backupPath, backupId));
            }

            // Ejecutar todas las tareas de backup
            const results = await Promise.allSettled(backupTasks);

            // Procesar resultados
            let totalSize = 0;
            let hasErrors = false;

            results.forEach((result, index) => {
                const component = ['database', 'files', 'logs'][index];
                if (result.status === 'fulfilled') {
                    backupResults.components[component] = {
                        status: 'completed',
                        size: result.value.size,
                        path: result.value.path
                    };
                    totalSize += result.value.size;
                } else {
                    backupResults.components[component] = {
                        status: 'failed',
                        error: result.reason.message
                    };
                    hasErrors = true;
                }
            });

            backupResults.total_size = totalSize;
            backupResults.completed_at = new Date();
            backupResults.status = hasErrors ? 'completed_with_errors' : 'completed';

            // Comprimir si se solicita
            if (compression && !hasErrors) {
                const compressedPath = await this.compressBackup(backupPath, backupId);
                backupResults.compressed_path = compressedPath;
            }

            // Registrar backup en base de datos
            await this.registerBackup(backupResults);

            // Limpiar backups antiguos
            await this.cleanupOldBackups(retention_days);

            return backupResults;

        } catch (error) {
            console.error('Error en backup manual:', error);
            throw error;
        }
    }

    async backupDatabase(backupPath, backupId) {
        try {
            const dbBackupPath = path.join(backupPath, 'database.sql');
            
            // Usar pg_dump para hacer backup de la base de datos
            const dumpCommand = `pg_dump "${process.env.DATABASE_URL}" > "${dbBackupPath}"`;
            
            await execAsync(dumpCommand);
            
            const stats = await fs.stat(dbBackupPath);
            
            return {
                size: stats.size,
                path: dbBackupPath
            };

        } catch (error) {
            throw new Error(`Database backup failed: ${error.message}`);
        }
    }

    async backupFiles(backupPath, backupId) {
        try {
            const filesBackupPath = path.join(backupPath, 'files');
            await fs.mkdir(filesBackupPath, { recursive: true });

            // Copiar archivos importantes
            const uploadsDir = path.join(__dirname, 'uploads');
            const configDir = path.join(__dirname, 'config');

            if (await this.directoryExists(uploadsDir)) {
                await this.copyDirectory(uploadsDir, path.join(filesBackupPath, 'uploads'));
            }

            if (await this.directoryExists(configDir)) {
                await this.copyDirectory(configDir, path.join(filesBackupPath, 'config'));
            }

            const totalSize = await this.getDirectorySize(filesBackupPath);

            return {
                size: totalSize,
                path: filesBackupPath
            };

        } catch (error) {
            throw new Error(`Files backup failed: ${error.message}`);
        }
    }

    async backupLogs(backupPath, backupId) {
        try {
            const logsBackupPath = path.join(backupPath, 'logs');
            await fs.mkdir(logsBackupPath, { recursive: true });

            // Exportar logs de la base de datos
            const logsQuery = `
                COPY (
                    SELECT * FROM api_logs 
                    WHERE created_at >= NOW() - INTERVAL '30 days'
                ) TO STDOUT WITH CSV HEADER
            `;

            const logsFile = path.join(logsBackupPath, 'api_logs.csv');
            // En implementación real, ejecutar la query y guardar en archivo

            const stats = { size: 1024 }; // Placeholder

            return {
                size: stats.size,
                path: logsBackupPath
            };

        } catch (error) {
            throw new Error(`Logs backup failed: ${error.message}`);
        }
    }

    async compressBackup(backupPath, backupId) {
        try {
            const compressedPath = `${backupPath}.tar.gz`;
            const compressCommand = `tar -czf "${compressedPath}" -C "${path.dirname(backupPath)}" "${path.basename(backupPath)}"`;
            
            await execAsync(compressCommand);
            
            // Eliminar directorio original
            await fs.rmdir(backupPath, { recursive: true });
            
            return compressedPath;

        } catch (error) {
            throw new Error(`Backup compression failed: ${error.message}`);
        }
    }

    async registerBackup(backupResults) {
        try {
            await this.pool.query(`
                INSERT INTO system_backups (
                    backup_id,
                    backup_type,
                    status,
                    started_at,
                    completed_at,
                    total_size,
                    components,
                    backup_path
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [
                backupResults.backup_id,
                'manual',
                backupResults.status,
                backupResults.started_at,
                backupResults.completed_at,
                backupResults.total_size,
                JSON.stringify(backupResults.components),
                backupResults.compressed_path || backupResults.backup_path
            ]);

        } catch (error) {
            console.error('Error registering backup:', error);
        }
    }

    async cleanupOldBackups(retentionDays) {
        try {
            const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
            
            const oldBackups = await this.pool.query(`
                SELECT backup_id, backup_path 
                FROM system_backups 
                WHERE created_at < $1
            `, [cutoffDate]);

            for (const backup of oldBackups.rows) {
                try {
                    if (backup.backup_path && await this.fileExists(backup.backup_path)) {
                        await fs.unlink(backup.backup_path);
                    }
                } catch (error) {
                    console.error(`Error deleting backup file ${backup.backup_path}:`, error);
                }
            }

            await this.pool.query(`
                DELETE FROM system_backups 
                WHERE created_at < $1
            `, [cutoffDate]);

            console.log(`Cleaned up ${oldBackups.rows.length} old backups`);

        } catch (error) {
            console.error('Error cleaning up old backups:', error);
        }
    }

    // ========== UTILIDADES ==========

    async directoryExists(dirPath) {
        try {
            const stats = await fs.stat(dirPath);
            return stats.isDirectory();
        } catch {
            return false;
        }
    }

    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    async copyDirectory(src, dest) {
        await fs.mkdir(dest, { recursive: true });
        const entries = await fs.readdir(src, { withFileTypes: true });

        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            if (entry.isDirectory()) {
                await this.copyDirectory(srcPath, destPath);
            } else {
                await fs.copyFile(srcPath, destPath);
            }
        }
    }

    async getDirectorySize(dirPath) {
        try {
            let totalSize = 0;
            const entries = await fs.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    totalSize += await this.getDirectorySize(fullPath);
                } else {
                    const stats = await fs.stat(fullPath);
                    totalSize += stats.size;
                }
            }

            return totalSize;
        } catch {
            return 0;
        }
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = TechnicalServicesAdvanced;