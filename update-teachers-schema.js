const pool = require('./database/connection');
const fs = require('fs');
const path = require('path');

/**
 * Script para actualizar el esquema de la base de datos con las tablas del panel de profesores
 */

async function updateTeachersSchema() {
    try {
        console.log('🎓 Actualizando esquema del Panel de Profesores...');
        
        // Leer el archivo SQL del esquema
        const schemaPath = path.join(__dirname, '..', 'database-schema-teachers-panel.sql');
        
        if (!fs.existsSync(schemaPath)) {
            throw new Error(`Archivo de esquema no encontrado: ${schemaPath}`);
        }
        
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        
        console.log('📄 Ejecutando script de esquema...');
        
        // Ejecutar el esquema completo
        await pool.query(schemaSql);
        
        console.log('✅ Esquema del Panel de Profesores actualizado exitosamente');
        
        // Verificar que las tablas principales fueron creadas
        const tables = [
            'teacher_classes',
            'class_enrollments', 
            'student_academic_profiles',
            'attendance_tracking',
            'academic_schedules',
            'content_assignments',
            'academic_progress',
            'teacher_assessments',
            'assessment_results',
            'pedagogical_interventions',
            'educational_tournaments',
            'tournament_participants',
            'tournament_progress',
            'educational_resources',
            'resource_reviews',
            'educational_communications',
            'institutional_reports'
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
            'generate_class_code',
            'calculate_student_progress_metrics',
            'detect_intervention_needs',
            'update_updated_at_column'
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
        
        console.log('🎉 Actualización del Panel de Profesores completada');
        
    } catch (error) {
        console.error('❌ Error actualizando esquema del Panel de Profesores:', error.message);
        console.error('❌ Stack trace:', error);
        throw error;
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    updateTeachersSchema()
        .then(() => {
            console.log('✅ Script completado exitosamente');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Script falló:', error.message);
            process.exit(1);
        });
}

module.exports = updateTeachersSchema;