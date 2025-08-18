const { Pool } = require('pg');

// Sistema de búsqueda avanzada para PLAYTEST
class AdvancedSearchSystem {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
    }

    // Búsqueda avanzada con múltiples filtros
    async performAdvancedSearch(params) {
        try {
            const {
                query,
                filters = {},
                sort_by = 'relevance',
                sort_order = 'desc',
                limit = 50,
                offset = 0,
                user_id,
                user_roles = []
            } = params;

            const results = {
                users: [],
                blocks: [],
                questions: [],
                games: [],
                challenges: [],
                total_count: 0
            };

            // Búsqueda de usuarios con filtros avanzados
            if (!filters.exclude_users) {
                results.users = await this.searchUsersAdvanced({
                    query,
                    filters: filters.users || {},
                    limit: Math.floor(limit / 5),
                    offset,
                    requesting_user_id: user_id
                });
            }

            // Búsqueda de bloques con filtros avanzados
            if (!filters.exclude_blocks) {
                results.blocks = await this.searchBlocksAdvanced({
                    query,
                    filters: filters.blocks || {},
                    limit: Math.floor(limit / 5),
                    offset,
                    user_id,
                    user_roles
                });
            }

            // Búsqueda de preguntas con filtros avanzados
            if (!filters.exclude_questions) {
                results.questions = await this.searchQuestionsAdvanced({
                    query,
                    filters: filters.questions || {},
                    limit: Math.floor(limit / 5),
                    offset,
                    user_id
                });
            }

            // Búsqueda de juegos con filtros avanzados
            if (!filters.exclude_games) {
                results.games = await this.searchGamesAdvanced({
                    query,
                    filters: filters.games || {},
                    limit: Math.floor(limit / 5),
                    offset,
                    user_id
                });
            }

            // Búsqueda de challenges con filtros avanzados
            if (!filters.exclude_challenges) {
                results.challenges = await this.searchChallengesAdvanced({
                    query,
                    filters: filters.challenges || {},
                    limit: Math.floor(limit / 5),
                    offset,
                    user_id
                });
            }

            // Calcular total y aplicar ordenamiento global
            const allResults = [
                ...results.users.map(r => ({ ...r, type: 'user' })),
                ...results.blocks.map(r => ({ ...r, type: 'block' })),
                ...results.questions.map(r => ({ ...r, type: 'question' })),
                ...results.games.map(r => ({ ...r, type: 'game' })),
                ...results.challenges.map(r => ({ ...r, type: 'challenge' }))
            ];

            // Ordenamiento global
            const sortedResults = this.applySorting(allResults, sort_by, sort_order);

            results.total_count = sortedResults.length;
            results.sorted_results = sortedResults.slice(offset, offset + limit);

            return results;

        } catch (error) {
            console.error('Error en búsqueda avanzada:', error);
            throw error;
        }
    }

    async searchUsersAdvanced({ query, filters, limit, offset, requesting_user_id }) {
        try {
            let sql = `
                SELECT DISTINCT
                    u.id,
                    u.nickname,
                    u.email,
                    u.created_at,
                    ur.role_name,
                    ul.current_balance as luminarias,
                    ualevel.level_name as user_level,
                    crlevel.level_name as creator_level,
                    trlevel.level_name as teacher_level,
                    ts_rank(
                        to_tsvector('spanish', COALESCE(u.nickname, '') || ' ' || COALESCE(u.email, '')),
                        plainto_tsquery('spanish', $1)
                    ) as relevance_score
                FROM users u
                LEFT JOIN user_roles ur ON u.id = ur.user_id
                LEFT JOIN user_luminarias ul ON u.id = ul.user_id
                LEFT JOIN user_levels ualevel_join ON u.id = ualevel_join.user_id AND ualevel_join.level_type = 'user'
                LEFT JOIN level_definitions ualevel ON ualevel_join.current_level_id = ualevel.id
                LEFT JOIN user_levels crlevel_join ON u.id = crlevel_join.user_id AND crlevel_join.level_type = 'creator'
                LEFT JOIN level_definitions crlevel ON crlevel_join.current_level_id = crlevel.id
                LEFT JOIN user_levels trlevel_join ON u.id = trlevel_join.user_id AND trlevel_join.level_type = 'teacher'
                LEFT JOIN level_definitions trlevel ON trlevel_join.current_level_id = trlevel.id
                WHERE (
                    u.nickname ILIKE $2 OR 
                    u.email ILIKE $2 OR
                    to_tsvector('spanish', COALESCE(u.nickname, '') || ' ' || COALESCE(u.email, '')) @@ plainto_tsquery('spanish', $1)
                )
            `;

            const params = [query, `%${query}%`];
            let paramIndex = 3;

            // Filtros específicos
            if (filters.role) {
                sql += ` AND ur.role_name = $${paramIndex}`;
                params.push(filters.role);
                paramIndex++;
            }

            if (filters.min_luminarias) {
                sql += ` AND ul.current_balance >= $${paramIndex}`;
                params.push(parseInt(filters.min_luminarias));
                paramIndex++;
            }

            if (filters.level_type && filters.level_name) {
                if (filters.level_type === 'user') {
                    sql += ` AND ualevel.level_name = $${paramIndex}`;
                } else if (filters.level_type === 'creator') {
                    sql += ` AND crlevel.level_name = $${paramIndex}`;
                } else if (filters.level_type === 'teacher') {
                    sql += ` AND trlevel.level_name = $${paramIndex}`;
                }
                params.push(filters.level_name);
                paramIndex++;
            }

            if (filters.created_after) {
                sql += ` AND u.created_at >= $${paramIndex}`;
                params.push(filters.created_after);
                paramIndex++;
            }

            if (filters.exclude_inactive) {
                sql += ` AND ul.last_activity >= NOW() - INTERVAL '30 days'`;
            }

            sql += ` ORDER BY relevance_score DESC, u.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, offset);

            const result = await this.pool.query(sql, params);
            return result.rows;

        } catch (error) {
            console.error('Error en búsqueda avanzada de usuarios:', error);
            return [];
        }
    }

    async searchBlocksAdvanced({ query, filters, limit, offset, user_id, user_roles }) {
        try {
            let sql = `
                SELECT DISTINCT
                    b.id,
                    b.title,
                    b.description,
                    b.difficulty,
                    b.category,
                    b.visibility,
                    b.created_at,
                    u.nickname as creator_nickname,
                    COUNT(DISTINCT q.id) as question_count,
                    COUNT(DISTINCT g.id) as games_played,
                    COALESCE(AVG(
                        CASE WHEN ua.is_correct THEN 1.0 ELSE 0.0 END
                    ), 0) as success_rate,
                    ts_rank(
                        to_tsvector('spanish', COALESCE(b.title, '') || ' ' || COALESCE(b.description, '')),
                        plainto_tsquery('spanish', $1)
                    ) as relevance_score
                FROM blocks b
                LEFT JOIN users u ON b.creator_id = u.id
                LEFT JOIN questions q ON b.id = q.block_id
                LEFT JOIN games g ON b.id = g.block_id AND g.status = 'completed'
                LEFT JOIN user_answers ua ON q.id = ua.question_id
                WHERE (
                    b.title ILIKE $2 OR 
                    b.description ILIKE $2 OR
                    to_tsvector('spanish', COALESCE(b.title, '') || ' ' || COALESCE(b.description, '')) @@ plainto_tsquery('spanish', $1)
                )
            `;

            const params = [query, `%${query}%`];
            let paramIndex = 3;

            // Filtros de visibilidad basados en permisos
            if (!user_roles.includes('admin_principal')) {
                sql += ` AND (b.visibility = 'public' OR b.creator_id = $${paramIndex})`;
                params.push(user_id);
                paramIndex++;
            }

            // Filtros específicos
            if (filters.difficulty) {
                sql += ` AND b.difficulty = $${paramIndex}`;
                params.push(filters.difficulty);
                paramIndex++;
            }

            if (filters.category) {
                sql += ` AND b.category = $${paramIndex}`;
                params.push(filters.category);
                paramIndex++;
            }

            if (filters.creator_id) {
                sql += ` AND b.creator_id = $${paramIndex}`;
                params.push(filters.creator_id);
                paramIndex++;
            }

            if (filters.min_questions) {
                sql += ` AND (SELECT COUNT(*) FROM questions WHERE block_id = b.id) >= $${paramIndex}`;
                params.push(parseInt(filters.min_questions));
                paramIndex++;
            }

            if (filters.created_after) {
                sql += ` AND b.created_at >= $${paramIndex}`;
                params.push(filters.created_after);
                paramIndex++;
            }

            if (filters.min_success_rate) {
                sql += ` AND COALESCE(AVG(CASE WHEN ua.is_correct THEN 1.0 ELSE 0.0 END), 0) >= $${paramIndex}`;
                params.push(parseFloat(filters.min_success_rate) / 100);
                paramIndex++;
            }

            sql += ` GROUP BY b.id, u.nickname ORDER BY relevance_score DESC, b.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, offset);

            const result = await this.pool.query(sql, params);
            return result.rows;

        } catch (error) {
            console.error('Error en búsqueda avanzada de bloques:', error);
            return [];
        }
    }

    async searchQuestionsAdvanced({ query, filters, limit, offset, user_id }) {
        try {
            let sql = `
                SELECT DISTINCT
                    q.id,
                    q.question_text,
                    q.correct_answer,
                    q.difficulty,
                    q.topic,
                    q.created_at,
                    b.title as block_title,
                    u.nickname as creator_nickname,
                    COUNT(DISTINCT ua.id) as answer_count,
                    COALESCE(AVG(
                        CASE WHEN ua.is_correct THEN 1.0 ELSE 0.0 END
                    ), 0) as success_rate,
                    ts_rank(
                        to_tsvector('spanish', COALESCE(q.question_text, '') || ' ' || COALESCE(q.topic, '')),
                        plainto_tsquery('spanish', $1)
                    ) as relevance_score
                FROM questions q
                LEFT JOIN blocks b ON q.block_id = b.id
                LEFT JOIN users u ON b.creator_id = u.id
                LEFT JOIN user_answers ua ON q.id = ua.question_id
                WHERE (
                    q.question_text ILIKE $2 OR 
                    q.topic ILIKE $2 OR
                    to_tsvector('spanish', COALESCE(q.question_text, '') || ' ' || COALESCE(q.topic, '')) @@ plainto_tsquery('spanish', $1)
                )
                AND (b.visibility = 'public' OR b.creator_id = $3)
            `;

            const params = [query, `%${query}%`, user_id];
            let paramIndex = 4;

            // Filtros específicos
            if (filters.difficulty) {
                sql += ` AND q.difficulty = $${paramIndex}`;
                params.push(filters.difficulty);
                paramIndex++;
            }

            if (filters.block_id) {
                sql += ` AND q.block_id = $${paramIndex}`;
                params.push(filters.block_id);
                paramIndex++;
            }

            if (filters.topic) {
                sql += ` AND q.topic ILIKE $${paramIndex}`;
                params.push(`%${filters.topic}%`);
                paramIndex++;
            }

            if (filters.min_answers) {
                sql += ` AND (SELECT COUNT(*) FROM user_answers WHERE question_id = q.id) >= $${paramIndex}`;
                params.push(parseInt(filters.min_answers));
                paramIndex++;
            }

            if (filters.created_after) {
                sql += ` AND q.created_at >= $${paramIndex}`;
                params.push(filters.created_after);
                paramIndex++;
            }

            sql += ` GROUP BY q.id, b.title, u.nickname ORDER BY relevance_score DESC, q.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, offset);

            const result = await this.pool.query(sql, params);
            return result.rows;

        } catch (error) {
            console.error('Error en búsqueda avanzada de preguntas:', error);
            return [];
        }
    }

    async searchGamesAdvanced({ query, filters, limit, offset, user_id }) {
        try {
            let sql = `
                SELECT DISTINCT
                    g.id,
                    g.game_type,
                    g.status,
                    g.created_at,
                    g.completed_at,
                    b.title as block_title,
                    creator.nickname as creator_nickname,
                    player.nickname as player_nickname,
                    g.final_score,
                    g.total_questions,
                    g.correct_answers,
                    ts_rank(
                        to_tsvector('spanish', COALESCE(b.title, '') || ' ' || COALESCE(g.game_type, '')),
                        plainto_tsquery('spanish', $1)
                    ) as relevance_score
                FROM games g
                LEFT JOIN blocks b ON g.block_id = b.id
                LEFT JOIN users creator ON g.created_by = creator.id
                LEFT JOIN users player ON g.player_id = player.id
                WHERE (
                    b.title ILIKE $2 OR 
                    g.game_type ILIKE $2 OR
                    to_tsvector('spanish', COALESCE(b.title, '') || ' ' || COALESCE(g.game_type, '')) @@ plainto_tsquery('spanish', $1)
                )
                AND (g.created_by = $3 OR g.player_id = $3 OR b.visibility = 'public')
            `;

            const params = [query, `%${query}%`, user_id];
            let paramIndex = 4;

            // Filtros específicos
            if (filters.game_type) {
                sql += ` AND g.game_type = $${paramIndex}`;
                params.push(filters.game_type);
                paramIndex++;
            }

            if (filters.status) {
                sql += ` AND g.status = $${paramIndex}`;
                params.push(filters.status);
                paramIndex++;
            }

            if (filters.min_score) {
                sql += ` AND g.final_score >= $${paramIndex}`;
                params.push(parseInt(filters.min_score));
                paramIndex++;
            }

            if (filters.created_after) {
                sql += ` AND g.created_at >= $${paramIndex}`;
                params.push(filters.created_after);
                paramIndex++;
            }

            if (filters.completed_only) {
                sql += ` AND g.status = 'completed'`;
            }

            sql += ` ORDER BY relevance_score DESC, g.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, offset);

            const result = await this.pool.query(sql, params);
            return result.rows;

        } catch (error) {
            console.error('Error en búsqueda avanzada de juegos:', error);
            return [];
        }
    }

    async searchChallengesAdvanced({ query, filters, limit, offset, user_id }) {
        try {
            let sql = `
                SELECT DISTINCT
                    c.id,
                    c.challenge_name,
                    c.challenge_type,
                    c.status,
                    c.start_date,
                    c.end_date,
                    c.prize_luminarias,
                    creator.nickname as creator_nickname,
                    COUNT(DISTINCT cp.id) as participants_count,
                    ts_rank(
                        to_tsvector('spanish', COALESCE(c.challenge_name, '') || ' ' || COALESCE(c.challenge_type, '')),
                        plainto_tsquery('spanish', $1)
                    ) as relevance_score
                FROM challenges c
                LEFT JOIN users creator ON c.created_by = creator.id
                LEFT JOIN challenge_participants cp ON c.id = cp.challenge_id
                WHERE (
                    c.challenge_name ILIKE $2 OR 
                    c.challenge_type ILIKE $2 OR
                    to_tsvector('spanish', COALESCE(c.challenge_name, '') || ' ' || COALESCE(c.challenge_type, '')) @@ plainto_tsquery('spanish', $1)
                )
                AND (c.visibility = 'public' OR c.created_by = $3)
            `;

            const params = [query, `%${query}%`, user_id];
            let paramIndex = 4;

            // Filtros específicos
            if (filters.challenge_type) {
                sql += ` AND c.challenge_type = $${paramIndex}`;
                params.push(filters.challenge_type);
                paramIndex++;
            }

            if (filters.status) {
                sql += ` AND c.status = $${paramIndex}`;
                params.push(filters.status);
                paramIndex++;
            }

            if (filters.min_prize) {
                sql += ` AND c.prize_luminarias >= $${paramIndex}`;
                params.push(parseInt(filters.min_prize));
                paramIndex++;
            }

            if (filters.active_only) {
                sql += ` AND c.status = 'active' AND c.start_date <= NOW() AND c.end_date >= NOW()`;
            }

            if (filters.created_after) {
                sql += ` AND c.created_at >= $${paramIndex}`;
                params.push(filters.created_after);
                paramIndex++;
            }

            sql += ` GROUP BY c.id, creator.nickname ORDER BY relevance_score DESC, c.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, offset);

            const result = await this.pool.query(sql, params);
            return result.rows;

        } catch (error) {
            console.error('Error en búsqueda avanzada de challenges:', error);
            return [];
        }
    }

    applySorting(results, sort_by, sort_order) {
        const direction = sort_order === 'asc' ? 1 : -1;

        return results.sort((a, b) => {
            let comparison = 0;

            switch (sort_by) {
                case 'relevance':
                    comparison = (a.relevance_score || 0) - (b.relevance_score || 0);
                    break;
                case 'date':
                    comparison = new Date(a.created_at) - new Date(b.created_at);
                    break;
                case 'popularity':
                    const aPopularity = a.games_played || a.participants_count || a.answer_count || 0;
                    const bPopularity = b.games_played || b.participants_count || b.answer_count || 0;
                    comparison = aPopularity - bPopularity;
                    break;
                case 'rating':
                    const aRating = a.success_rate || a.final_score || 0;
                    const bRating = b.success_rate || b.final_score || 0;
                    comparison = aRating - bRating;
                    break;
                default:
                    comparison = (a.relevance_score || 0) - (b.relevance_score || 0);
            }

            return comparison * direction;
        });
    }

    // Método para generar estadísticas de búsqueda
    async getSearchAnalytics(user_id, timeframe = 30) {
        try {
            const analytics = await this.pool.query(`
                SELECT 
                    COUNT(*) as total_searches,
                    COUNT(DISTINCT search_query) as unique_queries,
                    AVG(results_count) as avg_results_per_search,
                    search_context,
                    COUNT(*) as context_count
                FROM user_search_history 
                WHERE user_id = $1 
                AND created_at >= NOW() - INTERVAL '${timeframe} days'
                GROUP BY search_context
                ORDER BY context_count DESC
            `, [user_id]);

            return analytics.rows;

        } catch (error) {
            console.error('Error obteniendo analytics de búsqueda:', error);
            return [];
        }
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = AdvancedSearchSystem;