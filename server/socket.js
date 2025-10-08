const socketIo = require("socket.io");
const msgpackrParser = require("./utils/sgpackr-parser-server-native");

const initSocket = (server) => {
  const io = socketIo(server, {
    parser: msgpackrParser,
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    transports: ["websocket"],
    // ✅ KEEP: Prevent upgrade attempts
    upgrade: false,

    // ❌ REMOVE: Not needed with WebSocket-only
    // rememberUpgrade: false,

    // ❌ REMOVE: Compression conflicts with msgpackr!
    // msgpackr already compresses data efficiently
    // Double compression can actually make it SLOWER
    // compression: true,
    // httpCompression: { ... },
    // perMessageDeflate: { ... },

    // ✅ KEEP: Connection optimization
    pingTimeout: 60000,
    pingInterval: 25000,
    upgradeTimeout: 10000,

    // ✅ ADJUST: Increase for msgpackr efficiency
    // msgpackr handles large payloads better
    maxHttpBufferSize: 10e6, // 10MB instead of 1MB
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

    if (token) {
      const validation = validateToken(token);
      if (validation.valid) {
        // Store authenticated user info in socket data
        socket.data.isAuthenticated = true;
        socket.data.token = token;
        socket.data.userData = userData;
        socket.data.openId = userData?.openId;
        socket.data.userInfo = userData?.userInfo;

        // Emit authentication success after connection
        socket.on("connect", () => {
          socket.emit("auth_success", {
            authenticated: true,
            openId: userData?.openId,
            userInfo: userData?.userInfo,
          });
        });
      } else {
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
    }

    next(); // Always allow connection, but track auth status
  });
  return io;
};

module.exports = initSocket;
