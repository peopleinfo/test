const path = require("path");

// Load environment variables from root directory
const envFile =
  process.env.NODE_ENV === "production"
    ? ".env"
    : `.env.${process.env.NODE_ENV || "development"}`;
require("dotenv").config({
  path: path.resolve(__dirname, `../../${envFile}`),
});

// Environment configuration with defaults
const config = {
  // Server Configuration
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: parseInt(process.env.PORT) || 9000,
  MOS_API_URL: process.env.MOS_API_URL,

  // SSL Configuration
  SSL_ENABLED: process.env.SSL_ENABLED === "true",
  SSL_CERT_PATH: process.env.SSL_CERT_PATH || "",
  SSL_KEY_PATH: process.env.SSL_KEY_PATH || "",
  SSL_PORT: parseInt(process.env.SSL_PORT) || 9443,

  // CORS Configuration
  CORS_ORIGIN: process.env.CORS_ORIGIN || "*",
  CORS_METHODS: process.env.CORS_METHODS
    ? process.env.CORS_METHODS.split(",")
    : ["GET", "POST"],

  // Socket.IO Configuration
  SOCKET_PING_TIMEOUT: parseInt(process.env.SOCKET_PING_TIMEOUT) || 60000,
  SOCKET_PING_INTERVAL: parseInt(process.env.SOCKET_PING_INTERVAL) || 25000,
  SOCKET_MAX_HTTP_BUFFER_SIZE:
    parseInt(process.env.SOCKET_MAX_HTTP_BUFFER_SIZE) || 1000000,

  // Game Configuration
  WORLD_WIDTH: parseInt(process.env.WORLD_WIDTH) || 1200,
  WORLD_HEIGHT: parseInt(process.env.WORLD_HEIGHT) || 800,
  MAX_FOODS: parseInt(process.env.MAX_FOODS) || 300,
  MAX_BOTS: parseInt(process.env.MAX_BOTS) || 3,
  MIN_PLAYERS_FOR_BATTLE: parseInt(process.env.MIN_PLAYERS_FOR_BATTLE) || 3,

  // Performance Configuration
  BASE_FPS: parseInt(process.env.BASE_FPS) || 25,
  MIN_FPS: parseInt(process.env.MIN_FPS) || 15,
  MAX_FPS: parseInt(process.env.MAX_FPS) || 35,
  MEMORY_WARNING_THRESHOLD:
    parseInt(process.env.MEMORY_WARNING_THRESHOLD) || 157286400,
  MEMORY_CRITICAL_THRESHOLD:
    parseInt(process.env.MEMORY_CRITICAL_THRESHOLD) || 209715200,

  // Logging Configuration
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  LOG_FILE_PATH: process.env.LOG_FILE_PATH || "./logs",

  // Health Check Configuration
  HEALTH_CHECK_ENABLED: process.env.HEALTH_CHECK_ENABLED !== "false",
  HEALTH_CHECK_PATH: process.env.HEALTH_CHECK_PATH || "/health",

  // Development flags
  isDevelopment: () => config.NODE_ENV === "development",
  isProduction: () => config.NODE_ENV === "production",
  isStaging: () => config.NODE_ENV === "staging",
};

// Validation
function validateConfig() {
  const errors = [];

  if (config.SSL_ENABLED && (!config.SSL_CERT_PATH || !config.SSL_KEY_PATH)) {
    errors.push("SSL is enabled but SSL_CERT_PATH or SSL_KEY_PATH is missing");
  }

  if (config.PORT < 1 || config.PORT > 65535) {
    errors.push("PORT must be between 1 and 65535");
  }

  if (config.SSL_PORT < 1 || config.SSL_PORT > 65535) {
    errors.push("SSL_PORT must be between 1 and 65535");
  }

  if (errors.length > 0) {
    console.error("❌ Configuration validation failed:");
    errors.forEach((error) => console.error(`  - ${error}`));
    process.exit(1);
  }
}

// Log configuration on startup
function logConfig() {
  console.log("🔧 Server Configuration:");
  console.log(`  Environment: ${config.NODE_ENV}`);
  console.log(`  Port: ${config.PORT}`);
  console.log(`  SSL Enabled: ${config.SSL_ENABLED}`);
  if (config.SSL_ENABLED) {
    console.log(`  SSL Port: ${config.SSL_PORT}`);
  }
  console.log(`  CORS Origin: ${config.CORS_ORIGIN}`);
  console.log(`  World Size: ${config.WORLD_WIDTH}x${config.WORLD_HEIGHT}`);
  console.log(`  Max Foods: ${config.MAX_FOODS}`);
  console.log(`  Max Bots: ${config.MAX_BOTS}`);
  console.log(`  Base FPS: ${config.BASE_FPS}`);
  console.log(`  Log Level: ${config.LOG_LEVEL}`);
}

// Initialize configuration
validateConfig();
if (config.isDevelopment()) {
  logConfig();
}

module.exports = config;
