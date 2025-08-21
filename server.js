const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// Trust proxy for Render.com
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(compression());

// Rate limiting - more generous for question uploads
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000 // limit each IP to 1000 requests per windowMs (increased for bulk uploads)
});

const questionLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 200 // Allow more question uploads in shorter window
});

app.use('/api', generalLimiter);
app.use('/api/questions', questionLimiter);

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://localhost:58500',
      'https://playtest-frontend.onrender.com',
      process.env.FRONTEND_URL
    ].filter(Boolean); // Remove undefined/null values
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log(`❌ CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  preflightContinue: false,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Configure Socket.IO with CORS
const io = new Server(server, {
  cors: corsOptions,
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// Apply compatibility middlewares before routes
// (This will be configured after compatibility layer is created)

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const blockRoutes = require('./routes/blocks');
const questionRoutes = require('./routes/questions');
const gameRoutes = require('./routes/games');
const roleRoutes = require('./routes/roles');
const rolesUpdatedRoutes = require('./routes/roles-updated');
const communicationRoutes = require('./routes/communication');
const supportRoutes = require('./routes/support');
const challengesRoutes = require('./routes/challenges');
const challengesAdvancedRoutes = require('./routes/challenges-advanced');
const levelsRoutes = require('./routes/levels');
const featureFlagsRoutes = require('./routes/feature-flags');
const userPreferencesRoutes = require('./routes/user-preferences');
const gameStatesRoutes = require('./routes/game-states');

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/blocks', blockRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/roles-updated', rolesUpdatedRoutes);
app.use('/api/communication', communicationRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/challenges', challengesRoutes);
app.use('/api/challenges-advanced', challengesAdvancedRoutes);
app.use('/api/levels', levelsRoutes);
app.use('/api/feature-flags', featureFlagsRoutes);
app.use('/api/user-preferences', userPreferencesRoutes);
app.use('/api/game-states', gameStatesRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Auto-setup status endpoint
app.get('/api/setup/status', async (req, res) => {
  try {
    const status = await autoSetup.checkStatus();
    res.json({
      status: 'OK',
      autoSetup: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Initialize escalation scheduler
const EscalationScheduler = require('./setup-cron');
const escalationScheduler = new EscalationScheduler();

// Initialize support automation system
const supportAutomation = require('./support-automation');

// Auto-setup system
const autoSetup = require('./auto-setup');

// Levels system setup
const LevelsSetup = require('./levels-setup');

// Real-time events system
const RealTimeEvents = require('./realtime-events');
const realTimeEvents = new RealTimeEvents(io);

// Routes compatibility layer for unified tables
const RoutesCompatibilityLayer = require('./routes-compatibility-layer');
const compatibilityLayer = new RoutesCompatibilityLayer();

// Make schedulers globally accessible for API routes
global.escalationScheduler = escalationScheduler;
global.supportAutomation = supportAutomation;
global.realTimeEvents = realTimeEvents;
global.compatibilityLayer = compatibilityLayer;

server.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Environment: ${process.env.NODE_ENV}`);
  console.log(`🔌 WebSocket server enabled`);
  
  // Apply compatibility middlewares after all systems are initialized
  compatibilityLayer.applyCompatibilityMiddlewares(app);
  
  // Check migration status
  const migrationStatus = await compatibilityLayer.checkMigrationStatus();
  if (migrationStatus.migration_complete) {
    console.log('✅ Sistema de tablas unificadas verificado');
  } else {
    console.log('⚠️  Sistema requiere migración de tablas unificadas');
    console.log('💡 Ejecuta: node critical-fixes-migration.js');
  }
  
  // Run auto-setup (only executes if needed)
  await autoSetup.runAutoSetup();
  
  // Initialize levels system
  const levelsSetup = new LevelsSetup();
  try {
    const levelsHealth = await levelsSetup.checkSystemHealth();
    if (levelsHealth.status === 'healthy') {
      console.log('🏆 Sistema de niveles verificado y funcionando');
      
      // Start periodic calculations
      setInterval(async () => {
        try {
          await levelsSetup.processAsyncCalculations();
        } catch (error) {
          console.error('Error en cálculos automáticos de niveles:', error);
        }
      }, 5 * 60 * 1000); // Cada 5 minutos
      
    } else {
      console.log('⚠️  Sistema de niveles requiere configuración inicial');
      console.log('💡 Ejecuta: node complete-levels-migration.js');
    }
  } catch (levelsError) {
    console.error('❌ Error verificando sistema de niveles:', levelsError);
  }
  
  // Start escalation scheduler
  escalationScheduler.start();
  
  // Start support automation system
  supportAutomation.start().then(() => {
    console.log('🤖 Sistema de automatización de soporte iniciado');
  }).catch(err => {
    console.error('❌ Error iniciando sistema de automatización:', err);
  });
});

console.log('Deploy timestamp:', new Date().toISOString());
