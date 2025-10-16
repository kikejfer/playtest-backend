-- Migration: Add groups, assignments and block access control
-- Purpose: Implement dual block management (public creators + class teachers)
-- Date: 2025-01-16
-- Phase: 2 - Groups and Assignments System

-- ============================================================
-- STEP 1: Add new columns to blocks table
-- ============================================================

-- Add block_scope column to distinguish between public and class blocks
ALTER TABLE blocks
ADD COLUMN block_scope VARCHAR(20) DEFAULT 'PUBLICO';

COMMENT ON COLUMN blocks.block_scope IS 'Ámbito del bloque: PUBLICO (creadores) o CLASE (profesores)';

-- Add access_code for students to join blocks/groups
ALTER TABLE blocks
ADD COLUMN access_code VARCHAR(10);

COMMENT ON COLUMN blocks.access_code IS 'Código de acceso para que alumnos puedan cargar el bloque';

-- Add assigned_group_id to link blocks to groups (will add FK later)
ALTER TABLE blocks
ADD COLUMN assigned_group_id INTEGER;

COMMENT ON COLUMN blocks.assigned_group_id IS 'Grupo al que está asignado este bloque (solo para block_scope=CLASE)';

-- Add owner_user_id for direct user ownership reference
ALTER TABLE blocks
ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

COMMENT ON COLUMN blocks.owner_user_id IS 'Usuario propietario del bloque (simplifica consultas)';

-- Populate owner_user_id from existing user_role_id relationships
UPDATE blocks b
SET owner_user_id = ur.user_id
FROM user_roles ur
WHERE b.user_role_id = ur.id
  AND b.owner_user_id IS NULL;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_blocks_owner_user_id ON blocks(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_blocks_scope ON blocks(block_scope);

-- ============================================================
-- STEP 2: Create groups table
-- ============================================================

CREATE TABLE IF NOT EXISTS groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    access_code VARCHAR(10) UNIQUE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE groups IS 'Grupos de clase creados por profesores';
COMMENT ON COLUMN groups.name IS 'Nombre del grupo (ej: "Matemáticas 3º ESO")';
COMMENT ON COLUMN groups.access_code IS 'Código único para que alumnos se unan al grupo';
COMMENT ON COLUMN groups.created_by IS 'Profesor que creó el grupo';

-- Create index for access_code lookups
CREATE INDEX IF NOT EXISTS idx_groups_access_code ON groups(access_code);
CREATE INDEX IF NOT EXISTS idx_groups_created_by ON groups(created_by);

-- ============================================================
-- STEP 3: Create group_members table
-- ============================================================

CREATE TABLE IF NOT EXISTS group_members (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_in_group VARCHAR(20) DEFAULT 'ALUMNO',
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(group_id, user_id)
);

COMMENT ON TABLE group_members IS 'Miembros de cada grupo (alumnos y asistentes)';
COMMENT ON COLUMN group_members.role_in_group IS 'Rol dentro del grupo: ALUMNO, ASISTENTE, INVITADO';

-- Create indexes for queries
CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id);

-- ============================================================
-- STEP 4: Create block_assignments table
-- ============================================================

CREATE TABLE IF NOT EXISTS block_assignments (
    id SERIAL PRIMARY KEY,
    block_id INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
    assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    assigned_to_user INTEGER REFERENCES users(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    due_date TIMESTAMP,
    notes TEXT,
    CONSTRAINT check_assignment_target CHECK (group_id IS NOT NULL OR assigned_to_user IS NOT NULL)
);

COMMENT ON TABLE block_assignments IS 'Asignación de bloques a grupos o alumnos individuales';
COMMENT ON COLUMN block_assignments.assigned_by IS 'Profesor que hizo la asignación';
COMMENT ON COLUMN block_assignments.group_id IS 'Grupo al que se asignó (puede ser NULL si es asignación individual)';
COMMENT ON COLUMN block_assignments.assigned_to_user IS 'Usuario específico al que se asignó (puede ser NULL si es asignación grupal)';
COMMENT ON COLUMN block_assignments.due_date IS 'Fecha límite opcional para completar el bloque';

-- Create indexes for queries
CREATE INDEX IF NOT EXISTS idx_block_assignments_block_id ON block_assignments(block_id);
CREATE INDEX IF NOT EXISTS idx_block_assignments_group_id ON block_assignments(group_id);
CREATE INDEX IF NOT EXISTS idx_block_assignments_user_id ON block_assignments(assigned_to_user);
CREATE INDEX IF NOT EXISTS idx_block_assignments_assigned_by ON block_assignments(assigned_by);

-- ============================================================
-- STEP 5: Add foreign key from blocks to groups
-- ============================================================

ALTER TABLE blocks
ADD CONSTRAINT fk_blocks_assigned_group
FOREIGN KEY (assigned_group_id) REFERENCES groups(id) ON DELETE SET NULL;

-- ============================================================
-- STEP 6: Create helper views for common queries
-- ============================================================

-- View: Students with their assigned blocks
CREATE OR REPLACE VIEW student_assigned_blocks AS
SELECT
    u.id as student_id,
    u.nickname as student_nickname,
    b.id as block_id,
    b.name as block_name,
    b.description as block_description,
    ba.assigned_by,
    ba.assigned_at,
    ba.due_date,
    ba.notes,
    CASE
        WHEN ba.group_id IS NOT NULL THEN 'GROUP'
        ELSE 'INDIVIDUAL'
    END as assignment_type,
    g.name as group_name
FROM users u
LEFT JOIN block_assignments ba ON (
    ba.assigned_to_user = u.id OR
    ba.group_id IN (SELECT group_id FROM group_members WHERE user_id = u.id)
)
LEFT JOIN blocks b ON ba.block_id = b.id
LEFT JOIN groups g ON ba.group_id = g.id
WHERE b.id IS NOT NULL;

COMMENT ON VIEW student_assigned_blocks IS 'Vista de bloques asignados a cada alumno (directa o vía grupo)';

-- View: Teacher's groups with member counts
CREATE OR REPLACE VIEW teacher_groups_summary AS
SELECT
    g.id as group_id,
    g.name as group_name,
    g.description,
    g.access_code,
    g.created_by as teacher_id,
    u.nickname as teacher_nickname,
    COUNT(DISTINCT gm.user_id) as member_count,
    COUNT(DISTINCT ba.block_id) as assigned_blocks_count,
    g.created_at
FROM groups g
LEFT JOIN users u ON g.created_by = u.id
LEFT JOIN group_members gm ON g.id = gm.group_id
LEFT JOIN block_assignments ba ON g.id = ba.group_id
GROUP BY g.id, g.name, g.description, g.access_code, g.created_by, u.nickname, g.created_at;

COMMENT ON VIEW teacher_groups_summary IS 'Resumen de grupos de cada profesor con conteo de miembros y bloques';

-- ============================================================
-- STEP 7: Verification queries
-- ============================================================

-- Check new columns in blocks table
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'blocks'
    AND column_name IN ('block_scope', 'access_code', 'assigned_group_id', 'owner_user_id')
ORDER BY ordinal_position;

-- Check new tables exist
SELECT
    table_name,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
    AND table_name IN ('groups', 'group_members', 'block_assignments')
ORDER BY table_name;

-- Verify owner_user_id was populated
SELECT
    COUNT(*) as total_blocks,
    COUNT(owner_user_id) as blocks_with_owner,
    COUNT(*) - COUNT(owner_user_id) as blocks_without_owner
FROM blocks;

-- ============================================================
-- SUCCESS MESSAGE
-- ============================================================

SELECT 'Migration completed successfully! Groups and assignments system ready.' as status;
