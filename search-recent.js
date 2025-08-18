const { Pool } = require('pg');

// Sistema de búsquedas recientes para PLAYTEST
class RecentSearchSystem {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
        
        // Cache local para búsquedas frecuentes
        this.recentCache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutos
    }

    // Registrar una nueva búsqueda
    async recordSearch(user_id, search_data) {
        try {
            const {
                query,
                context = 'all',
                filters = {},
                results_count = 0,
                execution_time_ms = 0
            } = search_data;

            // Insertar en base de datos
            const result = await this.pool.query(`
                INSERT INTO user_search_history (
                    user_id, 
                    search_query, 
                    search_context, 
                    search_filters, 
                    results_count,
                    execution_time_ms,
                    created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
                ON CONFLICT (user_id, search_query, search_context, DATE(created_at))
                DO UPDATE SET 
                    search_count = user_search_history.search_count + 1,
                    last_searched_at = NOW(),
                    results_count = $5,
                    execution_time_ms = $6,
                    search_filters = $4
                RETURNING id
            `, [
                user_id, 
                query, 
                context, 
                JSON.stringify(filters), 
                results_count,
                execution_time_ms
            ]);

            // Limpiar cache del usuario
            this.invalidateUserCache(user_id);

            // Limpiar búsquedas antiguas (mantener solo las últimas 100 por usuario)
            await this.cleanupUserSearches(user_id);

            return result.rows[0].id;

        } catch (error) {
            console.error('Error registrando búsqueda:', error);
            throw error;
        }
    }

    // Obtener búsquedas recientes del usuario
    async getRecentSearches(user_id, options = {}) {
        try {
            const {
                limit = 20,
                context = null,
                include_filters = false,
                days_back = 30
            } = options;

            // Verificar cache primero
            const cacheKey = `recent_${user_id}_${limit}_${context}_${days_back}`;
            const cached = this.getFromCache(cacheKey);
            if (cached) {
                return cached;
            }

            let query = `
                SELECT 
                    id,
                    search_query,
                    search_context,
                    ${include_filters ? 'search_filters,' : ''}
                    results_count,
                    search_count,
                    execution_time_ms,
                    created_at,
                    last_searched_at,
                    -- Calcular relevancia basada en frecuencia y recencia
                    (
                        search_count * 0.3 + 
                        EXTRACT(EPOCH FROM (NOW() - last_searched_at)) / 86400 * -0.1 +
                        CASE WHEN results_count > 0 THEN 1.0 ELSE 0.5 END
                    ) as relevance_score
                FROM user_search_history 
                WHERE user_id = $1 
                AND created_at >= NOW() - INTERVAL '${days_back} days'
            `;

            const params = [user_id];
            let paramIndex = 2;

            if (context) {
                query += ` AND search_context = $${paramIndex}`;
                params.push(context);
                paramIndex++;
            }

            query += ` ORDER BY relevance_score DESC, last_searched_at DESC LIMIT $${paramIndex}`;
            params.push(limit);

            const result = await this.pool.query(query, params);

            // Procesar resultados
            const searches = result.rows.map(row => ({
                id: row.id,
                query: row.search_query,
                context: row.search_context,
                filters: include_filters ? JSON.parse(row.search_filters || '{}') : undefined,
                results_count: row.results_count,
                search_count: row.search_count,
                execution_time_ms: row.execution_time_ms,
                created_at: row.created_at,
                last_searched_at: row.last_searched_at,
                relevance_score: parseFloat(row.relevance_score)
            }));

            // Guardar en cache
            this.setCache(cacheKey, searches);

            return searches;

        } catch (error) {
            console.error('Error obteniendo búsquedas recientes:', error);
            return [];
        }
    }

    // Obtener búsquedas populares del usuario
    async getPopularSearches(user_id, limit = 10) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    search_query,
                    search_context,
                    search_count,
                    AVG(results_count) as avg_results,
                    MAX(last_searched_at) as last_used,
                    COUNT(DISTINCT DATE(created_at)) as days_used
                FROM user_search_history 
                WHERE user_id = $1 
                AND created_at >= NOW() - INTERVAL '90 days'
                GROUP BY search_query, search_context
                HAVING search_count >= 2
                ORDER BY search_count DESC, avg_results DESC
                LIMIT $2
            `, [user_id, limit]);

            return result.rows.map(row => ({
                query: row.search_query,
                context: row.search_context,
                search_count: row.search_count,
                avg_results: Math.round(row.avg_results),
                last_used: row.last_used,
                days_used: row.days_used
            }));

        } catch (error) {
            console.error('Error obteniendo búsquedas populares:', error);
            return [];
        }
    }

    // Obtener búsquedas similares
    async getSimilarSearches(user_id, current_query, limit = 5) {
        try {
            const result = await this.pool.query(`
                SELECT DISTINCT
                    search_query,
                    search_context,
                    search_count,
                    results_count,
                    last_searched_at,
                    similarity(search_query, $2) as similarity_score
                FROM user_search_history 
                WHERE user_id = $1 
                AND search_query != $2
                AND similarity(search_query, $2) > 0.3
                AND created_at >= NOW() - INTERVAL '60 days'
                ORDER BY similarity_score DESC, search_count DESC
                LIMIT $3
            `, [user_id, current_query, limit]);

            return result.rows.map(row => ({
                query: row.search_query,
                context: row.search_context,
                search_count: row.search_count,
                results_count: row.results_count,
                last_searched_at: row.last_searched_at,
                similarity_score: parseFloat(row.similarity_score)
            }));

        } catch (error) {
            console.error('Error obteniendo búsquedas similares:', error);
            return [];
        }
    }

    // Eliminar una búsqueda específica del historial
    async deleteSearch(user_id, search_id) {
        try {
            const result = await this.pool.query(`
                DELETE FROM user_search_history 
                WHERE id = $1 AND user_id = $2
                RETURNING search_query
            `, [search_id, user_id]);

            if (result.rows.length > 0) {
                this.invalidateUserCache(user_id);
                return { deleted: true, query: result.rows[0].search_query };
            }

            return { deleted: false };

        } catch (error) {
            console.error('Error eliminando búsqueda:', error);
            throw error;
        }
    }

    // Limpiar todo el historial del usuario
    async clearUserHistory(user_id, days_to_keep = 0) {
        try {
            let query = 'DELETE FROM user_search_history WHERE user_id = $1';
            const params = [user_id];

            if (days_to_keep > 0) {
                query += ` AND created_at < NOW() - INTERVAL '${days_to_keep} days'`;
            }

            const result = await this.pool.query(query + ' RETURNING COUNT(*)', params);
            
            this.invalidateUserCache(user_id);
            
            return {
                deleted_count: result.rows.length > 0 ? result.rows[0].count : 0
            };

        } catch (error) {
            console.error('Error limpiando historial:', error);
            throw error;
        }
    }

    // Obtener estadísticas de búsqueda del usuario
    async getUserSearchStats(user_id, days_back = 30) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    COUNT(*) as total_searches,
                    COUNT(DISTINCT search_query) as unique_queries,
                    COUNT(DISTINCT search_context) as contexts_used,
                    AVG(results_count) as avg_results_per_search,
                    AVG(execution_time_ms) as avg_execution_time,
                    SUM(CASE WHEN results_count > 0 THEN 1 ELSE 0 END) as successful_searches,
                    MAX(last_searched_at) as last_search_date,
                    -- Top contexto
                    (
                        SELECT search_context 
                        FROM user_search_history ush2 
                        WHERE ush2.user_id = $1 
                        AND ush2.created_at >= NOW() - INTERVAL '${days_back} days'
                        GROUP BY search_context 
                        ORDER BY COUNT(*) DESC 
                        LIMIT 1
                    ) as top_context,
                    -- Query más popular
                    (
                        SELECT search_query 
                        FROM user_search_history ush3 
                        WHERE ush3.user_id = $1 
                        AND ush3.created_at >= NOW() - INTERVAL '${days_back} days'
                        GROUP BY search_query 
                        ORDER BY search_count DESC 
                        LIMIT 1
                    ) as most_popular_query
                FROM user_search_history 
                WHERE user_id = $1 
                AND created_at >= NOW() - INTERVAL '${days_back} days'
            `, [user_id]);

            const stats = result.rows[0];
            
            return {
                total_searches: parseInt(stats.total_searches) || 0,
                unique_queries: parseInt(stats.unique_queries) || 0,
                contexts_used: parseInt(stats.contexts_used) || 0,
                avg_results_per_search: parseFloat(stats.avg_results_per_search) || 0,
                avg_execution_time: parseFloat(stats.avg_execution_time) || 0,
                successful_searches: parseInt(stats.successful_searches) || 0,
                success_rate: stats.total_searches > 0 ? 
                    (stats.successful_searches / stats.total_searches * 100).toFixed(1) : '0.0',
                last_search_date: stats.last_search_date,
                top_context: stats.top_context,
                most_popular_query: stats.most_popular_query
            };

        } catch (error) {
            console.error('Error obteniendo estadísticas:', error);
            return {};
        }
    }

    // Obtener búsquedas agrupadas por contexto
    async getSearchesByContext(user_id, limit = 10) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    search_context,
                    COUNT(*) as search_count,
                    COUNT(DISTINCT search_query) as unique_queries,
                    AVG(results_count) as avg_results,
                    MAX(last_searched_at) as last_activity,
                    ARRAY_AGG(
                        DISTINCT search_query 
                        ORDER BY search_count DESC
                    ) FILTER (WHERE search_query IS NOT NULL) 
                    SLICE 1:5 as top_queries
                FROM user_search_history 
                WHERE user_id = $1 
                AND created_at >= NOW() - INTERVAL '60 days'
                GROUP BY search_context
                ORDER BY search_count DESC
                LIMIT $2
            `, [user_id, limit]);

            return result.rows.map(row => ({
                context: row.search_context,
                search_count: parseInt(row.search_count),
                unique_queries: parseInt(row.unique_queries),
                avg_results: parseFloat(row.avg_results),
                last_activity: row.last_activity,
                top_queries: row.top_queries || []
            }));

        } catch (error) {
            console.error('Error obteniendo búsquedas por contexto:', error);
            return [];
        }
    }

    // Limpiar búsquedas antiguas del usuario (mantener solo las más recientes)
    async cleanupUserSearches(user_id, keep_count = 100) {
        try {
            await this.pool.query(`
                DELETE FROM user_search_history 
                WHERE user_id = $1 
                AND id NOT IN (
                    SELECT id FROM user_search_history 
                    WHERE user_id = $1 
                    ORDER BY last_searched_at DESC 
                    LIMIT $2
                )
            `, [user_id, keep_count]);

        } catch (error) {
            console.error('Error limpiando búsquedas del usuario:', error);
        }
    }

    // Gestión de cache
    getFromCache(key) {
        const cached = this.recentCache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }
        this.recentCache.delete(key);
        return null;
    }

    setCache(key, data) {
        this.recentCache.set(key, {
            data: data,
            timestamp: Date.now()
        });

        // Limitar tamaño del cache
        if (this.recentCache.size > 1000) {
            const oldestKey = this.recentCache.keys().next().value;
            this.recentCache.delete(oldestKey);
        }
    }

    invalidateUserCache(user_id) {
        for (const key of this.recentCache.keys()) {
            if (key.includes(`_${user_id}_`)) {
                this.recentCache.delete(key);
            }
        }
    }

    // Limpiar cache periódicamente
    startCacheCleanup() {
        setInterval(() => {
            const now = Date.now();
            for (const [key, value] of this.recentCache.entries()) {
                if (now - value.timestamp > this.cacheTimeout) {
                    this.recentCache.delete(key);
                }
            }
        }, this.cacheTimeout);
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = RecentSearchSystem;