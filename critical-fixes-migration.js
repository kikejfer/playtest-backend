const { Pool } = require('pg');

// Script de migración para resolver las inconsistencias críticas identificadas
class CriticalFixesMigration {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
    }

    async runCriticalFixes() {
        try {
            console.log('🔧 Iniciando corrección de inconsistencias críticas...');
            console.log('='.repeat(60));

            const client = await this.pool.connect();
            
            try {
                await client.query('BEGIN');

                // 1. Unificar sistema de roles
                console.log('\n1. 🔐 Unificando sistema de roles...');
                await this.unifyRoleSystem(client);

                // 2. Corregir loaded_blocks
                console.log('\n2. 📚 Corrigiendo campo loaded_blocks...');
                await this.fixLoadedBlocksField(client);

                // 3. Consolidar tablas de comunicación
                console.log('\n3. 💬 Consolidando sistema de comunicación...');
                await this.consolidateCommunicationSystem(client);

                // 4. Implementar sistema de Luminarias unificado
                console.log('\n4. 💰 Implementando sistema unificado de Luminarias...');
                await this.implementUnifiedLuminariasSystem(client);

                // 5. Crear foreign keys faltantes
                console.log('\n5. 🔗 Creando foreign keys faltantes...');
                await this.createMissingForeignKeys(client);

                // 6. Limpiar tablas duplicadas
                console.log('\n6. 🧹 Limpiando tablas duplicadas...');
                await this.cleanDuplicatedTables(client);

                // 7. Sincronizar schemas con implementación
                console.log('\n7. 🔄 Sincronizando schemas...');
                await this.synchronizeSchemas(client);

                await client.query('COMMIT');
                console.log('\n✅ Todas las correcciones críticas completadas exitosamente!');

                // Verificar integridad post-migración
                await this.verifyIntegrityPostMigration();

            } catch (error) {
                await client.query('ROLLBACK');
                console.error('\n❌ Error durante las correcciones:', error);
                throw error;
            } finally {
                client.release();
            }

        } catch (error) {
            console.error('\n💥 Error crítico en migración:', error);
            throw error;
        }
    }

    async unifyRoleSystem(client) {
        try {
            // Crear tabla unificada de roles
            await client.query(`
                CREATE TABLE IF NOT EXISTS unified_roles (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(50) NOT NULL UNIQUE,
                    display_name VARCHAR(100) NOT NULL,
                    description TEXT,
                    hierarchy_level INTEGER DEFAULT 0,
                    permissions JSONB DEFAULT '[]',
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Insertar roles unificados
            const unifiedRoles = [
                {
                    name: 'usuario',
                    display_name: 'Usuario',
                    description: 'Usuario regular del sistema',
                    hierarchy_level: 1,
                    permissions: ['play_games', 'view_blocks', 'create_profile']
                },
                {
                    name: 'creador_contenido',
                    display_name: 'Creador de Contenido',
                    description: 'Puede crear bloques y preguntas',
                    hierarchy_level: 2,
                    permissions: ['play_games', 'view_blocks', 'create_blocks', 'manage_own_content', 'earn_luminarias']
                },
                {
                    name: 'profesor',
                    display_name: 'Profesor',
                    description: 'Puede gestionar estudiantes y clases',
                    hierarchy_level: 2,
                    permissions: ['play_games', 'view_blocks', 'manage_students', 'create_classes', 'grade_assignments']
                },
                {
                    name: 'administrador_secundario',
                    display_name: 'Administrador Secundario',
                    description: 'Administrador con permisos limitados',
                    hierarchy_level: 3,
                    permissions: ['manage_users', 'moderate_content', 'view_analytics', 'manage_reports']
                },
                {
                    name: 'administrador_principal',
                    display_name: 'Administrador Principal',
                    description: 'Acceso completo al sistema',
                    hierarchy_level: 4,
                    permissions: ['*']
                },
                {
                    name: 'servicio_tecnico',
                    display_name: 'Servicio Técnico',
                    description: 'Soporte técnico y mantenimiento',
                    hierarchy_level: 3,
                    permissions: ['manage_tickets', 'system_diagnostics', 'view_logs', 'system_maintenance']
                }
            ];

            for (const role of unifiedRoles) {
                await client.query(`
                    INSERT INTO unified_roles (name, display_name, description, hierarchy_level, permissions)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (name) DO UPDATE SET
                        display_name = EXCLUDED.display_name,
                        description = EXCLUDED.description,
                        hierarchy_level = EXCLUDED.hierarchy_level,
                        permissions = EXCLUDED.permissions,
                        updated_at = CURRENT_TIMESTAMP
                `, [role.name, role.display_name, role.description, role.hierarchy_level, JSON.stringify(role.permissions)]);
            }

            // Crear tabla de relación usuario-rol unificada
            await client.query(`
                CREATE TABLE IF NOT EXISTS unified_user_roles (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    role_id INTEGER NOT NULL REFERENCES unified_roles(id) ON DELETE CASCADE,
                    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    assigned_by INTEGER REFERENCES users(id),
                    is_active BOOLEAN DEFAULT true,
                    expires_at TIMESTAMP WITH TIME ZONE,
                    UNIQUE(user_id, role_id)
                )
            `);

            // Migrar datos existentes de user_roles a unified_user_roles
            await client.query(`
                INSERT INTO unified_user_roles (user_id, role_id, assigned_at)
                SELECT 
                    ur.user_id,
                    uf.id,
                    ur.created_at
                FROM user_roles ur
                JOIN roles r ON ur.role_id = r.id
                JOIN unified_roles uf ON (
                    (r.name = 'profesor_creador' AND uf.name = 'creador_contenido') OR
                    (r.name = 'admin_principal' AND uf.name = 'administrador_principal') OR
                    (r.name = 'admin_secundario' AND uf.name = 'administrador_secundario') OR
                    (r.name = uf.name)
                )
                ON CONFLICT (user_id, role_id) DO NOTHING
            `);

            console.log('   ✓ Sistema de roles unificado');

        } catch (error) {
            console.error('   ❌ Error unificando roles:', error);
            throw error;
        }
    }

    async fixLoadedBlocksField(client) {
        try {
            // Verificar y corregir tipo de loaded_blocks
            const columnInfo = await client.query(`
                SELECT data_type, column_default
                FROM information_schema.columns 
                WHERE table_name = 'users' AND column_name = 'loaded_blocks'
            `);

            if (columnInfo.rows.length === 0) {
                // Agregar columna si no existe
                await client.query(`
                    ALTER TABLE users 
                    ADD COLUMN loaded_blocks JSONB DEFAULT '[]'
                `);
            } else if (columnInfo.rows[0].data_type !== 'jsonb') {
                // Convertir a JSONB si es de otro tipo
                await client.query(`
                    ALTER TABLE users 
                    ALTER COLUMN loaded_blocks TYPE JSONB USING 
                    CASE 
                        WHEN loaded_blocks::text = '' OR loaded_blocks IS NULL THEN '[]'::jsonb
                        ELSE loaded_blocks::jsonb
                    END
                `);
                
                await client.query(`
                    ALTER TABLE users 
                    ALTER COLUMN loaded_blocks SET DEFAULT '[]'::jsonb
                `);
            }

            // Asegurar que todos los valores existentes sean arrays JSON válidos
            await client.query(`
                UPDATE users 
                SET loaded_blocks = '[]'::jsonb 
                WHERE loaded_blocks IS NULL OR loaded_blocks::text = ''
            `);

            // Crear índice para mejor rendimiento
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_users_loaded_blocks_gin 
                ON users USING gin(loaded_blocks)
            `);

            console.log('   ✓ Campo loaded_blocks corregido y optimizado');

        } catch (error) {
            console.error('   ❌ Error corrigiendo loaded_blocks:', error);
            throw error;
        }
    }

    async consolidateCommunicationSystem(client) {
        try {
            // Crear tabla unificada de tickets/comunicación
            await client.query(`
                CREATE TABLE IF NOT EXISTS unified_tickets (
                    id SERIAL PRIMARY KEY,
                    ticket_number VARCHAR(20) UNIQUE NOT NULL,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    assigned_to INTEGER REFERENCES users(id),
                    category VARCHAR(50) NOT NULL,
                    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
                    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_user', 'resolved', 'closed')),
                    title VARCHAR(200) NOT NULL,
                    description TEXT NOT NULL,
                    resolution TEXT,
                    metadata JSONB DEFAULT '{}',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    resolved_at TIMESTAMP WITH TIME ZONE,
                    closed_at TIMESTAMP WITH TIME ZONE
                )
            `);

            // Crear tabla de mensajes para los tickets
            await client.query(`
                CREATE TABLE IF NOT EXISTS unified_ticket_messages (
                    id SERIAL PRIMARY KEY,
                    ticket_id INTEGER REFERENCES unified_tickets(id) ON DELETE CASCADE,
                    user_id INTEGER REFERENCES users(id),
                    message_type VARCHAR(20) DEFAULT 'message' CHECK (message_type IN ('message', 'note', 'status_change', 'assignment')),
                    content TEXT NOT NULL,
                    attachments JSONB DEFAULT '[]',
                    is_internal BOOLEAN DEFAULT false,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Migrar datos existentes de support_tickets si existe
            const supportTicketsExists = await client.query(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables 
                    WHERE table_name = 'support_tickets'
                )
            `);

            if (supportTicketsExists.rows[0].exists) {
                await client.query(`
                    INSERT INTO unified_tickets (
                        ticket_number, user_id, category, priority, status, title, description, created_at
                    )
                    SELECT 
                        COALESCE(ticket_number, 'MIGRATED-' || id),
                        user_id,
                        COALESCE(category, 'general'),
                        COALESCE(priority, 'medium'),
                        COALESCE(status, 'open'),
                        COALESCE(subject, title, 'Ticket Migrado'),
                        COALESCE(description, content, 'Contenido migrado'),
                        created_at
                    FROM support_tickets
                    WHERE NOT EXISTS (
                        SELECT 1 FROM unified_tickets ut 
                        WHERE ut.ticket_number = COALESCE(support_tickets.ticket_number, 'MIGRATED-' || support_tickets.id)
                    )
                `);
            }

            // Crear función para generar números de ticket únicos
            await client.query(`
                CREATE OR REPLACE FUNCTION generate_ticket_number()
                RETURNS TEXT AS $$
                DECLARE
                    new_number TEXT;
                    counter INTEGER := 1;
                BEGIN
                    LOOP
                        new_number := 'TK-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(counter::TEXT, 4, '0');
                        
                        IF NOT EXISTS (SELECT 1 FROM unified_tickets WHERE ticket_number = new_number) THEN
                            RETURN new_number;
                        END IF;
                        
                        counter := counter + 1;
                        
                        IF counter > 9999 THEN
                            new_number := 'TK-' || TO_CHAR(CURRENT_TIMESTAMP, 'YYYYMMDDHH24MISS') || '-' || LPAD((RANDOM() * 999)::INTEGER::TEXT, 3, '0');
                            RETURN new_number;
                        END IF;
                    END LOOP;
                END;
                $$ LANGUAGE plpgsql;
            `);

            // Trigger para auto-generar números de ticket
            await client.query(`
                CREATE OR REPLACE FUNCTION set_ticket_number()
                RETURNS TRIGGER AS $$
                BEGIN
                    IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' THEN
                        NEW.ticket_number := generate_ticket_number();
                    END IF;
                    RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;
            `);

            await client.query(`
                DROP TRIGGER IF EXISTS trigger_set_ticket_number ON unified_tickets;
                CREATE TRIGGER trigger_set_ticket_number
                    BEFORE INSERT ON unified_tickets
                    FOR EACH ROW
                    EXECUTE FUNCTION set_ticket_number();
            `);

            console.log('   ✓ Sistema de comunicación consolidado');

        } catch (error) {
            console.error('   ❌ Error consolidando comunicación:', error);
            throw error;
        }
    }

    async implementUnifiedLuminariasSystem(client) {
        try {
            // Crear tabla unificada de balance de Luminarias
            await client.query(`
                CREATE TABLE IF NOT EXISTS unified_user_luminarias (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
                    current_balance INTEGER DEFAULT 200 CHECK (current_balance >= 0),
                    total_earned INTEGER DEFAULT 200 CHECK (total_earned >= 0),
                    total_spent INTEGER DEFAULT 0 CHECK (total_spent >= 0),
                    lifetime_earnings INTEGER DEFAULT 200 CHECK (lifetime_earnings >= 0),
                    last_activity TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Crear tabla unificada de transacciones
            await client.query(`
                CREATE TABLE IF NOT EXISTS unified_luminarias_transactions (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('earn', 'spend', 'transfer_in', 'transfer_out', 'conversion', 'adjustment')),
                    amount INTEGER NOT NULL,
                    balance_after INTEGER NOT NULL,
                    description TEXT NOT NULL,
                    category VARCHAR(50) NOT NULL,
                    subcategory VARCHAR(50),
                    reference_type VARCHAR(50),
                    reference_id INTEGER,
                    metadata JSONB DEFAULT '{}',
                    from_user_id INTEGER REFERENCES users(id),
                    to_user_id INTEGER REFERENCES users(id),
                    processed_by INTEGER REFERENCES users(id),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Migrar datos existentes si la tabla users tiene luminarias
            const userLuminariasColumn = await client.query(`
                SELECT column_name FROM information_schema.columns 
                WHERE table_name = 'users' AND column_name = 'luminarias'
            `);

            if (userLuminariasColumn.rows.length > 0) {
                // Migrar balances existentes
                await client.query(`
                    INSERT INTO unified_user_luminarias (user_id, current_balance, total_earned, lifetime_earnings)
                    SELECT 
                        id,
                        COALESCE(luminarias, 200),
                        COALESCE(luminarias, 200),
                        COALESCE(luminarias, 200)
                    FROM users
                    ON CONFLICT (user_id) DO UPDATE SET
                        current_balance = EXCLUDED.current_balance,
                        total_earned = EXCLUDED.total_earned,
                        lifetime_earnings = EXCLUDED.lifetime_earnings,
                        updated_at = CURRENT_TIMESTAMP
                `);
            } else {
                // Crear registros iniciales para todos los usuarios
                await client.query(`
                    INSERT INTO unified_user_luminarias (user_id)
                    SELECT id FROM users
                    ON CONFLICT (user_id) DO NOTHING
                `);
            }

            // Crear función para procesar transacciones de Luminarias
            await client.query(`
                CREATE OR REPLACE FUNCTION process_unified_luminarias_transaction(
                    p_user_id INTEGER,
                    p_transaction_type VARCHAR(20),
                    p_amount INTEGER,
                    p_description TEXT,
                    p_category VARCHAR(50),
                    p_subcategory VARCHAR(50) DEFAULT NULL,
                    p_reference_type VARCHAR(50) DEFAULT NULL,
                    p_reference_id INTEGER DEFAULT NULL,
                    p_metadata JSONB DEFAULT '{}',
                    p_from_user_id INTEGER DEFAULT NULL,
                    p_to_user_id INTEGER DEFAULT NULL
                ) RETURNS INTEGER AS $$
                DECLARE
                    current_balance INTEGER;
                    new_balance INTEGER;
                    transaction_id INTEGER;
                BEGIN
                    -- Obtener balance actual
                    SELECT current_balance INTO current_balance 
                    FROM unified_user_luminarias 
                    WHERE user_id = p_user_id
                    FOR UPDATE;
                    
                    IF current_balance IS NULL THEN
                        RAISE EXCEPTION 'Usuario % no tiene registro de Luminarias', p_user_id;
                    END IF;
                    
                    -- Calcular nuevo balance
                    IF p_transaction_type IN ('earn', 'transfer_in') THEN
                        new_balance := current_balance + p_amount;
                    ELSIF p_transaction_type IN ('spend', 'transfer_out', 'conversion') THEN
                        new_balance := current_balance - p_amount;
                        IF new_balance < 0 THEN
                            RAISE EXCEPTION 'Saldo insuficiente. Balance actual: %, Cantidad requerida: %', current_balance, p_amount;
                        END IF;
                    ELSIF p_transaction_type = 'adjustment' THEN
                        new_balance := current_balance + p_amount; -- p_amount puede ser negativo
                    ELSE
                        RAISE EXCEPTION 'Tipo de transacción inválido: %', p_transaction_type;
                    END IF;
                    
                    -- Crear transacción
                    INSERT INTO unified_luminarias_transactions (
                        user_id, transaction_type, amount, balance_after, description,
                        category, subcategory, reference_type, reference_id, metadata,
                        from_user_id, to_user_id
                    ) VALUES (
                        p_user_id, p_transaction_type, p_amount, new_balance, p_description,
                        p_category, p_subcategory, p_reference_type, p_reference_id, p_metadata,
                        p_from_user_id, p_to_user_id
                    ) RETURNING id INTO transaction_id;
                    
                    -- Actualizar balance
                    UPDATE unified_user_luminarias SET
                        current_balance = new_balance,
                        total_earned = CASE WHEN p_transaction_type IN ('earn', 'transfer_in') THEN total_earned + p_amount ELSE total_earned END,
                        total_spent = CASE WHEN p_transaction_type IN ('spend', 'transfer_out', 'conversion') THEN total_spent + p_amount ELSE total_spent END,
                        lifetime_earnings = CASE WHEN p_transaction_type IN ('earn', 'transfer_in') THEN lifetime_earnings + p_amount ELSE lifetime_earnings END,
                        last_activity = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = p_user_id;
                    
                    RETURN transaction_id;
                END;
                $$ LANGUAGE plpgsql;
            `);

            // Crear índices para rendimiento
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_unified_luminarias_transactions_user_id ON unified_luminarias_transactions(user_id, created_at);
                CREATE INDEX IF NOT EXISTS idx_unified_luminarias_transactions_type ON unified_luminarias_transactions(transaction_type, created_at);
                CREATE INDEX IF NOT EXISTS idx_unified_luminarias_transactions_reference ON unified_luminarias_transactions(reference_type, reference_id);
            `);

            console.log('   ✓ Sistema unificado de Luminarias implementado');

        } catch (error) {
            console.error('   ❌ Error implementando Luminarias:', error);
            throw error;
        }
    }

    async createMissingForeignKeys(client) {
        try {
            // Lista de foreign keys faltantes identificados
            const foreignKeys = [
                {
                    table: 'blocks',
                    column: 'creator_id',
                    references: 'users(id)',
                    onDelete: 'CASCADE'
                },
                {
                    table: 'questions',
                    column: 'block_id',
                    references: 'blocks(id)',
                    onDelete: 'CASCADE'
                },
                {
                    table: 'user_answers',
                    column: 'user_id',
                    references: 'users(id)',
                    onDelete: 'CASCADE'
                },
                {
                    table: 'user_answers',
                    column: 'question_id',
                    references: 'questions(id)',
                    onDelete: 'CASCADE'
                },
                {
                    table: 'games',
                    column: 'created_by',
                    references: 'users(id)',
                    onDelete: 'CASCADE'
                },
                {
                    table: 'games',
                    column: 'block_id',
                    references: 'blocks(id)',
                    onDelete: 'CASCADE'
                }
            ];

            for (const fk of foreignKeys) {
                try {
                    // Verificar si la foreign key ya existe
                    const existingFk = await client.query(`
                        SELECT constraint_name 
                        FROM information_schema.table_constraints 
                        WHERE table_name = $1 AND constraint_type = 'FOREIGN KEY'
                        AND constraint_name LIKE '%' || $2 || '%'
                    `, [fk.table, fk.column]);

                    if (existingFk.rows.length === 0) {
                        const constraintName = `fk_${fk.table}_${fk.column}`;
                        await client.query(`
                            ALTER TABLE ${fk.table} 
                            ADD CONSTRAINT ${constraintName} 
                            FOREIGN KEY (${fk.column}) REFERENCES ${fk.references} ON DELETE ${fk.onDelete}
                        `);
                        console.log(`   ✓ Foreign key creada: ${fk.table}.${fk.column} -> ${fk.references}`);
                    }
                } catch (error) {
                    console.warn(`   ⚠️  No se pudo crear FK ${fk.table}.${fk.column}:`, error.message);
                }
            }

        } catch (error) {
            console.error('   ❌ Error creando foreign keys:', error);
            throw error;
        }
    }

    async cleanDuplicatedTables(client) {
        try {
            // Lista de tablas duplicadas o innecesarias
            const tablesToAnalyze = [
                'support_tickets', // Duplica unified_tickets
                'roles', // Reemplazado por unified_roles
                'user_roles', // Reemplazado por unified_user_roles
                'luminarias_transactions', // Reemplazado por unified_luminarias_transactions
                'user_luminarias' // Reemplazado por unified_user_luminarias
            ];

            for (const table of tablesToAnalyze) {
                const tableExists = await client.query(`
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.tables 
                        WHERE table_name = $1
                    )
                `, [table]);

                if (tableExists.rows[0].exists) {
                    // En lugar de eliminar, renombrar para backup
                    await client.query(`
                        ALTER TABLE ${table} RENAME TO ${table}_backup_${Date.now()}
                    `);
                    console.log(`   ✓ Tabla ${table} respaldada y renombrada`);
                }
            }

        } catch (error) {
            console.error('   ❌ Error limpiando tablas duplicadas:', error);
            // No lanzar error aquí para no bloquear la migración
        }
    }

    async synchronizeSchemas(client) {
        try {
            // Crear vistas de compatibilidad para mantener APIs existentes
            await client.query(`
                CREATE OR REPLACE VIEW roles AS
                SELECT 
                    id,
                    name,
                    display_name as description,
                    hierarchy_level,
                    is_active,
                    created_at,
                    updated_at
                FROM unified_roles;
            `);

            await client.query(`
                CREATE OR REPLACE VIEW user_roles AS
                SELECT 
                    uur.id,
                    uur.user_id,
                    uur.role_id,
                    ur.name as role_name,
                    uur.assigned_at as created_at,
                    uur.is_active
                FROM unified_user_roles uur
                JOIN unified_roles ur ON uur.role_id = ur.id
                WHERE uur.is_active = true;
            `);

            await client.query(`
                CREATE OR REPLACE VIEW user_luminarias AS
                SELECT 
                    user_id,
                    current_balance,
                    total_earned,
                    total_spent,
                    lifetime_earnings,
                    last_activity,
                    created_at,
                    updated_at
                FROM unified_user_luminarias;
            `);

            await client.query(`
                CREATE OR REPLACE VIEW luminarias_transactions AS
                SELECT 
                    id,
                    user_id,
                    transaction_type,
                    amount,
                    balance_after,
                    description,
                    category,
                    subcategory,
                    reference_type,
                    reference_id,
                    metadata,
                    from_user_id,
                    to_user_id,
                    created_at
                FROM unified_luminarias_transactions;
            `);

            // Crear función de compatibilidad para process_luminarias_transaction
            await client.query(`
                CREATE OR REPLACE FUNCTION process_luminarias_transaction(
                    p_user_id INTEGER,
                    p_transaction_type VARCHAR(20),
                    p_amount INTEGER,
                    p_user_role VARCHAR(50),
                    p_category VARCHAR(50),
                    p_subcategory VARCHAR(50),
                    p_action_type VARCHAR(50),
                    p_description TEXT,
                    p_reference_id INTEGER DEFAULT NULL,
                    p_reference_type VARCHAR(50) DEFAULT NULL,
                    p_metadata JSONB DEFAULT '{}'
                ) RETURNS INTEGER AS $$
                BEGIN
                    RETURN process_unified_luminarias_transaction(
                        p_user_id,
                        p_transaction_type,
                        p_amount,
                        p_description,
                        p_category,
                        p_subcategory,
                        p_reference_type,
                        p_reference_id,
                        p_metadata
                    );
                END;
                $$ LANGUAGE plpgsql;
            `);

            console.log('   ✓ Schemas sincronizados con vistas de compatibilidad');

        } catch (error) {
            console.error('   ❌ Error sincronizando schemas:', error);
            throw error;
        }
    }

    async verifyIntegrityPostMigration() {
        try {
            console.log('\n📋 Verificando integridad post-migración...');

            const client = await this.pool.connect();

            try {
                // Verificar que las tablas principales existen
                const requiredTables = [
                    'unified_roles',
                    'unified_user_roles', 
                    'unified_user_luminarias',
                    'unified_luminarias_transactions',
                    'unified_tickets'
                ];

                for (const table of requiredTables) {
                    const exists = await client.query(`
                        SELECT EXISTS (
                            SELECT 1 FROM information_schema.tables 
                            WHERE table_name = $1
                        )
                    `, [table]);

                    if (!exists.rows[0].exists) {
                        throw new Error(`Tabla requerida ${table} no existe`);
                    }
                }

                // Verificar datos migrados
                const userCount = await client.query('SELECT COUNT(*) FROM users');
                const rolesCount = await client.query('SELECT COUNT(*) FROM unified_roles');
                const luminariasCount = await client.query('SELECT COUNT(*) FROM unified_user_luminarias');

                console.log(`   ✓ ${userCount.rows[0].count} usuarios en el sistema`);
                console.log(`   ✓ ${rolesCount.rows[0].count} roles unificados`);
                console.log(`   ✓ ${luminariasCount.rows[0].count} registros de Luminarias`);

                // Verificar que las vistas funcionan
                const viewTest = await client.query('SELECT COUNT(*) FROM roles');
                console.log(`   ✓ Vista de compatibilidad 'roles' funcional: ${viewTest.rows[0].count} registros`);

                console.log('\n🎉 Verificación de integridad completada exitosamente');

            } finally {
                client.release();
            }

        } catch (error) {
            console.error('\n❌ Error en verificación de integridad:', error);
            throw error;
        }
    }

    async close() {
        await this.pool.end();
    }
}

// Auto-ejecutar si se ejecuta directamente
if (require.main === module) {
    const migration = new CriticalFixesMigration();
    
    async function run() {
        try {
            await migration.runCriticalFixes();
            console.log('\n🚀 ¡Migración de correcciones críticas completada exitosamente!');
            console.log('\n📌 Próximos pasos:');
            console.log('   1. Actualizar rutas del backend para usar tablas unificadas');
            console.log('   2. Probar todas las funcionalidades críticas');
            console.log('   3. Ejecutar tests de integración');
            
        } catch (error) {
            console.error('\n💥 Error en migración de correcciones críticas:', error);
            process.exit(1);
        } finally {
            await migration.close();
            process.exit(0);
        }
    }
    
    run();
}

module.exports = CriticalFixesMigration;