const { Packr, Unpackr, isNativeAccelerationEnabled } = require("msgpackr");
const { Buffer } = require("buffer");
const { EventEmitter } = require("events");

// 🚨 CRITICAL: Verify native acceleration is enabled
if (!isNativeAccelerationEnabled) {
  console.warn(
    "❌ Native acceleration not enabled! Performance will be degraded."
  );
} else {
  console.log("✅ Native acceleration enabled - maximum performance achieved!");
}

// Create msgpackr instances with SAFE configuration
const packr = new Packr({
  useRecords: false, // 🔥 DISABLED - causes buffer issues
  structures: [],
  bundleStrings: true,
  useFloat32: true,
  moreTypes: true,
  copyBuffers: false,
  maxSharedStructures: 0, // 🔥 DISABLED - prevents structure conflicts
  sequential: true, // 🔥 ENABLED - safer for streaming data
  largeBigIntToFloat: true,
  useTimestamp32: true,
});

const unpackr = new Unpackr({
  useRecords: false, // 🔥 DISABLED - causes buffer issues
  structures: [],
  bundleStrings: true,
  moreTypes: true,
  copyBuffers: false,
  sequential: true, // 🔥 ENABLED - safer for streaming data
  largeBigIntToFloat: true,
});

// Safe buffer validation
function validateBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
    throw new Error("Invalid buffer type: expected Buffer or Uint8Array");
  }

  if (buffer.length === 0) {
    throw new Error("Empty buffer provided");
  }

  if (buffer.length > 16777215) {
    // 16MB limit
    throw new Error("Buffer too large: exceeds 16MB limit");
  }

  return true;
}

// Safe msgpack unpacking with error recovery
function safeUnpack(buffer) {
  try {
    validateBuffer(buffer);

    // Create a copy to avoid buffer corruption
    const safeBuffer = Buffer.from(buffer);

    // Try to unpack
    return unpackr.unpack(safeBuffer);
  } catch (error) {
    if (error.message.includes("end of buffer not reached")) {
      console.warn("⚠️ Buffer corruption detected, attempting recovery...");

      // Try alternative unpacking method
      try {
        const packrInstance = new Packr({ useRecords: false });
        return packrInstance.unpack(buffer);
      } catch (backupError) {
        console.error("❌ Backup unpacking failed:", backupError.message);
        throw new Error(`Failed to decode msgpack data: ${error.message}`);
      }
    }

    throw error;
  }
}

// Socket.IO Protocol Types
const PACKET_TYPES = {
  CONNECT: 0,
  DISCONNECT: 1,
  EVENT: 2,
  ACK: 3,
  CONNECT_ERROR: 4,
  BINARY_EVENT: 5,
  BINARY_ACK: 6,
};

// 🚀 Socket.IO Encoder Class
class Encoder {
  encode(packet) {
    try {
      // Handle binary packets
      if (this.hasBinary(packet)) {
        return this.encodeBinary(packet);
      }

      // Regular packet encoding - use safe structure
      const safePacket = this.createSafePacket(packet);
      const encoded = packr.pack(safePacket);

      return [encoded];
    } catch (error) {
      console.error("❌ Encoder error:", error);
      throw new Error(`Encoding failed: ${error.message}`);
    }
  }

  hasBinary(packet) {
    if (!packet.data || !Array.isArray(packet.data)) return false;

    return packet.data.some(
      (item) =>
        Buffer.isBuffer(item) ||
        item instanceof ArrayBuffer ||
        item instanceof Uint8Array ||
        (item && typeof item === "object" && item.type === "Buffer")
    );
  }

  encodeBinary(packet) {
    const binaryData = [];
    const processedData = packet.data.map((item) => {
      if (Buffer.isBuffer(item) || item instanceof Uint8Array) {
        binaryData.push(Buffer.from(item));
        return { _placeholder: true, num: binaryData.length - 1 };
      }
      return item;
    });

    const binaryPacket = {
      type:
        packet.type === PACKET_TYPES.EVENT
          ? PACKET_TYPES.BINARY_EVENT
          : PACKET_TYPES.BINARY_ACK,
      nsp: packet.nsp || "/",
      id: packet.id,
      data: processedData,
    };

    const encoded = packr.pack(this.createSafePacket(binaryPacket));
    return [encoded, ...binaryData];
  }

  createSafePacket(packet) {
    // Create a safe, predictable structure
    return {
      type: packet.type,
      nsp: packet.nsp || "/",
      id: packet.id,
      data: packet.data,
    };
  }
}

// 🚀 Socket.IO Decoder Class with BUFFER FIXES
class Decoder extends EventEmitter {
  constructor() {
    super();
    this.binaryData = [];
    this.expectedBinaryCount = 0;
    this.currentPacket = null;
  }

  add(chunk) {
    try {
      // Validate input
      if (!chunk || chunk.length === 0) {
        return;
      }

      // Handle binary data chunks
      if (
        this.expectedBinaryCount > 0 &&
        (Buffer.isBuffer(chunk) || chunk instanceof ArrayBuffer)
      ) {
        this.binaryData.push(Buffer.from(chunk));

        if (this.binaryData.length === this.expectedBinaryCount) {
          this.reconstructBinaryPacket();
        }
        return;
      }

      // Decode main packet with ERROR RECOVERY
      const decoded = safeUnpack(chunk);
      const packet = this.restorePacket(decoded);

      // Check if this is a binary packet
      if (
        packet.type === PACKET_TYPES.BINARY_EVENT ||
        packet.type === PACKET_TYPES.BINARY_ACK
      ) {
        this.handleBinaryPacket(packet);
      } else {
        // Regular packet - emit immediately
        this.emit("decoded", packet);
      }
    } catch (error) {
      console.error("❌ Decoder error:", error.message);
      this.emit("error", error);
    }
  }

  handleBinaryPacket(packet) {
    this.currentPacket = packet;

    // Count placeholders
    this.expectedBinaryCount = 0;
    if (packet.data && Array.isArray(packet.data)) {
      packet.data.forEach((item) => {
        if (item && item._placeholder === true) {
          this.expectedBinaryCount++;
        }
      });
    }

    if (this.expectedBinaryCount === 0) {
      // No binary data expected, emit immediately
      this.emit("decoded", packet);
    } else {
      // Wait for binary data chunks
      this.binaryData = [];
    }
  }

  reconstructBinaryPacket() {
    try {
      let binaryIndex = 0;
      const reconstructedData = this.currentPacket.data.map((item) => {
        if (item && item._placeholder === true) {
          return this.binaryData[binaryIndex++];
        }
        return item;
      });

      const completePacket = {
        ...this.currentPacket,
        data: reconstructedData,
        type:
          this.currentPacket.type === PACKET_TYPES.BINARY_EVENT
            ? PACKET_TYPES.EVENT
            : PACKET_TYPES.ACK,
      };

      this.emit("decoded", completePacket);

      // Reset state
      this.expectedBinaryCount = 0;
      this.binaryData = [];
      this.currentPacket = null;
    } catch (error) {
      console.error("❌ Binary reconstruction error:", error);
      this.emit("error", error);
    }
  }

  restorePacket(decoded) {
    return {
      type: decoded.type,
      nsp: decoded.nsp || "/",
      id: decoded.id,
      data: decoded.data,
    };
  }

  destroy() {
    this.binaryData = [];
    this.expectedBinaryCount = 0;
    this.currentPacket = null;
    this.removeAllListeners();
  }
}

// 🚀 Export the parser
const parser = {
  Encoder,
  Decoder,
};

module.exports = parser;
module.exports.default = parser;
