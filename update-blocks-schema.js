const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function updateBlocksSchema() {
    try {
        console.log('🔄 Actualizando esquema de bloques con metadatos expandidos...');
        
        // 1. Crear tabla de áreas de conocimiento
        await pool.query(`
            CREATE TABLE IF NOT EXISTS knowledge_areas (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) UNIQUE NOT NULL,
                description TEXT,
                parent_id INTEGER REFERENCES knowledge_areas(id),
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Tabla knowledge_areas creada');

        // 2. Insertar áreas de conocimiento predefinidas
        await pool.query(`
            INSERT INTO knowledge_areas (name, description) VALUES
            ('Ciencias Exactas', 'Matemáticas, Física, Química'),
            ('Ciencias Naturales', 'Biología, Geología, Medicina'),
            ('Ciencias Sociales', 'Historia, Geografía, Sociología'),
            ('Humanidades', 'Filosofía, Literatura, Arte'),
            ('Tecnología', 'Informática, Ingeniería, Telecomunicaciones'),
            ('Idiomas', 'Lenguas extranjeras y comunicación'),
            ('Derecho', 'Jurisprudencia y legislación'),
            ('Economía', 'Finanzas, Administración, Contabilidad'),
            ('Educación', 'Pedagogía y métodos educativos'),
            ('Salud', 'Medicina, Enfermería, Farmacia'),
            ('Deportes', 'Educación física y deportes'),
            ('Arte y Diseño', 'Bellas artes, diseño gráfico, música'),
            ('Oposiciones', 'Preparación para oposiciones públicas'),
            ('Certificaciones', 'Certificaciones profesionales y técnicas'),
            ('Otros', 'Otras áreas no clasificadas')
            ON CONFLICT (name) DO NOTHING;
        `);
        console.log('✅ Áreas de conocimiento insertadas');

        // 3. Crear tabla de tags
        await pool.query(`
            CREATE TABLE IF NOT EXISTS block_tags (
                id SERIAL PRIMARY KEY,
                name VARCHAR(50) UNIQUE NOT NULL,
                usage_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Tabla block_tags creada');

        // 4. Crear tabla de relación bloques-tags
        await pool.query(`
            CREATE TABLE IF NOT EXISTS block_tag_relations (
                id SERIAL PRIMARY KEY,
                block_id INTEGER REFERENCES blocks(id) ON DELETE CASCADE,
                tag_id INTEGER REFERENCES block_tags(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(block_id, tag_id)
            );
        `);
        console.log('✅ Tabla block_tag_relations creada');

        // 5. Crear tabla de historial de estados
        await pool.query(`
            CREATE TABLE IF NOT EXISTS block_state_history (
                id SERIAL PRIMARY KEY,
                block_id INTEGER REFERENCES blocks(id) ON DELETE CASCADE,
                previous_state VARCHAR(20),
                new_state VARCHAR(20) NOT NULL,
                changed_by INTEGER REFERENCES users(id),
                change_reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Tabla block_state_history creada');

        // 6. Agregar nuevos campos a la tabla blocks
        const newColumns = [
            { name: 'detailed_description', type: 'TEXT' },
            { name: 'block_type', type: 'VARCHAR(30)', default: "'Otro'" },
            { name: 'education_level', type: 'VARCHAR(30)', default: "'Universidad'" },
            { name: 'scope', type: 'VARCHAR(30)', default: "'Local'" },
            { name: 'knowledge_area_id', type: 'INTEGER REFERENCES knowledge_areas(id)' },
            { name: 'difficulty_level', type: 'VARCHAR(20)', default: "'Intermedio'" },
            { name: 'content_language', type: 'VARCHAR(10)', default: "'es'" },
            { name: 'author_observations', type: 'TEXT' },
            { name: 'block_state', type: 'VARCHAR(20)', default: "'private'" },
            { name: 'publication_date', type: 'TIMESTAMP' },
            { name: 'last_state_change', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
            { name: 'view_count', type: 'INTEGER', default: '0' },
            { name: 'download_count', type: 'INTEGER', default: '0' },
            { name: 'average_rating', type: 'DECIMAL(3,2)', default: '0.00' },
            { name: 'rating_count', type: 'INTEGER', default: '0' }
        ];

        for (const column of newColumns) {
            try {
                await pool.query(`
                    ALTER TABLE blocks 
                    ADD COLUMN IF NOT EXISTS ${column.name} ${column.type} 
                    ${column.default ? `DEFAULT ${column.default}` : ''};
                `);
                console.log(`✅ Columna ${column.name} agregada`);
            } catch (error) {
                console.log(`⚠️  Columna ${column.name} ya existe o error: ${error.message}`);
            }
        }

        // 7. Actualizar block_state basado en is_public existente
        await pool.query(`
            UPDATE blocks SET block_state = CASE 
                WHEN is_public = true THEN 'public'
                ELSE 'private'
            END WHERE block_state IS NULL OR block_state = 'private';
        `);
        console.log('✅ Estados de bloques actualizados');

        // 8. Crear función para contadores de tags
        await pool.query(`
            CREATE OR REPLACE FUNCTION update_tag_usage_count()
            RETURNS TRIGGER AS $$
            BEGIN
                IF TG_OP = 'INSERT' THEN
                    UPDATE block_tags 
                    SET usage_count = usage_count + 1 
                    WHERE id = NEW.tag_id;
                    RETURN NEW;
                ELSIF TG_OP = 'DELETE' THEN
                    UPDATE block_tags 
                    SET usage_count = GREATEST(usage_count - 1, 0) 
                    WHERE id = OLD.tag_id;
                    RETURN OLD;
                END IF;
                RETURN NULL;
            END;
            $$ LANGUAGE plpgsql;
        `);
        console.log('✅ Función update_tag_usage_count creada');

        // 9. Crear trigger para tags
        await pool.query(`
            DROP TRIGGER IF EXISTS trigger_update_tag_usage ON block_tag_relations;
            CREATE TRIGGER trigger_update_tag_usage
                AFTER INSERT OR DELETE ON block_tag_relations
                FOR EACH ROW
                EXECUTE FUNCTION update_tag_usage_count();
        `);
        console.log('✅ Trigger de tags creado');

        // 10. Crear función para logging de cambios de estado
        await pool.query(`
            CREATE OR REPLACE FUNCTION log_block_state_change()
            RETURNS TRIGGER AS $$
            BEGIN
                IF OLD.block_state IS DISTINCT FROM NEW.block_state THEN
                    INSERT INTO block_state_history (block_id, previous_state, new_state, changed_by)
                    VALUES (NEW.id, OLD.block_state, NEW.block_state, NEW.creator_id);
                    
                    IF NEW.block_state = 'public' AND OLD.block_state != 'public' THEN
                        NEW.publication_date = NOW();
                    END IF;
                    
                    NEW.last_state_change = NOW();
                END IF;
                
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);
        console.log('✅ Función log_block_state_change creada');

        // 11. Crear trigger para cambios de estado
        await pool.query(`
            DROP TRIGGER IF EXISTS trigger_log_state_change ON blocks;
            CREATE TRIGGER trigger_log_state_change
                BEFORE UPDATE ON blocks
                FOR EACH ROW
                EXECUTE FUNCTION log_block_state_change();
        `);
        console.log('✅ Trigger de cambios de estado creado');

        // 12. Crear función de validación
        await pool.query(`
            CREATE OR REPLACE FUNCTION validate_block_for_publication(p_block_id INTEGER)
            RETURNS TABLE (
                is_valid BOOLEAN,
                missing_fields TEXT[],
                warnings TEXT[]
            ) AS $$
            DECLARE
                block_data RECORD;
                missing_list TEXT[] := ARRAY[]::TEXT[];
                warning_list TEXT[] := ARRAY[]::TEXT[];
                question_count INTEGER;
                tag_count INTEGER;
            BEGIN
                SELECT b.*, ka.name as knowledge_area_name
                INTO block_data
                FROM blocks b
                LEFT JOIN knowledge_areas ka ON b.knowledge_area_id = ka.id
                WHERE b.id = p_block_id;
                
                IF NOT FOUND THEN
                    RETURN QUERY SELECT false, ARRAY['Bloque no encontrado'], ARRAY[]::TEXT[];
                    RETURN;
                END IF;
                
                -- Contar preguntas
                SELECT COUNT(*) INTO question_count
                FROM questions WHERE block_id = p_block_id;
                
                -- Contar tags
                SELECT COUNT(*) INTO tag_count
                FROM block_tag_relations WHERE block_id = p_block_id;
                
                -- Validar campos obligatorios
                IF block_data.name IS NULL OR length(trim(block_data.name)) = 0 THEN
                    missing_list := array_append(missing_list, 'Nombre del bloque');
                END IF;
                
                IF block_data.detailed_description IS NULL OR length(trim(block_data.detailed_description)) < 50 THEN
                    missing_list := array_append(missing_list, 'Descripción detallada (mínimo 50 caracteres)');
                END IF;
                
                IF question_count = 0 THEN
                    missing_list := array_append(missing_list, 'Al menos una pregunta');
                END IF;
                
                IF block_data.knowledge_area_id IS NULL THEN
                    missing_list := array_append(missing_list, 'Área de conocimiento');
                END IF;
                
                -- Generar advertencias
                IF question_count < 10 THEN
                    warning_list := array_append(warning_list, 'Pocos contenidos: menos de 10 preguntas');
                END IF;
                
                IF tag_count < 3 THEN
                    warning_list := array_append(warning_list, 'Recomendado: añadir al menos 3 tags para mejor descubrimiento');
                END IF;
                
                IF block_data.author_observations IS NULL OR length(trim(block_data.author_observations)) < 100 THEN
                    warning_list := array_append(warning_list, 'Recomendado: añadir observaciones del autor para guiar a los usuarios');
                END IF;
                
                RETURN QUERY SELECT 
                    (array_length(missing_list, 1) IS NULL OR array_length(missing_list, 1) = 0),
                    missing_list,
                    warning_list;
            END;
            $$ LANGUAGE plpgsql;
        `);
        console.log('✅ Función de validación creada');

        // 13. Crear índices de optimización
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_blocks_state ON blocks(block_state);',
            'CREATE INDEX IF NOT EXISTS idx_blocks_type ON blocks(block_type);',
            'CREATE INDEX IF NOT EXISTS idx_blocks_education_level ON blocks(education_level);',
            'CREATE INDEX IF NOT EXISTS idx_blocks_scope ON blocks(scope);',
            'CREATE INDEX IF NOT EXISTS idx_blocks_difficulty ON blocks(difficulty_level);',
            'CREATE INDEX IF NOT EXISTS idx_blocks_knowledge_area ON blocks(knowledge_area_id);',
            'CREATE INDEX IF NOT EXISTS idx_blocks_language ON blocks(content_language);',
            'CREATE INDEX IF NOT EXISTS idx_blocks_rating ON blocks(average_rating);',
            'CREATE INDEX IF NOT EXISTS idx_blocks_publication_date ON blocks(publication_date DESC);',
            'CREATE INDEX IF NOT EXISTS idx_block_tags_usage ON block_tags(usage_count DESC);',
            'CREATE INDEX IF NOT EXISTS idx_block_tag_relations_block ON block_tag_relations(block_id);',
            'CREATE INDEX IF NOT EXISTS idx_block_tag_relations_tag ON block_tag_relations(tag_id);',
            'CREATE INDEX IF NOT EXISTS idx_block_state_history_block ON block_state_history(block_id, created_at DESC);'
        ];

        for (const index of indexes) {
            await pool.query(index);
        }
        console.log('✅ Índices de optimización creados');

        // Verificación final
        const verification = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM knowledge_areas) as areas_count,
                (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'blocks' AND column_name LIKE '%block_%') as new_columns,
                (SELECT COUNT(*) FROM information_schema.tables WHERE table_name LIKE '%block_%') as block_tables
        `);
        
        const stats = verification.rows[0];
        console.log('\n📊 Verificación del esquema expandido:');
        console.log(`✅ Áreas de conocimiento: ${stats.areas_count}`);
        console.log(`✅ Nuevas columnas en blocks: ${stats.new_columns}`);
        console.log(`✅ Tablas relacionadas con blocks: ${stats.block_tables}`);

        console.log('\n🎉 ¡Esquema de bloques expandido completado exitosamente!');
        console.log('\n📋 Nuevas funcionalidades disponibles:');
        console.log('   ✅ Metadatos expandidos para bloques');
        console.log('   ✅ Sistema de estados (privado/público/restringido/archivado)');
        console.log('   ✅ Área de observaciones del autor');
        console.log('   ✅ Sistema de tags y categorización');
        console.log('   ✅ Validación para publicación');
        console.log('   ✅ Historial de cambios de estado');

    } catch (error) {
        console.error('❌ Error actualizando esquema de bloques:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    updateBlocksSchema().catch(console.error);
}

module.exports = updateBlocksSchema;