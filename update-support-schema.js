const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function updateSupportSchema() {
    try {
        console.log('🎫 Actualizando esquema del Sistema de Soporte Técnico...');
        
        // Leer y ejecutar el archivo SQL completo
        const fs = require('fs');
        const path = require('path');
        
        const sqlFile = path.join(__dirname, '..', 'database-schema-support.sql');
        const sqlContent = fs.readFileSync(sqlFile, 'utf8');
        
        // Ejecutar el schema completo
        await pool.query(sqlContent);
        
        console.log('✅ Esquema del Sistema de Soporte creado exitosamente');
        
        // Verificar que las tablas se crearon correctamente
        const tableCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name LIKE 'support_%' 
            ORDER BY table_name;
        `);
        
        console.log('📊 Tablas del Sistema de Soporte creadas:');
        tableCheck.rows.forEach(row => {
            console.log(`   ✅ ${row.table_name}`);
        });
        
        // Verificar categorías iniciales
        const categoriesCheck = await pool.query(`
            SELECT name, description 
            FROM support_categories 
            ORDER BY sort_order;
        `);
        
        console.log('\n📂 Categorías de soporte cargadas:');
        categoriesCheck.rows.forEach(cat => {
            console.log(`   ✅ ${cat.name}: ${cat.description}`);
        });
        
        // Verificar plantillas de respuesta
        const templatesCheck = await pool.query(`
            SELECT name, array_length(tags, 1) as tag_count
            FROM support_templates 
            ORDER BY id;
        `);
        
        console.log('\n📝 Plantillas de respuesta cargadas:');
        templatesCheck.rows.forEach(template => {
            console.log(`   ✅ ${template.name} (${template.tag_count || 0} tags)`);
        });
        
        // Verificar reglas de escalación
        const rulesCheck = await pool.query(`
            SELECT rule_name, description, is_active
            FROM support_escalation_rules 
            ORDER BY priority DESC;
        `);
        
        console.log('\n⚡ Reglas de escalación automática configuradas:');
        rulesCheck.rows.forEach(rule => {
            console.log(`   ✅ ${rule.rule_name} (${rule.is_active ? 'ACTIVA' : 'INACTIVA'})`);
        });
        
        // Verificar configuración del sistema
        const configCheck = await pool.query(`
            SELECT config_key, config_value, config_type
            FROM support_system_config 
            ORDER BY config_key;
        `);
        
        console.log('\n⚙️ Configuración del sistema:');
        configCheck.rows.forEach(config => {
            console.log(`   ✅ ${config.config_key}: ${config.config_value} (${config.config_type})`);
        });
        
        // Verificar funciones y triggers
        const functionsCheck = await pool.query(`
            SELECT routine_name, routine_type
            FROM information_schema.routines 
            WHERE routine_schema = 'public' 
            AND (routine_name LIKE '%ticket%' OR routine_name LIKE '%support%' OR routine_name LIKE '%escalation%')
            ORDER BY routine_name;
        `);
        
        console.log('\n🔧 Funciones y procedimientos creados:');
        functionsCheck.rows.forEach(func => {
            console.log(`   ✅ ${func.routine_name} (${func.routine_type})`);
        });
        
        // Verificar vista de métricas
        const viewCheck = await pool.query(`
            SELECT * FROM support_dashboard_metrics;
        `);
        
        console.log('\n📈 Dashboard de métricas inicializado:');
        const metrics = viewCheck.rows[0];
        console.log(`   📊 Tickets abiertos: ${metrics.open_tickets}`);
        console.log(`   🚨 Tickets escalados: ${metrics.escalated_tickets}`);
        console.log(`   ⏱️ Tiempo promedio de resolución: ${metrics.avg_resolution_hours || 'N/A'} horas`);
        console.log(`   ⭐ Satisfacción promedio: ${metrics.avg_satisfaction || 'N/A'}/5`);
        console.log(`   📅 Tickets de hoy: ${metrics.today_tickets}`);
        console.log(`   ✅ Resueltos hoy: ${metrics.today_resolved}`);
        console.log(`   👥 Grupos activos: ${metrics.active_groups}`);
        
        console.log('\n🎉 ¡Sistema de Soporte Técnico completamente configurado!');
        console.log('\n📋 Funcionalidades disponibles:');
        console.log('   ✅ Agrupación inteligente automática de tickets');
        console.log('   ✅ Escalación automática basada en reglas');
        console.log('   ✅ Base de conocimiento integrada');
        console.log('   ✅ Sistema de plantillas de respuesta');
        console.log('   ✅ Analytics y métricas en tiempo real');
        console.log('   ✅ Categorización automática avanzada');
        console.log('   ✅ Gestión masiva de tickets');
        console.log('   ✅ FAQ automático generado desde tickets');
        console.log('   ✅ Notificaciones automáticas');
        console.log('   ✅ SLA tracking y alertas preventivas');
        
    } catch (error) {
        console.error('❌ Error actualizando esquema del Sistema de Soporte:', error.message);
        console.error('❌ Stack trace:', error.stack);
        throw error;
    } finally {
        await pool.end();
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    updateSupportSchema().catch(console.error);
}

module.exports = updateSupportSchema;