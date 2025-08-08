# PlayTest Backend API

Backend API para la aplicación PlayTest construida con Node.js, Express y PostgreSQL.

## Configuración Local

### 1. Instalar dependencias
```bash
npm install
```

### 2. Configurar variables de entorno
Copia `.env.example` a `.env` y configura:
```bash
cp .env.example .env
```

### 3. Configurar PostgreSQL
1. Crea una base de datos llamada `playtest_db`
2. Ejecuta el script de migración:
```bash
npm run migrate
```

### 4. Ejecutar en desarrollo
```bash
npm run dev
```

## Despliegue en Render

### 1. Preparar repositorio
1. Inicializa git en el directorio `playtest-backend`:
```bash
git init
git add .
git commit -m "Initial commit"
```

2. Sube a GitHub/GitLab

### 2. Configurar en Render
1. Ve a [render.com](https://render.com)
2. Conecta tu repositorio
3. Usa el archivo `render.yaml` para configuración automática

### 3. Variables de entorno en Render
Render configurará automáticamente:
- `DATABASE_URL` (desde PostgreSQL service)
- `JWT_SECRET` (generado automáticamente)
- `NODE_ENV=production`

## API Endpoints

### Autenticación
- `POST /api/auth/register` - Registro de usuario
- `POST /api/auth/login` - Inicio de sesión
- `GET /api/auth/verify` - Verificar token
- `POST /api/auth/logout` - Cerrar sesión

### Usuarios
- `GET /api/users/profile` - Obtener perfil
- `PUT /api/users/profile` - Actualizar perfil
- `POST /api/users/stats` - Actualizar estadísticas

### Bloques
- `GET /api/blocks` - Obtener todos los bloques
- `POST /api/blocks` - Crear nuevo bloque
- `PUT /api/blocks/:id` - Actualizar bloque
- `DELETE /api/blocks/:id` - Eliminar bloque

### Preguntas
- `POST /api/questions` - Añadir pregunta
- `PUT /api/questions/:id` - Actualizar pregunta
- `DELETE /api/questions/:id` - Eliminar pregunta

### Juegos
- `GET /api/games` - Obtener juegos del usuario
- `GET /api/games/:id` - Obtener juego específico
- `POST /api/games` - Crear nuevo juego
- `PUT /api/games/:id` - Actualizar estado del juego
- `DELETE /api/games/:id` - Eliminar juego
- `POST /api/games/:id/scores` - Guardar puntuación

## Estructura de Base de Datos

Ver `database-schema.sql` para el esquema completo de la base de datos.