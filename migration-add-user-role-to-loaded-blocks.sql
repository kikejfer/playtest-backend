-- Migration: Add user_role_id to user_loaded_blocks table
-- Purpose: Allow users with multiple roles to have separate loaded blocks per role
-- Date: 2025-01-16
-- Issue: Users with creator/teacher + player roles had mixed loaded blocks

-- Step 1: Add the user_role_id column (nullable initially)
ALTER TABLE user_loaded_blocks
ADD COLUMN user_role_id INTEGER REFERENCES user_roles(id) ON DELETE CASCADE;

COMMENT ON COLUMN user_loaded_blocks.user_role_id IS 'Rol con el que se cargó el bloque. Permite separar bloques de creador/profesor vs jugador';

-- Step 2: Populate user_role_id for existing records
-- Strategy: Assign the "jugador" role by default, or first available role if no jugador role exists
UPDATE user_loaded_blocks ulb
SET user_role_id = (
  SELECT ur.id
  FROM user_roles ur
  JOIN roles r ON ur.role_id = r.id
  WHERE ur.user_id = ulb.user_id
  ORDER BY
    CASE
      WHEN r.name = 'jugador' THEN 1
      WHEN r.name = 'creador' THEN 2
      WHEN r.name = 'profesor' THEN 3
      ELSE 4
    END
  LIMIT 1
)
WHERE user_role_id IS NULL;

-- Step 3: Make user_role_id NOT NULL after populating
ALTER TABLE user_loaded_blocks
ALTER COLUMN user_role_id SET NOT NULL;

-- Step 4: Drop old unique constraint (user_id, block_id)
ALTER TABLE user_loaded_blocks
DROP CONSTRAINT IF EXISTS user_loaded_blocks_user_id_block_id_key;

-- Step 5: Add new unique constraint including user_role_id
-- This allows the same user to load the same block with different roles
ALTER TABLE user_loaded_blocks
ADD CONSTRAINT user_loaded_blocks_unique
UNIQUE(user_id, block_id, user_role_id);

-- Step 6: Add index for performance
CREATE INDEX IF NOT EXISTS idx_user_loaded_blocks_user_role_id
ON user_loaded_blocks(user_role_id);

-- Verification query
SELECT
  'Migration completed successfully' as status,
  COUNT(*) as total_records,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(DISTINCT user_role_id) as unique_roles
FROM user_loaded_blocks;

-- Example: Check users with multiple roles and their loaded blocks
SELECT
  u.nickname,
  r.name as role_name,
  COUNT(ulb.id) as loaded_blocks_count
FROM users u
JOIN user_roles ur ON u.id = ur.user_id
JOIN roles r ON ur.role_id = r.id
LEFT JOIN user_loaded_blocks ulb ON ulb.user_id = u.id AND ulb.user_role_id = ur.id
GROUP BY u.nickname, r.name
HAVING COUNT(DISTINCT ur.id) > 1
ORDER BY u.nickname, r.name;
