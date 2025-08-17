const pool = require('./database/connection');
const fs = require('fs');
const path = require('path');

/**
 * Script para actualizar el esquema de la base de datos con las tablas de integraciones externas
 */

async function updateIntegrationsSchema() {
    try {
        console.log('🔗 Actualizando esquema de Integraciones Externas...');
        
        // Primero agregar campo external_id a la tabla users si no existe
        console.log('📝 Agregando campo external_id a tabla users...');
        
        try {
            await pool.query(`
                ALTER TABLE users 
                ADD COLUMN IF NOT EXISTS external_id VARCHAR(200),
                ADD COLUMN IF NOT EXISTS created_via_integration BOOLEAN DEFAULT false;
            `);
            
            // Crear índice para external_id
            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_users_external_id ON users(external_id) 
                WHERE external_id IS NOT NULL;
            `);
            
            console.log('✅ Campo external_id agregado a users');
        } catch (error) {
            console.log('ℹ️ Campo external_id ya existe en users o error menor:', error.message);
        }
        
        // Leer el archivo SQL del esquema de integraciones
        const schemaPath = path.join(__dirname, '..', 'database-schema-integrations.sql');
        
        if (!fs.existsSync(schemaPath)) {
            throw new Error(`Archivo de esquema no encontrado: ${schemaPath}`);
        }
        
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        
        console.log('📄 Ejecutando script de esquema de integraciones...');
        
        // Ejecutar el esquema completo
        await pool.query(schemaSql);
        
        console.log('✅ Esquema de Integraciones Externas actualizado exitosamente');
        
        // Verificar que las tablas principales fueron creadas
        const tables = [
            'integration_configurations',
            'sync_operations',
            'external_id_mappings',
            'sync_data_log',
            'integration_webhooks',
            'webhook_log',
            'external_data_cache',
            'data_transformations'
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
            'cleanup_expired_cache',
            'get_integration_stats',
            'upsert_external_mapping',
            'update_integration_updated_at',
            'auto_cleanup_cache'
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
        
        // Insertar configuraciones de ejemplo
        console.log('📝 Insertando configuraciones de ejemplo...');
        
        const exampleConfigs = [
            {
                integration_type: 'lms',
                integration_name: 'Canvas LMS Integration',
                provider_name: 'Canvas',
                base_url: 'https://canvas.instructure.com',
                api_version: 'v1',
                field_mappings: {
                    student_fields: {
                        'user_id': 'external_id',
                        'nickname': 'name',
                        'email': 'email'
                    }
                },
                sync_settings: {
                    auto_sync: true,
                    sync_frequency: 3600
                }
            },
            {
                integration_type: 'lms',
                integration_name: 'Moodle Integration', 
                provider_name: 'Moodle',
                base_url: 'https://moodle.example.com',
                api_version: 'v3.9',
                field_mappings: {
                    student_fields: {
                        'user_id': 'id',
                        'nickname': 'username',
                        'email': 'email'
                    }
                },
                sync_settings: {
                    auto_sync: false,
                    manual_sync_only: true
                }
            }
        ];
        
        for (const config of exampleConfigs) {
            try {
                await pool.query(`
                    INSERT INTO integration_configurations (
                        integration_type, integration_name, provider_name,
                        base_url, api_version, field_mappings, sync_settings,
                        is_active
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT DO NOTHING
                `, [
                    config.integration_type,
                    config.integration_name,
                    config.provider_name,
                    config.base_url,
                    config.api_version,
                    JSON.stringify(config.field_mappings),
                    JSON.stringify(config.sync_settings),
                    false // Inicialmente inactivas
                ]);
                
                console.log(`  ✅ Configuración de ejemplo: ${config.integration_name}`);
            } catch (error) {
                console.log(`  ⚠️ Error insertando ${config.integration_name}:`, error.message);
            }
        }
        
        console.log('🎉 Actualización de Integraciones Externas completada');
        
    } catch (error) {
        console.error('❌ Error actualizando esquema de Integraciones:', error.message);
        console.error('❌ Stack trace:', error);
        throw error;
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    updateIntegrationsSchema()
        .then(() => {
            console.log('✅ Script completado exitosamente');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Script falló:', error.message);
            process.exit(1);
        });
}

module.exports = updateIntegrationsSchema;