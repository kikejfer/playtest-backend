const https = require('https');

/**
 * Servicio de búsqueda de imágenes libres de derechos de autor
 * Utiliza múltiples fuentes de imágenes gratuitas
 */

class ImageSearchService {
    constructor() {
        // API keys (en producción deberían estar en variables de entorno)
        this.unsplashAccessKey = process.env.UNSPLASH_ACCESS_KEY || 'demo-key';
        this.fallbackImages = [
            'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=500&h=300&fit=crop', // Books/Study
            'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=500&h=300&fit=crop', // Technology
            'https://images.unsplash.com/photo-1546410531-bb4caa6b424d?w=500&h=300&fit=crop', // Science
            'https://images.unsplash.com/photo-1513475382585-d06e58bcb0e0?w=500&h=300&fit=crop', // Mathematics
            'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=500&h=300&fit=crop', // Art
            'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=500&h=300&fit=crop'  // Education
        ];
    }

    /**
     * Busca una imagen relacionada con la temática del bloque
     * @param {string} blockName - Nombre del bloque
     * @param {string} description - Descripción del bloque
     * @param {string} knowledgeArea - Área de conocimiento
     * @returns {Promise<string>} URL de la imagen encontrada
     */
    async searchImage(blockName, description = '', knowledgeArea = '') {
        try {
            // Crear términos de búsqueda basados en el contenido
            const searchTerms = this.generateSearchTerms(blockName, description, knowledgeArea);
            
            console.log(`🔍 Buscando imagen para: "${blockName}" con términos: ${searchTerms.join(', ')}`);
            
            // Intentar búsqueda en Unsplash
            let imageUrl = await this.searchUnsplash(searchTerms);
            
            if (!imageUrl) {
                // Si no se encuentra en Unsplash, usar Pixabay como fallback
                imageUrl = await this.searchPixabay(searchTerms);
            }
            
            if (!imageUrl) {
                // Si no se encuentra en ningún sitio, usar imagen por defecto basada en categoría
                imageUrl = this.getDefaultImageByCategory(knowledgeArea, blockName);
            }
            
            console.log(`📸 Imagen seleccionada: ${imageUrl}`);
            return imageUrl;
            
        } catch (error) {
            console.error('❌ Error buscando imagen:', error.message);
            return this.getRandomFallbackImage();
        }
    }

    /**
     * Genera términos de búsqueda relevantes
     */
    generateSearchTerms(blockName, description, knowledgeArea) {
        const terms = [];
        
        // Mapeo de categorías a términos de búsqueda en inglés
        const categoryMapping = {
            'matematicas': ['mathematics', 'math', 'education', 'learning'],
            'matematica': ['mathematics', 'math', 'education', 'learning'],
            'ciencias': ['science', 'laboratory', 'research', 'education'],
            'historia': ['history', 'books', 'ancient', 'education'],
            'geografia': ['geography', 'maps', 'world', 'earth'],
            'literatura': ['literature', 'books', 'reading', 'library'],
            'idiomas': ['languages', 'communication', 'learning', 'education'],
            'arte': ['art', 'creativity', 'painting', 'design'],
            'musica': ['music', 'instruments', 'notes', 'education'],
            'educacion': ['education', 'learning', 'school', 'study'],
            'tecnologia': ['technology', 'computer', 'digital', 'programming'],
            'fisica': ['physics', 'science', 'laboratory', 'experiment'],
            'quimica': ['chemistry', 'laboratory', 'science', 'molecules'],
            'biologia': ['biology', 'nature', 'science', 'life']
        };
        
        // Agregar términos basados en área de conocimiento
        const lowerKnowledge = knowledgeArea.toLowerCase();
        for (const [key, values] of Object.entries(categoryMapping)) {
            if (lowerKnowledge.includes(key)) {
                terms.push(...values);
                break;
            }
        }
        
        // Agregar términos basados en el nombre del bloque
        const lowerBlockName = blockName.toLowerCase();
        for (const [key, values] of Object.entries(categoryMapping)) {
            if (lowerBlockName.includes(key)) {
                terms.push(...values);
                break;
            }
        }
        
        // Si no se encontraron términos específicos, usar términos generales
        if (terms.length === 0) {
            terms.push('education', 'learning', 'study', 'knowledge');
        }
        
        // Remover duplicados y limitar a 3 términos principales
        return [...new Set(terms)].slice(0, 3);
    }

    /**
     * Busca imagen en Unsplash
     */
    async searchUnsplash(searchTerms) {
        return new Promise((resolve) => {
            try {
                const query = searchTerms.join(' ');
                const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape&client_id=${this.unsplashAccessKey}`;
                
                const req = https.get(url, (res) => {
                    let data = '';
                    
                    res.on('data', (chunk) => {
                        data += chunk;
                    });
                    
                    res.on('end', () => {
                        try {
                            if (res.statusCode === 200) {
                                const response = JSON.parse(data);
                                if (response.results && response.results.length > 0) {
                                    // Seleccionar una imagen aleatoria de los primeros resultados
                                    const randomIndex = Math.floor(Math.random() * Math.min(response.results.length, 3));
                                    const selectedImage = response.results[randomIndex];
                                    const imageUrl = `${selectedImage.urls.regular}&w=500&h=300&fit=crop`;
                                    resolve(imageUrl);
                                } else {
                                    resolve(null);
                                }
                            } else {
                                console.log('⚠️ Unsplash API error:', res.statusCode);
                                resolve(null);
                            }
                        } catch (parseError) {
                            console.log('⚠️ Error parsing Unsplash response:', parseError.message);
                            resolve(null);
                        }
                    });
                });
                
                req.on('error', (error) => {
                    console.log('⚠️ Unsplash request error:', error.message);
                    resolve(null);
                });
                
                req.setTimeout(5000, () => {
                    console.log('⚠️ Unsplash request timeout');
                    req.destroy();
                    resolve(null);
                });
                
            } catch (error) {
                console.log('⚠️ Error with Unsplash search:', error.message);
                resolve(null);
            }
        });
    }

    /**
     * Busca imagen en Pixabay (fallback)
     */
    async searchPixabay(searchTerms) {
        return new Promise((resolve) => {
            try {
                const query = searchTerms.join(' ');
                const pixabayKey = process.env.PIXABAY_API_KEY || 'demo';
                const url = `https://pixabay.com/api/?key=${pixabayKey}&q=${encodeURIComponent(query)}&image_type=photo&orientation=horizontal&category=education&per_page=5&safesearch=true`;
                
                const req = https.get(url, (res) => {
                    let data = '';
                    
                    res.on('data', (chunk) => {
                        data += chunk;
                    });
                    
                    res.on('end', () => {
                        try {
                            if (res.statusCode === 200) {
                                const response = JSON.parse(data);
                                if (response.hits && response.hits.length > 0) {
                                    const randomIndex = Math.floor(Math.random() * Math.min(response.hits.length, 3));
                                    const selectedImage = response.hits[randomIndex];
                                    resolve(selectedImage.webformatURL);
                                } else {
                                    resolve(null);
                                }
                            } else {
                                resolve(null);
                            }
                        } catch (parseError) {
                            resolve(null);
                        }
                    });
                });
                
                req.on('error', () => resolve(null));
                req.setTimeout(5000, () => {
                    req.destroy();
                    resolve(null);
                });
                
            } catch (error) {
                resolve(null);
            }
        });
    }

    /**
     * Obtiene imagen por defecto basada en categoría
     */
    getDefaultImageByCategory(knowledgeArea, blockName) {
        const categoryImages = {
            'matematicas': 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=500&h=300&fit=crop',
            'ciencias': 'https://images.unsplash.com/photo-1532094349884-543bc11b234d?w=500&h=300&fit=crop',
            'historia': 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=500&h=300&fit=crop',
            'arte': 'https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=500&h=300&fit=crop',
            'tecnologia': 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=500&h=300&fit=crop',
            'idiomas': 'https://images.unsplash.com/photo-1455390582262-044cdead277a?w=500&h=300&fit=crop',
            'musica': 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=500&h=300&fit=crop',
            'fisica': 'https://images.unsplash.com/photo-1636466497217-26a8cbeaf0aa?w=500&h=300&fit=crop',
            'quimica': 'https://images.unsplash.com/photo-1554475901-4538ddfbccc2?w=500&h=300&fit=crop',
            'biologia': 'https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=500&h=300&fit=crop'
        };
        
        const lowerArea = knowledgeArea.toLowerCase();
        const lowerBlock = blockName.toLowerCase();
        
        // Buscar por área de conocimiento
        for (const [key, imageUrl] of Object.entries(categoryImages)) {
            if (lowerArea.includes(key) || lowerBlock.includes(key)) {
                return imageUrl;
            }
        }
        
        // Imagen por defecto para educación
        return 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=500&h=300&fit=crop';
    }

    /**
     * Obtiene imagen aleatoria de fallback
     */
    getRandomFallbackImage() {
        const randomIndex = Math.floor(Math.random() * this.fallbackImages.length);
        return this.fallbackImages[randomIndex];
    }

    /**
     * Valida que una URL de imagen sea accesible
     */
    async validateImageUrl(imageUrl) {
        return new Promise((resolve) => {
            try {
                const req = https.get(imageUrl, (res) => {
                    resolve(res.statusCode === 200 && res.headers['content-type']?.startsWith('image/'));
                });
                
                req.on('error', () => resolve(false));
                req.setTimeout(3000, () => {
                    req.destroy();
                    resolve(false);
                });
                
            } catch (error) {
                resolve(false);
            }
        });
    }
}

module.exports = ImageSearchService;