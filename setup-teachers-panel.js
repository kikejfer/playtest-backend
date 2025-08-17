const express = require('express');

/**
 * Configuración completa del Panel de Profesores
 * Integra todas las rutas y funcionalidades educativas
 */

function setupTeachersPanel(app) {
    console.log('🎓 Configurando Panel de Profesores...');
    
    // Importar todas las rutas del panel de profesores
    const teachersPanelRoutes = require('./routes/teachers-panel');
    const externalIntegrationsRoutes = require('./routes/external-integrations');
    const aiAnalyticsRoutes = require('./routes/ai-analytics');
    
    // Registrar rutas con prefijos específicos
    app.use('/api/teachers', teachersPanelRoutes);
    app.use('/api/integrations', externalIntegrationsRoutes);
    app.use('/api/ai-analytics', aiAnalyticsRoutes);
    
    console.log('✅ Panel de Profesores configurado exitosamente');
    console.log('📚 Rutas disponibles:');
    console.log('  - /api/teachers/* - Gestión académica y pedagógica');
    console.log('  - /api/integrations/* - Integraciones con sistemas externos');
    console.log('  - /api/ai-analytics/* - Analytics predictivos y IA pedagógica');
    
    return {
        teachersPanel: teachersPanelRoutes,
        integrations: externalIntegrationsRoutes,
        aiAnalytics: aiAnalyticsRoutes
    };
}

/**
 * Función para ejecutar todas las migraciones de esquemas
 */
async function runAllMigrations() {
    console.log('🔄 Ejecutando migraciones del Panel de Profesores...');
    
    try {
        // Ejecutar migraciones en orden
        const updateTeachersSchema = require('./update-teachers-schema');
        const updateIntegrationsSchema = require('./update-integrations-schema');
        
        console.log('1/2 Actualizando esquema de profesores...');
        await updateTeachersSchema();
        
        console.log('2/2 Actualizando esquema de integraciones...');
        await updateIntegrationsSchema();
        
        console.log('✅ Todas las migraciones completadas exitosamente');
        
    } catch (error) {
        console.error('❌ Error en migraciones:', error.message);
        throw error;
    }
}

/**
 * Función de validación del sistema
 */
async function validateTeachersPanel() {
    const pool = require('./database/connection');
    
    console.log('🔍 Validando Panel de Profesores...');
    
    try {
        // Verificar tablas críticas
        const criticalTables = [
            'teacher_classes',
            'class_enrollments',
            'academic_progress',
            'pedagogical_interventions',
            'integration_configurations'
        ];
        
        for (const table of criticalTables) {
            const result = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = $1
                );
            `, [table]);
            
            if (!result.rows[0].exists) {
                throw new Error(`Tabla crítica faltante: ${table}`);
            }
        }
        
        // Verificar funciones críticas
        const criticalFunctions = [
            'generate_class_code',
            'calculate_student_progress_metrics',
            'detect_intervention_needs'
        ];
        
        for (const func of criticalFunctions) {
            const result = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.routines 
                    WHERE routine_schema = 'public' 
                    AND routine_name = $1
                );
            `, [func]);
            
            if (!result.rows[0].exists) {
                throw new Error(`Función crítica faltante: ${func}`);
            }
        }
        
        console.log('✅ Validación del Panel de Profesores completada');
        
    } catch (error) {
        console.error('❌ Error en validación:', error.message);
        throw error;
    }
}

/**
 * Configuración completa con validación
 */
async function setupCompleteTeachersPanel(app, options = {}) {
    const { runMigrations = false, validateSystem = true } = options;
    
    try {
        // Ejecutar migraciones si se solicita
        if (runMigrations) {
            await runAllMigrations();
        }
        
        // Validar sistema si se solicita
        if (validateSystem) {
            await validateTeachersPanel();
        }
        
        // Configurar rutas
        const routes = setupTeachersPanel(app);
        
        console.log('🎉 Panel de Profesores completamente configurado y listo para usar');
        
        return routes;
        
    } catch (error) {
        console.error('❌ Error en configuración completa:', error.message);
        throw error;
    }
}

module.exports = {
    setupTeachersPanel,
    runAllMigrations,
    validateTeachersPanel,
    setupCompleteTeachersPanel
};