const { Pool } = require('pg');
require('dotenv').config();

// Conectar a postgres por defecto para crear la base de datos
const adminPool = new Pool({
    user: 'postgres',
    host: '127.0.0.1',
    database: 'postgres', // Conectar a la DB por defecto
    password: '2512Sara06673149',
    port: 5432,
});

async function createDatabase() {
    try {
        console.log('🔧 Verificando si la base de datos playtest_db existe...');
        
        const dbCheckResult = await adminPool.query(
            "SELECT 1 FROM pg_database WHERE datname = 'playtest_db'"
        );
        
        if (dbCheckResult.rows.length === 0) {
            console.log('📦 Creando base de datos playtest_db...');
            await adminPool.query('CREATE DATABASE playtest_db');
            console.log('✅ Base de datos playtest_db creada exitosamente');
        } else {
            console.log('✅ Base de datos playtest_db ya existe');
        }
        
        await adminPool.end();
        
        // Ahora crear el esquema usando el archivo database-schema.sql
        console.log('📋 Ejecutando esquema de base de datos...');
        
        const fs = require('fs').promises;
        const path = require('path');
        
        const schemaPath = path.join(__dirname, '..', 'database-schema.sql');
        const schemaSQL = await fs.readFile(schemaPath, 'utf8');
        
        // Conectar a la nueva base de datos
        const projectPool = new Pool({
            connectionString: process.env.DATABASE_URL
        });
        
        // Ejecutar el esquema
        await projectPool.query(schemaSQL);
        console.log('✅ Esquema de base de datos aplicado exitosamente');
        
        await projectPool.end();
        
        console.log('🎉 Preparación de base de datos completada');
        
    } catch (error) {
        console.error('❌ Error preparando base de datos:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    createDatabase();
}

module.exports = { createDatabase };