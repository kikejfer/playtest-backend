const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function updateRolesSchema() {
    try {
        console.log('🔄 Actualizando esquema de roles...');
        
        // 1. Actualizar role existente profesor_creador -> creador_contenido
        await pool.query(`
            UPDATE roles SET 
                name = 'creador_contenido',
                description = 'Asignado automáticamente al crear primer bloque público, enfocado en marketing y monetización',
                hierarchy_level = 3,
                permissions = '{"create_blocks": true, "manage_own_blocks": true, "marketing": true, "monetization": true}'
            WHERE name = 'profesor_creador';
        `);
        console.log('✅ Rol profesor_creador actualizado a creador_contenido');

        // 2. Insertar nuevo rol profesor
        await pool.query(`
            INSERT INTO roles (name, description, hierarchy_level, permissions) VALUES
            ('profesor', 'Asignado manualmente por administradores o código educativo, enfocado en gestión académica', 3, '{"manage_students": true, "academic_reports": true, "assign_blocks": true}')
            ON CONFLICT (name) DO UPDATE SET
                description = EXCLUDED.description,
                hierarchy_level = EXCLUDED.hierarchy_level,
                permissions = EXCLUDED.permissions;
        `);
        console.log('✅ Rol profesor creado');

        // 3. Actualizar permisos de administradores
        await pool.query(`
            UPDATE roles SET permissions = '{"all": true, "manage_admins": true, "assign_roles": true, "redistribute_users": true}'
            WHERE name = 'administrador_principal';
            
            UPDATE roles SET permissions = '{"manage_assigned_users": true, "view_admin_panels": true, "assign_blocks": true}'
            WHERE name = 'administrador_secundario';
        `);
        console.log('✅ Permisos de administradores actualizados');

        // 4. Crear tabla de códigos educativos
        await pool.query(`
            CREATE TABLE IF NOT EXISTS educational_codes (
                id SERIAL PRIMARY KEY,
                code VARCHAR(20) UNIQUE NOT NULL,
                institution_name VARCHAR(200),
                created_by INTEGER REFERENCES users(id),
                max_uses INTEGER DEFAULT NULL,
                current_uses INTEGER DEFAULT 0,
                expires_at TIMESTAMP DEFAULT NULL,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Tabla educational_codes creada');

        // 5. Crear tabla de asignaciones educativas
        await pool.query(`
            CREATE TABLE IF NOT EXISTS educational_assignments (
                id SERIAL PRIMARY KEY,
                professor_id INTEGER REFERENCES users(id),
                student_id INTEGER REFERENCES users(id),
                educational_code_id INTEGER REFERENCES educational_codes(id),
                assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT true,
                UNIQUE(professor_id, student_id)
            );
        `);
        console.log('✅ Tabla educational_assignments creada');

        // 6. Extender user_luminarias
        await pool.query(`
            ALTER TABLE user_luminarias ADD COLUMN IF NOT EXISTS abonadas_marketing INTEGER DEFAULT 0;
            ALTER TABLE user_luminarias ADD COLUMN IF NOT EXISTS ingresos_monetizacion DECIMAL(10,2) DEFAULT 0.00;
        `);
        console.log('✅ Tabla user_luminarias extendida');

        // 7. Actualizar función de auto-asignación
        await pool.query(`
            CREATE OR REPLACE FUNCTION auto_assign_creador_contenido()
            RETURNS TRIGGER AS $$
            BEGIN
                IF NEW.is_public = true THEN
                    IF NOT EXISTS (
                        SELECT 1 FROM user_roles ur
                        JOIN roles r ON ur.role_id = r.id
                        WHERE ur.user_id = NEW.creator_id AND r.name = 'creador_contenido'
                    ) THEN
                        INSERT INTO user_roles (user_id, role_id, auto_assigned)
                        SELECT NEW.creator_id, r.id, true
                        FROM roles r
                        WHERE r.name = 'creador_contenido';
                    END IF;
                    
                    INSERT INTO user_luminarias (user_id)
                    VALUES (NEW.creator_id)
                    ON CONFLICT (user_id) DO NOTHING;
                END IF;
                
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);
        console.log('✅ Función auto_assign_creador_contenido creada');

        // 8. Actualizar triggers
        await pool.query(`
            DROP TRIGGER IF EXISTS trigger_auto_assign_profesor_creador ON blocks;
            CREATE TRIGGER trigger_auto_assign_creador_contenido
                AFTER INSERT ON blocks
                FOR EACH ROW
                EXECUTE FUNCTION auto_assign_creador_contenido();
        `);
        console.log('✅ Trigger actualizado');

        // 9. Actualizar función AdminPrincipal con verificación de contraseña
        await pool.query(`
            CREATE OR REPLACE FUNCTION check_admin_principal_registration()
            RETURNS TRIGGER AS $$
            BEGIN
                IF NEW.nickname = 'AdminPrincipal' THEN
                    -- Asignar rol de administrador_principal
                    INSERT INTO user_roles (user_id, role_id, auto_assigned)
                    SELECT NEW.id, r.id, true
                    FROM roles r
                    WHERE r.name = 'administrador_principal';
                    
                    -- Inicializar luminarias
                    INSERT INTO user_luminarias (user_id)
                    VALUES (NEW.id)
                    ON CONFLICT (user_id) DO NOTHING;
                    
                    -- Marcar que debe cambiar contraseña
                    INSERT INTO user_profiles (user_id, preferences)
                    VALUES (NEW.id, '{"must_change_password": true}')
                    ON CONFLICT (user_id) DO UPDATE SET
                        preferences = COALESCE(user_profiles.preferences, '{}'::jsonb) || '{"must_change_password": true}';
                END IF;
                
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);
        console.log('✅ Función AdminPrincipal actualizada');

        // 10. Función de redistribución
        await pool.query(`
            CREATE OR REPLACE FUNCTION redistribute_users_to_admins()
            RETURNS INTEGER AS $$
            DECLARE
                admin_count INTEGER;
                user_count INTEGER;
                users_per_admin INTEGER;
                remaining_users INTEGER;
                admin_record RECORD;
                user_record RECORD;
                current_admin_users INTEGER;
                assignment_counter INTEGER := 0;
            BEGIN
                SELECT COUNT(*) INTO admin_count
                FROM user_roles ur
                JOIN roles r ON ur.role_id = r.id
                WHERE r.name = 'administrador_secundario';
                
                IF admin_count = 0 THEN
                    RETURN 0;
                END IF;
                
                DELETE FROM admin_assignments;
                
                SELECT COUNT(DISTINCT ur.user_id) INTO user_count
                FROM user_roles ur
                JOIN roles r ON ur.role_id = r.id
                WHERE r.name IN ('creador_contenido', 'profesor', 'usuario');
                
                users_per_admin := user_count / admin_count;
                remaining_users := user_count % admin_count;
                
                assignment_counter := 0;
                
                FOR admin_record IN
                    SELECT DISTINCT ur.user_id as admin_id
                    FROM user_roles ur
                    JOIN roles r ON ur.role_id = r.id
                    WHERE r.name = 'administrador_secundario'
                    ORDER BY ur.assigned_at
                LOOP
                    current_admin_users := users_per_admin;
                    
                    IF remaining_users > 0 THEN
                        current_admin_users := current_admin_users + 1;
                        remaining_users := remaining_users - 1;
                    END IF;
                    
                    FOR user_record IN
                        SELECT DISTINCT ur.user_id
                        FROM user_roles ur
                        JOIN roles r ON ur.role_id = r.id
                        WHERE r.name IN ('creador_contenido', 'profesor', 'usuario')
                        AND NOT EXISTS (
                            SELECT 1 FROM admin_assignments aa WHERE aa.assigned_user_id = ur.user_id
                        )
                        ORDER BY ur.assigned_at
                        LIMIT current_admin_users
                    LOOP
                        INSERT INTO admin_assignments (admin_id, assigned_user_id, assigned_by)
                        VALUES (admin_record.admin_id, user_record.user_id, 
                               (SELECT ur.user_id FROM user_roles ur 
                                JOIN roles r ON ur.role_id = r.id 
                                WHERE r.name = 'administrador_principal' LIMIT 1));
                        
                        assignment_counter := assignment_counter + 1;
                    END LOOP;
                END LOOP;
                
                RETURN assignment_counter;
            END;
            $$ LANGUAGE plpgsql;
        `);
        console.log('✅ Función redistribute_users_to_admins creada');

        // 11. Crear índices
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_educational_codes_code ON educational_codes(code);
            CREATE INDEX IF NOT EXISTS idx_educational_assignments_professor ON educational_assignments(professor_id);
            CREATE INDEX IF NOT EXISTS idx_educational_assignments_student ON educational_assignments(student_id);
            CREATE INDEX IF NOT EXISTS idx_blocks_creator_public ON blocks(creator_id, is_public);
            CREATE INDEX IF NOT EXISTS idx_user_roles_multiple ON user_roles(user_id, role_id);
        `);
        console.log('✅ Índices creados');

        // 12. Función para códigos educativos
        await pool.query(`
            CREATE OR REPLACE FUNCTION assign_professor_by_code(
                p_user_id INTEGER,
                p_educational_code VARCHAR(20)
            )
            RETURNS BOOLEAN AS $$
            DECLARE
                code_record RECORD;
                professor_id INTEGER;
            BEGIN
                SELECT * INTO code_record
                FROM educational_codes 
                WHERE code = p_educational_code 
                AND is_active = true 
                AND (expires_at IS NULL OR expires_at > NOW())
                AND (max_uses IS NULL OR current_uses < max_uses);
                
                IF NOT FOUND THEN
                    RETURN FALSE;
                END IF;
                
                professor_id := code_record.created_by;
                
                INSERT INTO user_roles (user_id, role_id, auto_assigned)
                SELECT professor_id, r.id, false
                FROM roles r
                WHERE r.name = 'profesor'
                ON CONFLICT (user_id, role_id) DO NOTHING;
                
                INSERT INTO educational_assignments (professor_id, student_id, educational_code_id)
                VALUES (professor_id, p_user_id, code_record.id)
                ON CONFLICT (professor_id, student_id) DO NOTHING;
                
                UPDATE educational_codes 
                SET current_uses = current_uses + 1
                WHERE id = code_record.id;
                
                RETURN TRUE;
            END;
            $$ LANGUAGE plpgsql;
        `);
        console.log('✅ Función assign_professor_by_code creada');

        // Verificación final
        const verification = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM roles) as roles_count,
                (SELECT COUNT(*) FROM information_schema.tables WHERE table_name LIKE '%educational%') as new_tables,
                (SELECT COUNT(*) FROM information_schema.routines WHERE routine_name LIKE '%redistribute%' OR routine_name LIKE '%creador_contenido%') as new_functions
        `);
        
        const stats = verification.rows[0];
        console.log('\n📊 Verificación del esquema actualizado:');
        console.log(`✅ Roles totales: ${stats.roles_count}`);
        console.log(`✅ Nuevas tablas educativas: ${stats.new_tables}`);
        console.log(`✅ Nuevas funciones: ${stats.new_functions}`);

        console.log('\n🎉 ¡Esquema de roles actualizado exitosamente!');
        console.log('\n📋 Nuevas funcionalidades:');
        console.log('   ✅ Roles separados: Creador de Contenido y Profesor');
        console.log('   ✅ Sistema de códigos educativos');
        console.log('   ✅ Redistribución automática de usuarios');
        console.log('   ✅ Verificación AdminPrincipal con contraseña');

    } catch (error) {
        console.error('❌ Error actualizando esquema:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    updateRolesSchema().catch(console.error);
}

module.exports = updateRolesSchema;