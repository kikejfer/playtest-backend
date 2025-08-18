const { Pool } = require('pg');

// Sistema de sugerencias inteligentes para búsquedas
class SearchSuggestionsSystem {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
    }

    // Generar sugerencias automáticas basadas en el input del usuario
    async generateSuggestions(query, context = 'all', user_id, limit = 10) {
        try {
            if (!query || query.length < 1) {
                return {
                    suggestions: [],
                    trending: await this.getTrendingSuggestions(context, limit)
                };
            }

            const suggestions = [];

            // Sugerencias de autocompletado desde la base de datos
            const dbSuggestions = await this.getDatabaseSuggestions(query, context, user_id, limit);
            suggestions.push(...dbSuggestions);

            // Sugerencias basadas en búsquedas populares
            const popularSuggestions = await this.getPopularSuggestions(query, context, limit);
            suggestions.push(...popularSuggestions);

            // Sugerencias personalizadas basadas en el historial del usuario
            const personalizedSuggestions = await this.getPersonalizedSuggestions(query, user_id, limit);
            suggestions.push(...personalizedSuggestions);

            // Eliminar duplicados y limitar resultados
            const uniqueSuggestions = this.removeDuplicates(suggestions)
                .slice(0, limit)
                .sort((a, b) => b.score - a.score);

            return {
                suggestions: uniqueSuggestions,
                trending: suggestions.length < limit ? await this.getTrendingSuggestions(context, limit - suggestions.length) : []
            };

        } catch (error) {
            console.error('Error generando sugerencias:', error);
            return { suggestions: [], trending: [] };
        }
    }

    async getDatabaseSuggestions(query, context, user_id, limit) {
        try {
            const suggestions = [];

            if (context === 'all' || context === 'blocks') {
                // Sugerencias de bloques
                const blocksResult = await this.pool.query(`
                    SELECT DISTINCT 
                        title as suggestion,
                        'block' as type,
                        'Bloque' as category,
                        COUNT(*) OVER() as usage_count,
                        similarity(title, $1) as score
                    FROM blocks 
                    WHERE title % $1 
                    AND (visibility = 'public' OR creator_id = $2)
                    ORDER BY score DESC, usage_count DESC
                    LIMIT $3
                `, [query, user_id, Math.floor(limit / 4)]);

                suggestions.push(...blocksResult.rows.map(row => ({
                    text: row.suggestion,
                    type: row.type,
                    category: row.category,
                    score: row.score * 1.2, // Boost para títulos exactos
                    usage_count: row.usage_count
                })));

                // Sugerencias de categorías de bloques
                const categoriesResult = await this.pool.query(`
                    SELECT DISTINCT 
                        category as suggestion,
                        'category' as type,
                        'Categoría' as category,
                        COUNT(*) as usage_count,
                        similarity(category, $1) as score
                    FROM blocks 
                    WHERE category % $1 
                    AND (visibility = 'public' OR creator_id = $2)
                    GROUP BY category
                    ORDER BY score DESC, usage_count DESC
                    LIMIT $3
                `, [query, user_id, Math.floor(limit / 6)]);

                suggestions.push(...categoriesResult.rows.map(row => ({
                    text: row.suggestion,
                    type: row.type,
                    category: row.category,
                    score: row.score,
                    usage_count: row.usage_count
                })));
            }

            if (context === 'all' || context === 'users') {
                // Sugerencias de usuarios
                const usersResult = await this.pool.query(`
                    SELECT DISTINCT 
                        nickname as suggestion,
                        'user' as type,
                        'Usuario' as category,
                        1 as usage_count,
                        similarity(nickname, $1) as score
                    FROM users 
                    WHERE nickname % $1 
                    ORDER BY score DESC
                    LIMIT $2
                `, [query, Math.floor(limit / 4)]);

                suggestions.push(...usersResult.rows.map(row => ({
                    text: row.suggestion,
                    type: row.type,
                    category: row.category,
                    score: row.score,
                    usage_count: row.usage_count
                })));
            }

            if (context === 'all' || context === 'topics') {
                // Sugerencias de temas
                const topicsResult = await this.pool.query(`
                    SELECT DISTINCT 
                        topic as suggestion,
                        'topic' as type,
                        'Tema' as category,
                        COUNT(*) as usage_count,
                        similarity(topic, $1) as score
                    FROM questions q
                    JOIN blocks b ON q.block_id = b.id
                    WHERE topic % $1 
                    AND (b.visibility = 'public' OR b.creator_id = $2)
                    GROUP BY topic
                    ORDER BY score DESC, usage_count DESC
                    LIMIT $3
                `, [query, user_id, Math.floor(limit / 4)]);

                suggestions.push(...topicsResult.rows.map(row => ({
                    text: row.suggestion,
                    type: row.type,
                    category: row.category,
                    score: row.score,
                    usage_count: row.usage_count
                })));
            }

            return suggestions;

        } catch (error) {
            console.error('Error obteniendo sugerencias de BD:', error);
            return [];
        }
    }

    async getPopularSuggestions(query, context, limit) {
        try {
            // Obtener búsquedas populares que coincidan con el query
            const result = await this.pool.query(`
                SELECT 
                    search_query as suggestion,
                    'popular' as type,
                    'Popular' as category,
                    COUNT(*) as usage_count,
                    similarity(search_query, $1) as score
                FROM user_search_history 
                WHERE search_query % $1
                AND created_at >= NOW() - INTERVAL '30 days'
                ${context !== 'all' ? 'AND search_context = $3' : ''}
                GROUP BY search_query
                HAVING COUNT(*) >= 3
                ORDER BY score DESC, usage_count DESC
                LIMIT $2
            `, context !== 'all' ? [query, limit, context] : [query, limit]);

            return result.rows.map(row => ({
                text: row.suggestion,
                type: row.type,
                category: row.category,
                score: row.score * 0.8, // Menor peso que sugerencias exactas
                usage_count: row.usage_count
            }));

        } catch (error) {
            console.error('Error obteniendo sugerencias populares:', error);
            return [];
        }
    }

    async getPersonalizedSuggestions(query, user_id, limit) {
        try {
            // Sugerencias basadas en el historial personal del usuario
            const result = await this.pool.query(`
                SELECT 
                    search_query as suggestion,
                    'personal' as type,
                    'Tu historial' as category,
                    COUNT(*) as usage_count,
                    similarity(search_query, $1) as score,
                    MAX(created_at) as last_used
                FROM user_search_history 
                WHERE user_id = $2
                AND search_query % $1
                AND created_at >= NOW() - INTERVAL '90 days'
                GROUP BY search_query
                ORDER BY score DESC, last_used DESC, usage_count DESC
                LIMIT $3
            `, [query, user_id, limit]);

            return result.rows.map(row => ({
                text: row.suggestion,
                type: row.type,
                category: row.category,
                score: row.score * 1.1, // Boost para sugerencias personales
                usage_count: row.usage_count,
                last_used: row.last_used
            }));

        } catch (error) {
            console.error('Error obteniendo sugerencias personalizadas:', error);
            return [];
        }
    }

    async getTrendingSuggestions(context, limit) {
        try {
            // Obtener términos de búsqueda trending
            const result = await this.pool.query(`
                SELECT 
                    search_query as suggestion,
                    'trending' as type,
                    'Tendencia' as category,
                    COUNT(*) as usage_count,
                    COUNT(DISTINCT user_id) as unique_users
                FROM user_search_history 
                WHERE created_at >= NOW() - INTERVAL '7 days'
                ${context !== 'all' ? 'AND search_context = $2' : ''}
                GROUP BY search_query
                HAVING COUNT(DISTINCT user_id) >= 2
                ORDER BY unique_users DESC, usage_count DESC
                LIMIT $1
            `, context !== 'all' ? [limit, context] : [limit]);

            return result.rows.map(row => ({
                text: row.suggestion,
                type: row.type,
                category: row.category,
                score: 0.5, // Score base para trending
                usage_count: row.usage_count,
                unique_users: row.unique_users
            }));

        } catch (error) {
            console.error('Error obteniendo trending:', error);
            return [];
        }
    }

    // Sugerencias inteligentes basadas en el contexto
    async getContextualSuggestions(query, context, user_data, limit = 5) {
        try {
            const suggestions = [];

            // Sugerencias basadas en el rol del usuario
            if (user_data.roles?.includes('profesor')) {
                const teacherSuggestions = await this.pool.query(`
                    SELECT DISTINCT 
                        CASE 
                            WHEN $1 ILIKE '%clase%' THEN 'clases para ' || $1
                            WHEN $1 ILIKE '%estudiante%' THEN 'estudiantes en ' || $1
                            WHEN $1 ILIKE '%exam%' THEN 'exámenes de ' || $1
                            ELSE 'material de ' || $1
                        END as suggestion,
                        'contextual' as type,
                        'Para profesores' as category,
                        0.7 as score
                    WHERE length($1) >= 3
                    LIMIT $2
                `, [query, limit]);

                suggestions.push(...teacherSuggestions.rows);
            }

            // Sugerencias basadas en el nivel del usuario
            if (user_data.levels?.creator) {
                const creatorSuggestions = await this.pool.query(`
                    SELECT DISTINCT 
                        CASE 
                            WHEN $1 ILIKE '%bloque%' OR $1 ILIKE '%pregunta%' THEN 'crear ' || $1
                            WHEN $1 ILIKE '%dificil%' THEN $1 || ' avanzado'
                            ELSE $1 || ' para creadores'
                        END as suggestion,
                        'contextual' as type,
                        'Para creadores' as category,
                        0.6 as score
                    WHERE length($1) >= 3
                    LIMIT $2
                `, [query, limit]);

                suggestions.push(...creatorSuggestions.rows);
            }

            return suggestions;

        } catch (error) {
            console.error('Error obteniendo sugerencias contextuales:', error);
            return [];
        }
    }

    // Registrar búsqueda en el historial
    async recordSearch(user_id, query, context, results_count) {
        try {
            await this.pool.query(`
                INSERT INTO user_search_history (user_id, search_query, search_context, results_count)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (user_id, search_query, search_context, DATE(created_at))
                DO UPDATE SET 
                    search_count = user_search_history.search_count + 1,
                    last_searched = NOW(),
                    results_count = $4
            `, [user_id, query, context, results_count]);

        } catch (error) {
            console.error('Error registrando búsqueda:', error);
        }
    }

    // Obtener historial de búsquedas del usuario
    async getUserSearchHistory(user_id, limit = 20) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    search_query,
                    search_context,
                    search_count,
                    results_count,
                    created_at,
                    last_searched
                FROM user_search_history 
                WHERE user_id = $1
                ORDER BY last_searched DESC, search_count DESC
                LIMIT $2
            `, [user_id, limit]);

            return result.rows;

        } catch (error) {
            console.error('Error obteniendo historial de búsquedas:', error);
            return [];
        }
    }

    // Obtener sugerencias de autocompletado rápido
    async getQuickSuggestions(prefix, context = 'all', limit = 5) {
        try {
            if (!prefix || prefix.length < 2) {
                return [];
            }

            const result = await this.pool.query(`
                (
                    SELECT title as suggestion, 'block' as type, 'Bloque' as category
                    FROM blocks 
                    WHERE title ILIKE $1 AND visibility = 'public'
                    LIMIT $2
                )
                UNION ALL
                (
                    SELECT nickname as suggestion, 'user' as type, 'Usuario' as category
                    FROM users 
                    WHERE nickname ILIKE $1
                    LIMIT $2
                )
                UNION ALL
                (
                    SELECT DISTINCT topic as suggestion, 'topic' as type, 'Tema' as category
                    FROM questions q
                    JOIN blocks b ON q.block_id = b.id
                    WHERE topic ILIKE $1 AND b.visibility = 'public'
                    LIMIT $2
                )
                ORDER BY suggestion
                LIMIT $3
            `, [`${prefix}%`, Math.floor(limit / 3), limit]);

            return result.rows;

        } catch (error) {
            console.error('Error obteniendo sugerencias rápidas:', error);
            return [];
        }
    }

    removeDuplicates(suggestions) {
        const seen = new Set();
        return suggestions.filter(suggestion => {
            const key = suggestion.text.toLowerCase();
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    // Limpiar historial de búsquedas antiguo
    async cleanupOldSearchHistory(days = 180) {
        try {
            const result = await this.pool.query(`
                DELETE FROM user_search_history 
                WHERE created_at < NOW() - INTERVAL '${days} days'
                RETURNING COUNT(*) as deleted_count
            `);

            console.log(`Limpieza de historial: ${result.rows[0].deleted_count} registros eliminados`);
            return result.rows[0].deleted_count;

        } catch (error) {
            console.error('Error limpiando historial:', error);
            return 0;
        }
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = SearchSuggestionsSystem;