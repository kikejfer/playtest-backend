const fs = require('fs').promises;
const { Pool } = require('pg');
const createAdminPrincipal = require('./create-admin-principal');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function applySchema(filename, description) {
    try {
        console.log(`📋 Aplicando: ${description}`);
        const schema = await fs.readFile(filename, 'utf8');
        
        // Aplicar todo el esquema de una vez
        await pool.query(schema);
        console.log(`✅ ${description} completado`);
        
    } catch (error) {
        if (error.message.includes('already exists') || 
            error.message.includes('ya existe') ||
            error.code === '42P07') {
            console.log(`⚠️  ${description} - algunos elementos ya existen (OK)`);
        } else {
            console.error(`❌ Error aplicando ${description}:`, error.message);
            throw error;
        }
    }
}

async function deploy() {
    try {
        console.log('🚀 Desplegando esquemas PLAYTEST...');
        
        // Crear directorios
        await fs.mkdir('./uploads/tickets', { recursive: true });
        console.log('✅ Directorios creados');
        
        // Aplicar esquemas en orden
        await applySchema('../database-schema.sql', 'Esquema Base');
        await applySchema('../database-schema-roles.sql', 'Sistema de Roles');  
        await applySchema('../database-schema-communication.sql', 'Sistema de Comunicación');
        
        // Verificar despliegue
        const tablesResult = await pool.query(`
            SELECT COUNT(*) as count 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        console.log(`✅ Total de tablas: ${tablesResult.rows[0].count}`);
        
        // Crear AdminPrincipal automáticamente
        console.log('\n👤 Configurando usuario AdminPrincipal...');
        await createAdminPrincipal();
        
        console.log('\n🎉 ¡Despliegue completado exitosamente!');
        console.log('\n📋 Próximos pasos:');
        console.log('   1. Reiniciar servidor: npm start');
        console.log('   2. ✅ AdminPrincipal ya está creado');
        console.log('   3. Probar formularios de soporte');
        
    } catch (error) {
        console.error('💥 Error en despliegue:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

deploy();