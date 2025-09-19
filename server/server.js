const express = require("express");
const http = require("http");
const socketIo = require("socket.io");

// Import optimization agents
const { SpatialPartitioningAgent } = require('./agents/SpatialPartitioningAgent');
const RelevancyScoreAgent = require('./agents/RelevancyScoreAgent');
const { PredictiveCullingAgent } = require('./agents/PredictiveCullingAgent');
const { NetworkAdaptationAgent } = require('./agents/NetworkAdaptationAgent');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket"],
  // transports: ["websocket", "polling"],
  allowEIO3: true,
  // Enhanced compression settings
  compression: true,
  httpCompression: {
    threshold: 1024, // Compress messages larger than 1KB
    level: 6, // Compression level (1-9, 6 is good balance)
    chunkSize: 1024,
  },
  // Optimize for performance
  perMessageDeflate: {
    threshold: 1024,
    zlibDeflateOptions: {
      level: 6,
      chunkSize: 1024,
    },
  },
  // Connection optimization
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 10000,
  maxHttpBufferSize: 1e6, // 1MB max message size
});

// Token validation utility
function validateToken(token) {
  if (!token) {
    return { valid: false, reason: "No token provided" };
  }

  // Basic token format validation
  if (typeof token !== "string" || token.length < 10) {
    return { valid: false, reason: "Invalid token format" };
  }

  // For now, we'll accept any properly formatted token
  // In production, you would validate against your auth service
  return { valid: true, token };
}

// Socket authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  const userData = socket.handshake.auth.userData;

  console.log("🔐 Socket authentication attempt:", {
    socketId: socket.id,
    hasToken: !!token,
    hasUserData: !!userData,
    isLoggedIn: userData?.isLoggedIn,
  });

  if (token) {
    const validation = validateToken(token);
    if (validation.valid) {
      // Store authenticated user info in socket data
      socket.data.isAuthenticated = true;
      socket.data.token = token;
      socket.data.userData = userData;
      socket.data.openId = userData?.openId;
      socket.data.userInfo = userData?.userInfo;
      console.log("✅ Socket authenticated successfully:", socket.id);

      // Emit authentication success after connection
      socket.on("connect", () => {
        socket.emit("auth_success", {
          authenticated: true,
          openId: userData?.openId,
          userInfo: userData?.userInfo,
        });
      });
    } else {
      console.log("❌ Token validation failed:", validation.reason);
      // Allow connection but mark as unauthenticated
      socket.data.isAuthenticated = false;

      // Emit authentication error after connection
      socket.on("connect", () => {
        socket.emit("auth_error", {
          error: "Token validation failed",
          reason: validation.reason,
        });
      });
    }
  } else {
    // Allow Player connections
    socket.data.isAuthenticated = false;
    console.log("👤 Player connection allowed:", socket.id);
  }

  next(); // Always allow connection, but track auth status
});

const MIN_PLAYERS_FOR_BATTLE = 5;
const MAX_BOTS = MIN_PLAYERS_FOR_BATTLE;
const POINT = 3; // Points awarded for eating food or dead points
const FOOD_RADIUS = 5.5;

// Client rendering - smooth visuals
// const RENDER_FPS = 60; // 16ms
// Network updates - optimized bandwidth  
const RENDER_FPS = 50; // 15ms 
// const RENDER_FPS = 20; // 50ms 
// Game logic - consistent gameplay
// const RENDER_FPS = 30; // 33ms

// Bot management throttling
let lastBotSpawnAttempt = 0;
let lastBotLimitLog = 0;
const BOT_SPAWN_COOLDOWN = 2000; // 2 seconds between spawn attempts
const BOT_LOG_THROTTLE = 5000; // 5 seconds between limit logs

// ===== SERVER PERFORMANCE OPTIMIZATION CONFIGURATION =====

// Server State Management
const SERVER_STATES = {
  ACTIVE: "active",
  PAUSED: "paused",
  RESUMING: "resuming",
};

let serverState = SERVER_STATES.ACTIVE;
let pauseTimeout = null;
let gameLoopIntervals = [];

// Performance Configuration
const PERFORMANCE_CONFIG = {
  // Server state management
  PAUSE_DELAY: 30000, // 30 seconds of no players before pausing
  RESUME_TIMEOUT: 1000, // 1 second to fully resume

  // Dead point cleanup
  MAX_DEAD_POINTS: 2000,
  CLEANUP_THRESHOLD: 1500,
  CLEANUP_BATCH_SIZE: 500,
  CLEANUP_INTERVAL: 30000, // 30 seconds

  // Bot management optimization
  IDLE_BOT_UPDATE_INTERVAL: 1000, // 1 second when no players
  ACTIVE_BOT_UPDATE_INTERVAL: 100, // 100ms when players present
  MIN_BOTS_IDLE: 2,
  MAX_BOTS_IDLE: 3,
  MIN_BOTS_ACTIVE: 3,
  MAX_BOTS_ACTIVE: MAX_BOTS,

  // Memory monitoring
  MEMORY_CHECK_INTERVAL: 5000, // 5 seconds
  MEMORY_WARNING_THRESHOLD: 150 * 1024 * 1024, // 150MB
  MEMORY_CRITICAL_THRESHOLD: 200 * 1024 * 1024, // 200MB

  // Performance metrics
  METRICS_LOG_INTERVAL: 30000, // 30 seconds
};

// Performance Metrics
const performanceMetrics = {
  serverStartTime: Date.now(),
  totalPlayers: 0,
  totalBots: 0,
  deadPointsCreated: 0,
  deadPointsCleanedUp: 0,
  memoryUsage: { rss: 0, heapUsed: 0, heapTotal: 0 },
  cpuUsage: 0,
  stateTransitions: 0,
  lastMetricsLog: Date.now(),

  // Enhanced performance tracking
  botUpdates: 0,
  botMaintenanceCycles: 0,
  playerConnections: 0,
  playerDisconnections: 0,
  foodEaten: 0,
  deadPointsEaten: 0,
  memoryCleanups: 0,
  aggressiveCleanups: 0,
  serverPauses: 0,
  serverResumes: 0,

  // Performance timing
  avgResponseTime: 0,
  maxResponseTime: 0,
  totalRequests: 0,

  // Game state metrics
  peakPlayerCount: 0,
  peakDeadPointCount: 0,
  totalGameTime: 0,
};

// Memory monitoring state
let memoryMonitorInterval = null;
let lastMemoryCleanup = Date.now();

// Performance metrics interval
let performanceMetricsInterval = null;

// ===== MEMORY MONITORING SYSTEM =====

// Start memory monitoring with automatic cleanup triggers
function startMemoryMonitoring() {
  if (memoryMonitorInterval) clearInterval(memoryMonitorInterval);

  memoryMonitorInterval = setInterval(() => {
    const memUsage = process.memoryUsage();
    performanceMetrics.memoryUsage = memUsage;

    // Check memory thresholds and trigger cleanup if needed
    if (memUsage.heapUsed > PERFORMANCE_CONFIG.MEMORY_CRITICAL_THRESHOLD) {
      console.log(
        `🚨 MEMORY CRITICAL: ${(memUsage.heapUsed / 1024 / 1024).toFixed(
          1
        )}MB - Forcing aggressive cleanup`
      );
      performAggressiveCleanup();
    } else if (
      memUsage.heapUsed > PERFORMANCE_CONFIG.MEMORY_WARNING_THRESHOLD
    ) {
      console.log(
        `⚠️ MEMORY WARNING: ${(memUsage.heapUsed / 1024 / 1024).toFixed(
          1
        )}MB - Performing cleanup`
      );
      performMemoryCleanup();
    }

    // Log memory stats every 5 minutes
    if (Date.now() - performanceMetrics.lastMetricsLog > 300000) {
      logMemoryStats();
      performanceMetrics.lastMetricsLog = Date.now();
    }
  }, 10000); // Check every 10 seconds
}

// Perform standard memory cleanup
function performMemoryCleanup() {
  const currentTime = Date.now();
  if (currentTime - lastMemoryCleanup < 30000) return; // Throttle cleanup to every 30 seconds

  lastMemoryCleanup = currentTime;
  console.log("🧹 MEMORY: Starting standard cleanup");

  // Force dead point cleanup
  performSmartDeadPointCleanup(true);

  // Remove old disconnected players
  cleanupDisconnectedPlayers();

  // Trigger garbage collection if available
  if (global.gc) {
    global.gc();
    console.log("🗑️ MEMORY: Garbage collection triggered");
  }

  // Track cleanup metrics
  performanceMetrics.memoryCleanups++;
}

// Perform aggressive cleanup for critical memory situations
function performAggressiveCleanup() {
  console.log("🚨 MEMORY: Starting aggressive cleanup");

  // Remove 50% of dead points immediately
  const deadPointsToRemove = Math.floor(gameState.deadPoints.length * 0.5);
  if (deadPointsToRemove > 0) {
    gameState.deadPoints.splice(0, deadPointsToRemove);
    performanceMetrics.deadPointsCleanedUp += deadPointsToRemove;
    console.log(
      `🧹 MEMORY: Removed ${deadPointsToRemove} dead points aggressively`
    );
  }

  // Remove excess bots if any
  const bots = Array.from(gameState.players.values()).filter((p) => p.isBot);
  const botsToRemove = Math.max(0, bots.length - 3); // Keep minimum 3 bots
  for (let i = 0; i < botsToRemove; i++) {
    gameState.players.delete(bots[i].id);
  }

  // Force garbage collection multiple times
  if (global.gc) {
    for (let i = 0; i < 3; i++) {
      global.gc();
    }
    console.log("🗑️ MEMORY: Aggressive garbage collection completed");
  }

  // Track aggressive cleanup metrics
  performanceMetrics.aggressiveCleanups++;

  lastMemoryCleanup = Date.now();
}

// Clean up old disconnected players
function cleanupDisconnectedPlayers() {
  const currentTime = Date.now();
  let cleanedCount = 0;

  for (const [playerId, player] of gameState.players.entries()) {
    // Remove players that have been disconnected for more than 5 minutes
    if (
      !player.alive &&
      !player.isBot &&
      player.lastActivity &&
      currentTime - player.lastActivity > 300000
    ) {
      gameState.players.delete(playerId);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    console.log(
      `🧹 MEMORY: Cleaned up ${cleanedCount} old disconnected players`
    );
  }
}

// Log detailed memory statistics
function logMemoryStats() {
  const memUsage = process.memoryUsage();
  const uptime = Date.now() - performanceMetrics.serverStartTime;

  console.log("📊 MEMORY STATS:");
  console.log(`  RSS: ${(memUsage.rss / 1024 / 1024).toFixed(1)}MB`);
  console.log(`  Heap Used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)}MB`);
  console.log(
    `  Heap Total: ${(memUsage.heapTotal / 1024 / 1024).toFixed(1)}MB`
  );
  console.log(`  External: ${(memUsage.external / 1024 / 1024).toFixed(1)}MB`);
  console.log(
    `  Players: ${gameState.players.size} (${
      Array.from(gameState.players.values()).filter((p) => !p.isBot).length
    } human, ${
      Array.from(gameState.players.values()).filter((p) => p.isBot).length
    } bots)`
  );
  console.log(`  Dead Points: ${gameState.deadPoints.length}`);
  console.log(`  Uptime: ${Math.floor(uptime / 60000)} minutes`);
  console.log(`  Server State: ${serverState}`);
}

// Comprehensive performance metrics logging
function logPerformanceMetrics() {
  const currentTime = Date.now();
  const uptime = currentTime - performanceMetrics.serverStartTime;
  const uptimeMinutes = Math.floor(uptime / 60000);
  const memUsage = process.memoryUsage();

  console.log("\n🚀 ===== PERFORMANCE METRICS REPORT =====");
  console.log(`⏱️  Server Uptime: ${uptimeMinutes} minutes`);
  console.log(`🌐 Server State: ${serverState}`);

  // Player metrics
  const humanPlayers = Array.from(gameState.players.values()).filter(
    (p) => !p.isBot
  ).length;
  const botPlayers = Array.from(gameState.players.values()).filter(
    (p) => p.isBot
  ).length;
  console.log(`\n👥 PLAYER METRICS:`);
  console.log(
    `  Current Players: ${gameState.players.size} (${humanPlayers} human, ${botPlayers} bots)`
  );
  console.log(`  Peak Players: ${performanceMetrics.peakPlayerCount}`);
  console.log(`  Total Connections: ${performanceMetrics.playerConnections}`);
  console.log(
    `  Total Disconnections: ${performanceMetrics.playerDisconnections}`
  );

  // Game activity metrics
  console.log(`\n🎮 GAME ACTIVITY:`);
  console.log(`  Food Eaten: ${performanceMetrics.foodEaten}`);
  console.log(`  Dead Points Eaten: ${performanceMetrics.deadPointsEaten}`);
  console.log(`  Dead Points Created: ${performanceMetrics.deadPointsCreated}`);
  console.log(
    `  Dead Points Cleaned: ${performanceMetrics.deadPointsCleanedUp}`
  );
  console.log(`  Current Dead Points: ${gameState.deadPoints.length}`);
  console.log(`  Peak Dead Points: ${performanceMetrics.peakDeadPointCount}`);

  // Bot performance metrics
  console.log(`\n🤖 BOT PERFORMANCE:`);
  console.log(`  Bot Updates: ${performanceMetrics.botUpdates}`);
  console.log(
    `  Bot Maintenance Cycles: ${performanceMetrics.botMaintenanceCycles}`
  );
  console.log(
    `  Updates per Minute: ${
      uptimeMinutes > 0
        ? Math.round(performanceMetrics.botUpdates / uptimeMinutes)
        : 0
    }`
  );

  // Memory and cleanup metrics
  console.log(`\n🧹 CLEANUP & MEMORY:`);
  console.log(`  Memory Cleanups: ${performanceMetrics.memoryCleanups}`);
  console.log(
    `  Aggressive Cleanups: ${performanceMetrics.aggressiveCleanups}`
  );
  console.log(
    `  Current Memory: ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)}MB`
  );
  console.log(
    `  Memory Efficiency: ${
      gameState.deadPoints.length > 0
        ? Math.round(
            gameState.deadPoints.length / (memUsage.heapUsed / 1024 / 1024)
          )
        : "N/A"
    } points/MB`
  );

  // Server state metrics
  console.log(`\n⚡ SERVER STATE:`);
  console.log(`  State Transitions: ${performanceMetrics.stateTransitions}`);
  console.log(`  Server Pauses: ${performanceMetrics.serverPauses}`);
  console.log(`  Server Resumes: ${performanceMetrics.serverResumes}`);

  // Performance timing (if available)
  if (performanceMetrics.totalRequests > 0) {
    console.log(`\n📈 RESPONSE TIMES:`);
    console.log(
      `  Average Response: ${performanceMetrics.avgResponseTime.toFixed(2)}ms`
    );
    console.log(
      `  Max Response: ${performanceMetrics.maxResponseTime.toFixed(2)}ms`
    );
    console.log(`  Total Requests: ${performanceMetrics.totalRequests}`);
  }

  console.log("========================================\n");

  // Update last metrics log time
  performanceMetrics.lastMetricsLog = currentTime;
}

// Update peak metrics tracking
function updatePeakMetrics() {
  const currentPlayers = gameState.players.size;
  const currentDeadPoints = gameState.deadPoints.length;

  if (currentPlayers > performanceMetrics.peakPlayerCount) {
    performanceMetrics.peakPlayerCount = currentPlayers;
  }

  if (currentDeadPoints > performanceMetrics.peakDeadPointCount) {
    performanceMetrics.peakDeadPointCount = currentDeadPoints;
  }
}

// Start performance metrics logging interval
function startPerformanceMetricsLogging() {
  if (performanceMetricsInterval) clearInterval(performanceMetricsInterval);

  performanceMetricsInterval = setInterval(() => {
    logPerformanceMetrics();
    updatePeakMetrics();
  }, PERFORMANCE_CONFIG.METRICS_LOG_INTERVAL);

  console.log(
    `📊 Performance metrics logging started (${
      PERFORMANCE_CONFIG.METRICS_LOG_INTERVAL / 1000
    }s intervals)`
  );
}

// Game state
const gameState = {
  players: new Map(),
  foods: [],
  deadPoints: [],
  maxFoods: 300,
  worldWidth: 1200,
  worldHeight: 800,
};

// Initialize optimization agents
const spatialAgent = new SpatialPartitioningAgent(gameState.worldWidth, gameState.worldHeight, 100);
const relevancyAgent = new RelevancyScoreAgent();
const predictiveAgent = new PredictiveCullingAgent();
const networkAgent = new NetworkAdaptationAgent();

// Client viewport tracking
const clientViewports = new Map(); // playerId -> viewport bounds

console.log('🚀 Network optimization agents initialized');
console.log(`📊 Spatial partitioning: ${spatialAgent.getStats().gridWidth}x${spatialAgent.getStats().gridHeight} cells`);

// Optimized game state broadcast with spatial culling and relevancy scoring
function broadcastOptimizedGameState(targetPlayerId = null, eventType = 'gameUpdate') {
  const currentTime = Date.now();
  
  // Get all connected players
  const connectedPlayers = Array.from(gameState.players.values()).filter(p => p.alive);
  
  connectedPlayers.forEach(player => {
    // Skip if targeting specific player and this isn't the target
    if (targetPlayerId && player.id !== targetPlayerId) return;
    
    const viewport = clientViewports.get(player.id);
    if (!viewport) {
      // Fallback to full game state for players without viewport data
      io.to(player.socketId).emit(eventType, {
        players: connectedPlayers,
        foods: gameState.foods,
        deadPoints: gameState.deadPoints
      });
      return;
    }
    
    // Use spatial partitioning to get relevant objects
    const relevantPlayers = spatialAgent.getObjectsInViewport(
      viewport.x, viewport.y, viewport.width, viewport.height, ['players']
    );
    
    const relevantFoods = spatialAgent.getObjectsInViewport(
      viewport.x, viewport.y, viewport.width, viewport.height, ['foods']
    );
    
    const relevantDeadPoints = spatialAgent.getObjectsInViewport(
      viewport.x, viewport.y, viewport.width, viewport.height, ['deadPoints']
    );
    
    // Apply relevancy scoring with lower thresholds for better optimization
    const scoredPlayers = relevancyAgent.scoreObjects(
      relevantPlayers, viewport.playerX, viewport.playerY, 'players'
    ).filter(obj => obj.score > 0.01); // Lower threshold for players
    
    const scoredFoods = relevancyAgent.scoreObjects(
      relevantFoods, viewport.playerX, viewport.playerY, 'foods'
    ).filter(obj => obj.score > 0.005); // Lower threshold for foods
    
    const scoredDeadPoints = relevancyAgent.scoreObjects(
      relevantDeadPoints, viewport.playerX, viewport.playerY, 'deadPoints'
    ).filter(obj => obj.score > 0.005); // Lower threshold for dead points
    
    // Get adaptive update frequency from network agent
    const playerData = {
      x: viewport.playerX,
      y: viewport.playerY,
      velocityX: player.velocityX || 0,
      velocityY: player.velocityY || 0,
      lastActionTime: player.lastActionTime || currentTime,
      alive: player.alive
    };
    
    const serverMetrics = {
      playerCount: connectedPlayers.length,
      objectCount: gameState.foods.length + gameState.deadPoints.length
    };
    
    const allGameObjects = [...relevantPlayers, ...relevantFoods, ...relevantDeadPoints];
    const updateFreq = networkAgent.getUpdateFrequency(player.id, playerData, allGameObjects, serverMetrics);
    const shouldUpdate = (currentTime - (player.lastUpdate || 0)) >= updateFreq;
    
    if (shouldUpdate) {
      // Send optimized game state
      io.to(player.socketId).emit(eventType, {
        players: scoredPlayers.map(obj => obj.object),
        foods: scoredFoods.map(obj => obj.object),
        deadPoints: scoredDeadPoints.map(obj => obj.object),
        viewport: {
          x: viewport.x,
          y: viewport.y,
          width: viewport.width,
          height: viewport.height
        }
      });
      
      player.lastUpdate = currentTime;
      
      // Log optimization stats
      const originalCount = connectedPlayers.length + gameState.foods.length + gameState.deadPoints.length;
      const optimizedCount = scoredPlayers.length + scoredFoods.length + scoredDeadPoints.length;
      const reduction = ((originalCount - optimizedCount) / originalCount * 100).toFixed(1);
      
      console.log(`🚀 Optimized update for ${player.id}: ${originalCount} → ${optimizedCount} objects (${reduction}% reduction)`);
    }
  });
}

// Update spatial partitioning with current game objects
function updateSpatialPartitioning() {
  // Clear existing spatial data
  spatialAgent.clear();
  
  // Add all players to spatial grid
  gameState.players.forEach(player => {
    if (player.alive) {
      spatialAgent.addObject(player.id, player.x, player.y, 'players', player);
    }
  });
  
  // Add all foods to spatial grid
  gameState.foods.forEach(food => {
    spatialAgent.addObject(food.id, food.x, food.y, 'foods', food);
  });
  
  // Add all dead points to spatial grid
  gameState.deadPoints.forEach(deadPoint => {
    spatialAgent.addObject(deadPoint.id, deadPoint.x, deadPoint.y, 'deadPoints', deadPoint);
  });
}

// Initialize food
function initializeFoods() {
  gameState.foods = [];
  console.log(
    `🍎 Initializing ${gameState.maxFoods} food items in ${gameState.worldWidth}x${gameState.worldHeight} world...`
  );

  for (let i = 0; i < gameState.maxFoods; i++) {
    const type = getRandomFood();
    const food = {
      id: i,
      x: Math.random() * gameState.worldWidth,
      y: Math.random() * gameState.worldHeight,
      radius: FOOD_RADIUS,
      color: getFoodColorByType(type),
      type: type,
    };
    gameState.foods.push(food);

    if (i < 5) {
      // Log first 5 food positions for debugging
      console.log(
        `🍎 Food ${i}: position (${food.x.toFixed(2)}, ${food.y.toFixed(
          2
        )}) color: ${food.color}`
      );
    }
  }

  console.log(
    `🍎 Food initialization complete: ${gameState.foods.length} foods spawned`
  );
  
  // Update spatial partitioning after food initialization
  updateSpatialPartitioning();
  console.log(`🗂️ Spatial partitioning updated with ${gameState.foods.length} foods`);
}

// Start optimized game loop for spatial updates and broadcasts
let gameLoopInterval;
function startOptimizedGameLoop() {
  if (gameLoopInterval) clearInterval(gameLoopInterval);
  
  gameLoopInterval = setInterval(() => {
    // Broadcast optimized game state to all players
    broadcastOptimizedGameState(null, 'gameUpdate');
    
    // Update predictive agent predictions
    predictiveAgent.updatePredictions();
    
  }, 1000 / RENDER_FPS); 
  
  console.log('🎮 Optimized game loop started at 30 FPS');
}

// Start the optimized game loop
startOptimizedGameLoop();

function getRandomColor() {
  const colors = [
    "red",
    "green",
    "white",
    "yellow",
    "orange",
    "lightgreen",
    "grey",
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Get random food type matching client-side Food.ts types
function getRandomFood() {
  const types = ["watermelon", "apple", "cherry", "orange", "grapes"];
  return types[Math.floor(Math.random() * types.length)];
}

// Get color based on food type (updated for new food system)
function getFoodColorByType(type) {
  switch (type) {
    case "basic":
      return "lightgreen";
    case "apple":
      return "red";
    case "watermelon":
      return "green";
    case "cherry":
      return "darkred"; // Legacy support
    case "orange":
      return "orange"; // Legacy support
    case "grapes":
      return "purple"; // Legacy support
    default:
      return "orange";
  }
}

// Get point value based on food type (updated to new point system)
function getPointValueByType(type) {
  switch (type) {
    case "watermelon":
      return 3;
    case "apple":
      return 6;
    case "cherry":
      return 9;
    case "orange":
      return 12;
    case "grapes":
      return 50;
    default:
      return POINT;
  }
}

// Size-adaptive food distribution generator for optimal snake body filling
function generateOptimalFoodDistribution(
  targetScore,
  deadPoints,
  availableSlots
) {
  const foodTypes = [
    { type: "grapes", value: getPointValueByType("grapes") },
    { type: "orange", value: getPointValueByType("orange") },
    { type: "cherry", value: getPointValueByType("cherry") },
    { type: "apple", value: getPointValueByType("apple") },
    { type: "watermelon", value: getPointValueByType("watermelon") },
  ];

  const snakeLength = deadPoints.length;
  const maxFoodItems = Math.min(availableSlots, snakeLength);
  // Snake size classification thresholds
  // SMALL_SNAKE_MAX: Snakes up to this length are considered small
  // MEDIUM_SNAKE_MAX: Snakes between SMALL_SNAKE_MAX and this length are medium, above are large
  const SMALL_SNAKE_MAX = 15;
  const MEDIUM_SNAKE_MAX = 140;

  // Target food coverage percentages for different snake sizes
  // These determine how much of the snake's length should be covered with food
  // Lower percentages for larger snakes to maintain game balance
  const SMALL_SNAKE_COVERAGE = 0.37; // 37% coverage for small snakes
  const MEDIUM_SNAKE_COVERAGE = 0.32; // 32% coverage for medium snakes
  const LARGE_SNAKE_COVERAGE = 0.09; // 27% coverage for large snakes

  // Minimum and maximum food counts and distribution ratios for small snakes
  // These ensure small snakes get enough food while preventing overcrowding
  const SMALL_SNAKE_MIN_FOOD = 4; // Minimum 4 food items for small snakes
  const SMALL_SNAKE_MAX_FOOD = 7; // Maximum 7 food items for small snakes
  const SMALL_SNAKE_FOOD_RATIO = 0.4; // 40% of snake length for food calculation

  // Medium snake food distribution parameters
  // Balanced values for medium-sized snakes to maintain steady growth
  const MEDIUM_SNAKE_MIN_FOOD = 6; // Minimum 6 food items for medium snakes
  const MEDIUM_SNAKE_MAX_FOOD = 11; // Maximum 11 food items for medium snakes
  const MEDIUM_SNAKE_FOOD_RATIO = 0.3; // 30% of snake length for food calculation

  // Large snake food distribution parameters
  // Conservative values to prevent large snakes from growing too quickly
  const LARGE_SNAKE_MIN_FOOD = 8; // Minimum 8 food items for large snakes
  const LARGE_SNAKE_MAX_FOOD = 16; // Maximum 16 food items for large snakes
  const LARGE_SNAKE_FOOD_RATIO = 0.07; // 25% of snake length for food calculation

  // Calculate size-adaptive distribution strategy with moderate coverage
  const isSmallSnake = snakeLength <= SMALL_SNAKE_MAX;
  const isMediumSnake =
    snakeLength > SMALL_SNAKE_MAX && snakeLength <= MEDIUM_SNAKE_MAX;

  // MINIMUM FOOD GUARANTEE: Balanced for proper spacing
  const minFoodCount = isSmallSnake
    ? Math.max(
        SMALL_SNAKE_MIN_FOOD,
        Math.min(
          SMALL_SNAKE_MAX_FOOD,
          Math.floor(snakeLength * SMALL_SNAKE_FOOD_RATIO)
        )
      )
    : isMediumSnake
    ? Math.max(
        MEDIUM_SNAKE_MIN_FOOD,
        Math.min(
          MEDIUM_SNAKE_MAX_FOOD,
          Math.floor(snakeLength * MEDIUM_SNAKE_FOOD_RATIO)
        )
      )
    : Math.max(
        LARGE_SNAKE_MIN_FOOD,
        Math.min(
          LARGE_SNAKE_MAX_FOOD,
          Math.floor(snakeLength * LARGE_SNAKE_FOOD_RATIO)
        )
      );

  // Determine optimal food count with moderate coverage for proper spacing
  let targetFoodCount;
  if (isSmallSnake) {
    // Small snakes: aim for 32-42% segment coverage (slightly tighter than before)
    targetFoodCount = Math.max(
      minFoodCount,
      Math.min(Math.ceil(snakeLength * SMALL_SNAKE_COVERAGE), maxFoodItems)
    );
  } else if (isMediumSnake) {
    // Medium snakes: aim for 27-37% coverage (slightly tighter than before)
    targetFoodCount = Math.max(
      minFoodCount,
      Math.min(Math.ceil(snakeLength * MEDIUM_SNAKE_COVERAGE), maxFoodItems)
    );
  } else {
    // Large snakes: aim for 22-32% coverage (slightly tighter than before)
    targetFoodCount = Math.max(
      minFoodCount,
      Math.min(Math.ceil(snakeLength * LARGE_SNAKE_COVERAGE), maxFoodItems)
    );
  }

  // MIXED FOOD DISTRIBUTION: 50% high-score, 50% lower-score foods
  const distribution = [];
  let remainingScore = targetScore;
  let totalFoods = 0;

  console.log(
    `🔍 Debug: Snake ${snakeLength} segments, target score ${targetScore}, min foods ${minFoodCount}, target foods ${targetFoodCount}`
  );

  // Define high-value and lower-value food categories
  const highValueFoods = foodTypes.filter((f) => f.value >= 12); // grapes(150), orange(12)
  const lowerValueFoods = foodTypes.filter((f) => f.value < 12); // cherry(9), apple(6), watermelon(3)

  // Calculate 50/50 split for food allocation
  const highValueSlots = Math.ceil(targetFoodCount * 0.5);
  const lowerValueSlots = targetFoodCount - highValueSlots;

  console.log(
    `🎯 Mixed distribution: ${highValueSlots} high-value slots, ${lowerValueSlots} lower-value slots`
  );

  // Phase 1: Fill high-value slots (50% of total foods)
  let highValueFoodsPlaced = 0;
  let highValueScore = 0;

  // Start with grapes for maximum efficiency, then orange
  const sortedHighValue = [...highValueFoods].sort((a, b) => b.value - a.value);

  for (const foodType of sortedHighValue) {
    while (
      highValueFoodsPlaced < highValueSlots &&
      remainingScore >= foodType.value
    ) {
      const existing = distribution.find((d) => d.type === foodType.type);
      if (existing) {
        existing.count++;
      } else {
        distribution.push({ ...foodType, count: 1 });
      }

      remainingScore -= foodType.value;
      highValueScore += foodType.value;
      highValueFoodsPlaced++;
      totalFoods++;

      console.log(
        `  High-value: Added ${foodType.type} (${foodType.value} pts), placed: ${highValueFoodsPlaced}/${highValueSlots}`
      );
    }
  }

  // Phase 2: Fill lower-value slots (50% of total foods)
  let lowerValueFoodsPlaced = 0;
  let lowerValueScore = 0;

  // Use remaining score efficiently with lower-value foods
  const sortedLowerValue = [...lowerValueFoods].sort(
    (a, b) => b.value - a.value
  ); // cherry(9), apple(6), watermelon(3)

  while (lowerValueFoodsPlaced < lowerValueSlots && remainingScore > 0) {
    let added = false;

    for (const foodType of sortedLowerValue) {
      if (
        lowerValueFoodsPlaced >= lowerValueSlots ||
        remainingScore < foodType.value
      )
        continue;

      const existing = distribution.find((d) => d.type === foodType.type);
      if (existing) {
        existing.count++;
      } else {
        distribution.push({ ...foodType, count: 1 });
      }

      remainingScore -= foodType.value;
      lowerValueScore += foodType.value;
      lowerValueFoodsPlaced++;
      totalFoods++;
      added = true;

      console.log(
        `  Lower-value: Added ${foodType.type} (${foodType.value} pts), placed: ${lowerValueFoodsPlaced}/${lowerValueSlots}`
      );
      break;
    }

    if (!added) break; // Prevent infinite loop
  }

  // Phase 3: Fill any remaining slots to reach minimum food count
  while (totalFoods < minFoodCount) {
    const watermelon = foodTypes.find((f) => f.type === "watermelon");
    const existing = distribution.find((d) => d.type === "watermelon");

    if (existing) {
      existing.count++;
    } else {
      distribution.push({ ...watermelon, count: 1 });
    }

    totalFoods++;
    console.log(
      `  Minimum guarantee: Added watermelon, total foods: ${totalFoods}`
    );
  }

  console.log(
    `🎯 Distribution complete: High-value score: ${highValueScore}, Lower-value score: ${lowerValueScore}, Total: ${
      highValueScore + lowerValueScore
    }`
  );

  // Enhanced spacing algorithm for better snake body coverage
  const newFoodItems = [];
  const timestamp = Date.now();
  let foodIndex = 0;

  // Calculate adaptive spacing based on snake size and food count
  const segmentIndices = [];
  if (totalFoods > 0 && deadPoints.length > 0) {
    if (totalFoods === 1) {
      // Single food at head
      segmentIndices.push(0);
    } else if (totalFoods >= deadPoints.length) {
      // More foods than segments - use all segments
      segmentIndices.push(
        ...Array.from({ length: deadPoints.length }, (_, i) => i)
      );
    } else {
      // Moderate spacing algorithm for 2.1-2.8x wider gaps (reduced by 0.2)
      // Step size reduced by 0.2 from previous 2.5-3.5 range to 2.3-3.3 range
      const baseStep = (deadPoints.length - 1) / (totalFoods - 1);
      const spacingMultiplier = 2.3 + Math.random() * 1.0; // 2.3-3.3 range (reduced by 0.2)
      const step = Math.max(
        2.3,
        Math.min(baseStep * spacingMultiplier, deadPoints.length / totalFoods)
      );

      console.log(
        `🎯 Food spacing: Snake length ${
          deadPoints.length
        }, Foods ${totalFoods}, Step size ${step.toFixed(
          2
        )} (2.1-2.8x wider gaps)`
      );

      for (let i = 0; i < totalFoods; i++) {
        let index;
        if (totalFoods === 1) {
          // Single food goes at head
          index = 0;
        } else if (i === totalFoods - 1) {
          // Last food always goes at tail
          index = deadPoints.length - 1;
        } else {
          // Moderate spacing: 2.1-2.8x wider than normal segments
          const baseIndex = Math.floor(i * step);
          // Add slight randomization for natural distribution
          const offset =
            Math.random() < 0.2 ? (Math.random() < 0.5 ? -1 : 1) : 0;
          index = Math.max(
            0,
            Math.min(deadPoints.length - 1, baseIndex + offset)
          );
        }

        // Ensure no duplicate indices for better distribution
        while (
          segmentIndices.includes(index) &&
          index < deadPoints.length - 1
        ) {
          index++;
        }

        segmentIndices.push(index);
        console.log(
          `🎯 Food ${i + 1}/${totalFoods} placed at segment ${index} (${(
            (index / (deadPoints.length - 1)) *
            100
          ).toFixed(1)}% along snake)`
        );
      }
    }
  }

  // Place food items at calculated positions
  for (const { type, value, count } of distribution) {
    for (let i = 0; i < count; i++) {
      if (foodIndex < segmentIndices.length) {
        const segmentIndex = segmentIndices[foodIndex];
        const dp = deadPoints[segmentIndex];

        const foodItem = {
          id: `${type}_${timestamp}_${foodIndex}`,
          x: dp.x,
          y: dp.y,
          radius: FOOD_RADIUS,
          color: getFoodColorByType(type),
          type: type,
          createdAt: timestamp,
          isScoreGenerated: true,
          originalScore: targetScore,
          isDeadSnakeFood: true,
          snakeSegmentSize: dp.radius || 10,
          snakeColor: dp.color || "#ff0000",
        };

        newFoodItems.push(foodItem);
      }
      foodIndex++;
    }
  }

  // Calculate actual score generated
  const actualScore = distribution.reduce(
    (sum, { value, count }) => sum + value * count,
    0
  );

  console.log(
    `🎯 ULTRA-DENSE food distribution: Snake length ${snakeLength} → Target ${targetScore} → Actual ${actualScore} (${distribution
      .map((d) => `${d.type}:${d.count}`)
      .join(", ")}) | Foods: ${totalFoods}/${targetFoodCount} | Coverage: ${(
      (totalFoods / snakeLength) *
      100
    ).toFixed(1)}% (MAXIMUM DENSITY)`
  );

  if (totalFoods < minFoodCount) {
    console.warn(
      `⚠️  Warning: Only generated ${totalFoods} foods, below minimum ${minFoodCount}`
    );
  }

  return newFoodItems;
}

// Generate random player ID (for Players/fallback)
function generatePlayerId() {
  return Math.random().toString(36).substr(2, 9);
}

// Get real user ID from openId
function getRealUserId(openId) {
  return openId || null;
}

// Safe spawn zones across the map - completely redesigned for proper distribution
function getSpawnZones() {
  const margin = 120; // Increased minimum distance from edges
  const zoneSize = 180; // Increased size of each spawn zone
  const zones = [];

  // Create 16 spawn zones distributed across the map in a 4x4 grid
  const cols = 4;
  const rows = 4;

  // Calculate available space for zones
  const availableWidth = gameState.worldWidth - 2 * margin;
  const availableHeight = gameState.worldHeight - 2 * margin;

  // Calculate spacing between zone centers
  const colSpacing = availableWidth / (cols - 1);
  const rowSpacing = availableHeight / (rows - 1);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Proper distribution calculation
      const x = margin + col * colSpacing;
      const y = margin + row * rowSpacing;

      // Add some randomization to prevent perfect grid alignment
      const randomOffsetX = (Math.random() - 0.5) * 40; // ±20px random offset
      const randomOffsetY = (Math.random() - 0.5) * 40; // ±20px random offset

      const finalX = Math.max(
        margin,
        Math.min(gameState.worldWidth - margin, x + randomOffsetX)
      );
      const finalY = Math.max(
        margin,
        Math.min(gameState.worldHeight - margin, y + randomOffsetY)
      );

      zones.push({ x: finalX, y: finalY, size: zoneSize });
    }
  }

  // Validate zone distribution
  const minX = Math.min(...zones.map((z) => z.x));
  const maxX = Math.max(...zones.map((z) => z.x));
  const minY = Math.min(...zones.map((z) => z.y));
  const maxY = Math.max(...zones.map((z) => z.y));

  console.log(
    `🎯 DEBUG: Generated ${zones.length} spawn zones with proper distribution:`
  );
  console.log(
    `🎯 DEBUG: X range: ${minX.toFixed(0)} - ${maxX.toFixed(0)} (spread: ${(
      maxX - minX
    ).toFixed(0)}px)`
  );
  console.log(
    `🎯 DEBUG: Y range: ${minY.toFixed(0)} - ${maxY.toFixed(0)} (spread: ${(
      maxY - minY
    ).toFixed(0)}px)`
  );
  console.log(
    `🎯 DEBUG: Zone positions:`,
    zones
      .map((z, i) => `Zone${i}: (${z.x.toFixed(0)}, ${z.y.toFixed(0)})`)
      .join(", ")
  );

  return zones;
}

// Check if position is safe (no collision with existing worms) - enhanced safety checks
function isPositionSafe(x, y, radius, minDistance = 200) {
  const alivePlayers = Array.from(gameState.players.values()).filter(
    (p) => p.alive
  );
  console.log(
    `🔍 DEBUG: Checking position safety at (${x.toFixed(2)}, ${y.toFixed(
      2
    )}) with ${
      alivePlayers.length
    } alive players, minDistance: ${minDistance}px`
  );

  // Check boundaries with increased buffer for better safety
  const boundaryBuffer = 80;
  if (
    x < boundaryBuffer ||
    x > gameState.worldWidth - boundaryBuffer ||
    y < boundaryBuffer ||
    y > gameState.worldHeight - boundaryBuffer
  ) {
    // console.log(`❌ DEBUG: Position unsafe - too close to boundaries`);
    return false;
  }

  for (const [playerId, player] of gameState.players.entries()) {
    if (!player.alive) continue;

    // Check distance from player head with increased safety margin
    const distance = Math.hypot(x - player.x, y - player.y);
    const requiredDistance = minDistance + radius + player.radius;
    if (distance < requiredDistance) {
      // console.log(
      //   `❌ DEBUG: Position unsafe - too close to player ${playerId} head (distance: ${distance.toFixed(
      //     2
      //   )}, required: ${requiredDistance.toFixed(2)})`
      // );
      // return false;
    }

    // Check distance from player body points with enhanced safety
    for (const point of player.points) {
      const pointDistance = Math.hypot(x - point.x, y - point.y);
      const requiredPointDistance = minDistance + radius + point.radius;
      if (pointDistance < requiredPointDistance) {
        // console.log(
        //   `❌ DEBUG: Position unsafe - too close to player ${playerId} body (distance: ${pointDistance.toFixed(
        //     2
        //   )}, required: ${requiredPointDistance.toFixed(2)})`
        // );
        return false;
      }
    }
  }

  // Check distance from dead points to avoid spawning on food
  for (const deadPoint of gameState.deadPoints) {
    const deadDistance = Math.hypot(x - deadPoint.x, y - deadPoint.y);
    if (deadDistance < 40 + radius) {
      // console.log(
      //   `❌ DEBUG: Position unsafe - too close to dead point (distance: ${deadDistance.toFixed(
      //     2
      //   )})`
      // );
      return false;
    }
  }

  // Check distance from food to avoid spawning in food clusters
  let nearbyFoodCount = 0;
  for (const food of gameState.foods) {
    const foodDistance = Math.hypot(x - food.x, y - food.y);
    if (foodDistance < 60) {
      nearbyFoodCount++;
      if (nearbyFoodCount >= 3) {
        // console.log(
        //   `❌ DEBUG: Position unsafe - too many nearby foods (${nearbyFoodCount})`
        // );
        return false;
      }
    }
  }

  // Additional safety check: ensure spawn direction is clear
  const testAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  let clearDirections = 0;
  for (const angle of testAngles) {
    const testDistance = 100;
    const testX = x + Math.cos(angle) * testDistance;
    const testY = y + Math.sin(angle) * testDistance;

    if (
      testX >= boundaryBuffer &&
      testX <= gameState.worldWidth - boundaryBuffer &&
      testY >= boundaryBuffer &&
      testY <= gameState.worldHeight - boundaryBuffer
    ) {
      let directionClear = true;
      for (const [playerId, player] of gameState.players.entries()) {
        if (!player.alive) continue;
        const distToPlayer = Math.hypot(testX - player.x, testY - player.y);
        if (distToPlayer < minDistance * 0.7) {
          directionClear = false;
          break;
        }
      }
      if (directionClear) clearDirections++;
    }
  }

  if (clearDirections < 2) {
    // console.log(
    //   `❌ DEBUG: Position unsafe - insufficient clear directions (${clearDirections}/4)`
    // );
    return false;
  }

  console.log(
    `✅ DEBUG: Position is safe at (${x.toFixed(2)}, ${y.toFixed(
      2
    )}) with ${clearDirections} clear directions`
  );
  return true;
}

// Find safe spawn position - enhanced with better distribution and emergency fallback
function findSafeSpawnPosition(radius) {
  console.log(`🎯 DEBUG: Finding safe spawn position for radius ${radius}`);
  const spawnZones = getSpawnZones();
  const maxZoneAttempts = 50; // Increased per-zone attempts for better success rate
  const maxFallbackAttempts = 150; // Further increased fallback attempts
  const maxRetries = 3; // Multiple retry attempts with different strategies

  // Prioritize zones with fewer nearby players for better distribution
  const zonesWithPlayerCount = spawnZones.map((zone) => {
    const nearbyPlayers = Array.from(gameState.players.values())
      .filter((p) => p.alive)
      .filter((p) => Math.hypot(p.x - zone.x, p.y - zone.y) < 300).length;
    return { zone, nearbyPlayers, index: spawnZones.indexOf(zone) };
  });

  // Sort zones by player count (fewer players = higher priority)
  zonesWithPlayerCount.sort((a, b) => a.nearbyPlayers - b.nearbyPlayers);

  console.log(
    `🎯 DEBUG: Zone priority order:`,
    zonesWithPlayerCount
      .map(
        (z) =>
          `Zone${z.index}(${z.zone.x.toFixed(0)},${z.zone.y.toFixed(0)}):${
            z.nearbyPlayers
          }players`
      )
      .join(", ")
  );

  // Try each zone in priority order
  for (const zoneData of zonesWithPlayerCount) {
    const { zone, index } = zoneData;
    console.log(
      `🎯 DEBUG: Trying spawn zone ${index} at center (${zone.x.toFixed(
        0
      )}, ${zone.y.toFixed(0)}) with ${zoneData.nearbyPlayers} nearby players`
    );

    for (let attempt = 0; attempt < maxZoneAttempts; attempt++) {
      // Random position within the zone with better distribution
      const offsetX = (Math.random() - 0.5) * zone.size * 0.8; // Use 80% of zone size
      const offsetY = (Math.random() - 0.5) * zone.size * 0.8;
      const x = zone.x + offsetX;
      const y = zone.y + offsetY;

      // Ensure position is within world bounds with proper margins
      const margin = 60;
      const clampedX = Math.max(
        margin,
        Math.min(gameState.worldWidth - margin, x)
      );
      const clampedY = Math.max(
        margin,
        Math.min(gameState.worldHeight - margin, y)
      );

      if (isPositionSafe(clampedX, clampedY, radius)) {
        console.log(
          `✅ DEBUG: Found safe position in zone ${index} at (${clampedX.toFixed(
            2
          )}, ${clampedY.toFixed(2)}) after ${attempt + 1} attempts`
        );
        return { x: clampedX, y: clampedY };
      }
    }
    console.log(
      `❌ DEBUG: Zone ${index} failed after ${maxZoneAttempts} attempts`
    );
  }

  console.log(`⚠️ DEBUG: All zones failed, trying enhanced fallback positions`);
  // Enhanced fallback: try scattered positions across the entire map
  for (let attempt = 0; attempt < maxFallbackAttempts; attempt++) {
    const margin = 80;
    const x = margin + Math.random() * (gameState.worldWidth - 2 * margin);
    const y = margin + Math.random() * (gameState.worldHeight - 2 * margin);

    if (isPositionSafe(x, y, radius, 100)) {
      // Reduced safety distance for fallback
      console.log(
        `✅ DEBUG: Found safe fallback position at (${x.toFixed(
          2
        )}, ${y.toFixed(2)}) after ${attempt + 1} attempts`
      );
      return { x, y };
    }
  }

  console.log(
    `🚨 DEBUG: Enhanced fallback failed, trying emergency strategies`
  );

  // Strategy 1: Emergency scatter spawn with relaxed safety requirements
  for (let retry = 0; retry < maxRetries; retry++) {
    console.log(`🔄 DEBUG: Emergency retry ${retry + 1}/${maxRetries}`);
    let bestPosition = null;
    let maxMinDistance = 0;
    const relaxedMinDistance = Math.max(50, 150 - retry * 30); // Gradually relax requirements

    for (let attempt = 0; attempt < 75; attempt++) {
      const margin = 120 - retry * 20; // Gradually reduce margin
      const x = margin + Math.random() * (gameState.worldWidth - 2 * margin);
      const y = margin + Math.random() * (gameState.worldHeight - 2 * margin);

      // Find minimum distance to any existing player
      let minDistance = Infinity;
      for (const player of gameState.players.values()) {
        if (!player.alive) continue;
        const distance = Math.hypot(x - player.x, y - player.y);
        minDistance = Math.min(minDistance, distance);
      }

      if (minDistance > maxMinDistance && minDistance >= relaxedMinDistance) {
        maxMinDistance = minDistance;
        bestPosition = { x, y };
      }
    }

    if (
      bestPosition &&
      isPositionSafe(bestPosition.x, bestPosition.y, radius, relaxedMinDistance)
    ) {
      console.log(
        `🚨 DEBUG: Found emergency position at (${bestPosition.x.toFixed(
          2
        )}, ${bestPosition.y.toFixed(
          2
        )}) with min distance ${maxMinDistance.toFixed(2)} on retry ${
          retry + 1
        }`
      );
      return bestPosition;
    }
  }

  // Strategy 2: Grid-based systematic search
  console.log(`🔍 DEBUG: Trying systematic grid search`);
  const gridSize = 8;
  const stepX = (gameState.worldWidth - 200) / gridSize;
  const stepY = (gameState.worldHeight - 200) / gridSize;

  for (let gx = 0; gx < gridSize; gx++) {
    for (let gy = 0; gy < gridSize; gy++) {
      const x = 100 + gx * stepX + Math.random() * stepX * 0.5;
      const y = 100 + gy * stepY + Math.random() * stepY * 0.5;

      if (isPositionSafe(x, y, radius, 80)) {
        console.log(
          `🔍 DEBUG: Found grid position at (${x.toFixed(2)}, ${y.toFixed(2)})`
        );
        return { x, y };
      }
    }
  }

  console.log(`🚨 DEBUG: All methods failed, using safe edge position`);
  // Absolute last resort: safe edge position
  const edge = Math.floor(Math.random() * 4);
  const safeMargin = 100;
  const edgePosition = {
    0: {
      x: safeMargin,
      y: safeMargin + Math.random() * (gameState.worldHeight - 2 * safeMargin),
    },
    1: {
      x: gameState.worldWidth - safeMargin,
      y: safeMargin + Math.random() * (gameState.worldHeight - 2 * safeMargin),
    },
    2: {
      x: safeMargin + Math.random() * (gameState.worldWidth - 2 * safeMargin),
      y: safeMargin,
    },
    3: {
      x: safeMargin + Math.random() * (gameState.worldWidth - 2 * safeMargin),
      y: gameState.worldHeight - safeMargin,
    },
  }[edge];
  console.log(
    `🚨 DEBUG: Using safe edge ${edge} position at (${edgePosition.x.toFixed(
      2
    )}, ${edgePosition.y.toFixed(2)})`
  );
  return edgePosition;
}

// Calculate safe spawn direction that avoids borders and obstacles
function calculateSafeSpawnDirection(x, y, radius) {
  const borderBuffer = 250; // Increased distance to avoid from borders
  const playerAvoidanceRadius = 180; // Distance to avoid other players
  const mapCenterX = gameState.worldWidth / 2;
  const mapCenterY = gameState.worldHeight / 2;

  // Calculate distances to each border
  const distToLeft = x;
  const distToRight = gameState.worldWidth - x;
  const distToTop = y;
  const distToBottom = gameState.worldHeight - y;

  // Find which borders are too close
  const tooCloseToLeft = distToLeft < borderBuffer;
  const tooCloseToRight = distToRight < borderBuffer;
  const tooCloseToTop = distToTop < borderBuffer;
  const tooCloseToBottom = distToBottom < borderBuffer;

  let safeAngles = [];

  // If not near any borders, prefer direction toward center with some randomness
  if (
    !tooCloseToLeft &&
    !tooCloseToRight &&
    !tooCloseToTop &&
    !tooCloseToBottom
  ) {
    const angleToCenter = Math.atan2(mapCenterY - y, mapCenterX - x);
    // Add some randomness around center direction (±60 degrees)
    const randomOffset = (Math.random() - 0.5) * (Math.PI / 3);
    return angleToCenter + randomOffset;
  }

  // Generate safe angle ranges avoiding problematic borders and players
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 12) {
    // More precise angle testing
    const testDistance = 200; // Increased distance to test in this direction
    const testX = x + Math.cos(angle) * testDistance;
    const testY = y + Math.sin(angle) * testDistance;

    // Check if this direction leads to safe territory (borders)
    const wouldHitBorder =
      testX < borderBuffer ||
      testX > gameState.worldWidth - borderBuffer ||
      testY < borderBuffer ||
      testY > gameState.worldHeight - borderBuffer;

    // Check if this direction would lead too close to other players
    let tooCloseToPlayer = false;
    for (const player of gameState.players.values()) {
      if (!player.alive) continue;
      const playerDistance = Math.hypot(testX - player.x, testY - player.y);
      if (playerDistance < playerAvoidanceRadius) {
        tooCloseToPlayer = true;
        break;
      }
    }

    if (!wouldHitBorder && !tooCloseToPlayer) {
      safeAngles.push(angle);
    }
  }

  // If we have safe angles, pick one randomly
  if (safeAngles.length > 0) {
    const baseAngle = safeAngles[Math.floor(Math.random() * safeAngles.length)];
    // Add small random variation (±15 degrees)
    const variation = (Math.random() - 0.5) * (Math.PI / 6);
    return baseAngle + variation;
  }

  // Fallback: point toward the most open direction
  const openDirections = [];
  if (
    distToLeft > distToRight &&
    distToLeft > distToTop &&
    distToLeft > distToBottom
  ) {
    openDirections.push(Math.PI); // Left
  }
  if (
    distToRight > distToLeft &&
    distToRight > distToTop &&
    distToRight > distToBottom
  ) {
    openDirections.push(0); // Right
  }
  if (
    distToTop > distToLeft &&
    distToTop > distToRight &&
    distToTop > distToBottom
  ) {
    openDirections.push(Math.PI * 1.5); // Up
  }
  if (
    distToBottom > distToLeft &&
    distToBottom > distToRight &&
    distToBottom > distToTop
  ) {
    openDirections.push(Math.PI * 0.5); // Down
  }

  if (openDirections.length > 0) {
    const baseDirection =
      openDirections[Math.floor(Math.random() * openDirections.length)];
    const variation = (Math.random() - 0.5) * (Math.PI / 4); // ±45 degrees
    return baseDirection + variation;
  }

  // Last resort: random angle (should rarely happen with improved spawn zones)
  console.log(
    `⚠️ DEBUG: Using fallback random angle for position (${x.toFixed(
      2
    )}, ${y.toFixed(2)})`
  );
  return Math.random() * Math.PI * 2;
}

function createBot(id) {
  const botRadius = 4;
  const safePosition = findSafeSpawnPosition(botRadius);
  const safeAngle = calculateSafeSpawnDirection(
    safePosition.x,
    safePosition.y,
    botRadius
  );

  console.log(
    `🤖 DEBUG: Creating bot ${id} at position (${safePosition.x.toFixed(
      2
    )}, ${safePosition.y.toFixed(2)}) with safe angle ${safeAngle.toFixed(
      3
    )} radians (${((safeAngle * 180) / Math.PI).toFixed(1)}°)`
  );

  // Bot personality types for diverse behavior
  const personalityTypes = ["explorer", "hunter", "wanderer"];
  const personality =
    personalityTypes[Math.floor(Math.random() * personalityTypes.length)];

  const bot = {
    id: id,
    socketId: null, // Bots don't have socket connections
    x: safePosition.x,
    y: safePosition.y,
    points: [],
    angle: safeAngle,
    radius: botRadius,
    speed: 1.5,
    color: getRandomColor(),
    score: POINT,
    alive: true,
    isBot: true,
    spawnProtection: true,
    spawnTime: Date.now(),
    lastDirectionChange: Date.now(), // Timer for straight movement preference
    straightMovementDuration: 4000 + Math.random() * 4000, // 4-8 seconds of straight movement

    // Enhanced bot properties for improved movement
    personality: personality,
    explorationRadius: 10 + Math.random() * 30, // 120-150 pixels
    currentSector: null,
    visitedSectors: new Set(),
    lastSectorChange: Date.now(),
    movementPattern: "straight",
    patternStartTime: Date.now(),
    patternDuration: 3000 + Math.random() * 2000,
    momentum: { x: 0, y: 0 },
    wanderTarget: null,
    lastWanderTime: Date.now(),
  };

  console.log(
    `🛡️ DEBUG: Bot ${id} spawn protection enabled until ${new Date(
      bot.spawnTime + 3000
    ).toLocaleTimeString()}`
  );

  // Initialize bot with starting points using bot's main color
  for (let i = 0; i < 20; i++) {
    bot.points.push({
      x: bot.x - i * 2,
      y: bot.y,
      radius: bot.radius,
      color: bot.color, // Use bot's main color for consistency
      type: getRandomFood(), // Add random food type for variety when bot dies
    });
  }

  console.log(
    `✅ DEBUG: Bot ${id} created successfully with ${bot.points.length} body points`
  );
  return bot;
}

function spawnBots(count = MAX_BOTS) {
  const currentTime = Date.now();

  // Throttle spawn attempts to prevent spam
  if (currentTime - lastBotSpawnAttempt < BOT_SPAWN_COOLDOWN) {
    return;
  }

  // Count current bots (both alive and dead)
  const currentBots = Array.from(gameState.players.values()).filter(
    (p) => p.isBot
  ).length;
  const availableSlots = MAX_BOTS - currentBots;
  const botsToSpawn = Math.min(count, availableSlots);

  if (botsToSpawn <= 0) {
    // Throttled logging to prevent spam
    if (currentTime - lastBotLimitLog > BOT_LOG_THROTTLE) {
      console.log(
        `Bot limit reached (${MAX_BOTS}). Current bots: ${currentBots}`
      );
      lastBotLimitLog = currentTime;
    }
    return;
  }

  lastBotSpawnAttempt = currentTime;

  for (let i = 0; i < botsToSpawn; i++) {
    const botId = `bot-${generatePlayerId()}`;
    const bot = createBot(botId);
    gameState.players.set(botId, bot);
    console.log(
      `Bot spawned: ${botId} at position (${bot.x.toFixed(2)}, ${bot.y.toFixed(
        2
      )})`
    );

    // Broadcast new bot to all players
    io.emit("playerJoined", bot);
  }

  const totalBots = currentBots + botsToSpawn;
  const aliveBots = Array.from(gameState.players.values()).filter(
    (p) => p.isBot && p.alive
  ).length;
  console.log(
    `Bot spawning complete: ${botsToSpawn} spawned, ${totalBots}/${MAX_BOTS} total, ${aliveBots} alive`
  );
}

// Helper function for collision detection (same logic as client-side)
function isCollided(circle1, circle2) {
  const distance = Math.hypot(circle1.x - circle2.x, circle1.y - circle2.y);
  return distance < circle1.radius + circle2.radius;
}

// Handle bot death - convert body to dead points and remove from game
function handleBotDeath(bot, killerId = null) {
  if (!bot.alive) return;

  console.log(
    "💀 BOT DEATH: Bot",
    bot.id,
    "is dying at position:",
    bot.x,
    bot.y
  );
  console.log(
    "💀 BOT DEATH: Bot score:",
    bot.score,
    "points length:",
    bot.points.length
  );

  bot.alive = false;

  // Calculate 80% of bot's score for food conversion (same as human players)
  const targetScoreValue = Math.floor(bot.score * 0.8);
  const currentFoodCount = gameState.foods.length;
  const availableSlots = Math.max(0, gameState.maxFoods - currentFoodCount);

  console.log(
    "💀 BOT DEATH: Generating food - targetScore:",
    targetScoreValue,
    "availableSlots:",
    availableSlots
  );

  // Use generateOptimalFoodDistribution for consistent food creation
  const newFoodItems = generateOptimalFoodDistribution(
    targetScoreValue,
    bot.points,
    availableSlots
  );

  console.log("💀 BOT DEATH: Generated", newFoodItems.length, "food items");
  newFoodItems.forEach((food, index) => {
    console.log(`💀 Food ${index}:`, {
      x: food.x,
      y: food.y,
      type: food.type,
      isDeadSnakeFood: food.isDeadSnakeFood,
      snakeColor: food.snakeColor,
      snakeSegmentSize: food.snakeSegmentSize,
    });
  });

  // Add generated food items to game state
  gameState.foods.push(...newFoodItems);

  console.log(
    `🍕 Bot death: Generated ${
      newFoodItems.length
    } optimally distributed food items from bot ${
      bot.id
    } | Score: ${bot.score.toFixed(
      1
    )} → Food value: ${targetScoreValue} (types: ${newFoodItems
      .map((f) => f.type)
      .join(", ")})`
  );

  // Remove bot from game state
  gameState.players.delete(bot.id);

  // Enhanced logging for bot death debugging
  // const remainingBots = Array.from(gameState.players.values()).filter(p => p.isBot && p.alive).length;
  // const totalPlayers = gameState.players.size;
  // console.log(`🤖 Bot Death: ${bot.id} died at (${bot.x.toFixed(2)}, ${bot.y.toFixed(2)}) | Score: ${bot.score.toFixed(1)} | Remaining bots: ${remainingBots} | Total players: ${totalPlayers}`);

  // Broadcast kill event if there was a killer
  if (killerId) {
    io.emit("playerKilled", {
      killerId: killerId,
      victimId: bot.id,
      victimLength: bot.points.length,
      victimScore: bot.score
    });
  }

  // Broadcast bot death and new food items
  io.emit("playerDied", {
    playerId: bot.id,
    deadPoints: [], // No dead points anymore
    newFoods: newFoodItems, // Send new food items
  });

  // Also broadcast food update to sync all clients
  io.emit("foodsUpdated", newFoodItems);

  // Perform food cleanup if we're approaching the limit
  if (gameState.foods.length > gameState.maxFoods * 0.8) {
    performFoodCleanup();
  }

  // Broadcast bot removal
  io.emit("playerDisconnected", bot.id);

  // Update leaderboard after bot removal
  const leaderboard = generateLeaderboard();
  const fullLeaderboard = generateFullLeaderboard();
  io.emit("leaderboardUpdate", {
    leaderboard: leaderboard,
    fullLeaderboard: fullLeaderboard,
  });
}

// ===== SERVER STATE MANAGEMENT FUNCTIONS =====

// Check if server should be paused (no human players)
function shouldPauseServer() {
  const humanPlayers = Array.from(gameState.players.values()).filter(
    (p) => !p.isBot && p.alive
  );
  return humanPlayers.length === 0;
}

// Pause server operations
function pauseServer() {
  if (serverState === SERVER_STATES.PAUSED) return;

  console.log("🔄 SERVER: Pausing server operations (no active players)");
  serverState = SERVER_STATES.PAUSED;
  performanceMetrics.stateTransitions++;
  performanceMetrics.serverPauses++;

  // Clear all game loop intervals
  gameLoopIntervals.forEach((interval) => clearInterval(interval));
  gameLoopIntervals = [];

  // Keep minimal bot count during pause
  const currentBots = Array.from(gameState.players.values()).filter(
    (p) => p.isBot
  );
  const botsToRemove = currentBots.length - PERFORMANCE_CONFIG.MIN_BOTS_IDLE;

  if (botsToRemove > 0) {
    // Remove excess bots (keep lowest scoring ones)
    const sortedBots = currentBots.sort((a, b) => a.score - b.score);
    for (let i = 0; i < botsToRemove; i++) {
      const bot = sortedBots[i];
      gameState.players.delete(bot.id);
      io.emit("playerDisconnected", bot.id);
    }
    console.log(
      `🤖 SERVER: Removed ${botsToRemove} bots during pause (keeping ${PERFORMANCE_CONFIG.MIN_BOTS_IDLE})`
    );
  }

  // Start idle game loop with reduced frequency
  startIdleGameLoop();

  // Restart intervals with idle configuration
  startBotIntervals();
  startCleanupInterval();
}

// Resume server operations
function resumeServer() {
  if (serverState === SERVER_STATES.ACTIVE) return;

  console.log("🔄 SERVER: Resuming server operations");
  serverState = SERVER_STATES.RESUMING;
  performanceMetrics.stateTransitions++;
  performanceMetrics.serverResumes++;

  // Clear pause timeout if exists
  if (pauseTimeout) {
    clearTimeout(pauseTimeout);
    pauseTimeout = null;
  }

  // Ensure minimum active bots
  const currentBots = Array.from(gameState.players.values()).filter(
    (p) => p.isBot
  );
  const botsNeeded = PERFORMANCE_CONFIG.MIN_BOTS_ACTIVE - currentBots.length;

  if (botsNeeded > 0) {
    spawnBots(botsNeeded);
    console.log(
      `🤖 SERVER: Spawned ${botsNeeded} additional bots for active state`
    );
  }

  // Start active game loop
  setTimeout(() => {
    serverState = SERVER_STATES.ACTIVE;
    startActiveGameLoop();

    // Restart intervals with active configuration
    startBotIntervals();
    startCleanupInterval();

    console.log("✅ SERVER: Server fully resumed and active");
  }, PERFORMANCE_CONFIG.RESUME_TIMEOUT);
}

// Update player activity tracking
function updatePlayerActivity() {
  lastPlayerActivity = Date.now();

  // Cancel pause timeout if server should resume
  if (serverState === SERVER_STATES.PAUSED && !shouldPauseServer()) {
    resumeServer();
  } else if (serverState === SERVER_STATES.ACTIVE && shouldPauseServer()) {
    // Schedule pause if no activity
    if (pauseTimeout) clearTimeout(pauseTimeout);
    pauseTimeout = setTimeout(() => {
      if (shouldPauseServer()) {
        pauseServer();
      }
    }, PERFORMANCE_CONFIG.PAUSE_DELAY);
  }
}

// ===== FOOD CLEANUP FUNCTIONS =====

// Clean up excess food items when approaching maxFoods limit
function performFoodCleanup(targetReduction = 50) {
  const currentCount = gameState.foods.length;

  if (currentCount <= gameState.maxFoods * 0.8) {
    return; // Only cleanup when we're at 80% of max capacity
  }

  // Separate score-generated foods from regular foods
  const scoreGeneratedFoods = gameState.foods.filter((f) => f.isScoreGenerated);
  const regularFoods = gameState.foods.filter((f) => !f.isScoreGenerated);

  console.log(
    `🧹 FOOD CLEANUP: Starting cleanup - current: ${currentCount}, max: ${gameState.maxFoods} (score-generated: ${scoreGeneratedFoods.length}, regular: ${regularFoods.length})`
  );

  // Get current player positions for distance calculations
  const playerPositions = Array.from(gameState.players.values())
    .filter((p) => p.alive)
    .map((p) => ({ x: p.x, y: p.y }));

  // Add timestamps to food items if missing and calculate cleanup priority
  const currentTime = Date.now();
  const foodsWithPriority = gameState.foods.map((food) => {
    if (!food.createdAt) food.createdAt = currentTime - Math.random() * 30000;

    let priority = 0;
    const age = currentTime - food.createdAt;

    // Check if food was recently eaten and should be protected from cleanup
    const timeSinceEaten = food.lastEatenAt
      ? currentTime - food.lastEatenAt
      : Infinity;
    if (timeSinceEaten < PERFORMANCE_CONFIG.CLEANUP_INTERVAL) {
      priority -= 1000; // Very low priority, protect recently eaten food
      return { food, priority };
    }

    // Age factor (older food gets higher priority for removal)
    priority += Math.min(age / 30000, 5); // Max 5 points for age (30s = max age score)

    // For score-generated foods, add originalScore to prioritize high-score foods for removal
    if (food.isScoreGenerated && food.originalScore) {
      priority += Math.min(food.originalScore / 100, 10); // Max 10 points for score (normalize by 100)
    }

    // Distance from players (farther = higher priority for removal)
    let minPlayerDistance = Infinity;
    for (const pos of playerPositions) {
      const distance = Math.hypot(food.x - pos.x, food.y - pos.y);
      minPlayerDistance = Math.min(minPlayerDistance, distance);
    }

    if (minPlayerDistance > 400) priority += 3; // Far from players
    else if (minPlayerDistance > 200) priority += 1; // Moderately far
    else if (minPlayerDistance < 100) priority -= 2; // Close to players (keep)

    return { food, priority };
  });

  // Calculate removal amounts for different food types
  // Limit score-generated (dead) food to 60% of total removals, regular food to 40%
  const capacityPercentage = currentCount / gameState.maxFoods;
  let scoreGeneratedToRemove = 0;
  let regularFoodsToRemove = 0;

  if (capacityPercentage >= 0.94) {
    // At 94%+ capacity, calculate total foods to remove
    const totalToRemove = Math.floor(currentCount * 0.2);

    // 60% from score-generated foods, 40% from regular foods
    scoreGeneratedToRemove = Math.min(
      Math.floor(totalToRemove * 0.6),
      scoreGeneratedFoods.length
    );
    regularFoodsToRemove = Math.min(
      Math.floor(totalToRemove * 0.4),
      regularFoods.length
    );

    console.log(
      `🧹 HIGH CAPACITY (${(capacityPercentage * 100).toFixed(
        1
      )}%): Removing ${totalToRemove} foods (60% score-generated: ${scoreGeneratedToRemove}, 40% regular: ${regularFoodsToRemove})`
    );
  } else {
    // Below 94%, maintain 60/40 ratio for balanced cleanup
    const totalToRemove = Math.min(
      targetReduction,
      currentCount - gameState.maxFoods + 20
    );

    // 60% from score-generated foods, 40% from regular foods
    scoreGeneratedToRemove = Math.min(
      Math.floor(totalToRemove * 0.6),
      scoreGeneratedFoods.length
    );
    regularFoodsToRemove = Math.min(
      Math.floor(totalToRemove * 0.4),
      regularFoods.length
    );
  }

  // Separate foods by type for priority sorting
  const scoreGeneratedWithPriority = foodsWithPriority.filter(
    (f) => f.food.isScoreGenerated
  );
  const regularFoodsWithPriority = foodsWithPriority.filter(
    (f) => !f.food.isScoreGenerated
  );

  // Sort by priority (highest first)
  scoreGeneratedWithPriority.sort((a, b) => b.priority - a.priority);
  regularFoodsWithPriority.sort((a, b) => b.priority - a.priority);

  const removedFoods = [];

  // Remove score-generated foods (20% limit)
  if (scoreGeneratedToRemove > 0) {
    for (
      let i = 0;
      i < Math.min(scoreGeneratedToRemove, scoreGeneratedWithPriority.length);
      i++
    ) {
      removedFoods.push(scoreGeneratedWithPriority[i].food);
    }
  }

  // Remove regular foods (existing logic)
  if (regularFoodsToRemove > 0) {
    for (
      let i = 0;
      i < Math.min(regularFoodsToRemove, regularFoodsWithPriority.length);
      i++
    ) {
      removedFoods.push(regularFoodsWithPriority[i].food);
    }
  }

  if (removedFoods.length > 0) {
    // Remove from gameState
    gameState.foods = gameState.foods.filter(
      (food) => !removedFoods.includes(food)
    );

    // Broadcast removal to clients
    io.emit(
      "foodsRemoved",
      removedFoods.map((f) => f.id)
    );

    const scoreRemovedCount = removedFoods.filter(
      (f) => f.isScoreGenerated
    ).length;
    const regularRemovedCount = removedFoods.length - scoreRemovedCount;

    console.log(
      `🧹 FOOD CLEANUP: Removed ${removedFoods.length} food items (score-generated: ${scoreRemovedCount}/${scoreGeneratedFoods.length}, regular: ${regularRemovedCount}/${regularFoods.length}) - ${gameState.foods.length} remaining`
    );
  }
}

// ===== SMART DEAD SNAKE CLEANUP FUNCTIONS =====

// Calculate priority score for dead point cleanup (higher = more likely to be removed)
function calculateCleanupPriority(
  deadPoint,
  humanPlayerPositions,
  botPlayerPositions,
  spawnZones
) {
  let priority = 0;
  const currentTime = Date.now();

  // Protection mechanism: Don't clean up points that haven't existed for CLEANUP_INTERVAL
  const age = currentTime - (deadPoint.createdAt || currentTime);
  const CLEANUP_PROTECTION_TIME = PERFORMANCE_CONFIG.CLEANUP_INTERVAL; // 30 seconds

  // If the dead point is too new, give it very low priority (protect it)
  if (age < CLEANUP_PROTECTION_TIME) {
    return -1000; // Very low priority, should not be cleaned up
  }

  // Age factor (older points get higher priority for removal)
  priority += Math.min(age / 60000, 8); // Max 8 points for age (1 minute = max age score)

  // Enhanced distance-based scoring with player type awareness
  let minHumanDistance = Infinity;
  let minBotDistance = Infinity;

  // Calculate distances to human players (highest priority for preservation)
  for (const pos of humanPlayerPositions) {
    const distance = Math.hypot(deadPoint.x - pos.x, deadPoint.y - pos.y);
    minHumanDistance = Math.min(minHumanDistance, distance);
  }

  // Calculate distances to bot players (medium priority for preservation)
  for (const pos of botPlayerPositions) {
    const distance = Math.hypot(deadPoint.x - pos.x, deadPoint.y - pos.y);
    minBotDistance = Math.min(minBotDistance, distance);
  }

  // Priority system: Far from humans > Near bots but far from humans > Near humans
  if (minHumanDistance !== Infinity) {
    if (minHumanDistance > 400) {
      priority += 15; // Very far from human players - highest cleanup priority
    } else if (minHumanDistance > 250) {
      priority += 10; // Far from human players - high cleanup priority
    } else if (minHumanDistance > 150) {
      priority += 5; // Moderately far from human players
    } else if (minHumanDistance > 80) {
      priority += 1; // Close to human players - low cleanup priority
    } else {
      priority -= 10; // Very close to human players - protect strongly
    }
  }

  // Bot distance consideration (lower weight than human distance)
  if (minBotDistance !== Infinity) {
    if (minBotDistance > 300) {
      priority += 3; // Far from bots - moderate cleanup priority
    } else if (minBotDistance > 150) {
      priority += 1; // Moderately far from bots
    } else if (minBotDistance < 60) {
      priority -= 2; // Close to bots - slight protection
    }
  }

  // If no human players, use bot distances with higher weight
  if (humanPlayerPositions.length === 0 && minBotDistance !== Infinity) {
    if (minBotDistance > 300) priority += 8;
    else if (minBotDistance > 150) priority += 4;
    else if (minBotDistance < 80) priority -= 5;
  }

  // Distance from spawn zones (closer to spawn = lower priority for removal)
  let minSpawnDistance = Infinity;
  for (const zone of spawnZones) {
    const distance = Math.hypot(deadPoint.x - zone.x, deadPoint.y - zone.y);
    minSpawnDistance = Math.min(minSpawnDistance, distance);
  }

  if (minSpawnDistance < 100)
    priority -= 6; // Very close to spawn (protect more)
  else if (minSpawnDistance < 200) priority -= 2; // Close to spawn

  return priority;
}

// Smart dead point cleanup with priority-based removal
function performSmartDeadPointCleanup(forceCleanup = false) {
  const currentCount = gameState.deadPoints.length;

  // Check if cleanup is needed
  if (!forceCleanup && currentCount < PERFORMANCE_CONFIG.CLEANUP_THRESHOLD) {
    return;
  }

  const targetCount = PERFORMANCE_CONFIG.MAX_DEAD_POINTS;
  let pointsToRemove = Math.max(0, currentCount - targetCount);

  if (pointsToRemove === 0) return;

  // Implement gradual cleanup - don't remove everything at once
  const maxRemovalPerCleanup = Math.min(
    pointsToRemove,
    Math.max(50, Math.floor(currentCount * 0.15))
  );
  pointsToRemove = Math.min(pointsToRemove, maxRemovalPerCleanup);

  console.log(
    `🧹 CLEANUP: Starting smart cleanup - removing ${pointsToRemove} of ${currentCount} dead points`
  );

  // Separate human and bot players for enhanced priority calculation
  const alivePlayers = Array.from(gameState.players.values()).filter(
    (p) => p.alive
  );
  const humanPlayerPositions = alivePlayers
    .filter((p) => !p.isBot)
    .map((p) => ({ x: p.x, y: p.y }));
  const botPlayerPositions = alivePlayers
    .filter((p) => p.isBot)
    .map((p) => ({ x: p.x, y: p.y }));

  // Get spawn zones
  const spawnZones = getSpawnZones();

  // Add timestamps to dead points if missing
  const currentTime = Date.now();
  gameState.deadPoints.forEach((dp) => {
    if (!dp.createdAt) dp.createdAt = currentTime - Math.random() * 30000; // Random age up to 30s
  });

  // Calculate cluster density for each point
  gameState.deadPoints.forEach((point) => {
    let nearbyCount = 0;
    for (const other of gameState.deadPoints) {
      if (other !== point) {
        const distance = Math.hypot(point.x - other.x, point.y - other.y);
        if (distance < 50) nearbyCount++;
      }
    }
    point.clusterDensity = nearbyCount;
  });

  // Calculate priority scores with enhanced player type awareness
  const pointsWithPriority = gameState.deadPoints.map((point) => {
    let priority = calculateCleanupPriority(
      point,
      humanPlayerPositions,
      botPlayerPositions,
      spawnZones
    );

    // Add cluster density bonus (remove from dense areas)
    if (point.clusterDensity > 5) priority += 4;
    else if (point.clusterDensity > 3) priority += 2;
    else if (point.clusterDensity > 1) priority += 1;

    // Add small randomization to make cleanup less predictable
    priority += (Math.random() - 0.5) * 2;

    return { point, priority };
  });

  // Sort by priority (highest first) and remove top candidates
  pointsWithPriority.sort((a, b) => b.priority - a.priority);

  // Filter out points that are too new (additional safety check)
  const eligiblePoints = pointsWithPriority.filter((item) => {
    const age = currentTime - (item.point.createdAt || currentTime);
    return age >= PERFORMANCE_CONFIG.CLEANUP_INTERVAL;
  });

  const actualPointsToRemove = Math.min(pointsToRemove, eligiblePoints.length);
  const pointsToRemoveList = eligiblePoints
    .slice(0, actualPointsToRemove)
    .map((item) => item.point);

  // Remove selected points
  gameState.deadPoints = gameState.deadPoints.filter(
    (point) => !pointsToRemoveList.includes(point)
  );

  // Update metrics
  performanceMetrics.deadPointsCleanedUp += actualPointsToRemove;

  console.log(
    `✅ CLEANUP: Removed ${actualPointsToRemove} dead points, ${gameState.deadPoints.length} remaining (${humanPlayerPositions.length} humans, ${botPlayerPositions.length} bots)`
  );

  // Broadcast cleanup to clients if significant (with reduced threshold)
  if (actualPointsToRemove > 500) {
    io.emit("deadPointsCleanup", {
      removedCount: actualPointsToRemove,
      remainingCount: gameState.deadPoints.length,
    });
  }
}

// Enhanced dead point creation with timestamp
function createDeadPoint(x, y, radius, color) {
  const deadPoint = {
    x,
    y,
    radius,
    color,
    createdAt: Date.now(),
  };

  gameState.deadPoints.push(deadPoint);
  performanceMetrics.deadPointsCreated++;
  updatePeakMetrics();

  return deadPoint;
}

function updateBots() {
  // Check if there are any human players in the room
  const humanPlayers = Array.from(gameState.players.values()).filter(
    (p) => !p.isBot && p.alive
  );

  const allBots = Array.from(gameState.players.values()).filter((p) => p.isBot);
  const aliveBots = allBots.filter((p) => p.alive);

  // Debug bot status every 10 seconds
  if (
    !updateBots.lastDebugTime ||
    Date.now() - updateBots.lastDebugTime > 10000
  ) {
    console.log("🤖 BOT STATUS:", {
      humanPlayers: humanPlayers.length,
      totalBots: allBots.length,
      aliveBots: aliveBots.length,
      botIds: aliveBots.map((b) => b.id),
    });
    updateBots.lastDebugTime = Date.now();
  }

  // If no human players, don't update bots at all
  if (humanPlayers.length === 0) {
    return;
  }

  // Iterate over all players and filter for bots
  gameState.players.forEach((player) => {
    if (!player.isBot || !player.alive) return;

    // Initialize bot movement tracking if not exists
    if (!player.movementHistory) {
      player.movementHistory = [];
      player.lastExploreTime = 0;
      player.stuckCounter = 0;
    }

    // Track bot position for stuck detection
    const currentPos = { x: player.x, y: player.y, time: Date.now() };
    player.movementHistory.push(currentPos);
    if (player.movementHistory.length > 10) {
      player.movementHistory.shift(); // Keep only last 10 positions
    }

    // Check if bot is stuck in small area
    let isStuck = false;
    if (player.movementHistory.length >= 8) {
      const positions = player.movementHistory.slice(-8);
      const avgX =
        positions.reduce((sum, pos) => sum + pos.x, 0) / positions.length;
      const avgY =
        positions.reduce((sum, pos) => sum + pos.y, 0) / positions.length;
      const maxDistance = Math.max(
        ...positions.map((pos) => Math.hypot(pos.x - avgX, pos.y - avgY))
      );
      isStuck = maxDistance < player.radius * 4; // If moving in very small area
    }

    // Enhanced boundary avoidance with more randomness
    const boundaryBuffer = player.radius * 4; // Increased buffer
    const lookAheadDistance = player.speed * 15; // Look further ahead
    const nextX = player.x + Math.cos(player.angle) * lookAheadDistance;
    const nextY = player.y + Math.sin(player.angle * -1) * lookAheadDistance; // Inverted Y-axis to match client

    // Intelligent boundary avoidance - turn toward center instead of reflecting
    const centerX = gameState.worldWidth / 2;
    const centerY = gameState.worldHeight / 2;
    let boundaryAvoidanceApplied = false;

    // Check if approaching any boundary
    const approachingLeft = nextX < boundaryBuffer;
    const approachingRight = nextX > gameState.worldWidth - boundaryBuffer;
    const approachingTop = nextY < boundaryBuffer;
    const approachingBottom = nextY > gameState.worldHeight - boundaryBuffer;

    if (
      approachingLeft ||
      approachingRight ||
      approachingTop ||
      approachingBottom
    ) {
      // Calculate angle toward center with strong randomization
      let escapeAngle = Math.atan2(centerY - player.y, centerX - player.x);

      // Add strong randomization to prevent predictable patterns
      const randomOffset = (Math.random() - 0.5) * Math.PI * 0.8;
      escapeAngle += randomOffset;

      // Special handling for corners - add extra randomization
      const isInCorner =
        (approachingLeft || approachingRight) &&
        (approachingTop || approachingBottom);
      if (isInCorner) {
        // Force a more dramatic escape from corners
        const cornerEscapeBoost = (Math.random() - 0.5) * Math.PI * 0.6;
        escapeAngle += cornerEscapeBoost;

        // Ensure we're moving away from the corner
        if (approachingLeft && approachingTop) {
          escapeAngle = Math.PI * 0.25 + (Math.random() - 0.5) * Math.PI * 0.3; // Southeast-ish
        } else if (approachingRight && approachingTop) {
          escapeAngle = Math.PI * 0.75 + (Math.random() - 0.5) * Math.PI * 0.3; // Southwest-ish
        } else if (approachingLeft && approachingBottom) {
          escapeAngle = -Math.PI * 0.25 + (Math.random() - 0.5) * Math.PI * 0.3; // Northeast-ish
        } else if (approachingRight && approachingBottom) {
          escapeAngle = -Math.PI * 0.75 + (Math.random() - 0.5) * Math.PI * 0.3; // Northwest-ish
        }
      }

      // Apply the escape angle with some smoothing to prevent jerky movement
      let angleDiff = escapeAngle - player.angle;
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

      // Use a stronger turn rate for boundary avoidance
      const boundaryTurnRate = 0.3 + Math.random() * 0.2;
      if (Math.abs(angleDiff) > boundaryTurnRate) {
        player.angle += Math.sign(angleDiff) * boundaryTurnRate;
      } else {
        player.angle = escapeAngle;
      }

      boundaryAvoidanceApplied = true;

      // Mark as exploring to prevent getting stuck
      player.lastExploreTime = Date.now();
      player.stuckCounter = 0;
    }

    // Enhanced AI movement with personality-based behavior
    let targetFound = false;
    let targetAngle = player.angle;
    const seekRadius = player.explorationRadius; // Use bot's individual exploration radius (120-150)

    // Update current sector for sector-based exploration
    const sectorsPerRow = 4;
    const sectorWidth = gameState.worldWidth / sectorsPerRow;
    const sectorHeight = gameState.worldHeight / sectorsPerRow;
    const currentSectorX = Math.floor(player.x / sectorWidth);
    const currentSectorY = Math.floor(player.y / sectorHeight);
    const currentSector = `${currentSectorX}-${currentSectorY}`;

    if (player.currentSector !== currentSector) {
      player.currentSector = currentSector;
      player.visitedSectors.add(currentSector);
      player.lastSectorChange = Date.now();
    }

    // Personality-based target seeking
    let nearestDeadPoint = null;
    let nearestDeadDistance = Infinity;
    let nearestFood = null;
    let nearestFoodDistance = Infinity;

    // Reduce food-seeking frequency based on personality
    const seekingChance =
      player.personality === "hunter"
        ? 0.8
        : player.personality === "explorer"
        ? 0.3
        : 0.5;

    if (Math.random() < seekingChance) {
      // Find nearest dead point within seek radius
      for (const deadPoint of gameState.deadPoints) {
        const distance = Math.hypot(
          deadPoint.x - player.x,
          deadPoint.y - player.y
        );
        if (distance < seekRadius && distance < nearestDeadDistance) {
          nearestDeadPoint = deadPoint;
          nearestDeadDistance = distance;
        }
      }

      // Find nearest food within seek radius
      for (const food of gameState.foods) {
        const distance = Math.hypot(food.x - player.x, food.y - player.y);
        if (distance < seekRadius && distance < nearestFoodDistance) {
          nearestFood = food;
          nearestFoodDistance = distance;
        }
      }
    }

    // Personality-based target prioritization
    const deadPointThreshold = player.personality === "hunter" ? 80 : 50;
    const foodThreshold = player.personality === "hunter" ? 60 : 40;

    if (nearestDeadPoint && nearestDeadDistance < deadPointThreshold) {
      targetAngle = Math.atan2(
        nearestDeadPoint.y - player.y,
        nearestDeadPoint.x - player.x
      );
      targetFound = true;
    } else if (nearestFood && nearestFoodDistance < foodThreshold) {
      targetAngle = Math.atan2(
        nearestFood.y - player.y,
        nearestFood.x - player.x
      );
      targetFound = true;
    }

    if (targetFound) {
      // More direct angle adjustment towards target
      let angleDiff = targetAngle - player.angle;
      // Normalize angle difference to [-π, π]
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

      // Reduced turn rate for smoother, more human-like movement
      const maxTurnRate = 0.08 + Math.random() * 0.02; // 0.08-0.10 radians per update (reduced from 0.15-0.20)
      if (Math.abs(angleDiff) > maxTurnRate) {
        player.angle += Math.sign(angleDiff) * maxTurnRate;
      } else {
        player.angle = targetAngle;
      }
    } else if (!boundaryAvoidanceApplied) {
      // Enhanced movement patterns with personality-based behavior
      const currentTime = Date.now();

      // Update movement pattern based on duration
      if (currentTime - player.patternStartTime > player.patternDuration) {
        const patterns = ["straight", "spiral", "zigzag", "wander"];
        const personalityWeights = {
          explorer: [0.3, 0.2, 0.2, 0.3],
          hunter: [0.5, 0.1, 0.2, 0.2],
          wanderer: [0.2, 0.3, 0.2, 0.3],
        };

        const weights = personalityWeights[player.personality] || [
          0.25, 0.25, 0.25, 0.25,
        ];
        const rand = Math.random();
        let cumulative = 0;

        for (let i = 0; i < patterns.length; i++) {
          cumulative += weights[i];
          if (rand < cumulative) {
            player.movementPattern = patterns[i];
            break;
          }
        }

        player.patternStartTime = currentTime;
        player.patternDuration = 3000 + Math.random() * 4000; // 3-7 seconds
      }

      // Long-distance wandering for explorers
      if (
        player.personality === "explorer" &&
        (!player.wanderTarget ||
          Math.hypot(
            player.x - player.wanderTarget.x,
            player.y - player.wanderTarget.y
          ) < 50)
      ) {
        // Set new wander target in unexplored or less visited sectors
        const unvisitedSectors = [];
        for (let x = 0; x < 4; x++) {
          for (let y = 0; y < 4; y++) {
            const sector = `${x}-${y}`;
            if (!player.visitedSectors.has(sector)) {
              unvisitedSectors.push({
                x: x * sectorWidth + sectorWidth / 2,
                y: y * sectorHeight + sectorHeight / 2,
              });
            }
          }
        }

        if (unvisitedSectors.length > 0) {
          player.wanderTarget =
            unvisitedSectors[
              Math.floor(Math.random() * unvisitedSectors.length)
            ];
        } else {
          // All sectors visited, pick random distant point
          player.wanderTarget = {
            x: Math.random() * gameState.worldWidth,
            y: Math.random() * gameState.worldHeight,
          };
        }
      }

      // Apply movement pattern
      switch (player.movementPattern) {
        case "spiral":
          const spiralTime = (currentTime - player.patternStartTime) / 1000;
          player.angle += 0.1 + Math.sin(spiralTime) * 0.05;
          break;

        case "zigzag":
          if (currentTime - player.lastDirectionChange > 1000) {
            player.angle += (Math.random() - 0.5) * Math.PI * 0.5;
            player.lastDirectionChange = currentTime;
          }
          break;

        case "wander":
          if (player.wanderTarget) {
            const wanderAngle = Math.atan2(
              player.wanderTarget.y - player.y,
              player.wanderTarget.x - player.x
            );
            let angleDiff = wanderAngle - player.angle;
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

            player.angle +=
              Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), 0.05);
          }
          break;

        default: // straight
          // Force exploration if stuck or haven't explored for long
          if (isStuck || currentTime - player.lastExploreTime > 15000) {
            const maxAngleChange = Math.PI * 0.8;
            player.angle += (Math.random() - 0.5) * maxAngleChange;
            player.lastExploreTime = currentTime;
            player.stuckCounter = 0;
            player.lastDirectionChange = currentTime;
            player.straightMovementDuration = 6000 + Math.random() * 4000; // 6-10 seconds
          } else {
            // Infrequent small adjustments for natural movement
            if (Math.random() < 0.002) {
              player.angle += (Math.random() - 0.5) * 0.2;
              player.lastDirectionChange = currentTime;
              player.straightMovementDuration = 6000 + Math.random() * 4000;
            }
          }
      }
    }

    // Minimal random direction changes when following targets to maintain straighter paths
    const timeSinceLastChange =
      Date.now() - (player.lastDirectionChange || Date.now());
    const shouldMovestraight =
      timeSinceLastChange < (player.straightMovementDuration || 5000);

    if (
      targetFound &&
      !boundaryAvoidanceApplied &&
      !shouldMovestraight &&
      Math.random() < 0.003
    ) {
      player.angle += (Math.random() - 0.5) * 0.03; // Very small deviation from target path (reduced from 0.1)

      // Set longer straight movement duration after direction change
      player.lastDirectionChange = Date.now();
      player.straightMovementDuration = 5000 + Math.random() * 3000; // 5-8 seconds (increased from 2-3)
    }

    // Move bot - CRITICAL FIX: Use inverted Y-axis to match client coordinate system
    // Client uses: y: Math.sin(angle * -coeffD2R) - inverted Y-axis
    // Server must match this for consistent face/neck positioning
    const newX = player.x + Math.cos(player.angle) * player.speed;
    const newY = player.y + Math.sin(player.angle * -1) * player.speed; // Inverted Y-axis to match client

    // Improved boundary collision detection - strict enforcement with edge case handling
    const minX = player.radius;
    const maxX = gameState.worldWidth - player.radius;
    const minY = player.radius;
    const maxY = gameState.worldHeight - player.radius;

    // Relaxed boundary collision detection - give bots small buffer to prevent excessive deaths
    if (newX < minX || newX > maxX || newY < minY || newY > maxY) {
      // Bot dies from boundary collision - relaxed enforcement with buffer
      console.log(
        `Bot ${player.id} died at boundary: position (${newX.toFixed(
          2
        )}, ${newY.toFixed(2)}), bounds: x[${minX}-${maxX}], y[${minY}-${maxY}]`
      );
      handleBotDeath(player);
      return;
    }

    player.x = newX;
    player.y = newY;

    // Check spawn protection (5 seconds)
    const currentTime = Date.now();
    const spawnProtectionDuration = 5000; // 5 seconds
    const hasSpawnProtection =
      player.spawnProtection &&
      currentTime - player.spawnTime < spawnProtectionDuration;

    // Remove spawn protection after duration
    if (
      player.spawnProtection &&
      currentTime - player.spawnTime >= spawnProtectionDuration
    ) {
      player.spawnProtection = false;
      console.log(
        `🛡️ DEBUG: Spawn protection removed for bot ${player.id} during update`
      );
    }

    // Check collision with other players/bots before updating position
    const botHead = { x: player.x, y: player.y, radius: player.radius };
    let collisionDetected = false;

    if (!hasSpawnProtection) {
      // Only check collisions if not protected
      // Check collision with all other players (both human and bot)
      gameState.players.forEach((otherPlayer) => {
        if (
          otherPlayer.id === player.id ||
          !otherPlayer.alive ||
          collisionDetected
        )
          return;

        // Skip collision with other protected players
        const otherHasProtection =
          otherPlayer.spawnProtection &&
          currentTime - otherPlayer.spawnTime < spawnProtectionDuration;
        if (otherHasProtection) return;

        // Check collision with other player's body points
        for (const point of otherPlayer.points) {
          if (isCollided(botHead, point)) {
            handleBotDeath(player, otherPlayer.id);
            collisionDetected = true;
            return;
          }
        }
      });
    }

    if (collisionDetected) return;

    // Update bot points (simple snake movement)
    if (player.points.length > 0) {
      // Move each point to the position of the point in front of it
      for (let i = player.points.length - 1; i > 0; i--) {
        player.points[i].x = player.points[i - 1].x;
        player.points[i].y = player.points[i - 1].y;
      }
      // Update head position
      player.points[0].x = player.x;
      player.points[0].y = player.y;
    }

    // Bot collision detection with food (reuse botHead from collision detection above)
    for (let i = 0; i < gameState.foods.length; i++) {
      const food = gameState.foods[i];
      if (isCollided(botHead, food)) {
        // Extract the food type that was eaten
        const eatentype = food.type || "watermelon";

        // Get point value based on food type
        const pointValue = getPointValueByType(eatentype);

        // Bot eats food - same logic as human players
        player.score += pointValue;

        // Add multiple segments based on food point value (1 segment = 10 points)
        const segmentsToAdd = Math.max(1, Math.floor(pointValue / 10));
        console.log(
          `🤖 Bot ${player.id} eating ${eatentype}: ${pointValue} points = ${segmentsToAdd} segments`
        );

        if (player.points.length > 0) {
          const tail = player.points[player.points.length - 1];
          // Add multiple segments based on point value
          for (let i = 0; i < segmentsToAdd; i++) {
            player.points.push({
              x: tail.x,
              y: tail.y,
              radius: player.radius,
              color: player.color, // Use bot's main color instead of food color
              type: eatentype, // Store food type for when bot dies
            });
          }
        }

        // Regenerate food with logging
        const oldPos = { x: food.x, y: food.y };
        const newtype = getRandomFood();
        food.x = Math.random() * gameState.worldWidth;
        food.y = Math.random() * gameState.worldHeight;
        food.color = getFoodColorByType(newtype);
        food.type = newtype;

        // console.log(`🍎 Bot ${player.id} ate food ${food.id}: regenerated from (${oldPos.x.toFixed(2)}, ${oldPos.y.toFixed(2)}) to (${food.x.toFixed(2)}, ${food.y.toFixed(2)})`);

        // Broadcast food regeneration to all players
        io.emit("foodRegenerated", food);

        // Broadcast score update
        io.emit("scoreUpdate", {
          playerId: player.id,
          score: Math.round(player.score * 10) / 10,
        });

        // Broadcast updated leaderboard
        const leaderboard = generateLeaderboard();
        const fullLeaderboard = generateFullLeaderboard();
        io.emit("leaderboardUpdate", {
          leaderboard: leaderboard,
          fullLeaderboard: fullLeaderboard,
        });

        break; // Only eat one food per update cycle
      }
    }

    // Bot collision detection with dead points
    for (let i = gameState.deadPoints.length - 1; i >= 0; i--) {
      const deadPoint = gameState.deadPoints[i];
      if (isCollided(botHead, deadPoint)) {
        // Check if dead point is old enough to be consumed (age-based protection)
        const currentTime = Date.now();
        const age = currentTime - (deadPoint.createdAt || 0);

        // Only allow consumption if dead point is older than CLEANUP_INTERVAL (30 seconds)
        if (age >= CLEANUP_INTERVAL) {
          // Get point value based on dead point food type
          const deadPointType = deadPoint.type || "watermelon";
          const pointValue = getPointValueByType(deadPointType);

          // Bot eats dead point - award points based on food type
          player.score += pointValue;

          // Add multiple segments based on dead point value (1 segment = 10 points)
          const segmentsToAdd = Math.max(1, Math.floor(pointValue / 10));
          console.log(
            `🤖 Bot ${player.id} eating dead point ${deadPointType}: ${pointValue} points = ${segmentsToAdd} segments`
          );

          if (player.points.length > 0) {
            const tail = player.points[player.points.length - 1];
            // Add multiple segments based on point value
            for (let i = 0; i < segmentsToAdd; i++) {
              player.points.push({
                x: tail.x,
                y: tail.y,
                radius: player.radius,
                color: player.color, // Use bot's main color for consistency
                type: deadPoint.type || "watermelon", // Preserve food type from consumed dead point
              });
            }
          }

          // Store the consumed dead point for broadcast before removing it
          const consumedDeadPoint = { ...deadPoint };

          // Remove consumed dead point
          gameState.deadPoints.splice(i, 1);

          // Broadcast dead point removal to all clients (same as human players)
          io.emit("deadPointsRemoved", {
            deadPoints: [consumedDeadPoint],
          });

          // Broadcast score update
          io.emit("scoreUpdate", {
            playerId: player.id,
            score: Math.round(player.score * 10) / 10,
          });

          // Broadcast updated leaderboard
          const leaderboard = generateLeaderboard();
          const fullLeaderboard = generateFullLeaderboard();
          io.emit("leaderboardUpdate", {
            leaderboard: leaderboard,
            fullLeaderboard: fullLeaderboard,
          });

          break; // Only eat one dead point per update cycle
        } else {
          // Dead point is protected due to age
          console.log(
            `🛡️ Bot ${
              player.id
            } attempted to eat protected dead point (age: ${Math.round(
              age / 1000
            )}s < ${CLEANUP_INTERVAL / 1000}s)`
          );
        }
      }
    }
  });
}

// Initialize game
initializeFoods();

// TEMPORARY: Test function to force bot death and create dead snake food
function testDeadSnakeFood() {
  console.log(
    "🧪 TESTING: Forcing bot death to test dead snake food animation"
  );
  const bots = Array.from(gameState.players.values()).filter(
    (p) => p.isBot && p.alive
  );
  if (bots.length > 0) {
    const testBot = bots[0];
    console.log(
      `🧪 TESTING: Killing bot ${testBot.id} at position (${testBot.x}, ${testBot.y}) with score ${testBot.score}`
    );
    handleBotDeath(testBot);
  } else {
    console.log("🧪 TESTING: No alive bots found to kill");
  }
}

// TEMPORARY: Auto-trigger test after 10 seconds
// setTimeout(() => {
//   testDeadSnakeFood();
// }, 10000);
// // console.log(
//   `🎮 Game initialized: ${gameState.foods.length} foods spawned in ${gameState.worldWidth}x${gameState.worldHeight} world`
// );

// Spawn initial bots for testing
setTimeout(() => {
  console.log("🤖 Spawning initial bots for game testing...");
  spawnBots(5);
}, 1000);

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  // Handle ping/pong for latency measurement
  socket.on("ping", (data) => {
    // Respond with pong containing the original timestamp
    socket.emit("pong", { timestamp: data.timestamp });
  });

  // Handle game initialization with user data
  socket.on("gameInit", (userData) => {
    // console.log("Game init with user data:", userData);

    // Use authenticated user data from socket.data if available
    const isAuthenticated = socket.data.isAuthenticated;
    const authenticatedUserData = socket.data.userData;
    const authenticatedOpenId = socket.data.openId;
    const authenticatedUserInfo = socket.data.userInfo;

    // console.log("🎮 Game initialization:", {
    //   socketId: socket.id,
    //   isAuthenticated,
    //   hasAuthData: !!authenticatedUserData,
    //   fallbackData: !!userData,
    // });

    // Prioritize authenticated data, fallback to provided userData
    const finalUserData = isAuthenticated ? authenticatedUserData : userData;
    const finalOpenId = isAuthenticated
      ? authenticatedOpenId
      : userData?.openId;
    const finalUserInfo = isAuthenticated
      ? authenticatedUserInfo
      : userData?.userInfo;

    // Extract real user ID and name
    const realUserId = getRealUserId(finalOpenId);
    const userName = finalUserInfo?.name || finalUserInfo?.firstName;
    const playerId = realUserId || generatePlayerId();

    const playerRadius = 4;
    const safePosition = findSafeSpawnPosition(playerRadius);
    const safeAngle = calculateSafeSpawnDirection(
      safePosition.x,
      safePosition.y,
      playerRadius
    );

    // console.log(
    //   `👤 DEBUG: Creating player ${playerId} (${
    //     userName || "Anonymous"
    //   }) at position (${safePosition.x.toFixed(2)}, ${safePosition.y.toFixed(
    //     2
    //   )}) with safe angle ${safeAngle.toFixed(3)} radians (${(
    //     (safeAngle * 180) /
    //     Math.PI
    //   ).toFixed(1)}°)`
    // );

    const newPlayer = {
      id: playerId,
      socketId: socket.id,
      x: safePosition.x,
      y: safePosition.y,
      points: [],
      angle: safeAngle,
      radius: playerRadius,
      speed: 0.9,
      color: getRandomColor(),
      score: 0,
      alive: true,
      realUserId: realUserId, // Store real user ID separately
      userName: userName, // Store user name for leaderboard
      spawnProtection: true,
      spawnTime: Date.now(),
    };

    // console.log(
    //   `🛡️ DEBUG: Player ${playerId} spawn protection enabled until ${new Date(
    //     newPlayer.spawnTime + 3000
    //   ).toLocaleTimeString()}`
    // );

    // Initialize player with starting points using player's main color
    for (let i = 0; i < 25; i++) {
      newPlayer.points.push({
        x: newPlayer.x - i * 2,
        y: newPlayer.y,
        radius: newPlayer.radius,
        color: newPlayer.color, // Use player's main color for consistency
      });
    }

    gameState.players.set(playerId, newPlayer);
    // console.log(
    //   `✅ DEBUG: Player ${playerId} created successfully with ${newPlayer.points.length} body points`
    // );

    // Track player connection metrics
    performanceMetrics.playerConnections++;
    updatePeakMetrics();

    // Update player activity for server state management
    updatePlayerActivity();

    // Automatically spawn 5 bots when a user connects (if not already present)
    const humanPlayers = Array.from(gameState.players.values()).filter(
      (p) => !p.isBot
    );
    if (humanPlayers.length === 1) {
      // First human player
      spawnBots(5);

      // TEMPORARY: Test dead snake food immediately after spawning bots
      // setTimeout(() => {
      //   console.log('🧪 TESTING: Triggering dead snake food test after player join');
      //   testDeadSnakeFood();
      // }, 2000);
    }

    // Update spatial partitioning with new player
    updateSpatialPartitioning();
    
    // Send initial game state to new player using optimized broadcast
    socket.emit("gameInit", {
      playerId: playerId,
      gameState: {
        players: Array.from(gameState.players.values()),
        foods: gameState.foods,
        deadPoints: gameState.deadPoints,
        worldWidth: gameState.worldWidth,
        worldHeight: gameState.worldHeight,
      },
    });
    
    // Start sending optimized updates to this player
    setTimeout(() => {
      broadcastOptimizedGameState(playerId, 'gameUpdate');
    }, 1000); // Give client time to set up viewport tracking

    // Send initial leaderboard to new player
    const initialLeaderboard = generateLeaderboard();
    const initialFullLeaderboard = generateFullLeaderboard();
    socket.emit("leaderboardUpdate", {
      leaderboard: initialLeaderboard,
      fullLeaderboard: initialFullLeaderboard,
    });

    // Broadcast new player to all other players
    socket.broadcast.emit("playerJoined", newPlayer);

    // Broadcast updated leaderboard to all players
    const updatedLeaderboard = generateLeaderboard();
    const updatedFullLeaderboard = generateFullLeaderboard();
    io.emit("leaderboardUpdate", {
      leaderboard: updatedLeaderboard,
      fullLeaderboard: updatedFullLeaderboard,
    });
  });

  // Handle player movement
  socket.on("playerMove", (data) => {
    const player = gameState.players.get(data.playerId);
    if (player && player.alive) {
      // Update player activity for server state management
      if (!player.isBot) {
        updatePlayerActivity();
      }

      player.angle = data.angle;
      player.x = data.x;
      player.y = data.y;
      player.points = data.points;
      
      // Update spatial partitioning for moved player
      spatialAgent.updateObject(player.id, player.x, player.y, player);

      // Check and remove spawn protection after 5 seconds
      const currentTime = Date.now();
      const spawnProtectionDuration = 5000;
      if (
        player.spawnProtection &&
        currentTime - player.spawnTime >= spawnProtectionDuration
      ) {
        player.spawnProtection = false;
        console.log(
          `🛡️ DEBUG: Spawn protection removed for player ${data.playerId} during movement`
        );
      }

      // Broadcast movement to all other players with current spawn protection status
      const hasSpawnProtection =
        player.spawnProtection &&
        currentTime - player.spawnTime < spawnProtectionDuration;
      socket.broadcast.emit("playerMoved", {
        playerId: data.playerId,
        x: data.x,
        y: data.y,
        angle: data.angle,
        points: data.points,
        spawnProtection: hasSpawnProtection,
      });
    }
  });

  // Handle viewport updates from client
  socket.on("viewportUpdate", (data) => {
    const { playerId, viewport } = data;
    const player = gameState.players.get(playerId);
    
    if (player && player.alive && viewport) {
      const { x, y, width, height, playerX, playerY } = viewport;
      
      // Store client viewport bounds
      clientViewports.set(playerId, {
        x, y, width, height,
        playerX, playerY,
        timestamp: Date.now()
      });
      
      // Update predictive agent with player movement
      predictiveAgent.updatePlayerMovement(playerId, playerX, playerY, Date.now());
      
      console.log(`🔍 Viewport updated for ${playerId}: (${x?.toFixed(1) || 'N/A'}, ${y?.toFixed(1) || 'N/A'}) ${width?.toFixed(1) || 'N/A'}x${height?.toFixed(1) || 'N/A'}`);
    }
  });

  // Handle food consumption
  socket.on("foodEaten", (data) => {
    const { playerId, foodId } = data;
    const player = gameState.players.get(playerId);
    const food = gameState.foods.find((f) => f.id === foodId);

    if (player && food) {
      // Update player activity for server state management
      if (!player.isBot) {
        updatePlayerActivity();
      }
      // Extract the food type that was eaten
      const eatentype = food.type || "watermelon";

      // Get point value based on food type
      const pointValue = getPointValueByType(eatentype);

      // Regenerate food with logging
      const oldPos = { x: food.x, y: food.y };
      const newtype = getRandomFood();
      food.x = Math.random() * gameState.worldWidth;
      food.y = Math.random() * gameState.worldHeight;
      food.color = getFoodColorByType(newtype);
      food.type = newtype;
      food.lastEatenAt = Date.now(); // Add timestamp for delayed cleanup

      player.score += pointValue;
      performanceMetrics.foodEaten++;

      console.log(
        `🍎 Player ${playerId} ate food ${foodId}: regenerated from (${oldPos.x.toFixed(
          2
        )}, ${oldPos.y.toFixed(2)}) to (${food.x.toFixed(2)}, ${food.y.toFixed(
          2
        )})`
      );

      // Score persistence now handled client-side

      // Update spatial partitioning after food regeneration
      spatialAgent.updateObject(food.id, food.x, food.y, food);
      
      // Broadcast food regeneration to all players
      io.emit("foodRegenerated", food);

      // Broadcast the eaten food type and point value to the client for snake segment storage and animations
      io.emit("typeEaten", {
        playerId,
        foodId,
        eatentype,
        pointValue,
      });

      // Broadcast score update
      io.emit("scoreUpdate", {
        playerId: playerId,
        score: Math.round(player.score * 10) / 10,
      });

      // Broadcast updated leaderboard
      const leaderboard = generateLeaderboard();
      const fullLeaderboard = generateFullLeaderboard();
      io.emit("leaderboardUpdate", {
        leaderboard: leaderboard,
        fullLeaderboard: fullLeaderboard,
      });
    }
  });

  // Handle dead point consumption
  socket.on("deadPointEaten", (data) => {
    const { playerId, deadPoints } = data;
    const player = gameState.players.get(playerId);

    if (player && deadPoints && deadPoints.length > 0) {
      // Update player activity for server state management
      if (!player.isBot) {
        updatePlayerActivity();
      }

      const currentTime = Date.now();
      const validDeadPoints = [];
      const protectedDeadPoints = [];

      // Filter dead points based on age - only allow consumption of points older than CLEANUP_INTERVAL
      deadPoints.forEach((consumedPoint) => {
        const index = gameState.deadPoints.findIndex(
          (dp) =>
            Math.abs(dp.x - consumedPoint.x) < 1 &&
            Math.abs(dp.y - consumedPoint.y) < 1 &&
            dp.color === consumedPoint.color
        );

        if (index !== -1) {
          const deadPoint = gameState.deadPoints[index];
          const age = currentTime - (deadPoint.createdAt || 0);

          // Only allow consumption if dead point is older than CLEANUP_INTERVAL (30 seconds)
          if (age >= CLEANUP_INTERVAL) {
            validDeadPoints.push({ point: consumedPoint, index });
          } else {
            protectedDeadPoints.push(deadPoint);
            console.log(
              `🛡️ Dead point protected from consumption (age: ${Math.round(
                age / 1000
              )}s < ${CLEANUP_INTERVAL / 1000}s)`
            );
          }
        }
      });

      // Remove only the valid (aged) dead points from game state
      // Sort indices in descending order to avoid index shifting issues
      validDeadPoints.sort((a, b) => b.index - a.index);
      validDeadPoints.forEach(({ point, index }) => {
        // Remove from spatial partitioning before removing from game state
        spatialAgent.removeObject(point.id);
        gameState.deadPoints.splice(index, 1);
      });

      // Update player score - award points based on dead point food types
      const consumedCount = validDeadPoints.length;
      let totalPoints = 0;
      validDeadPoints.forEach(({ point }) => {
        const deadPointType = point.type || "watermelon";
        const pointValue = getPointValueByType(deadPointType);
        totalPoints += pointValue;
      });
      player.score += totalPoints;
      performanceMetrics.deadPointsEaten += consumedCount;

      // Only broadcast removal if there were valid dead points consumed
      if (consumedCount > 0) {
        const consumedDeadPoints = validDeadPoints.map((vdp) => vdp.point);
        io.emit("deadPointsRemoved", {
          deadPoints: consumedDeadPoints,
        });
      }

      // Log protection activity
      if (protectedDeadPoints.length > 0) {
        console.log(
          `🛡️ Protected ${protectedDeadPoints.length} dead points from consumption (player: ${playerId})`
        );
      }

      // Only broadcast score and leaderboard updates if points were actually consumed
      if (consumedCount > 0) {
        // Broadcast score update
        io.emit("scoreUpdate", {
          playerId: playerId,
          score: player.score,
        });

        // Broadcast updated leaderboard
        const leaderboard = generateLeaderboard();
        const fullLeaderboard = generateFullLeaderboard();
        io.emit("leaderboardUpdate", {
          leaderboard: leaderboard,
          fullLeaderboard: fullLeaderboard,
        });
      }
    }
  });

  // Handle player death - optimized for performance
  socket.on("playerDied", (data) => {
    const startTime = performance.now();
    const player = gameState.players.get(data.playerId);
    if (!player) return;

    player.alive = false;
    const deadPoints = data.deadPoints;
    const killerId = data.killerId; // Get killer ID from client
    const totalScore = player.score || deadPoints.length;
    const targetScoreValue = Math.floor(totalScore * 0.8); // 80% of score as food value

    console.log(
      `💀 Death handling: Player ${data.playerId} score ${totalScore} → generating ${targetScoreValue} points worth of food${killerId ? `, killed by: ${killerId}` : ''}`
    );

    // Optimized food generation with exact score matching
    const newFoodItems = generateOptimalFoodDistribution(
      targetScoreValue,
      deadPoints,
      gameState.maxFoods - gameState.foods.length
    );

    // Batch add foods to game state
    gameState.foods.push(...newFoodItems);
    
    // Update spatial partitioning with new food items
    newFoodItems.forEach(food => {
      spatialAgent.addObject(food, 'foods');
    });
    
    // Remove dead player from spatial partitioning
    spatialAgent.removeObject(player.id);

    const endTime = performance.now();
    console.log(
      `⚡ Death processing completed in ${(endTime - startTime).toFixed(
        2
      )}ms, created ${newFoodItems.length} food items`
    );

    // Single broadcast for all death-related updates
    io.emit("playerDied", {
      playerId: data.playerId,
      deadPoints: [],
      newFoods: newFoodItems,
    });

    // Broadcast kill event if there was a killer (for human vs human kills)
    if (killerId && !player.isBot) {
      io.emit("playerKilled", {
        killerId: killerId,
        victimId: data.playerId,
        victimLength: deadPoints.length,
        victimScore: totalScore
      });
      console.log(`⚔️ Human vs Human kill: ${killerId} killed ${data.playerId}`);
    }

    // Trigger cleanup if needed (non-blocking)
    if (gameState.foods.length > gameState.maxFoods * 0.8) {
      setImmediate(() => performFoodCleanup());
    }

    // Only respawn human players, remove bots from arena
    if (player.isBot) {
      // Remove bot from game state completely
      gameState.players.delete(data.playerId);
      console.log(`Bot ${data.playerId} died and was removed from arena`);

      // Broadcast bot removal
      io.emit("playerDisconnected", data.playerId);

      // Update leaderboard after bot removal
      const leaderboard = generateLeaderboard();
      const fullLeaderboard = generateFullLeaderboard();
      io.emit("leaderboardUpdate", {
        leaderboard: leaderboard,
        fullLeaderboard: fullLeaderboard,
      });
    } else {
      // Respawn human player after 3 seconds
      setTimeout(() => {
        if (gameState.players.has(data.playerId)) {
          const safePosition = findSafeSpawnPosition(player.radius);
          const safeAngle = calculateSafeSpawnDirection(
            safePosition.x,
            safePosition.y,
            player.radius
          );
          const spawnTime = Date.now();

          console.log(
            `🔄 DEBUG: Respawning player ${
              data.playerId
            } at position (${safePosition.x.toFixed(
              2
            )}, ${safePosition.y.toFixed(2)})`
          );
          console.log(
            `🧭 DEBUG: Respawn angle: ${safeAngle.toFixed(4)} radians (${(
              (safeAngle * 180) /
              Math.PI
            ).toFixed(1)} degrees)`
          );
          console.log(
            `🛡️ DEBUG: Respawn protection enabled until ${new Date(
              spawnTime + 3000
            ).toLocaleTimeString()}`
          );

          const respawnedPlayer = {
            ...player,
            x: safePosition.x,
            y: safePosition.y,
            angle: safeAngle,
            points: [],
            alive: true,
            score: 0,
            spawnProtection: true,
            spawnTime: spawnTime,
          };

          // Initialize respawned player with starting points using player's main color
          for (let i = 0; i < 25; i++) {
            respawnedPlayer.points.push({
              x: respawnedPlayer.x - i * 2,
              y: respawnedPlayer.y,
              radius: respawnedPlayer.radius,
              color: respawnedPlayer.color, // Use player's main color for consistency
            });
          }

          gameState.players.set(data.playerId, respawnedPlayer);
          
          // Add respawned player to spatial partitioning
          spatialAgent.addObject(respawnedPlayer, 'players');

          console.log(
            `✅ DEBUG: Player ${data.playerId} successfully respawned with ${respawnedPlayer.points.length} body points`
          );

          // Broadcast respawn
          io.emit("playerRespawned", respawnedPlayer);

          // Set up automatic spawn protection removal after 3 seconds
          setTimeout(() => {
            const currentPlayer = gameState.players.get(data.playerId);
            if (currentPlayer && currentPlayer.spawnProtection) {
              currentPlayer.spawnProtection = false;
              console.log(
                `🛡️ DEBUG: Spawn protection removed for player ${data.playerId}`
              );
            }
          }, 3000);
        }
      }, 3000);
    }
  });

  // Handle request for minimum players
  socket.on("requestMinimumPlayers", (data) => {
    const { minPlayers } = data;
    const currentPlayerCount = gameState.players.size;
    const currentBots = Array.from(gameState.players.values()).filter(
      (p) => p.isBot
    ).length;

    if (currentPlayerCount < minPlayers) {
      const botsNeeded = minPlayers - currentPlayerCount;
      const maxBotsAllowed = Math.min(botsNeeded, MAX_BOTS - currentBots);

      if (maxBotsAllowed > 0) {
        spawnBots(maxBotsAllowed);
      } else {
        // Throttled logging to prevent spam
        const currentTime = Date.now();
        if (currentTime - lastBotLimitLog > BOT_LOG_THROTTLE) {
          console.log(
            `Cannot add more bots. Current: ${currentBots}/${MAX_BOTS}`
          );
          lastBotLimitLog = currentTime;
        }
      }

      // Broadcast updated game state to all players
      io.emit("gameStats", {
        playerCount: gameState.players.size,
        foodCount: gameState.foods.length,
      });
    }
  });

  // Handle voluntary room leaving
  socket.on("leaveRoom", (data) => {
    console.log("Player leaving room:", data.playerId, "socket:", socket.id);

    // Find and remove player (only human players, keep bots)
    const player = gameState.players.get(data.playerId);
    if (player && player.socketId === socket.id && !player.isBot) {
      // Remove from spatial partitioning before deleting
      spatialAgent.removeObject(player.id);
      gameState.players.delete(data.playerId);
      io.emit("playerDisconnected", data.playerId);
      socket.broadcast.emit("playerLeft", {
        playerId: data.playerId,
      });

      // Broadcast updated leaderboard after player leaves
      const leaderboard = generateLeaderboard();
      const fullLeaderboard = generateFullLeaderboard();
      io.emit("leaderboardUpdate", {
        leaderboard: leaderboard,
        fullLeaderboard: fullLeaderboard,
      });

      console.log("Player", data.playerId, "successfully left the room");
    }
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);

    // Find and remove player (only human players, keep bots)
    let disconnectedPlayerId = null;
    for (const [playerId, player] of gameState.players.entries()) {
      if (player.socketId === socket.id && !player.isBot) {
        disconnectedPlayerId = playerId;
      }
    }
    if (disconnectedPlayerId) {
      const player = gameState.players.get(disconnectedPlayerId);
      if (player) {
        // Remove from spatial partitioning before deleting
        spatialAgent.removeObject(player.id);
      }
      gameState.players.delete(disconnectedPlayerId);
      performanceMetrics.playerDisconnections++;
      updatePeakMetrics();
      io.emit("playerDisconnected", disconnectedPlayerId);
      socket.broadcast.emit("playerLeft", {
        playerId: disconnectedPlayerId,
      });

      // Broadcast updated leaderboard after player leaves
      const leaderboard = generateLeaderboard();
      const fullLeaderboard = generateFullLeaderboard();
      io.emit("leaderboardUpdate", {
        leaderboard: leaderboard,
        fullLeaderboard: fullLeaderboard,
      });
    }
  });
});

// Smart dead point cleanup with performance optimization
let cleanupInterval;

function startCleanupInterval() {
  if (cleanupInterval) clearInterval(cleanupInterval);

  const interval =
    serverState === SERVER_STATES.ACTIVE
      ? PERFORMANCE_CONFIG.CLEANUP_INTERVAL
      : PERFORMANCE_CONFIG.CLEANUP_INTERVAL * 0.5; // Less frequent when paused

  cleanupInterval = setInterval(() => {
    performSmartDeadPointCleanup();

    // Also perform food cleanup if approaching limit
    if (gameState.foods.length > gameState.maxFoods * 0.8) {
      performFoodCleanup();
    }
  }, interval);
}

// Start initial cleanup interval
startCleanupInterval();

// ===== OPTIMIZED BOT MANAGEMENT SYSTEM =====

// Bot update intervals based on server state
let botUpdateInterval;
let botMaintenanceInterval;
let botMaintenanceCounter = 0;

// Start optimized bot intervals
function startBotIntervals() {
  // Clear existing intervals
  if (botUpdateInterval) clearInterval(botUpdateInterval);
  if (botMaintenanceInterval) clearInterval(botMaintenanceInterval);

  // Set intervals based on server state
  const updateFreq =
    serverState === SERVER_STATES.ACTIVE
      ? PERFORMANCE_CONFIG.ACTIVE_BOT_UPDATE_INTERVAL
      : PERFORMANCE_CONFIG.IDLE_BOT_UPDATE_INTERVAL;

  const maintenanceFreq = serverState === SERVER_STATES.ACTIVE ? 5000 : 10000; // 5s active, 10s idle

  console.log(
    `🤖 BOT: Starting intervals - Update: ${updateFreq}ms, Maintenance: ${maintenanceFreq}ms (State: ${serverState})`
  );

  // Bot update interval (movement and AI)
  botUpdateInterval = setInterval(() => {
    if (serverState !== SERVER_STATES.PAUSED) {
      // Check if there are any human players before updating bots
      const humanPlayers = Array.from(gameState.players.values()).filter(
        (p) => !p.isBot && p.alive
      );

      // Only update bots if there are human players in the room
      if (humanPlayers.length > 0) {
        updateBots();

        // Broadcast bot movements to all players
        gameState.players.forEach((player) => {
          if (player.isBot && player.alive) {
            const currentTime = Date.now();
            const spawnProtectionDuration = 5000;
            const hasSpawnProtection =
              player.spawnProtection &&
              currentTime - player.spawnTime < spawnProtectionDuration;

            // Ensure bot points have the same detailed structure as human players
            const formattedPoints = player.points.map((p) => ({
              x: p.x || p.x === 0 ? p.x : player.x,
              y: p.y || p.y === 0 ? p.y : player.y,
              radius: p.radius || player.radius || 8,
              color: p.color || player.color,
              type: p.type || "watermelon",
            }));

            io.emit("playerMoved", {
              playerId: player.id,
              x: player.x,
              y: player.y,
              angle: player.angle * (180 / Math.PI), // Convert radians to degrees for client
              points: formattedPoints,
              spawnProtection: hasSpawnProtection,
            });
          }
        });

        // Update performance metrics
        performanceMetrics.botUpdates++;
      }
    }
  }, updateFreq);

  // Bot maintenance interval (spawning, cleanup)
  botMaintenanceInterval = setInterval(() => {
    if (serverState !== SERVER_STATES.PAUSED) {
      // Check if there are any human players before maintaining bots
      const humanPlayers = Array.from(gameState.players.values()).filter(
        (p) => !p.isBot && p.alive
      );

      // Only maintain bots if there are human players in the room
      if (humanPlayers.length > 0) {
        maintainOptimizedBots();
        performanceMetrics.botMaintenanceCycles++;
      }
    }
  }, maintenanceFreq);
}

// Enhanced bot maintenance with state-aware scaling
function maintainOptimizedBots() {
  const humanPlayers = Array.from(gameState.players.values()).filter(
    (p) => !p.isBot && p.alive
  ).length;
  const aliveBots = Array.from(gameState.players.values()).filter(
    (p) => p.isBot && p.alive
  );
  const allBots = Array.from(gameState.players.values()).filter((p) => p.isBot);

  // If no human players, remove all bots to completely pause bot activity
  if (humanPlayers === 0) {
    if (allBots.length > 0) {
      console.log(
        `🤖 CLEANUP: Removing all ${allBots.length} bots - no human players in room`
      );
      allBots.forEach((bot) => {
        if (bot.alive) {
          handleBotDeath(bot);
        } else {
          gameState.players.delete(bot.id);
          io.emit("playerDisconnected", bot.id);
        }
      });

      // Update leaderboard after removing all bots
      const leaderboard = generateLeaderboard();
      const fullLeaderboard = generateFullLeaderboard();
      io.emit("leaderboardUpdate", {
        leaderboard: leaderboard,
        fullLeaderboard: fullLeaderboard,
      });
    }
    return; // Exit early - no need to spawn bots
  }

  // Dynamic bot scaling based on server state and player count
  let minBots, maxBots;

  if (serverState === SERVER_STATES.PAUSED) {
    minBots = PERFORMANCE_CONFIG.MIN_BOTS_IDLE;
    maxBots = PERFORMANCE_CONFIG.MIN_BOTS_IDLE;
  } else {
    minBots = Math.max(
      PERFORMANCE_CONFIG.MIN_BOTS_ACTIVE,
      Math.min(5, 5 - humanPlayers)
    );
    maxBots = PERFORMANCE_CONFIG.MAX_BOTS_ACTIVE;
  }

  // Remove excess bots if over limit
  if (allBots.length > maxBots) {
    const sortedBots = allBots.sort((a, b) => b.score - a.score);
    const botsToRemove = sortedBots.slice(maxBots);

    botsToRemove.forEach((bot) => {
      console.log(
        `🤖 REMOVE: Bot ${bot.id} (score: ${bot.score.toFixed(
          1
        )}) - maintaining max ${maxBots} bots`
      );
      if (bot.alive) {
        handleBotDeath(bot);
      } else {
        gameState.players.delete(bot.id);
        io.emit("playerDisconnected", bot.id);
      }
    });

    // Update leaderboard after bot removal
    const leaderboard = generateLeaderboard();
    const fullLeaderboard = generateFullLeaderboard();
    io.emit("leaderboardUpdate", {
      leaderboard: leaderboard,
      fullLeaderboard: fullLeaderboard,
    });
  }

  // Spawn bots if needed
  const currentAliveBots = aliveBots.length;
  if (currentAliveBots < minBots && allBots.length < maxBots) {
    const botsNeeded = Math.min(
      minBots - currentAliveBots,
      maxBots - allBots.length
    );
    if (botsNeeded > 0) {
      console.log(
        `🤖 SPAWN: Adding ${botsNeeded} bots (${currentAliveBots}/${minBots} alive, state: ${serverState})`
      );
      spawnBots(botsNeeded);
    }
  }
}

// Start initial bot intervals
startBotIntervals();

// Start memory monitoring system
startMemoryMonitoring();

// Start performance metrics logging
startPerformanceMetricsLogging();

// Generate leaderboard data
function generateLeaderboard() {
  // Get all alive players sorted by score
  const allAlivePlayers = Array.from(gameState.players.values())
    .filter((player) => player.alive)
    .sort((a, b) => b.score - a.score);

  // Assign correct ranks to ALL players
  const playersWithRanks = allAlivePlayers.map((player, index) => ({
    id: player.id,
    name:
      player.userName ||
      (player.isBot
        ? `Player ${player.id.replace("bot-", "")}`
        : `Player ${player.id}`),
    score: player.score,
    rank: index + 1, // This is the actual rank in the full leaderboard
    isBot: player.isBot || false,
    realUserId: player.realUserId || null,
  }));

  // Return top 10 players for the leaderboard display
  // The client will handle showing current player if they're not in top 10
  return playersWithRanks.slice(0, 10);
}

// Generate full leaderboard data (for finding current player's rank)
function generateFullLeaderboard() {
  const allAlivePlayers = Array.from(gameState.players.values())
    .filter((player) => player.alive)
    .sort((a, b) => b.score - a.score);

  return allAlivePlayers.map((player, index) => ({
    id: player.id,
    name:
      player.userName ||
      (player.isBot
        ? `Player ${player.id.replace("bot-", "")}`
        : `Player ${player.id}`),
    score: player.score,
    rank: index + 1,
    isBot: player.isBot || false,
    realUserId: player.realUserId || null,
  }));
}

// Send periodic game state updates
// setInterval(() => {
//   const playerCount = gameState.players.size;
//   const leaderboard = generateLeaderboard();

//   io.emit("gameStats", {
//     playerCount: playerCount,
//     foodCount: gameState.foods.length,
//     leaderboard: leaderboard,
//   });
// }, 5000);

// // Send leaderboard updates more frequently
// setInterval(() => {
//   const leaderboard = generateLeaderboard();
//   const fullLeaderboard = generateFullLeaderboard();
//   io.emit("leaderboardUpdate", {
//     leaderboard: leaderboard,
//     fullLeaderboard: fullLeaderboard,
//   });
// }, 300);

// Health check endpoint for Docker
app.get("/health", (req, res) => {
  const memUsage = process.memoryUsage();
  const uptime = process.uptime();
  const playerCount = gameState.players.size;

  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(uptime),
    memory: {
      // Raw memory values in MB
      rss: Math.round(memUsage.rss / 1024 / 1024),
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024),
      arrayBuffers: Math.round(memUsage.arrayBuffers / 1024 / 1024),
      
      // Formatted display values
      totalUsage: `${Math.round((memUsage.rss + memUsage.external) / 1024 / 1024)}MB`,
      heapUsagePercent: `${Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)}%`,
      
      // Memory efficiency metrics
      bytesPerPlayer: Math.round(memUsage.heapUsed / (gameState.players.size || 1)),
      gcEnabled: !!global.gc
    },
    players: playerCount,
    serverState: serverState,
  });
});

// Basic info endpoint
app.get("/", (req, res) => {
  res.json({
    name: "Snake Zone Server",
    version: "1.0.0",
    status: "running",
    players: gameState.players.size,
    uptime: Math.floor(process.uptime()),
  });
});

const PORT = process.env.PORT || 9000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Game available at http://localhost:${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
});
