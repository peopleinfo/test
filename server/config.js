const MIN_PLAYERS_FOR_BATTLE = 3;
const MAX_BOTS = MIN_PLAYERS_FOR_BATTLE;
const POINT = 3; // Points awarded for eating food or dead points
const FOOD_RADIUS = 5.5;

const SNAKE_SEGMENT_SCALE = 0.06; // Size of each snake segment
const SNAKE_SEGMENT_DEFAULT = 10; // Size of each snake segment

// ===== ADAPTIVE RATE LIMITING CONFIGURATION =====
const RATE_LIMITING_CONFIG = {
  // Base FPS settings
  MIN_FPS: 25, // Minimum 10 FPS (100ms intervals)
  MAX_FPS: 25, // Maximum 50 FPS (20ms intervals)
  BASE_FPS: 25, // Default 30 FPS (33ms intervals)
  // Player count thresholds for adaptive FPS
  PLAYER_THRESHOLDS: {
    LOW: 8, // 1-2 players: higher FPS
    MEDIUM: 8, // 3-5 players: medium FPS
    HIGH: 10, // 6-10 players: lower FPS
    VERY_HIGH: 15, // 11+ players: minimum FPS
  },

  // FPS adjustments based on player count
  FPS_BY_PLAYER_COUNT: {
    LOW: 30, // 1-2 players: 40 FPS
    MEDIUM: 30, // 3-5 players: 30 FPS
    HIGH: 30, // 6-10 players: 20 FPS
    VERY_HIGH: 30, // 11+ players: 15 FPS
  },

  // Network condition adjustments
  NETWORK_ADJUSTMENT: {
    GOOD: 1.0, // No adjustment
    MODERATE: 0.8, // 20% reduction
    POOR: 0.8, // 40% reduction
  },

  // Rate limiting per player
  PER_PLAYER_LIMITS: {
    MAX_UPDATES_PER_SEC: 30, // Maximum 30 updates per second per player
    BURST_LIMIT: 5, // Allow 5 updates in burst
    BURST_WINDOW: 1000, // 1 second burst window
    THROTTLE_THRESHOLD: 50, // Throttle after 50 updates/sec
  },
};

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
      return 15;
    default:
      return POINT;
  }
}

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

const CLEANUP_INTERVAL = PERFORMANCE_CONFIG.CLEANUP_INTERVAL;

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

const BOT_LOG_THROTTLE = 5000; // 5 seconds between limit logs
const BOT_RESPAWN_INTERVAL = 5000; // 5 seconds between bot spawning cycles
const BOT_SPAWN_STAGGER_DELAY = 500; // 500ms delay between individual bot spawns

// Server State Management
const SERVER_STATES = {
  ACTIVE: "active",
  PAUSED: "paused",
  RESUMING: "resuming",
};

module.exports = {
  BOT_LOG_THROTTLE,
  BOT_RESPAWN_INTERVAL,
  BOT_SPAWN_STAGGER_DELAY,
  SERVER_STATES,
  PERFORMANCE_CONFIG,
  CLEANUP_INTERVAL,
  performanceMetrics,
  getRandomColor,
  getRandomFood,
  getFoodColorByType,
  getPointValueByType,
  MAX_BOTS,
  POINT,
  FOOD_RADIUS,
  SNAKE_SEGMENT_SCALE,
  SNAKE_SEGMENT_DEFAULT,
  RATE_LIMITING_CONFIG,
};
