const express = require('express');
const { Pool } = require('pg');

// Capa de compatibilidad para rutas después de la migración crítica
class RoutesCompatibilityLayer {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
    }

    // Middleware de compatibilidad para roles
    createRoleCompatibilityMiddleware() {
        return async (req, res, next) => {
            try {
                // Interceptar queries a la tabla roles antigua y redirigir a unified_roles
                const originalQuery = this.pool.query;
                this.pool.query = async function(text, params) {
                    if (typeof text === 'string') {
                        // Reemplazar referencias a tablas antiguas
                        let modifiedText = text
                            .replace(/\buser_roles\b/g, 'unified_user_roles')
                            .replace(/\broles\b(?!\w)/g, 'unified_roles')
                            .replace(/\bluminarias_transactions\b/g, 'unified_luminarias_transactions')
                            .replace(/\buser_luminarias\b/g, 'unified_user_luminarias')
                            .replace(/\bsupport_tickets\b/g, 'unified_tickets');

                        // Ajustar nombres de campos que cambiaron
                        modifiedText = modifiedText
                            .replace(/r\.description/g, 'r.display_name')
                            .replace(/role_name/g, 'name')
                            .replace(/profesor_creador/g, 'creador_contenido')
                            .replace(/admin_principal/g, 'administrador_principal')
                            .replace(/admin_secundario/g, 'administrador_secundario');

                        return originalQuery.call(this, modifiedText, params);
                    }
                    return originalQuery.call(this, text, params);
                };

                next();
            } catch (error) {
                console.error('Error in role compatibility middleware:', error);
                next();
            }
        };
    }

    // Middleware para manejar campos de loaded_blocks
    createLoadedBlocksCompatibilityMiddleware() {
        return (req, res, next) => {
            // Interceptar respuestas y asegurar formato correcto de loaded_blocks
            const originalJson = res.json;
            res.json = function(obj) {
                if (obj && typeof obj === 'object') {
                    // Procesar loaded_blocks en objetos de usuario
                    if (obj.loaded_blocks) {
                        if (typeof obj.loaded_blocks === 'string') {
                            try {
                                obj.loaded_blocks = JSON.parse(obj.loaded_blocks);
                            } catch {
                                obj.loaded_blocks = [];
                            }
                        }
                    }

                    // Procesar arrays de usuarios
                    if (Array.isArray(obj)) {
                        obj = obj.map(item => {
                            if (item && item.loaded_blocks) {
                                if (typeof item.loaded_blocks === 'string') {
                                    try {
                                        item.loaded_blocks = JSON.parse(item.loaded_blocks);
                                    } catch {
                                        item.loaded_blocks = [];
                                    }
                                }
                            }
                            return item;
                        });
                    }

                    // Procesar objetos anidados
                    if (obj.users && Array.isArray(obj.users)) {
                        obj.users = obj.users.map(user => {
                            if (user.loaded_blocks && typeof user.loaded_blocks === 'string') {
                                try {
                                    user.loaded_blocks = JSON.parse(user.loaded_blocks);
                                } catch {
                                    user.loaded_blocks = [];
                                }
                            }
                            return user;
                        });
                    }
                }

                return originalJson.call(this, obj);
            };
            next();
        };
    }

    // Middleware para normalizar respuestas de Luminarias
    createLuminariasCompatibilityMiddleware() {
        return (req, res, next) => {
            const originalJson = res.json;
            res.json = function(obj) {
                if (obj && typeof obj === 'object') {
                    // Normalizar nombres de campos de Luminarias
                    if (obj.current_balance !== undefined) {
                        obj.luminarias = obj.current_balance;
                    }
                    
                    if (Array.isArray(obj)) {
                        obj = obj.map(item => {
                            if (item && item.current_balance !== undefined) {
                                item.luminarias = item.current_balance;
                            }
                            return item;
                        });
                    }

                    // Para respuestas de transacciones
                    if (obj.balance_after !== undefined) {
                        obj.new_balance = obj.balance_after;
                    }
                }

                return originalJson.call(this, obj);
            };
            next();
        };
    }

    // Helper para convertir nombres de roles antiguos a nuevos
    translateRoleName(oldRoleName) {
        const roleMapping = {
            'profesor_creador': 'creador_contenido',
            'admin_principal': 'administrador_principal', 
            'admin_secundario': 'administrador_secundario',
            'user': 'usuario',
            'creator': 'creador_contenido',
            'teacher': 'profesor',
            'admin': 'administrador_principal'
        };

        return roleMapping[oldRoleName] || oldRoleName;
    }

    // Middleware para traducir nombres de roles en requests
    createRoleTranslationMiddleware() {
        return (req, res, next) => {
            // Traducir roles en el body de requests
            if (req.body && req.body.role) {
                req.body.role = this.translateRoleName(req.body.role);
            }

            if (req.body && req.body.roles && Array.isArray(req.body.roles)) {
                req.body.roles = req.body.roles.map(role => this.translateRoleName(role));
            }

            // Traducir roles en query parameters
            if (req.query && req.query.role) {
                req.query.role = this.translateRoleName(req.query.role);
            }

            next();
        };
    }

    // Middleware para manejar campos que cambiaron de nombre
    createFieldMappingMiddleware() {
        return (req, res, next) => {
            const originalJson = res.json;
            res.json = function(obj) {
                if (obj && typeof obj === 'object') {
                    // Mapear campos de roles
                    if (obj.display_name && !obj.description) {
                        obj.description = obj.display_name;
                    }

                    // Mapear arrays
                    if (Array.isArray(obj)) {
                        obj = obj.map(item => {
                            if (item && item.display_name && !item.description) {
                                item.description = item.display_name;
                            }
                            return item;
                        });
                    }

                    // Mapear objetos anidados
                    if (obj.roles && Array.isArray(obj.roles)) {
                        obj.roles = obj.roles.map(role => {
                            if (role.display_name && !role.description) {
                                role.description = role.display_name;
                            }
                            return role;
                        });
                    }
                }

                return originalJson.call(this, obj);
            };
            next();
        };
    }

    // Función para aplicar todos los middlewares de compatibilidad
    applyCompatibilityMiddlewares(app) {
        console.log('🔄 Aplicando middlewares de compatibilidad...');
        
        // Aplicar middlewares en orden
        app.use(this.createRoleTranslationMiddleware());
        app.use(this.createLoadedBlocksCompatibilityMiddleware());
        app.use(this.createLuminariasCompatibilityMiddleware());
        app.use(this.createFieldMappingMiddleware());
        
        // Middleware específico para rutas de API
        app.use('/api', this.createRoleCompatibilityMiddleware());
        
        console.log('✅ Middlewares de compatibilidad aplicados');
    }

    // Función helper para ejecutar queries con compatibilidad automática
    async compatibleQuery(text, params = []) {
        try {
            // Aplicar transformaciones automáticas
            let modifiedText = text;
            
            if (typeof text === 'string') {
                modifiedText = text
                    .replace(/\buser_roles\b/g, 'unified_user_roles')
                    .replace(/\broles\b(?!\w)/g, 'unified_roles')
                    .replace(/\bluminarias_transactions\b/g, 'unified_luminarias_transactions')
                    .replace(/\buser_luminarias\b/g, 'unified_user_luminarias')
                    .replace(/\bsupport_tickets\b/g, 'unified_tickets')
                    .replace(/r\.description/g, 'r.display_name')
                    .replace(/profesor_creador/g, 'creador_contenido')
                    .replace(/admin_principal/g, 'administrador_principal')
                    .replace(/admin_secundario/g, 'administrador_secundario');
            }

            const result = await this.pool.query(modifiedText, params);

            // Post-procesar resultados
            if (result.rows) {
                result.rows = result.rows.map(row => {
                    // Convertir loaded_blocks de string a array si es necesario
                    if (row.loaded_blocks && typeof row.loaded_blocks === 'string') {
                        try {
                            row.loaded_blocks = JSON.parse(row.loaded_blocks);
                        } catch {
                            row.loaded_blocks = [];
                        }
                    }

                    // Mapear current_balance a luminarias para compatibilidad
                    if (row.current_balance !== undefined) {
                        row.luminarias = row.current_balance;
                    }

                    // Mapear display_name a description para compatibilidad
                    if (row.display_name && !row.description) {
                        row.description = row.display_name;
                    }

                    return row;
                });
            }

            return result;

        } catch (error) {
            console.error('Error in compatible query:', error);
            throw error;
        }
    }

    // Función para verificar el estado de la migración
    async checkMigrationStatus() {
        try {
            const requiredTables = [
                'unified_roles',
                'unified_user_roles',
                'unified_user_luminarias', 
                'unified_luminarias_transactions',
                'unified_tickets'
            ];

            const status = {
                migration_complete: true,
                missing_tables: [],
                compatibility_views: true,
                errors: []
            };

            for (const table of requiredTables) {
                const exists = await this.pool.query(`
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.tables 
                        WHERE table_name = $1
                    )
                `, [table]);

                if (!exists.rows[0].exists) {
                    status.migration_complete = false;
                    status.missing_tables.push(table);
                }
            }

            // Verificar vistas de compatibilidad
            const compatibilityViews = ['roles', 'user_roles', 'user_luminarias', 'luminarias_transactions'];
            
            for (const view of compatibilityViews) {
                const exists = await this.pool.query(`
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.views 
                        WHERE table_name = $1
                    )
                `, [view]);

                if (!exists.rows[0].exists) {
                    status.compatibility_views = false;
                    status.errors.push(`Vista de compatibilidad '${view}' no existe`);
                }
            }

            return status;

        } catch (error) {
            return {
                migration_complete: false,
                error: error.message
            };
        }
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = RoutesCompatibilityLayer;