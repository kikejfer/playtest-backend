const pool = require('./database/connection');
const fs = require('fs');
const path = require('path');

/**
 * Script para actualizar el esquema de la base de datos con las tablas del panel de creadores
 */

async function updateCreatorsSchema() {
    try {
        console.log('🎨 Actualizando esquema del Panel de Creadores...');
        
        // Leer el archivo SQL del esquema
        const schemaPath = path.join(__dirname, '..', 'database-schema-creators-panel.sql');
        
        if (!fs.existsSync(schemaPath)) {
            throw new Error(`Archivo de esquema no encontrado: ${schemaPath}`);
        }
        
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        
        console.log('📄 Ejecutando script de esquema...');
        
        // Ejecutar el esquema completo
        await pool.query(schemaSql);
        
        console.log('✅ Esquema del Panel de Creadores actualizado exitosamente');
        
        // Verificar que las tablas principales fueron creadas
        const tables = [
            'creator_market_analytics',
            'competitor_analysis', 
            'marketing_campaigns',
            'marketing_tournaments',
            'creator_premium_services',
            'service_bookings',
            'creator_digital_products',
            'creator_subscriptions',
            'content_analytics',
            'dynamic_pricing',
            'marketing_automation',
            'market_opportunities',
            'ab_tests'
        ];
        
        console.log('🔍 Verificando tablas creadas...');
        
        for (const tableName of tables) {
            const result = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = $1
                );
            `, [tableName]);
            
            const exists = result.rows[0].exists;
            console.log(`  ${exists ? '✅' : '❌'} ${tableName}: ${exists ? 'OK' : 'NO EXISTE'}`);
        }
        
        // Verificar funciones creadas
        console.log('🔍 Verificando funciones...');
        
        const functions = [
            'calculate_market_metrics',
            'detect_market_opportunities'
        ];
        
        for (const functionName of functions) {
            const result = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.routines 
                    WHERE routine_schema = 'public' 
                    AND routine_name = $1
                );
            `, [functionName]);
            
            const exists = result.rows[0].exists;
            console.log(`  ${exists ? '✅' : '❌'} ${functionName}(): ${exists ? 'OK' : 'NO EXISTE'}`);
        }
        
        console.log('🎉 Actualización del Panel de Creadores completada');
        
    } catch (error) {
        console.error('❌ Error actualizando esquema del Panel de Creadores:', error.message);
        console.error('❌ Stack trace:', error);
        throw error;
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    updateCreatorsSchema()
        .then(() => {
            console.log('✅ Script completado exitosamente');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Script falló:', error.message);
            process.exit(1);
        });
}

module.exports = updateCreatorsSchema;