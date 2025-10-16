const express = require('express');
const { pool } = require('../database/connection');
const { authenticateToken } = require('../middleware/auth');
const ImageSearchService = require('../image-search');

const router = express.Router();

// Initialize image search service
const imageSearch = new ImageSearchService();

// Get all blocks with questions (temporary - will be 'loaded blocks' after migration)
router.get('/', authenticateToken, async (req, res) => {
  try {
    console.log('🔍 /blocks endpoint called for user:', req.user.id);

    const blocksResult = await pool.query(`
      SELECT DISTINCT b.id, b.name, b.description, b.observaciones, b.user_role_id, b.is_public, b.created_at, b.image_url,
        b.block_scope,
        u.nickname as creator_nickname,
        u.id as creator_id,
        r.name as created_with_role,
        COALESCE(ba.total_questions, 0) as question_count
      FROM blocks b
      LEFT JOIN user_roles ur ON b.user_role_id = ur.id
      LEFT JOIN users u ON ur.user_id = u.id
      LEFT JOIN roles r ON ur.role_id = r.id
      LEFT JOIN block_answers ba ON b.id = ba.block_id
      LEFT JOIN block_assignments bla ON b.id = bla.block_id
      LEFT JOIN group_members gm ON bla.group_id = gm.group_id
      WHERE (
        -- Show public blocks (PUBLICO scope or NULL)
        (b.block_scope = 'PUBLICO' OR b.block_scope IS NULL)
        OR
        -- Show class blocks (CLASE scope) if user has access
        (b.block_scope = 'CLASE' AND (
          b.owner_user_id = $1  -- User owns the block
          OR bla.assigned_to_user = $1  -- Block assigned directly to user
          OR gm.user_id = $1  -- User is member of a group that has this block assigned
        ))
      )
      ORDER BY b.created_at DESC
    `, [req.user.id]);
    
    console.log('🔍 Found blocks:', blocksResult.rows.length);

    const blocks = [];
    
    for (const block of blocksResult.rows) {
      // Get questions for this block
      const questionsResult = await pool.query(`
        SELECT q.id, q.text_question, q.topic, q.block_id, q.difficulty, q.explanation,
          json_agg(
            json_build_object(
              'id', a.id,
              'answerText', a.answer_text,
              'isCorrect', a.is_correct
            )
          ) as answers
        FROM questions q
        LEFT JOIN answers a ON q.id = a.question_id
        WHERE q.block_id = $1
        GROUP BY q.id, q.text_question, q.topic, q.block_id, q.difficulty, q.explanation
        ORDER BY q.created_at
      `, [block.id]);

      const questions = questionsResult.rows.map(q => ({
        id: q.id,
        textoPregunta: q.text_question,
        tema: q.topic,
        bloqueId: q.block_id,
        difficulty: q.difficulty,
        explicacionRespuesta: q.explanation || null,
        respuestas: q.answers.filter(a => a.id !== null).map(a => ({
          textoRespuesta: a.answerText,
          esCorrecta: a.isCorrect
        }))
      }));

      blocks.push({
        id: block.id,
        name: block.name,
        nombreCorto: block.name, // For frontend compatibility
        nombreLargo: block.description || block.name,
        description: block.description,
        observaciones: block.observaciones,
        creatorId: block.creator_id,
        creatorNickname: block.creator_nickname,
        isPublic: block.is_public,
        questionCount: parseInt(block.question_count),
        imageUrl: block.image_url,
        questions: questions
      });
    }

    console.log('🔍 Returning', blocks.length, 'total blocks');
    res.json(blocks);
  } catch (error) {
    console.error('❌ Error fetching blocks:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message,
      endpoint: '/blocks'
    });
  }
});

// Get available blocks (all public blocks from all users)
router.get('/available', authenticateToken, async (req, res) => {
  try {
    console.log('🔍 /blocks/available endpoint called');
    console.log('🔍 User ID:', req.user.id);
    
    // Simple query first to test database connection
    const testQuery = await pool.query('SELECT COUNT(*) as total FROM blocks WHERE is_public = true');
    console.log('🔍 Total public blocks:', testQuery.rows[0]?.total || 0);
    
    const blocksResult = await pool.query(`
      SELECT DISTINCT b.id, b.name, b.description, b.observaciones, b.user_role_id, b.is_public, b.created_at, b.image_url,
        b.tipo_id, b.nivel_id, b.estado_id, b.block_scope,
        u.nickname as creator_nickname,
        u.id as creator_id,
        r.name as created_with_role,
        COALESCE(ba.total_questions, 0) as question_count,
        bt.name as tipo_name,
        bl.name as nivel_name,
        bs.name as estado_name
      FROM blocks b
      LEFT JOIN user_roles ur ON b.user_role_id = ur.id
      LEFT JOIN users u ON ur.user_id = u.id
      LEFT JOIN roles r ON ur.role_id = r.id
      LEFT JOIN block_answers ba ON b.id = ba.block_id
      LEFT JOIN block_types bt ON b.tipo_id = bt.id
      LEFT JOIN block_levels bl ON b.nivel_id = bl.id
      LEFT JOIN block_states bs ON b.estado_id = bs.id
      LEFT JOIN block_assignments bla ON b.id = bla.block_id
      LEFT JOIN group_members gm ON bla.group_id = gm.group_id
      WHERE (
        -- Show public blocks (PUBLICO scope or NULL)
        (b.block_scope = 'PUBLICO' OR b.block_scope IS NULL)
        OR
        -- Show class blocks (CLASE scope) if user has access
        (b.block_scope = 'CLASE' AND (
          b.owner_user_id = $1  -- User owns the block
          OR bla.assigned_to_user = $1  -- Block assigned directly to user
          OR gm.user_id = $1  -- User is member of a group that has this block assigned
        ))
      )
      ORDER BY b.created_at DESC
    `, [req.user.id]);

    console.log('🔍 Found blocks:', blocksResult.rows.length);

    const blocks = [];
    
    for (const block of blocksResult.rows) {
      // Get questions for this block (simplified)
      const questionsResult = await pool.query(`
        SELECT q.id, q.text_question, q.topic, q.block_id, q.difficulty, q.explanation
        FROM questions q
        WHERE q.block_id = $1
        ORDER BY q.created_at
        LIMIT 50
      `, [block.id]);

      console.log(`🔍 Block ${block.id} has ${questionsResult.rows.length} questions`);

      // Get unique topics count from topic_answers table
      let topicCount = 0;
      try {
        console.log(`🔍 DEBUG: Querying topic_answers for block_id ${block.id}`);
        const topicsResult = await pool.query(`
          SELECT COUNT(*) as topic_count
          FROM topic_answers
          WHERE block_id = $1
        `, [block.id]);
        console.log(`🔍 DEBUG: topic_answers query result:`, topicsResult.rows);
        topicCount = parseInt(topicsResult.rows[0]?.topic_count) || 0;
        console.log(`🔍 Block ${block.id} has ${topicCount} unique topics`);
      } catch (error) {
        console.log(`⚠️ Error getting topics for block ${block.id}:`, error.message);
      }

      // Get users count who have loaded this block from user_loaded_blocks table
      let userCount = 0;
      try {
        console.log(`🔍 DEBUG: Querying user_loaded_blocks for block_id ${block.id}`);
        const usersResult = await pool.query(`
          SELECT COUNT(*) as user_count
          FROM user_loaded_blocks
          WHERE block_id = $1
        `, [block.id]);
        console.log(`🔍 DEBUG: user_loaded_blocks query result:`, usersResult.rows);
        userCount = parseInt(usersResult.rows[0]?.user_count) || 0;
        console.log(`🔍 Block ${block.id} has been loaded by ${userCount} users`);
      } catch (error) {
        console.log(`⚠️ Error getting users for block ${block.id}:`, error.message);
      }

      // Get answers for questions (simplified)
      const questions = [];
      for (const q of questionsResult.rows) {
        const answersResult = await pool.query(`
          SELECT a.id, a.answer_text, a.is_correct
          FROM answers a
          WHERE a.question_id = $1
        `, [q.id]);

        questions.push({
          id: q.id,
          textoPregunta: q.text_question,
          tema: q.topic,
          bloqueId: q.block_id,
          difficulty: q.difficulty,
          explicacionRespuesta: q.explanation || null,
          respuestas: answersResult.rows.map(a => ({
            textoRespuesta: a.answer_text,
            esCorrecta: a.is_correct
          }))
        });
      }

      blocks.push({
        id: block.id,
        name: block.name,
        nombreCorto: block.name,
        nombreLargo: block.description || block.name,
        description: block.description,
        creatorId: block.creator_id,
        creatorNickname: block.creator_nickname || 'Unknown',
        isPublic: block.is_public,
        questionCount: parseInt(block.question_count) || 0,
        stats: {
          totalTopics: topicCount,
          totalUsers: userCount,
          totalQuestions: parseInt(block.question_count) || 0
        },
        imageUrl: block.image_url,

        // Metadata IDs for filtering
        tipo_id: block.tipo_id,
        nivel_id: block.nivel_id,
        estado_id: block.estado_id,
        
        // Metadata names
        metadata: {
          tipo: block.tipo_name || 'Sin especificar',
          nivel: block.nivel_name || 'Sin especificar',
          estado: block.estado_name || 'Sin especificar'
        },
        
        questions: questions
      });
    }

    console.log('🔍 Returning', blocks.length, 'blocks');
    res.json(blocks);
  } catch (error) {
    console.error('❌ Error fetching available blocks:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message,
      endpoint: '/blocks/available'
    });
  }
});

// Get loaded blocks (blocks that the user has loaded for gaming)
router.get('/loaded', authenticateToken, async (req, res) => {
  try {
    console.log('🔍 /blocks/loaded endpoint called');
    console.log('🔍 User ID:', req.user.id);
    
    // Get user profile to see which blocks are loaded
    const userResult = await pool.query(
      'SELECT loaded_blocks FROM user_profiles WHERE user_id = $1',
      [req.user.id]
    );
    
    const loadedBlockIds = userResult.rows[0]?.loaded_blocks || [];
    console.log('🔍 Loaded block IDs:', loadedBlockIds);
    
    if (loadedBlockIds.length === 0) {
      return res.json([]);
    }
    
    // Get the actual blocks that are loaded (with access control)
    const placeholders = loadedBlockIds.map((_, index) => `$${index + 2}`).join(',');
    const blocksResult = await pool.query(`
      SELECT DISTINCT b.id, b.name, b.description, b.observaciones, b.user_role_id, b.is_public, b.created_at, b.image_url,
        b.block_scope,
        u.nickname as creator_nickname,
        u.id as creator_id,
        r.name as created_with_role,
        COALESCE(ba.total_questions, 0) as question_count
      FROM blocks b
      LEFT JOIN user_roles ur ON b.user_role_id = ur.id
      LEFT JOIN users u ON ur.user_id = u.id
      LEFT JOIN roles r ON ur.role_id = r.id
      LEFT JOIN block_answers ba ON b.id = ba.block_id
      LEFT JOIN block_assignments bla ON b.id = bla.block_id
      LEFT JOIN group_members gm ON bla.group_id = gm.group_id
      WHERE b.id = ANY($1)
        AND (
          -- Show public blocks (PUBLICO scope or NULL)
          (b.block_scope = 'PUBLICO' OR b.block_scope IS NULL)
          OR
          -- Show class blocks (CLASE scope) if user has access
          (b.block_scope = 'CLASE' AND (
            b.owner_user_id = $2  -- User owns the block
            OR bla.assigned_to_user = $2  -- Block assigned directly to user
            OR gm.user_id = $2  -- User is member of a group that has this block assigned
          ))
        )
      ORDER BY b.created_at DESC
    `, [loadedBlockIds, req.user.id]);

    console.log('🔍 Found loaded blocks:', blocksResult.rows.length);

    const blocks = [];
    
    for (const block of blocksResult.rows) {
      // Get questions for this block (simplified)
      const questionsResult = await pool.query(`
        SELECT q.id, q.text_question, q.topic, q.block_id, q.difficulty, q.explanation
        FROM questions q
        WHERE q.block_id = $1
        ORDER BY q.created_at
        LIMIT 50
      `, [block.id]);

      console.log(`🔍 Loaded block ${block.id} has ${questionsResult.rows.length} questions`);

      // Get unique topics count from topic_answers table
      let topicCount = 0;
      try {
        const topicsResult = await pool.query(`
          SELECT COUNT(*) as topic_count
          FROM topic_answers
          WHERE block_id = $1
        `, [block.id]);
        topicCount = parseInt(topicsResult.rows[0]?.topic_count) || 0;
        console.log(`🔍 Loaded block ${block.id} has ${topicCount} unique topics`);
      } catch (error) {
        console.log(`⚠️ Error getting topics for loaded block ${block.id}:`, error.message);
      }

      // Get students/users count who have loaded this block from user_loaded_blocks table
      let studentCount = 0;
      try {
        const studentsResult = await pool.query(`
          SELECT COUNT(*) as student_count
          FROM user_loaded_blocks
          WHERE block_id = $1
        `, [block.id]);
        studentCount = parseInt(studentsResult.rows[0]?.student_count) || 0;
        console.log(`🔍 Loaded block ${block.id} has ${studentCount} students who have loaded it`);
      } catch (error) {
        console.log(`⚠️ Error getting students for loaded block ${block.id}:`, error.message);
      }

      // Get loaded date for this user and block
      let loadedAt = null;
      try {
        const loadedDateResult = await pool.query(`
          SELECT loaded_at
          FROM user_loaded_blocks
          WHERE user_id = $1 AND block_id = $2
        `, [req.user.id, block.id]);
        loadedAt = loadedDateResult.rows[0]?.loaded_at || null;
        console.log(`🔍 Block ${block.id} was loaded by user ${req.user.id} at:`, loadedAt);
      } catch (error) {
        console.log(`⚠️ Error getting load date for block ${block.id}:`, error.message);
      }

      // Get answers for questions (simplified)
      const questions = [];
      for (const q of questionsResult.rows) {
        const answersResult = await pool.query(`
          SELECT a.id, a.answer_text, a.is_correct
          FROM answers a
          WHERE a.question_id = $1
        `, [q.id]);

        questions.push({
          id: q.id,
          textoPregunta: q.text_question,
          tema: q.topic,
          bloqueId: q.block_id,
          difficulty: q.difficulty,
          explicacionRespuesta: q.explanation || null,
          respuestas: answersResult.rows.map(a => ({
            textoRespuesta: a.answer_text,
            esCorrecta: a.is_correct
          }))
        });
      }

      blocks.push({
        id: block.id,
        name: block.name,
        nombreCorto: block.name,
        nombreLargo: block.description || block.name,
        description: block.description,
        creatorId: block.creator_id,
        creatorNickname: block.creator_nickname || 'Unknown',
        isPublic: block.is_public,
        questionCount: parseInt(block.question_count) || 0,
        stats: {
          totalTopics: topicCount,
          totalUsers: studentCount,
          totalQuestions: parseInt(block.question_count) || 0,
          loadedAt: loadedAt
        },
        imageUrl: block.image_url,
        questions: questions
      });
    }

    console.log('🔍 Returning', blocks.length, 'loaded blocks');
    res.json(blocks);
  } catch (error) {
    console.error('❌ Error fetching loaded blocks:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message,
      endpoint: '/blocks/loaded'
    });
  }
});

// Get loaded blocks with detailed stats (enhanced version for PJG)
router.get('/loaded-stats', authenticateToken, async (req, res) => {
  try {
    console.log('🔍 /blocks/loaded-stats endpoint called');
    console.log('🔍 User ID:', req.user.id);
    console.log('🔍 Headers:', req.headers);

    // Get the current active role from header
    const currentRole = req.headers['x-current-role'];
    if (!currentRole) {
      return res.status(400).json({ error: 'Current role header is required' });
    }

    // Map panel codes from frontend to database role names
    const panelToRoleMapping = {
      'PCC': 'creador',
      'PPF': 'profesor',
      'PJG': 'jugador',
      'PAP': 'administrador_principal',
      'PAS': 'administrador_secundario'
    };

    // Convert panel code to database role name if needed
    const actualRoleName = panelToRoleMapping[currentRole] || currentRole;
    console.log('🎭 Role from header:', currentRole, '-> Database role:', actualRoleName);

    // Get user's specific user_role record for the current active role
    const userRoleResult = await pool.query(`
      SELECT ur.id as user_role_id, r.name as role_name
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = $1 AND r.name = $2
      LIMIT 1
    `, [req.user.id, actualRoleName]);

    if (userRoleResult.rows.length === 0) {
      return res.status(403).json({ error: 'User does not have the specified role' });
    }

    const userRoleId = userRoleResult.rows[0].user_role_id;
    console.log('👤 User role ID for query:', userRoleId, 'Role:', userRoleResult.rows[0].role_name);

    // Get loaded blocks for this specific role from user_loaded_blocks table
    const loadedBlocksResult = await pool.query(`
      SELECT block_id
      FROM user_loaded_blocks
      WHERE user_id = $1 AND user_role_id = $2
    `, [req.user.id, userRoleId]);

    const loadedBlockIds = loadedBlocksResult.rows.map(row => row.block_id);
    console.log('🔍 Loaded block IDs for role', actualRoleName, ':', loadedBlockIds);

    if (loadedBlockIds.length === 0) {
      console.log('✅ No loaded blocks for this role, returning empty array');
      return res.json([]);
    }
    
    const placeholders = loadedBlockIds.map((_, index) => `$${index + 1}`).join(',');

    const blocksResult = await pool.query(`
      SELECT b.id, b.name, b.description, b.observaciones, b.user_role_id, b.is_public, b.created_at, b.image_url,
        u.nickname as creator_nickname,
        u.id as creator_id,
        r.name as created_with_role,
        COALESCE(ba.total_questions, 0) as question_count
      FROM blocks b
      LEFT JOIN user_roles ur ON b.user_role_id = ur.id
      LEFT JOIN users u ON ur.user_id = u.id
      LEFT JOIN roles r ON ur.role_id = r.id
      LEFT JOIN block_answers ba ON b.id = ba.block_id
      WHERE b.id IN (${placeholders})
      ORDER BY b.created_at DESC
    `, loadedBlockIds);

    console.log('🔍 Found blocks from query:', blocksResult.rows.length);

    const blocks = [];
    
    for (const block of blocksResult.rows) {
      console.log(`🔍 Processing block ${block.id}: ${block.name}`);
      
      console.log(`🔍 Block ${block.id} has ${block.question_count} questions`);

      // Calculate statistics efficiently:

      // 1. Total questions from block_answers table
      const totalQuestions = parseInt(block.question_count) || 0;

      // 2. Total unique topics using topic_answers query
      let totalTopics = 0;
      try {
        console.log(`🔍 DEBUG: Querying topic_answers for block_id ${block.id}`);
        const topicsResult = await pool.query(`
          SELECT COUNT(*) as topic_count FROM topic_answers WHERE block_id = $1
        `, [block.id]);
        console.log(`🔍 DEBUG: topic_answers query result:`, topicsResult.rows);
        totalTopics = parseInt(topicsResult.rows[0]?.topic_count) || 0;
        console.log(`🔍 Loaded block ${block.id} has ${totalTopics} unique topics`);
      } catch (error) {
        console.log(`❌ Error calculating topics for loaded block ${block.id}:`, error.message);
      }

      // 3. Total users who have this block loaded (fallback to user_loaded_blocks if exists)
      let totalUsers = 0;
      try {
        const userCountResult = await pool.query(
          'SELECT COUNT(*) as user_count FROM user_loaded_blocks WHERE block_id = $1',
          [block.id]
        );
        totalUsers = parseInt(userCountResult.rows[0]?.user_count) || 0;
      } catch (e) {
        // Table might not exist, estimate from user_profiles.loaded_blocks
        console.log(`🔍 user_loaded_blocks table not available, estimating...`);
        try {
          const profileCountResult = await pool.query(
            'SELECT COUNT(*) as user_count FROM user_profiles WHERE loaded_blocks @> $1::jsonb',
            [JSON.stringify([block.id])]
          );
          totalUsers = parseInt(profileCountResult.rows[0]?.user_count) || 0;
        } catch (profileError) {
          console.log(`🔍 Could not count users for block ${block.id}:`, profileError.message);
          totalUsers = 1; // At least current user has it loaded
        }
      }

      // 4. Load date (when current user loaded this block)
      let loadedAt = new Date().toISOString();
      try {
        const loadDateResult = await pool.query(
          'SELECT loaded_at FROM user_loaded_blocks WHERE user_id = $1 AND block_id = $2',
          [req.user.id, block.id]
        );
        loadedAt = loadDateResult.rows[0]?.loaded_at || loadedAt;
      } catch (e) {
        // Table might not exist, use current timestamp
        console.log(`🔍 user_loaded_blocks table not available for load date`);
      }

      console.log(`🔍 Block ${block.id} stats: ${totalQuestions} questions, ${totalTopics} topics, ${totalUsers} users`);
      
      blocks.push({
        id: block.id,
        name: block.name,
        nombreCorto: block.name,
        nombreLargo: block.description || block.name,
        description: block.description,
        creatorId: block.creator_id,
        creatorNickname: block.creator_nickname || 'Unknown',
        isPublic: block.is_public,
        questionCount: parseInt(block.question_count) || 0,
        stats: {
          totalQuestions: totalQuestions,
          totalTopics: totalTopics,
          totalUsers: totalUsers,
          loadedAt: loadedAt
        },
        imageUrl: block.image_url
      });
    }
    
    console.log('✅ Returning', blocks.length, 'loaded blocks with stats from database tables');
    res.json(blocks);
  } catch (error) {
    console.error('❌ Error fetching loaded blocks with stats:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message,
      endpoint: '/blocks/loaded-stats',
      userId: req.user?.id
    });
  }
});

// Get created blocks (blocks created by the current user)
router.get('/created', authenticateToken, async (req, res) => {
  try {
    console.log('🔍 /blocks/created endpoint called');
    console.log('🔍 User ID:', req.user.id);
    console.log('🔍 User object:', req.user);
    console.log('🔍 Headers:', req.headers);
    console.log('🔍 Database URL:', process.env.DATABASE_URL?.substring(0, 50) + '...');
    
    // Simple query first to test database connection
    const testQuery = await pool.query('SELECT COUNT(*) as total FROM blocks b LEFT JOIN user_roles ur ON b.user_role_id = ur.id WHERE ur.user_id = $1', [req.user.id]);
    console.log('🔍 Total created blocks for user:', testQuery.rows[0]?.total || 0);
    
    const blocksResult = await pool.query(`
      SELECT b.id, b.name, b.description, b.observaciones, b.user_role_id, b.is_public, b.created_at, b.image_url,
        u.nickname as creator_nickname,
        u.id as creator_id,
        r.name as created_with_role,
        COALESCE(ba.total_questions, 0) as question_count
      FROM blocks b
      LEFT JOIN user_roles ur ON b.user_role_id = ur.id
      LEFT JOIN users u ON ur.user_id = u.id
      LEFT JOIN roles r ON ur.role_id = r.id
      LEFT JOIN block_answers ba ON b.id = ba.block_id
      WHERE ur.user_id = $1
      ORDER BY b.created_at DESC
    `, [req.user.id]);

    console.log('🔍 Found created blocks:', blocksResult.rows.length);

    const blocks = [];
    
    for (const block of blocksResult.rows) {
      // Get questions for this block (simplified)
      const questionsResult = await pool.query(`
        SELECT q.id, q.text_question, q.topic, q.block_id, q.difficulty, q.explanation
        FROM questions q
        WHERE q.block_id = $1
        ORDER BY q.created_at
        LIMIT 50
      `, [block.id]);

      console.log(`🔍 Created block ${block.id} has ${questionsResult.rows.length} questions`);

      // Get answers for questions (simplified)
      const questions = [];
      for (const q of questionsResult.rows) {
        const answersResult = await pool.query(`
          SELECT a.id, a.answer_text, a.is_correct
          FROM answers a
          WHERE a.question_id = $1
        `, [q.id]);

        questions.push({
          id: q.id,
          textoPregunta: q.text_question,
          tema: q.topic,
          bloqueId: q.block_id,
          difficulty: q.difficulty,
          explicacionRespuesta: q.explanation || null,
          respuestas: answersResult.rows.map(a => ({
            textoRespuesta: a.answer_text,
            esCorrecta: a.is_correct
          }))
        });
      }

      blocks.push({
        id: block.id,
        name: block.name,
        nombreCorto: block.name,
        nombreLargo: block.description || block.name,
        description: block.description,
        creatorId: block.creator_id,
        creatorNickname: block.creator_nickname || 'Unknown',
        isPublic: block.is_public,
        questionCount: parseInt(block.question_count) || 0,
        imageUrl: block.image_url,
        questions: questions
      });
    }

    console.log('🔍 Returning', blocks.length, 'created blocks');
    res.json(blocks);
  } catch (error) {
    console.error('❌ Error fetching created blocks:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message,
      endpoint: '/blocks/created'
    });
  }
});

// Load a block (add to user's loaded blocks) - UPDATED TO USE user_loaded_blocks with user_role_id
router.post('/:id/load', authenticateToken, async (req, res) => {
  try {
    const blockId = parseInt(req.params.id);

    // Check if block exists and is accessible with new access control
    const blockResult = await pool.query(`
      SELECT DISTINCT b.id, ur.user_id as creator_id, b.is_public, b.block_scope
      FROM blocks b
      LEFT JOIN user_roles ur ON b.user_role_id = ur.id
      LEFT JOIN block_assignments bla ON b.id = bla.block_id
      LEFT JOIN group_members gm ON bla.group_id = gm.group_id
      WHERE b.id = $1
        AND (
          -- Show public blocks (PUBLICO scope or NULL)
          (b.block_scope = 'PUBLICO' OR b.block_scope IS NULL)
          OR
          -- Show class blocks (CLASE scope) if user has access
          (b.block_scope = 'CLASE' AND (
            b.owner_user_id = $2  -- User owns the block
            OR bla.assigned_to_user = $2  -- Block assigned directly to user
            OR gm.user_id = $2  -- User is member of a group that has this block assigned
          ))
        )
    `, [blockId, req.user.id]);

    if (blockResult.rows.length === 0) {
      return res.status(404).json({ error: 'Block not found or not accessible' });
    }

    // Get current active role from header
    const currentRole = req.headers['x-current-role'];
    if (!currentRole) {
      return res.status(400).json({ error: 'Current role header is required' });
    }

    // Map panel codes from frontend to database role names
    const panelToRoleMapping = {
      'PCC': 'creador',
      'PPF': 'profesor',
      'PJG': 'jugador',
      'PAP': 'administrador_principal',
      'PAS': 'administrador_secundario'
    };

    const actualRoleName = panelToRoleMapping[currentRole] || currentRole;
    console.log('🎭 Loading block with role:', currentRole, '-> Database role:', actualRoleName);

    // Get user's specific user_role record for the current active role
    const userRoleResult = await pool.query(`
      SELECT ur.id as user_role_id
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = $1 AND r.name = $2
      LIMIT 1
    `, [req.user.id, actualRoleName]);

    if (userRoleResult.rows.length === 0) {
      return res.status(403).json({ error: 'User does not have the specified role' });
    }

    const userRoleId = userRoleResult.rows[0].user_role_id;
    console.log('👤 User role ID for loading block:', userRoleId);

    // Insert into user_loaded_blocks with user_role_id (will fail if already exists due to UNIQUE constraint)
    try {
      await pool.query(`
        INSERT INTO user_loaded_blocks (user_id, block_id, user_role_id, loaded_at)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id, block_id, user_role_id) DO NOTHING
      `, [req.user.id, blockId, userRoleId]);

      console.log(`✅ Block ${blockId} loaded for user ${req.user.id} with role ID ${userRoleId}`);
    } catch (dbError) {
      console.error('❌ Error inserting into user_loaded_blocks:', dbError.message);
      return res.status(500).json({ error: 'Failed to load block' });
    }

    // ALSO update user_profiles.loaded_blocks for backwards compatibility
    try {
      const userResult = await pool.query(
        'SELECT loaded_blocks FROM user_profiles WHERE user_id = $1',
        [req.user.id]
      );

      let loadedBlocks = userResult.rows[0]?.loaded_blocks || [];

      if (!Array.isArray(loadedBlocks)) {
        loadedBlocks = [];
      }

      if (!loadedBlocks.includes(blockId)) {
        loadedBlocks.push(blockId);

        await pool.query(`
          INSERT INTO user_profiles (user_id, loaded_blocks, stats, answer_history, preferences)
          VALUES ($1, $2::jsonb, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb)
          ON CONFLICT (user_id)
          DO UPDATE SET loaded_blocks = $2::jsonb, updated_at = CURRENT_TIMESTAMP
        `, [req.user.id, JSON.stringify(loadedBlocks)]);
      }
    } catch (profileError) {
      console.warn('⚠️ Could not update user_profiles, but block was loaded in user_loaded_blocks');
    }

    res.json({ message: 'Block loaded successfully' });
  } catch (error) {
    console.error('Error loading block:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Unload a block (remove from user's loaded blocks) - UPDATED TO USE user_loaded_blocks with user_role_id
router.delete('/:id/load', authenticateToken, async (req, res) => {
  try {
    const blockId = parseInt(req.params.id);

    // Get current active role from header
    const currentRole = req.headers['x-current-role'];
    if (!currentRole) {
      return res.status(400).json({ error: 'Current role header is required' });
    }

    // Map panel codes from frontend to database role names
    const panelToRoleMapping = {
      'PCC': 'creador',
      'PPF': 'profesor',
      'PJG': 'jugador',
      'PAP': 'administrador_principal',
      'PAS': 'administrador_secundario'
    };

    const actualRoleName = panelToRoleMapping[currentRole] || currentRole;
    console.log('🎭 Unloading block with role:', currentRole, '-> Database role:', actualRoleName);

    // Get user's specific user_role record for the current active role
    const userRoleResult = await pool.query(`
      SELECT ur.id as user_role_id
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = $1 AND r.name = $2
      LIMIT 1
    `, [req.user.id, actualRoleName]);

    if (userRoleResult.rows.length === 0) {
      return res.status(403).json({ error: 'User does not have the specified role' });
    }

    const userRoleId = userRoleResult.rows[0].user_role_id;
    console.log('👤 User role ID for unloading block:', userRoleId);

    // Delete from user_loaded_blocks with user_role_id
    const deleteResult = await pool.query(`
      DELETE FROM user_loaded_blocks
      WHERE user_id = $1 AND block_id = $2 AND user_role_id = $3
    `, [req.user.id, blockId, userRoleId]);

    if (deleteResult.rowCount === 0) {
      console.log(`⚠️ Block ${blockId} was not loaded for user ${req.user.id} with role ID ${userRoleId}`);
    } else {
      console.log(`✅ Block ${blockId} unloaded for user ${req.user.id} with role ID ${userRoleId}`);
    }

    // ALSO remove from user_profiles.loaded_blocks for backwards compatibility
    // Only if no other role has this block loaded
    try {
      const otherRoleLoaded = await pool.query(`
        SELECT COUNT(*) as count
        FROM user_loaded_blocks
        WHERE user_id = $1 AND block_id = $2 AND user_role_id != $3
      `, [req.user.id, blockId, userRoleId]);

      if (parseInt(otherRoleLoaded.rows[0].count) === 0) {
        // No other role has this block, remove from user_profiles too
        const userResult = await pool.query(
          'SELECT loaded_blocks FROM user_profiles WHERE user_id = $1',
          [req.user.id]
        );

        let loadedBlocks = userResult.rows[0]?.loaded_blocks || [];

        if (!Array.isArray(loadedBlocks)) {
          loadedBlocks = [];
        }

        loadedBlocks = loadedBlocks.filter(id => id !== blockId);

        await pool.query(`
          INSERT INTO user_profiles (user_id, loaded_blocks, stats, answer_history, preferences)
          VALUES ($1, $2::jsonb, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb)
          ON CONFLICT (user_id)
          DO UPDATE SET loaded_blocks = $2::jsonb, updated_at = CURRENT_TIMESTAMP
        `, [req.user.id, JSON.stringify(loadedBlocks)]);

        console.log('✅ Also removed from user_profiles.loaded_blocks');
      } else {
        console.log('ℹ️  Block still loaded by another role, keeping in user_profiles.loaded_blocks');
      }
    } catch (profileError) {
      console.warn('⚠️ Could not update user_profiles, but block was unloaded from user_loaded_blocks');
    }

    res.json({ message: 'Block unloaded successfully' });
  } catch (error) {
    console.error('Error unloading block:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Alternative load endpoint for compatibility
router.post('/:id/load-block', authenticateToken, async (req, res) => {
  try {
    const blockId = parseInt(req.params.id);

    // Check if block exists and is accessible with new access control
    const blockResult = await pool.query(`
      SELECT DISTINCT b.id, ur.user_id as creator_id, b.is_public, b.block_scope
      FROM blocks b
      LEFT JOIN user_roles ur ON b.user_role_id = ur.id
      LEFT JOIN block_assignments bla ON b.id = bla.block_id
      LEFT JOIN group_members gm ON bla.group_id = gm.group_id
      WHERE b.id = $1
        AND (
          -- Show public blocks (PUBLICO scope or NULL)
          (b.block_scope = 'PUBLICO' OR b.block_scope IS NULL)
          OR
          -- Show class blocks (CLASE scope) if user has access
          (b.block_scope = 'CLASE' AND (
            b.owner_user_id = $2  -- User owns the block
            OR bla.assigned_to_user = $2  -- Block assigned directly to user
            OR gm.user_id = $2  -- User is member of a group that has this block assigned
          ))
        )
    `, [blockId, req.user.id]);

    if (blockResult.rows.length === 0) {
      return res.status(404).json({ error: 'Block not found or not accessible' });
    }

    // Get current loaded blocks
    const userResult = await pool.query(
      'SELECT loaded_blocks FROM user_profiles WHERE user_id = $1',
      [req.user.id]
    );
    
    let loadedBlocks = userResult.rows[0]?.loaded_blocks || [];
    
    // Ensure it's an array (sometimes stored as string/other format)
    if (!Array.isArray(loadedBlocks)) {
      console.warn('⚠️ loaded_blocks is not an array, converting:', loadedBlocks);
      loadedBlocks = [];
    }

    // Check if already loaded
    if (loadedBlocks.includes(blockId)) {
      return res.status(409).json({ error: 'Block already loaded' });
    }

    // Add block to loaded blocks
    loadedBlocks.push(blockId);
    
    // Update user profile
    await pool.query(`
      INSERT INTO user_profiles (user_id, loaded_blocks, stats, answer_history, preferences) 
      VALUES ($1, $2::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb) 
      ON CONFLICT (user_id) 
      DO UPDATE SET loaded_blocks = $2::jsonb, updated_at = CURRENT_TIMESTAMP
    `, [req.user.id, JSON.stringify(loadedBlocks)]);

    res.json({ message: 'Block loaded successfully' });
  } catch (error) {
    console.error('Error loading block via load-block endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Alternative unload endpoint for compatibility
router.delete('/:id/unload', authenticateToken, async (req, res) => {
  try {
    const blockId = parseInt(req.params.id);
    
    // Get current loaded blocks
    const userResult = await pool.query(
      'SELECT loaded_blocks FROM user_profiles WHERE user_id = $1',
      [req.user.id]
    );
    
    let loadedBlocks = userResult.rows[0]?.loaded_blocks || [];
    
    // Ensure it's an array
    if (!Array.isArray(loadedBlocks)) {
      console.warn('⚠️ loaded_blocks is not an array, converting:', loadedBlocks);
      loadedBlocks = [];
    }

    // Remove block from loaded blocks
    loadedBlocks = loadedBlocks.filter(id => parseInt(id) !== blockId);
    
    // Update user profile
    await pool.query(`
      INSERT INTO user_profiles (user_id, loaded_blocks, stats, answer_history, preferences) 
      VALUES ($1, $2::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb) 
      ON CONFLICT (user_id) 
      DO UPDATE SET loaded_blocks = $2::jsonb, updated_at = CURRENT_TIMESTAMP
    `, [req.user.id, JSON.stringify(loadedBlocks)]);

    res.json({ message: 'Block unloaded successfully' });
  } catch (error) {
    console.error('Error unloading block via unload endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new block
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, description, observaciones, isPublic = true } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Block name is required' });
    }

    console.log('🔧 Creating block:', { name, description, observaciones, isPublic, userId: req.user.id });

    // Get user's current active user_role record for block creation
    let userRoleRecordId = null;
    try {
      const currentRole = req.headers['x-current-role'];
      if (!currentRole) {
        return res.status(400).json({ error: 'Current role header is required' });
      }

      // Map panel codes from frontend to database role names
      const panelToRoleMapping = {
        'PCC': 'creador',
        'PPF': 'profesor',
        'PJG': 'jugador',
        'PAP': 'administrador_principal',
        'PAS': 'administrador_secundario'
      };
      
      // Convert panel code to database role name if needed
      const actualRoleName = panelToRoleMapping[currentRole] || currentRole;
      console.log('🎭 Role from header:', currentRole, '-> Database role:', actualRoleName);

      const userRoleResult = await pool.query(`
        SELECT ur.id, r.name as role_name
        FROM user_roles ur 
        JOIN roles r ON ur.role_id = r.id 
        WHERE ur.user_id = $1 AND r.name = $2
        LIMIT 1
      `, [req.user.id, actualRoleName]);
      
      if (userRoleResult.rows.length > 0) {
        userRoleRecordId = userRoleResult.rows[0].id;
        console.log('👤 User role record for block creation:', userRoleRecordId, 'Role:', userRoleResult.rows[0].role_name);
      }
    } catch (roleError) {
      console.warn('⚠️ Could not determine user role, block creation will fail:', roleError.message);
    }
    
    if (!userRoleRecordId) {
      return res.status(400).json({ error: 'User must have at least one role to create blocks' });
    }

    // Search for related image
    console.log('📸 Searching for block image...');
    let imageUrl = null;
    try {
      imageUrl = await imageSearch.searchImage(name, description || '', '');
      console.log('📸 Image found:', imageUrl);
    } catch (imageError) {
      console.warn('⚠️ Could not find image for block, using fallback:', imageError.message);
      imageUrl = imageSearch.getRandomFallbackImage();
    }

    // Extract block metadata from request
    const tipoId = req.body.tipo_id || req.body.tipoId || null;
    const nivelId = req.body.nivel_id || req.body.nivelId || null;  
    const estadoId = req.body.estado_id || req.body.estadoId || null;

    // Create the block with image, observations, user_role_id and metadata
    const result = await pool.query(
      'INSERT INTO blocks (name, description, observaciones, user_role_id, is_public, image_url, tipo_id, nivel_id, estado_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
      [name, description, observaciones, userRoleRecordId, isPublic, imageUrl, tipoId, nivelId, estadoId]
    );

    const newBlock = result.rows[0];
    console.log('✅ Block created:', newBlock.id, 'with image:', imageUrl);

    // Try to auto-load the block (non-critical - if it fails, still return success)
    try {
      const blockIdInt = parseInt(newBlock.id);
      console.log('🔄 Auto-loading block:', blockIdInt);
      
      // Get current loaded blocks
      const userResult = await pool.query(
        'SELECT loaded_blocks FROM user_profiles WHERE user_id = $1',
        [req.user.id]
      );
      
      let loadedBlocks = userResult.rows[0]?.loaded_blocks || [];
      console.log('📋 Current loaded blocks:', loadedBlocks, typeof loadedBlocks);
      
      // Ensure loadedBlocks is an array
      if (!Array.isArray(loadedBlocks)) {
        console.warn('⚠️ loaded_blocks is not an array, converting:', loadedBlocks);
        loadedBlocks = [];
      }
      
      // Add the new block if not already loaded
      if (!loadedBlocks.includes(blockIdInt)) {
        loadedBlocks.push(blockIdInt);
        console.log('📋 Updated loaded blocks array:', loadedBlocks);
        
        // Ensure we create the user_profiles record if it doesn't exist
        await pool.query(`
          INSERT INTO user_profiles (user_id, loaded_blocks, stats, answer_history, preferences) 
          VALUES ($1, $2::jsonb, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb) 
          ON CONFLICT (user_id) 
          DO UPDATE SET loaded_blocks = $2::jsonb, updated_at = CURRENT_TIMESTAMP
        `, [req.user.id, JSON.stringify(loadedBlocks)]);
        
        console.log('✅ Block automatically loaded for creator');
      } else {
        console.log('ℹ️ Block already loaded, skipping');
      }
    } catch (autoLoadError) {
      console.error('❌ Auto-load failed (non-critical):', autoLoadError.message);
      console.error('❌ Auto-load error details:', autoLoadError);
      // Don't fail the whole request if auto-load fails
    }

    res.status(201).json({
      message: 'Block created successfully',
      block: newBlock
    });
    
  } catch (error) {
    console.error('❌ Error creating block:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// Update block
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const blockId = req.params.id;
    const { name, description, observaciones, isPublic } = req.body;

    // Check if user owns the block
    const ownerCheck = await pool.query(
      'SELECT ur.user_id as creator_id FROM blocks b LEFT JOIN user_roles ur ON b.user_role_id = ur.id WHERE b.id = $1',
      [blockId]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Block not found' });
    }

    if (ownerCheck.rows[0].creator_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to modify this block' });
    }

    const result = await pool.query(
      'UPDATE blocks SET name = $1, description = $2, observaciones = $3, is_public = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *',
      [name, description, observaciones, isPublic, blockId]
    );

    res.json({
      message: 'Block updated successfully',
      block: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating block:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get detailed history for a block (for STATS)
router.get('/:id/history', authenticateToken, async (req, res) => {
  try {
    const blockId = parseInt(req.params.id);
    console.log('📊 Getting block history for block:', blockId, 'user:', req.user.id);

    // Get user's answer history for this block
    const userResult = await pool.query(
      'SELECT answer_history FROM user_profiles WHERE user_id = $1',
      [req.user.id]
    );

    const answerHistory = userResult.rows[0]?.answer_history || [];
    console.log('📊 Total answer history entries:', answerHistory.length);

    // Filter answers for this specific block and get last 20 results per question
    const blockHistory = answerHistory.filter(entry => entry.blockId === blockId);
    console.log('📊 Block-specific history entries:', blockHistory.length);

    // Group by question and get last 20 results for each
    const questionHistory = {};
    
    // Get all questions for this block first with proper ordering
    const questionsResult = await pool.query(
      'SELECT id, text_question FROM questions WHERE block_id = $1 ORDER BY created_at',
      [blockId]
    );

    const questions = questionsResult.rows;
    console.log('📊 Questions in block:', questions.length);

    // Initialize each question with empty history
    questions.forEach((question, index) => {
      questionHistory[question.id] = {
        id: question.id,
        questionId: question.id,
        numero: index + 1, // Sequential number starting from 1
        textoPregunta: question.text_question,
        results: new Array(20).fill(null) // Initialize with 20 nulls
      };
    });

    // Fill with actual results (last 20 per question)
    const sortedHistory = blockHistory.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)); // Oldest first
    
    sortedHistory.forEach(entry => {
      if (questionHistory[entry.questionId]) {
        const question = questionHistory[entry.questionId];
        // Find the first null position and replace it
        const firstNullIndex = question.results.findIndex(r => r === null);
        if (firstNullIndex !== -1) {
          // Convert database format to frontend format: A (green), F (red), B (blue)
          let resultChar = 'B'; // Default to blank (blue)
          if (entry.result === 'ACIERTO') resultChar = 'A';
          else if (entry.result === 'FALLO') resultChar = 'F';
          else if (entry.result === 'BLANCO' || entry.result === 'BLANK') resultChar = 'B';
          
          question.results[firstNullIndex] = resultChar;
        } else {
          // If array is full, shift left and add new result at the end
          question.results.shift();
          let resultChar = 'B'; // Default to blank (blue)
          if (entry.result === 'ACIERTO') resultChar = 'A';
          else if (entry.result === 'FALLO') resultChar = 'F';
          else if (entry.result === 'BLANCO' || entry.result === 'BLANK') resultChar = 'B';
          question.results.push(resultChar);
        }
      }
    });

    // Convert to array format
    const historyArray = Object.values(questionHistory).sort((a, b) => a.numero - b.numero);

    console.log('📊 Returning history for', historyArray.length, 'questions');
    res.json(historyArray);
    
  } catch (error) {
    console.error('❌ Error fetching block history:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message,
      endpoint: '/blocks/:id/history'
    });
  }
});

// Delete block
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const blockId = req.params.id;

    // Check if user owns the block
    const ownerCheck = await pool.query(
      'SELECT ur.user_id as creator_id FROM blocks b LEFT JOIN user_roles ur ON b.user_role_id = ur.id WHERE b.id = $1',
      [blockId]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Block not found' });
    }

    if (ownerCheck.rows[0].creator_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to delete this block' });
    }

    await pool.query('DELETE FROM blocks WHERE id = $1', [blockId]);

    res.json({ message: 'Block deleted successfully' });
  } catch (error) {
    console.error('Error deleting block:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// EXPANDED BLOCK CREATION API ENDPOINTS

// Get knowledge areas
router.get('/knowledge-areas', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, description, parent_id
      FROM knowledge_areas 
      WHERE is_active = true
      ORDER BY name
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching knowledge areas:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get tag suggestions based on knowledge area
router.get('/tag-suggestions', authenticateToken, async (req, res) => {
  try {
    const { knowledge_area_id, education_level, block_type } = req.query;
    
    const result = await pool.query(`
      SELECT DISTINCT bt.name, bt.usage_count
      FROM block_tags bt
      JOIN block_tag_relations btr ON bt.id = btr.tag_id
      JOIN blocks b ON btr.block_id = b.id
      WHERE ($1::integer IS NULL OR b.knowledge_area_id = $1::integer)
        AND ($2::text IS NULL OR b.education_level = $2)
        AND ($3::text IS NULL OR b.block_type = $3)
      ORDER BY bt.usage_count DESC
      LIMIT 20
    `, [knowledge_area_id || null, education_level || null, block_type || null]);
    
    res.json(result.rows.map(row => row.name));
  } catch (error) {
    console.error('Error fetching tag suggestions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create expanded block with metadata
router.post('/create-expanded', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const {
      name,
      description,
      detailed_description,
      block_type,
      education_level,
      scope,
      knowledge_area_id,
      difficulty_level,
      content_language,
      author_observations,
      tags = [],
      block_state = 'private'
    } = req.body;

    // Validate required fields
    if (!name || !detailed_description || !knowledge_area_id) {
      return res.status(400).json({ 
        error: 'Campos requeridos: name, detailed_description, knowledge_area_id' 
      });
    }

    // Search for related image based on knowledge area and content
    console.log('📸 Searching for expanded block image...');
    let imageUrl = null;
    try {
      // Get knowledge area name for better image search
      const knowledgeAreaResult = await client.query(
        'SELECT name FROM knowledge_areas WHERE id = $1',
        [knowledge_area_id]
      );
      const knowledgeAreaName = knowledgeAreaResult.rows[0]?.name || '';
      
      imageUrl = await imageSearch.searchImage(name, detailed_description, knowledgeAreaName);
      console.log('📸 Expanded block image found:', imageUrl);
    } catch (imageError) {
      console.warn('⚠️ Could not find image for expanded block, using fallback:', imageError.message);
      imageUrl = imageSearch.getRandomFallbackImage();
    }

    // Get user's current role for block creation
    let userRoleId = null;
    try {
      const roleResult = await client.query(`
        SELECT ur.role_id 
        FROM user_roles ur 
        JOIN roles r ON ur.role_id = r.id 
        WHERE ur.user_id = $1 
        ORDER BY CASE 
          WHEN r.name = 'administrador_principal' THEN 1
          WHEN r.name = 'administrador_secundario' THEN 2
          WHEN r.name = 'creador' OR r.name = 'creador_contenido' THEN 3
          WHEN r.name = 'profesor' THEN 4
          ELSE 5 
        END
        LIMIT 1
      `, [req.user.id]);
      
      if (roleResult.rows.length > 0) {
        userRoleId = roleResult.rows[0].role_id;
      }
    } catch (roleError) {
      console.warn('⚠️ Could not determine user role for expanded block creation:', roleError.message);
    }

    // Create the block
    const blockResult = await client.query(`
      INSERT INTO blocks (
        name, description, detailed_description, block_type, education_level, 
        scope, knowledge_area_id, difficulty_level, content_language, 
        author_observations, block_state, creator_id, is_public, image_url, user_role_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      ) RETURNING *
    `, [
      name, 
      description || detailed_description.substring(0, 200), 
      detailed_description,
      block_type,
      education_level,
      scope,
      knowledge_area_id,
      difficulty_level,
      content_language,
      author_observations,
      block_state,
      req.user.id,
      block_state === 'public',
      imageUrl,
      userRoleId
    ]);

    const newBlock = blockResult.rows[0];

    // Process tags
    if (tags && tags.length > 0) {
      for (const tagName of tags) {
        // Insert or get tag
        const tagResult = await client.query(`
          INSERT INTO block_tags (name) VALUES ($1)
          ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
          RETURNING id
        `, [tagName.trim()]);
        
        const tagId = tagResult.rows[0].id;
        
        // Link tag to block
        await client.query(`
          INSERT INTO block_tag_relations (block_id, tag_id)
          VALUES ($1, $2)
          ON CONFLICT (block_id, tag_id) DO NOTHING
        `, [newBlock.id, tagId]);
      }
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Bloque creado exitosamente',
      block: newBlock
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating expanded block:', error);
    res.status(500).json({ 
      error: 'Error interno del servidor',
      details: error.message 
    });
  } finally {
    client.release();
  }
});

// Validate block for publication
router.post('/:id/validate', authenticateToken, async (req, res) => {
  try {
    const blockId = parseInt(req.params.id);
    
    // Check if user owns the block
    const ownerCheck = await pool.query(
      'SELECT ur.user_id as creator_id FROM blocks b LEFT JOIN user_roles ur ON b.user_role_id = ur.id WHERE b.id = $1',
      [blockId]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Bloque no encontrado' });
    }

    if (ownerCheck.rows[0].creator_id !== req.user.id) {
      return res.status(403).json({ error: 'No autorizado para validar este bloque' });
    }

    // Use the validation function
    const validationResult = await pool.query(
      'SELECT * FROM validate_block_for_publication($1)',
      [blockId]
    );

    const validation = validationResult.rows[0];
    
    res.json({
      is_valid: validation.is_valid,
      missing_fields: validation.missing_fields || [],
      warnings: validation.warnings || []
    });

  } catch (error) {
    console.error('Error validating block:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Update block state (private/public/restricted/archived)
router.patch('/:id/state', authenticateToken, async (req, res) => {
  try {
    const blockId = parseInt(req.params.id);
    const { state, reason } = req.body;
    
    const validStates = ['private', 'public', 'restricted', 'archived'];
    if (!validStates.includes(state)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }
    
    // Check if user owns the block
    const ownerCheck = await pool.query(
      'SELECT ur.user_id as creator_id FROM blocks b LEFT JOIN user_roles ur ON b.user_role_id = ur.id WHERE b.id = $1',
      [blockId]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Bloque no encontrado' });
    }

    if (ownerCheck.rows[0].creator_id !== req.user.id) {
      return res.status(403).json({ error: 'No autorizado para modificar este bloque' });
    }

    // If changing to public, validate first
    if (state === 'public') {
      const validationResult = await pool.query(
        'SELECT is_valid FROM validate_block_for_publication($1)',
        [blockId]
      );
      
      if (!validationResult.rows[0]?.is_valid) {
        return res.status(400).json({ 
          error: 'El bloque no cumple los requisitos para publicación',
          validation_required: true
        });
      }
    }

    // Update the state
    const result = await pool.query(`
      UPDATE blocks 
      SET block_state = $1, is_public = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 
      RETURNING *
    `, [state, state === 'public', blockId]);

    // Log the state change if reason provided
    if (reason) {
      await pool.query(`
        INSERT INTO block_state_history (block_id, previous_state, new_state, changed_by, change_reason)
        VALUES ($1, 
          (SELECT block_state FROM blocks WHERE id = $1),
          $2, $3, $4)
      `, [blockId, state, req.user.id, reason]);
    }

    res.json({
      message: 'Estado del bloque actualizado exitosamente',
      block: result.rows[0]
    });

  } catch (error) {
    console.error('Error updating block state:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Search blocks with advanced filters
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const {
      search_text,
      block_type,
      education_level,
      scope,
      knowledge_area_id,
      difficulty_level,
      content_language,
      tags,
      creator_id,
      min_rating,
      block_state = 'public',
      limit = 20,
      offset = 0
    } = req.query;

    // Parse tags if provided
    const tagsArray = tags ? (Array.isArray(tags) ? tags : tags.split(',')) : null;

    const result = await pool.query(`
      SELECT * FROM search_blocks_advanced(
        $1::text, $2::varchar, $3::varchar, $4::varchar, $5::integer,
        $6::varchar, $7::varchar, $8::text[], $9::integer, $10::decimal,
        $11::varchar, $12::integer, $13::integer
      )
    `, [
      search_text || null,
      block_type || null,
      education_level || null,
      scope || null,
      knowledge_area_id ? parseInt(knowledge_area_id) : null,
      difficulty_level || null,
      content_language || null,
      tagsArray,
      creator_id ? parseInt(creator_id) : null,
      min_rating ? parseFloat(min_rating) : null,
      block_state,
      parseInt(limit),
      parseInt(offset)
    ]);

    res.json(result.rows);

  } catch (error) {
    console.error('Error searching blocks:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Regenerate block image
router.post('/:id/regenerate-image', authenticateToken, async (req, res) => {
  try {
    const blockId = parseInt(req.params.id);
    
    // Check if user owns the block
    const ownerCheck = await pool.query(
      'SELECT ur.user_id as creator_id, b.name, b.description, b.knowledge_area_id FROM blocks b LEFT JOIN user_roles ur ON b.user_role_id = ur.id WHERE b.id = $1',
      [blockId]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Bloque no encontrado' });
    }

    if (ownerCheck.rows[0].creator_id !== req.user.id) {
      return res.status(403).json({ error: 'No autorizado para modificar este bloque' });
    }

    const block = ownerCheck.rows[0];
    
    console.log('🔄 Regenerating image for block:', blockId);
    
    // Search for new image
    let imageUrl = null;
    try {
      // Get knowledge area name if available
      let knowledgeAreaName = '';
      if (block.knowledge_area_id) {
        const knowledgeAreaResult = await pool.query(
          'SELECT name FROM knowledge_areas WHERE id = $1',
          [block.knowledge_area_id]
        );
        knowledgeAreaName = knowledgeAreaResult.rows[0]?.name || '';
      }
      
      imageUrl = await imageSearch.searchImage(block.name, block.description || '', knowledgeAreaName);
      console.log('📸 New image found:', imageUrl);
    } catch (imageError) {
      console.warn('⚠️ Could not find new image, using fallback:', imageError.message);
      imageUrl = imageSearch.getRandomFallbackImage();
    }

    // Update the block with new image
    const result = await pool.query(
      'UPDATE blocks SET image_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING image_url',
      [imageUrl, blockId]
    );

    res.json({
      message: 'Imagen del bloque regenerada exitosamente',
      imageUrl: result.rows[0].image_url
    });

  } catch (error) {
    console.error('Error regenerating block image:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Get block with complete metadata
router.get('/:id/complete', authenticateToken, async (req, res) => {
  try {
    const blockId = parseInt(req.params.id);
    
    const result = await pool.query(`
      SELECT * FROM blocks_complete_info WHERE id = $1
    `, [blockId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bloque no encontrado' });
    }

    const block = result.rows[0];
    
    // Check access permissions (creator_id comes from the view which includes the JOIN)
    if (block.block_state !== 'public' && block.creator_id !== req.user.id) {
      return res.status(403).json({ error: 'No tienes acceso a este bloque' });
    }

    res.json(block);

  } catch (error) {
    console.error('Error fetching complete block info:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Get created blocks with statistics for Bloques Creados section
router.get('/created-stats', authenticateToken, async (req, res) => {
  try {
    console.log('🔍 /blocks/created-stats endpoint called');
    console.log('🔍 User ID:', req.user.id);
    console.log('🔍 Headers:', req.headers);

    // Get the current active role from header
    const currentRole = req.headers['x-current-role'];
    if (!currentRole) {
      return res.status(400).json({ error: 'Current role header is required' });
    }

    // Map panel codes from frontend to database role names
    const panelToRoleMapping = {
      'PCC': 'creador',
      'PPF': 'profesor',
      'PJG': 'jugador',
      'PAP': 'administrador_principal',
      'PAS': 'administrador_secundario'
    };

    // Convert panel code to database role name if needed
    const actualRoleName = panelToRoleMapping[currentRole] || currentRole;
    console.log('🎭 Role from header:', currentRole, '-> Database role:', actualRoleName);

    // Get user's specific user_role record for the current active role
    const userRoleResult = await pool.query(`
      SELECT ur.id as user_role_id, r.name as role_name
      FROM user_roles ur 
      JOIN roles r ON ur.role_id = r.id 
      WHERE ur.user_id = $1 AND r.name = $2
      LIMIT 1
    `, [req.user.id, actualRoleName]);
    
    if (userRoleResult.rows.length === 0) {
      return res.status(403).json({ error: 'User does not have the specified role' });
    }

    const userRoleId = userRoleResult.rows[0].user_role_id;
    console.log('👤 User role ID for query:', userRoleId, 'Role:', userRoleResult.rows[0].role_name);
    
    // Get blocks created by this user with this specific role, along with statistics and metadata
    const blocksResult = await pool.query(`
      SELECT 
        b.id,
        b.name,
        b.description,
        b.observaciones,
        b.is_public,
        b.created_at,
        b.updated_at,
        b.image_url,
        u.nickname as creator_nickname,
        r.name as created_with_role,
        
        -- Metadata fields
        b.tipo_id,
        b.nivel_id,
        b.estado_id,
        bt.name as tipo_name,
        bl.name as nivel_name,
        bs.name as estado_name,
        
        -- Number of questions from block_answers table
        COALESCE(ba.total_questions, 0) as total_questions,
        
        -- Number of topics from topic_answers table  
        COALESCE(ta.topic_count, 0) as total_topics,
        
        -- Number of users who have loaded this block (from user_profiles.loaded_blocks JSONB)
        COALESCE(ub.user_count, 0) as total_users
        
      FROM blocks b
      LEFT JOIN user_roles ur ON b.user_role_id = ur.id
      LEFT JOIN users u ON ur.user_id = u.id
      LEFT JOIN roles r ON ur.role_id = r.id
      LEFT JOIN block_types bt ON b.tipo_id = bt.id
      LEFT JOIN block_levels bl ON b.nivel_id = bl.id
      LEFT JOIN block_states bs ON b.estado_id = bs.id
      LEFT JOIN block_answers ba ON b.id = ba.block_id
      LEFT JOIN (
        SELECT block_id, COUNT(DISTINCT topic) as topic_count
        FROM topic_answers 
        GROUP BY block_id
      ) ta ON b.id = ta.block_id
      LEFT JOIN (
        SELECT 
          jsonb_array_elements_text(loaded_blocks)::integer as block_id,
          COUNT(*) as user_count
        FROM user_profiles 
        WHERE loaded_blocks IS NOT NULL AND loaded_blocks != '[]'::jsonb
        GROUP BY jsonb_array_elements_text(loaded_blocks)::integer
      ) ub ON b.id = ub.block_id
      WHERE b.user_role_id = $1
      ORDER BY b.created_at DESC
    `, [userRoleId]);

    console.log('🔍 Found blocks with stats:', blocksResult.rows.length);

    // Transform the results to match the expected format
    const blocks = blocksResult.rows.map(block => ({
      id: block.id,
      name: block.name,
      description: block.description,
      observaciones: block.observaciones,
      isPublic: block.is_public,
      createdAt: block.created_at,
      updatedAt: block.updated_at,
      imageUrl: block.image_url,
      creatorNickname: block.creator_nickname,
      createdWithRole: block.created_with_role,
      
      // Metadata IDs for filtering
      tipo_id: block.tipo_id,
      nivel_id: block.nivel_id,
      estado_id: block.estado_id,
      
      // Metadata
      metadata: {
        tipo: block.tipo_name || 'Sin especificar',
        nivel: block.nivel_name || 'Sin especificar', 
        estado: block.estado_name || 'Sin especificar'
      },
      
      // Statistics
      stats: {
        totalQuestions: parseInt(block.total_questions) || 0,
        totalTopics: parseInt(block.total_topics) || 0,
        totalUsers: parseInt(block.total_users) || 0
      }
    }));

    console.log('✅ Returning blocks with stats:', blocks.length);
    res.json(blocks);
    
  } catch (error) {
    console.error('❌ Error fetching created blocks with stats:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message,
      endpoint: '/blocks/created-stats'
    });
  }
});

// Get block types for dropdowns
router.get('/types', async (req, res) => {
  try {
    console.log('🔍 /blocks/types endpoint called');
    
    const result = await pool.query(`
      SELECT id, name 
      FROM block_types 
      ORDER BY name ASC
    `);

    console.log('✅ Found block types:', result.rows.length);
    res.json(result.rows);
    
  } catch (error) {
    console.error('❌ Error fetching block types:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message,
      endpoint: '/blocks/types'
    });
  }
});

// Get block levels for dropdowns
router.get('/levels', async (req, res) => {
  try {
    console.log('🔍 /blocks/levels endpoint called');
    
    const result = await pool.query(`
      SELECT id, name 
      FROM block_levels 
      ORDER BY name ASC
    `);

    console.log('✅ Found block levels:', result.rows.length);
    res.json(result.rows);
    
  } catch (error) {
    console.error('❌ Error fetching block levels:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message,
      endpoint: '/blocks/levels'
    });
  }
});

// Get block states for dropdowns
router.get('/states', async (req, res) => {
  try {
    console.log('🔍 /blocks/states endpoint called');
    
    const result = await pool.query(`
      SELECT id, name 
      FROM block_states 
      ORDER BY name ASC
    `);

    console.log('✅ Found block states:', result.rows.length);
    res.json(result.rows);
    
  } catch (error) {
    console.error('❌ Error fetching block states:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message,
      endpoint: '/blocks/states'
    });
  }
});

// Get all metadata for dropdowns (combined endpoint)
router.get('/metadata', async (req, res) => {
  try {
    console.log('🔍 /blocks/metadata endpoint called');
    
    const [typesResult, levelsResult, statesResult] = await Promise.all([
      pool.query('SELECT id, name FROM block_types ORDER BY name ASC'),
      pool.query('SELECT id, name FROM block_levels ORDER BY name ASC'), 
      pool.query('SELECT id, name FROM block_states ORDER BY name ASC')
    ]);

    const metadata = {
      types: typesResult.rows,
      levels: levelsResult.rows,
      states: statesResult.rows
    };

    console.log('✅ Found metadata - Types:', metadata.types.length, 'Levels:', metadata.levels.length, 'States:', metadata.states.length);
    res.json(metadata);
    
  } catch (error) {
    console.error('❌ Error fetching block metadata:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message,
      endpoint: '/blocks/metadata'
    });
  }
});

// Obtener datos completos de un bloque
router.get('/:blockId/complete-data', authenticateToken, async (req, res) => {
  try {
    const blockId = parseInt(req.params.blockId);
    console.log('🔍 Getting complete data for block:', blockId, 'user:', req.user.id);

    // Get block info
    const blockResult = await pool.query(`
      SELECT 
        b.id, b.name, b.description, b.observaciones, b.is_public, b.created_at,
        u.nickname as creator_nickname,
        u.id as creator_id,
        r.name as created_with_role
      FROM blocks b
      LEFT JOIN user_roles ur ON b.user_role_id = ur.id
      LEFT JOIN users u ON ur.user_id = u.id
      LEFT JOIN roles r ON ur.role_id = r.id
      WHERE b.id = $1
    `, [blockId]);

    if (blockResult.rows.length === 0) {
      return res.status(404).json({ error: 'Block not found' });
    }

    const block = blockResult.rows[0];

    // Get question count from block_answers table
    const questionCountResult = await pool.query(`
      SELECT COALESCE(ba.total_questions, 0) as total_questions
      FROM block_answers ba
      WHERE ba.block_id = $1
    `, [blockId]);

    // Get topics and questions per topic from topic_answers (using total_questions column)
    const topicsResult = await pool.query(`
      SELECT 
        ta.topic,
        ta.total_questions as question_count
      FROM topic_answers ta
      WHERE ta.block_id = $1 AND ta.topic IS NOT NULL AND ta.topic != ''
      ORDER BY ta.topic
    `, [blockId]);

    // Get user count (users who have loaded this block)
    const userCountResult = await pool.query(`
      SELECT COUNT(*) as total_users
      FROM user_profiles
      WHERE loaded_blocks @> $1::jsonb
    `, [JSON.stringify([blockId])]);

    // Prepare topics and questions per topic
    const topicsData = topicsResult.rows.map(row => ({
      topic: row.topic,
      questionCount: parseInt(row.question_count) || 0
    }));

    const completeData = {
      id: block.id,
      name: block.name,
      description: block.description,
      observaciones: block.observaciones,
      isPublic: block.is_public,
      createdAt: block.created_at,
      creatorId: block.creator_id,
      creatorNickname: block.creator_nickname,
      createdWithRole: block.created_with_role,
      stats: {
        totalQuestions: parseInt(questionCountResult.rows[0]?.total_questions) || 0,
        totalTopics: topicsData.length,
        totalUsers: parseInt(userCountResult.rows[0].total_users) || 0,
        topicsAndQuestions: topicsData
      }
    };

    console.log('✅ Returning complete data for block:', blockId);
    res.json(completeData);

  } catch (error) {
    console.error('❌ Error getting complete block data:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message,
      endpoint: '/blocks/:blockId/complete-data'
    });
  }
});

// Obtener todas las preguntas de un bloque
router.get('/:blockId/questions', authenticateToken, async (req, res) => {
  try {
    const blockId = parseInt(req.params.blockId);
    const limit = parseInt(req.query.limit) || 100;
    console.log('🔍 Getting questions for block:', blockId, 'limit:', limit, 'user:', req.user.id);

    // Get all questions for this block
    const questionsResult = await pool.query(`
      SELECT q.id, q.text_question, q.topic, q.block_id, q.difficulty, q.explanation,
        json_agg(
          json_build_object(
            'id', a.id,
            'answerText', a.answer_text,
            'isCorrect', a.is_correct
          )
        ) as answers
      FROM questions q
      LEFT JOIN answers a ON q.id = a.question_id
      WHERE q.block_id = $1
      GROUP BY q.id, q.text_question, q.topic, q.block_id, q.difficulty, q.explanation
      ORDER BY q.created_at
      LIMIT $2
    `, [blockId, limit]);

    const questions = questionsResult.rows.map(q => ({
      id: q.id,
      textoPregunta: q.text_question,
      tema: q.topic,
      bloqueId: q.block_id,
      difficulty: q.difficulty,
      explicacionRespuesta: q.explanation || null,
      respuestas: q.answers.filter(a => a.id !== null).map(a => ({
        textoRespuesta: a.answerText,
        esCorrecta: a.isCorrect
      }))
    }));

    console.log('✅ Returning', questions.length, 'questions for block:', blockId);
    res.json(questions);

  } catch (error) {
    console.error('❌ Error getting block questions:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message,
      endpoint: '/blocks/:blockId/questions'
    });
  }
});

// Obtener todos los temas únicos de un bloque desde topic_answers
router.get('/:blockId/topics', authenticateToken, async (req, res) => {
  try {
    const blockId = parseInt(req.params.blockId);
    console.log('🔍 Getting topics for block:', blockId, 'user:', req.user.id);

    // Get unique topics from topic_answers table
    const topicsResult = await pool.query(`
      SELECT DISTINCT topic
      FROM topic_answers
      WHERE block_id = $1
      ORDER BY topic
    `, [blockId]);

    const topics = topicsResult.rows.map(row => row.topic);

    console.log('✅ Returning', topics.length, 'unique topics for block:', blockId);
    res.json(topics);

  } catch (error) {
    console.error('❌ Error getting block topics:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message,
      endpoint: '/blocks/:blockId/topics'
    });
  }
});

module.exports = router;