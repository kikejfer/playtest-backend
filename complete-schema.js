const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function completeSchema() {
    console.log('🚀 Completando esquema de comunicación...');
    
    try {
        // 1. Completar tablas de comunicación
        await pool.query(`
            -- Ticket messages (si no existe)
            CREATE TABLE IF NOT EXISTS ticket_messages (
                id SERIAL PRIMARY KEY,
                ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE NOT NULL,
                sender_id INTEGER REFERENCES users(id) NOT NULL,
                message_text TEXT NOT NULL,
                message_html TEXT,
                is_internal BOOLEAN DEFAULT false,
                is_system BOOLEAN DEFAULT false,
                edited_at TIMESTAMP,
                read_by JSONB DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Ticket attachments (si no existe)
            CREATE TABLE IF NOT EXISTS ticket_attachments (
                id SERIAL PRIMARY KEY,
                ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
                message_id INTEGER REFERENCES ticket_messages(id) ON DELETE CASCADE,
                filename VARCHAR(255) NOT NULL,
                original_name VARCHAR(255) NOT NULL,
                file_type VARCHAR(100) NOT NULL,
                file_size INTEGER NOT NULL,
                file_path VARCHAR(500) NOT NULL,
                uploaded_by INTEGER REFERENCES users(id) NOT NULL,
                upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_image BOOLEAN DEFAULT false,
                thumbnail_path VARCHAR(500)
            );
            
            -- Ticket participants (si no existe)
            CREATE TABLE IF NOT EXISTS ticket_participants (
                id SERIAL PRIMARY KEY,
                ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE NOT NULL,
                user_id INTEGER REFERENCES users(id) NOT NULL,
                role VARCHAR(20) NOT NULL,
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                notifications_enabled BOOLEAN DEFAULT true,
                UNIQUE(ticket_id, user_id)
            );
            
            -- Notifications (si no existe)  
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE NOT NULL,
                ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
                type VARCHAR(50) NOT NULL,
                title VARCHAR(200) NOT NULL,
                message TEXT NOT NULL,
                action_url VARCHAR(500),
                is_read BOOLEAN DEFAULT false,
                is_push_sent BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                read_at TIMESTAMP
            );
        `);
        console.log('✅ Tablas de comunicación creadas');

        // 2. Función para generar números de ticket
        await pool.query(`
            CREATE OR REPLACE FUNCTION generate_ticket_number()
            RETURNS TEXT AS $$
            DECLARE
                year_str TEXT := EXTRACT(YEAR FROM NOW())::TEXT;
                sequence_num INTEGER;
                ticket_num TEXT;
            BEGIN
                SELECT COALESCE(MAX(
                    CAST(SUBSTRING(ticket_number FROM E'\\\\d{4}-(\\\\d+)$') AS INTEGER)
                ), 0) + 1
                INTO sequence_num
                FROM tickets 
                WHERE ticket_number LIKE 'TK-' || year_str || '-%';
                
                ticket_num := 'TK-' || year_str || '-' || LPAD(sequence_num::TEXT, 6, '0');
                
                RETURN ticket_num;
            END;
            $$ LANGUAGE plpgsql;
        `);
        console.log('✅ Función generate_ticket_number creada');

        // 3. Trigger para auto-generar número de ticket
        await pool.query(`
            CREATE OR REPLACE FUNCTION auto_generate_ticket_number()
            RETURNS TRIGGER AS $$
            BEGIN
                IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' THEN
                    NEW.ticket_number := generate_ticket_number();
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);

        await pool.query(`
            DROP TRIGGER IF EXISTS trigger_auto_ticket_number ON tickets;
            CREATE TRIGGER trigger_auto_ticket_number
                BEFORE INSERT ON tickets
                FOR EACH ROW
                EXECUTE FUNCTION auto_generate_ticket_number();
        `);
        console.log('✅ Trigger auto_generate_ticket_number creado');

        // 4. Función para auto-asignación de tickets
        await pool.query(`
            CREATE OR REPLACE FUNCTION auto_assign_ticket()
            RETURNS TRIGGER AS $$
            DECLARE
                assigned_user_id INTEGER;
                admin_id INTEGER;
                creator_id INTEGER;
            BEGIN
                -- Si es ticket global (soporte técnico)
                IF NEW.origin_type = 'global' THEN
                    -- Buscar usuario con rol 'servicio_tecnico'
                    SELECT u.id INTO assigned_user_id
                    FROM users u
                    JOIN user_roles ur ON u.id = ur.user_id
                    JOIN roles r ON ur.role_id = r.id
                    WHERE r.name = 'servicio_tecnico'
                    ORDER BY RANDOM()
                    LIMIT 1;
                    
                    -- Si no hay servicio técnico, asignar a AdminPrincipal
                    IF assigned_user_id IS NULL THEN
                        SELECT u.id INTO assigned_user_id
                        FROM users u
                        JOIN user_roles ur ON u.id = ur.user_id
                        JOIN roles r ON ur.role_id = r.id
                        WHERE r.name = 'administrador_principal'
                        LIMIT 1;
                    END IF;
                    
                -- Si es ticket de bloque específico
                ELSIF NEW.origin_type = 'block' AND NEW.block_id IS NOT NULL THEN
                    -- Obtener el creador del bloque
                    SELECT creator_id INTO assigned_user_id
                    FROM blocks
                    WHERE id = NEW.block_id;
                    
                    -- Si el creador no existe o es el mismo que reporta
                    IF assigned_user_id IS NULL OR assigned_user_id = NEW.created_by THEN
                        -- Buscar el admin asignado del creador del bloque
                        SELECT b.creator_id INTO creator_id FROM blocks WHERE id = NEW.block_id;
                        
                        SELECT aa.admin_id INTO admin_id
                        FROM admin_assignments aa
                        WHERE aa.assigned_user_id = creator_id;
                        
                        IF admin_id IS NOT NULL THEN
                            assigned_user_id := admin_id;
                        ELSE
                            -- Si no tiene admin asignado, usar AdminPrincipal
                            SELECT u.id INTO assigned_user_id
                            FROM users u
                            JOIN user_roles ur ON u.id = ur.user_id
                            JOIN roles r ON ur.role_id = r.id
                            WHERE r.name = 'administrador_principal'
                            LIMIT 1;
                        END IF;
                    END IF;
                END IF;
                
                NEW.assigned_to := assigned_user_id;
                
                -- Establecer tiempo de escalado si la categoría lo requiere
                IF EXISTS (SELECT 1 FROM ticket_categories WHERE id = NEW.category_id AND auto_escalate = true) THEN
                    NEW.escalate_at := NEW.created_at + INTERVAL '24 hours';
                END IF;
                
                -- Actualizar last_activity
                NEW.last_activity := NOW();
                
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);

        await pool.query(`
            DROP TRIGGER IF EXISTS trigger_auto_assign_ticket ON tickets;
            CREATE TRIGGER trigger_auto_assign_ticket
                BEFORE INSERT ON tickets
                FOR EACH ROW
                EXECUTE FUNCTION auto_assign_ticket();
        `);
        console.log('✅ Función y trigger auto_assign_ticket creados');

        // 5. Función para actualizar activity en tickets
        await pool.query(`
            CREATE OR REPLACE FUNCTION update_ticket_activity()
            RETURNS TRIGGER AS $$
            BEGIN
                UPDATE tickets 
                SET last_activity = NOW(), updated_at = NOW()
                WHERE id = NEW.ticket_id;
                
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);

        await pool.query(`
            DROP TRIGGER IF EXISTS trigger_update_ticket_activity ON ticket_messages;
            CREATE TRIGGER trigger_update_ticket_activity
                AFTER INSERT ON ticket_messages
                FOR EACH ROW
                EXECUTE FUNCTION update_ticket_activity();
        `);
        console.log('✅ Trigger update_ticket_activity creado');

        // 6. Función de escalado automático
        await pool.query(`
            CREATE OR REPLACE FUNCTION escalate_tickets()
            RETURNS INTEGER AS $$
            DECLARE
                escalated_count INTEGER := 0;
                ticket_record RECORD;
                admin_id INTEGER;
            BEGIN
                -- Buscar tickets que necesitan escalado
                FOR ticket_record IN
                    SELECT t.id, t.assigned_to, t.created_by
                    FROM tickets t
                    WHERE t.escalate_at IS NOT NULL 
                    AND t.escalate_at <= NOW()
                    AND t.status IN ('abierto', 'en_progreso')
                    AND t.escalated_to IS NULL
                LOOP
                    -- Encontrar el admin asignado del usuario actual
                    SELECT aa.admin_id INTO admin_id
                    FROM admin_assignments aa
                    WHERE aa.assigned_user_id = ticket_record.assigned_to;
                    
                    -- Si no tiene admin asignado, escalar al AdminPrincipal
                    IF admin_id IS NULL THEN
                        SELECT u.id INTO admin_id
                        FROM users u
                        JOIN user_roles ur ON u.id = ur.user_id
                        JOIN roles r ON ur.role_id = r.id
                        WHERE r.name = 'administrador_principal'
                        LIMIT 1;
                    END IF;
                    
                    -- Actualizar el ticket
                    UPDATE tickets 
                    SET escalated_to = admin_id,
                        escalate_at = NOW() + INTERVAL '24 hours'
                    WHERE id = ticket_record.id;
                    
                    escalated_count := escalated_count + 1;
                    
                    -- Crear notificación de escalado
                    INSERT INTO notifications (user_id, ticket_id, type, title, message)
                    VALUES (
                        admin_id,
                        ticket_record.id,
                        'escalation',
                        'Ticket escalado',
                        'Se te ha escalado un ticket que requiere atención'
                    );
                END LOOP;
                
                RETURN escalated_count;
            END;
            $$ LANGUAGE plpgsql;
        `);
        console.log('✅ Función escalate_tickets creada');

        // 7. Crear índices para optimización
        await pool.query(`
            -- Índices para tickets
            CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
            CREATE INDEX IF NOT EXISTS idx_tickets_assigned_to ON tickets(assigned_to);
            CREATE INDEX IF NOT EXISTS idx_tickets_created_by ON tickets(created_by);
            CREATE INDEX IF NOT EXISTS idx_tickets_block_id ON tickets(block_id);
            CREATE INDEX IF NOT EXISTS idx_tickets_escalate_at ON tickets(escalate_at) WHERE escalate_at IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_tickets_last_activity ON tickets(last_activity DESC);

            -- Índices para mensajes
            CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id ON ticket_messages(ticket_id);
            CREATE INDEX IF NOT EXISTS idx_ticket_messages_sender_id ON ticket_messages(sender_id);
            CREATE INDEX IF NOT EXISTS idx_ticket_messages_created_at ON ticket_messages(created_at DESC);

            -- Índices para notificaciones
            CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
            CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
            CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

            -- Índices para participantes
            CREATE INDEX IF NOT EXISTS idx_ticket_participants_ticket_id ON ticket_participants(ticket_id);
            CREATE INDEX IF NOT EXISTS idx_ticket_participants_user_id ON ticket_participants(user_id);

            -- Índices para roles
            CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
            CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);
            CREATE INDEX IF NOT EXISTS idx_admin_assignments_admin_id ON admin_assignments(admin_id);
            CREATE INDEX IF NOT EXISTS idx_admin_assignments_assigned_user_id ON admin_assignments(assigned_user_id);
        `);
        console.log('✅ Índices de optimización creados');

        // 8. Crear vista para información completa de tickets
        await pool.query(`
            CREATE OR REPLACE VIEW ticket_complete_info AS
            SELECT 
                t.id,
                t.ticket_number,
                t.origin_type,
                t.title,
                t.status,
                t.priority,
                t.created_at,
                t.updated_at,
                t.last_activity,
                
                -- Información del creador
                creator.nickname as creator_nickname,
                creator.email as creator_email,
                
                -- Información del asignado
                assigned.nickname as assigned_nickname,
                assigned.email as assigned_email,
                
                -- Información del escalado
                escalated.nickname as escalated_nickname,
                
                -- Información de categoría
                tc.name as category_name,
                tc.priority as category_priority,
                
                -- Información del bloque (si aplica)
                b.name as block_name,
                b.creator_id as block_creator_id,
                block_creator.nickname as block_creator_nickname,
                
                -- Contadores
                COALESCE((SELECT COUNT(*) FROM ticket_messages tm WHERE tm.ticket_id = t.id), 0) as message_count,
                COALESCE((SELECT COUNT(*) FROM ticket_attachments ta WHERE ta.ticket_id = t.id), 0) as attachment_count,
                
                -- Último mensaje
                (SELECT tm.message_text FROM ticket_messages tm 
                 WHERE tm.ticket_id = t.id 
                 ORDER BY tm.created_at DESC LIMIT 1) as last_message,
                (SELECT tm.created_at FROM ticket_messages tm 
                 WHERE tm.ticket_id = t.id 
                 ORDER BY tm.created_at DESC LIMIT 1) as last_message_at,
                (SELECT u.nickname FROM ticket_messages tm 
                 JOIN users u ON tm.sender_id = u.id
                 WHERE tm.ticket_id = t.id 
                 ORDER BY tm.created_at DESC LIMIT 1) as last_message_by

            FROM tickets t
            LEFT JOIN users creator ON t.created_by = creator.id
            LEFT JOIN users assigned ON t.assigned_to = assigned.id
            LEFT JOIN users escalated ON t.escalated_to = escalated.id
            LEFT JOIN ticket_categories tc ON t.category_id = tc.id
            LEFT JOIN blocks b ON t.block_id = b.id
            LEFT JOIN users block_creator ON b.creator_id = block_creator.id;
        `);
        console.log('✅ Vista ticket_complete_info creada');

        // 9. Insertar más categorías de tickets
        await pool.query(`
            INSERT INTO ticket_categories (name, origin_type, priority, auto_escalate, description) VALUES
            ('Error con Luminarias/pagos', 'global', 'alta', true, 'Problemas con el sistema de luminarias o pagos'),
            ('Problema de acceso/login', 'global', 'alta', true, 'Dificultades para acceder al sistema'),
            ('Fallo en sistema de juego', 'global', 'alta', true, 'Errores durante las partidas'),
            ('Error en estadísticas globales', 'global', 'media', false, 'Problemas con estadísticas generales'),
            ('Solicitud de funcionalidad', 'global', 'baja', false, 'Sugerencias de nuevas funciones'),
            ('Problema con contenido de bloque específico', 'global', 'media', false, 'Redirección a formulario de bloque'),
            
            ('Falta información/contexto', 'block', 'media', false, 'Preguntas que necesitan más información'),
            ('Contenido inapropiado', 'block', 'alta', true, 'Contenido ofensivo o inapropiado'),
            ('Sugerencia de mejora', 'block', 'baja', false, 'Ideas para mejorar el contenido'),
            ('Solicitar nuevo tema', 'block', 'baja', false, 'Solicitud de nuevos temas en el bloque'),
            ('Problema con reto/torneo del bloque', 'block', 'media', false, 'Problemas específicos de competencia'),
            ('Error en estadísticas del bloque', 'block', 'media', false, 'Problemas con stats específicas del bloque'),
            ('Problema técnico general (no del bloque)', 'block', 'media', false, 'Redirección a soporte técnico global')
            ON CONFLICT (name, origin_type) DO NOTHING;
        `);
        console.log('✅ Categorías adicionales de tickets insertadas');

        // 10. Crear función para trigger de AdminPrincipal
        await pool.query(`
            CREATE OR REPLACE FUNCTION check_admin_principal_registration()
            RETURNS TRIGGER AS $$
            BEGIN
                -- Si el nickname es exactamente "AdminPrincipal"
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
                END IF;
                
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);

        await pool.query(`
            DROP TRIGGER IF EXISTS trigger_check_admin_principal ON users;
            CREATE TRIGGER trigger_check_admin_principal
                AFTER INSERT ON users
                FOR EACH ROW
                EXECUTE FUNCTION check_admin_principal_registration();
        `);
        console.log('✅ Trigger AdminPrincipal creado');

        // Verificación final
        const verification = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM roles) as roles_count,
                (SELECT COUNT(*) FROM ticket_categories) as categories_count,
                (SELECT COUNT(*) FROM information_schema.tables WHERE table_name LIKE '%ticket%') as ticket_tables,
                (SELECT COUNT(*) FROM information_schema.routines WHERE routine_name LIKE '%ticket%' OR routine_name LIKE '%escalate%') as functions_count
        `);
        
        const stats = verification.rows[0];
        console.log('\n📊 Verificación del esquema:');
        console.log(`✅ Roles: ${stats.roles_count}`);
        console.log(`✅ Categorías: ${stats.categories_count}`);
        console.log(`✅ Tablas de tickets: ${stats.ticket_tables}`);
        console.log(`✅ Funciones: ${stats.functions_count}`);

        console.log('\n🎉 ¡Esquema de comunicación completado exitosamente!');
        console.log('\n📋 Sistema listo para:');
        console.log('   ✅ Crear tickets desde formularios');
        console.log('   ✅ Chat en tiempo real');
        console.log('   ✅ Asignación automática');
        console.log('   ✅ Escalado automático');
        console.log('   ✅ Notificaciones push');

    } catch (error) {
        console.error('❌ Error completando esquema:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    completeSchema().catch(console.error);
}

module.exports = completeSchema;