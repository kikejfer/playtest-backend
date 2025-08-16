const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function updateLuminariasSchema() {
    try {
        console.log('🌟 Actualizando esquema de Luminarias...');
        
        // Leer y ejecutar el archivo SQL completo
        const fs = require('fs');
        const path = require('path');
        
        const sqlFile = path.join(__dirname, '..', 'database-schema-luminarias.sql');
        const sqlContent = fs.readFileSync(sqlFile, 'utf8');
        
        // Ejecutar el schema completo
        await pool.query(sqlContent);
        
        console.log('✅ Esquema de Luminarias creado exitosamente');
        
        // Verificar que las tablas se crearon correctamente
        const tableCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name LIKE '%luminarias%' 
            ORDER BY table_name;
        `);
        
        console.log('📊 Tablas de Luminarias creadas:');
        tableCheck.rows.forEach(row => {
            console.log(`   ✅ ${row.table_name}`);
        });
        
        // Verificar configuración inicial
        const configCheck = await pool.query(`
            SELECT 
                category,
                COUNT(*) as config_count
            FROM luminarias_config 
            GROUP BY category 
            ORDER BY category;
        `);
        
        console.log('\n💰 Configuración de valores cargada:');
        configCheck.rows.forEach(row => {
            console.log(`   ✅ ${row.category}: ${row.config_count} configuraciones`);
        });
        
        // Verificar items de tienda
        const storeCheck = await pool.query(`
            SELECT 
                target_role,
                category,
                COUNT(*) as item_count
            FROM luminarias_store_items 
            GROUP BY target_role, category 
            ORDER BY target_role, category;
        `);
        
        console.log('\n🛒 Items de tienda cargados:');
        storeCheck.rows.forEach(row => {
            console.log(`   ✅ ${row.target_role} - ${row.category}: ${row.item_count} items`);
        });
        
        // Crear algunas cuentas iniciales para usuarios existentes
        console.log('\n👥 Creando cuentas de Luminarias para usuarios existentes...');
        await pool.query(`
            INSERT INTO user_luminarias (user_id, current_balance, total_earned, lifetime_earnings)
            SELECT 
                u.id,
                200,  -- Balance inicial
                200,  -- Total ganado inicial
                200   -- Ganancias de por vida inicial
            FROM users u
            LEFT JOIN user_luminarias ul ON u.id = ul.user_id
            WHERE ul.user_id IS NULL;
        `);
        
        const usersWithLuminarias = await pool.query(`
            SELECT COUNT(*) as user_count FROM user_luminarias;
        `);
        
        console.log(`   ✅ ${usersWithLuminarias.rows[0].user_count} usuarios tienen cuenta de Luminarias`);
        
        console.log('\n🎉 ¡Sistema de Luminarias completamente configurado!');
        console.log('\n📋 Funcionalidades disponibles:');
        console.log('   ✅ Moneda dual (Usuarios vs Creadores)');
        console.log('   ✅ Sistema de transacciones completo');
        console.log('   ✅ Tienda virtual segmentada');
        console.log('   ✅ Marketplace interno');
        console.log('   ✅ Conversión a dinero real');
        console.log('   ✅ Configuración administrativa');
        console.log('   ✅ Balance automático de 200 Luminarias iniciales');
        
    } catch (error) {
        console.error('❌ Error actualizando esquema de Luminarias:', error.message);
        console.error('❌ Stack trace:', error.stack);
        throw error;
    } finally {
        await pool.end();
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    updateLuminariasSchema().catch(console.error);
}

module.exports = updateLuminariasSchema;