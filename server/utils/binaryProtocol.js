const msgpack = require('msgpack5')();

/**
 nary Protocol Utility for msgpack1()Network Optimization
 * Implements MessagePack serialization and delta compression
 */
class BinaryProtocol {
  constructor() {
    this.previousStates = new Map(); // Store previous states for delta compression
    this.compressionThreshold = 100; // Minimum bytes to attempt compression
    this.stats = {
      totalUpdates: 0,
      deltaUpdates: 0,
      fullUpdates: 0,
      totalOriginalBytes: 0,
      totalCompressedBytes: 0,
      compressionRatio: 0
    };
  }

  /**
   * Serialize data using MessagePack
   * @param {Object} data - Data to serialize
   * @returns {Buffer} Serialized binary data
   */
  serialize(data) {
    try {
      return msgpack.encode(data);
    } catch (error) {
      console.error('Binary serialization error:', error);
      return Buffer.from(JSON.stringify(data)); // Fallback to JSON
    }
  }

  /**
   * Deserialize MessagePack data
   * @param {Buffer} buffer - Binary data to deserialize
   * @returns {Object} Deserialized data
   */
  deserialize(buffer) {
    try {
      return msgpack.decode(buffer);
    } catch (error) {
      console.error('Binary deserialization error:', error);
      return JSON.parse(buffer.toString()); // Fallback to JSON
    }
  }

  /**
   * Create optimized game state with delta compression
   * @param {string} playerId - Target player ID
   * @param {Object} currentState - Current game state
   * @returns {Object} Optimized state data
   */
  createOptimizedGameState(playerId, currentState) {
    const previousState = this.previousStates.get(playerId);
    this.stats.totalUpdates++;
    
    if (!previousState) {
      // First update - send full state
      const optimizedState = this.optimizeStateData(currentState);
      this.previousStates.set(playerId, this.cloneState(currentState));
      this.stats.fullUpdates++;
      
      return {
        type: 'full',
        timestamp: Date.now(),
        data: optimizedState
      };
    }

    // Create delta update with enhanced position compression
    const delta = this.createEnhancedDelta(previousState, currentState);
    
    // Check if delta is worth sending (if it's too large, send full state)
    const deltaSize = JSON.stringify(delta).length;
    const fullSize = JSON.stringify(this.optimizeStateData(currentState)).length;
    
    if (deltaSize > fullSize * 0.7) {
      // Delta is too large, send full state
      const optimizedState = this.optimizeStateData(currentState);
      this.previousStates.set(playerId, this.cloneState(currentState));
      this.stats.fullUpdates++;
      
      return {
        type: 'full',
        timestamp: Date.now(),
        data: optimizedState
      };
    }
    
    // Update stored state
    this.previousStates.set(playerId, this.cloneState(currentState));
    this.stats.deltaUpdates++;

    return {
      type: 'delta',
      timestamp: Date.now(),
      data: delta
    };
  }

  /**
   * Optimize state data by removing unnecessary fields and compressing coordinates
   * @param {Object} state - Game state to optimize
   * @returns {Object} Optimized state
   */
  optimizeStateData(state) {
    const optimized = {
      players: state.players?.map(player => this.optimizePlayer(player)) || [],
      foods: state.foods?.map(food => this.optimizeFood(food)) || [],
      deadPoints: state.deadPoints?.map(point => this.optimizeDeadPoint(point)) || []
    };

    // Add viewport if present
    if (state.viewport) {
      optimized.viewport = this.optimizeViewport(state.viewport);
    }

    return optimized;
  }

  /**
   * Optimize player data for transmission
   * @param {Object} player - Player object
   * @returns {Object} Optimized player data
   */
  optimizePlayer(player) {
    return {
      id: player.id,
      // Compress coordinates to integers (multiply by 100 for precision)
      x: Math.round(player.x * 100),
      y: Math.round(player.y * 100),
      // Compress angle to single byte (0-255 for 0-360 degrees)
      a: Math.round((player.angle || 0) * 255 / 360),
      // Compress radius to single byte
      r: Math.min(255, Math.round(player.radius || 5)),
      // Use color index instead of hex string
      c: this.getColorIndex(player.color),
      // Boolean flags as single byte
      f: (player.alive ? 1 : 0) | (player.ai ? 2 : 0),
      // Only include points if they exist and limit to essential data
      p: player.points ? player.points.slice(0, 50).map(point => ({
        x: Math.round(point.x * 100),
        y: Math.round(point.y * 100),
        r: Math.min(255, Math.round(point.radius || 3))
      })) : []
    };
  }

  /**
   * Optimize food data for transmission
   * @param {Object} food - Food object
   * @returns {Object} Optimized food data
   */
  optimizeFood(food) {
    return {
      id: food.id,
      x: Math.round(food.x * 100),
      y: Math.round(food.y * 100),
      r: Math.min(255, Math.round(food.radius || 3)),
      c: this.getColorIndex(food.color),
      t: food.type || 0
    };
  }

  /**
   * Optimize dead point data for transmission
   * @param {Object} point - Dead point object
   * @returns {Object} Optimized dead point data
   */
  optimizeDeadPoint(point) {
    return {
      id: point.id,
      x: Math.round(point.x * 100),
      y: Math.round(point.y * 100),
      r: Math.min(255, Math.round(point.radius || 3)),
      c: this.getColorIndex(point.color)
    };
  }

  /**
   * Optimize viewport data for transmission
   * @param {Object} viewport - Viewport object
   * @returns {Object} Optimized viewport data
   */
  optimizeViewport(viewport) {
    return {
      x: Math.round(viewport.x * 100),
      y: Math.round(viewport.y * 100),
      w: Math.round(viewport.width * 100),
      h: Math.round(viewport.height * 100)
    };
  }

  /**
   * Get color index for compression (maps common colors to indices)
   * @param {string} color - Color hex string
   * @returns {number} Color index
   */
  getColorIndex(color) {
    const colorMap = {
      '#ff0000': 0, '#00ff00': 1, '#0000ff': 2, '#ffff00': 3,
      '#ff00ff': 4, '#00ffff': 5, '#ffffff': 6, '#000000': 7,
      '#ff8000': 8, '#8000ff': 9, '#80ff00': 10, '#0080ff': 11
    };
    return colorMap[color] !== undefined ? colorMap[color] : 255;
  }

  /**
   * Create delta between previous and current state
   * @param {Object} previous - Previous state
   * @param {Object} current - Current state
   * @returns {Object} Delta object
   */
  createDelta(previous, current) {
    const delta = {};

    // Compare players
    if (current.players) {
      const playerDeltas = [];
      current.players.forEach(player => {
        const prevPlayer = previous.players?.find(p => p.id === player.id);
        if (!prevPlayer) {
          // New player
          playerDeltas.push({ action: 'add', data: this.optimizePlayer(player) });
        } else {
          // Check for changes
          const changes = this.getPlayerChanges(prevPlayer, player);
          if (Object.keys(changes).length > 0) {
            playerDeltas.push({ action: 'update', id: player.id, data: changes });
          }
        }
      });

      // Check for removed players
      if (previous.players) {
        previous.players.forEach(prevPlayer => {
          if (!current.players.find(p => p.id === prevPlayer.id)) {
            playerDeltas.push({ action: 'remove', id: prevPlayer.id });
          }
        });
      }

      if (playerDeltas.length > 0) {
        delta.players = playerDeltas;
      }
    }

    // Compare foods (simplified - only track additions/removals)
    if (current.foods && previous.foods) {
      const foodChanges = this.getFoodChanges(previous.foods, current.foods);
      if (foodChanges.length > 0) {
        delta.foods = foodChanges;
      }
    }

    // Compare dead points (simplified - only track additions/removals)
    if (current.deadPoints && previous.deadPoints) {
      const deadPointChanges = this.getDeadPointChanges(previous.deadPoints, current.deadPoints);
      if (deadPointChanges.length > 0) {
        delta.deadPoints = deadPointChanges;
      }
    }

    return delta;
  }

  /**
   * Create enhanced delta with better position compression
   * @param {Object} previous - Previous state
   * @param {Object} current - Current state
   * @returns {Object} Enhanced delta object
   */
  createEnhancedDelta(previous, current) {
    const delta = {};

    // Enhanced player delta compression
    if (current.players) {
      const playerDeltas = [];
      current.players.forEach(player => {
        const prevPlayer = previous.players?.find(p => p.id === player.id);
        if (!prevPlayer) {
          // New player
          playerDeltas.push({ action: 'add', data: this.optimizePlayer(player) });
        } else {
          // Enhanced position delta
          const positionDelta = this.getEnhancedPlayerChanges(prevPlayer, player);
          if (Object.keys(positionDelta).length > 0) {
            playerDeltas.push({ action: 'update', id: player.id, data: positionDelta });
          }
        }
      });

      // Check for removed players
      if (previous.players) {
        previous.players.forEach(prevPlayer => {
          if (!current.players.find(p => p.id === prevPlayer.id)) {
            playerDeltas.push({ action: 'remove', id: prevPlayer.id });
          }
        });
      }

      if (playerDeltas.length > 0) {
        delta.players = playerDeltas;
      }
    }

    // Enhanced food delta compression
    if (current.foods && previous.foods) {
      const foodChanges = this.getEnhancedFoodChanges(previous.foods, current.foods);
      if (foodChanges.length > 0) {
        delta.foods = foodChanges;
      }
    }

    // Enhanced dead point delta compression
    if (current.deadPoints && previous.deadPoints) {
      const deadPointChanges = this.getEnhancedDeadPointChanges(previous.deadPoints, current.deadPoints);
      if (deadPointChanges.length > 0) {
        delta.deadPoints = deadPointChanges;
      }
    }

    return delta;
  }

  /**
   * Get enhanced changes between two player states with position delta compression
   * @param {Object} prev - Previous player state
   * @param {Object} curr - Current player state
   * @returns {Object} Changes object with position deltas
   */
  getEnhancedPlayerChanges(prev, curr) {
    const changes = {};
    const optimizedCurr = this.optimizePlayer(curr);
    const optimizedPrev = this.optimizePlayer(prev);

    // Enhanced position delta compression
    const deltaX = optimizedCurr.x - optimizedPrev.x;
    const deltaY = optimizedCurr.y - optimizedPrev.y;
    
    // Only send position deltas if movement is significant (threshold: 2 units = 0.02 world units)
    if (Math.abs(deltaX) > 2) {
      // Use delta encoding for small movements, absolute for large movements
      if (Math.abs(deltaX) < 1000) { // 10 world units
        changes.dx = deltaX; // Delta X
      } else {
        changes.x = optimizedCurr.x; // Absolute X for large movements
      }
    }
    
    if (Math.abs(deltaY) > 2) {
      if (Math.abs(deltaY) < 1000) { // 10 world units
        changes.dy = deltaY; // Delta Y
      } else {
        changes.y = optimizedCurr.y; // Absolute Y for large movements
      }
    }
    
    // Angle delta compression
    const deltaAngle = optimizedCurr.a - optimizedPrev.a;
    if (Math.abs(deltaAngle) > 3) { // Threshold: 3 units
      if (Math.abs(deltaAngle) < 64) { // Small angle change
        changes.da = deltaAngle;
      } else {
        changes.a = optimizedCurr.a; // Large angle change
      }
    }
    
    // Radius changes
    if (optimizedCurr.r !== optimizedPrev.r) changes.r = optimizedCurr.r;
    
    // Flags
    if (optimizedCurr.f !== optimizedPrev.f) changes.f = optimizedCurr.f;
    
    // Snake body points delta compression
    if (optimizedCurr.p.length !== optimizedPrev.p.length) {
      changes.p = optimizedCurr.p; // Full update if length changed
    } else if (optimizedCurr.p.length > 0) {
      // Check for significant position changes in snake body
      const bodyChanges = [];
      let hasChanges = false;
      
      for (let i = 0; i < Math.min(optimizedCurr.p.length, 20); i++) { // Limit to first 20 segments
        const currPoint = optimizedCurr.p[i];
        const prevPoint = optimizedPrev.p[i];
        
        if (currPoint && prevPoint) {
          const pdx = currPoint.x - prevPoint.x;
          const pdy = currPoint.y - prevPoint.y;
          
          if (Math.abs(pdx) > 5 || Math.abs(pdy) > 5) { // Threshold for body segments
            bodyChanges[i] = { dx: pdx, dy: pdy };
            hasChanges = true;
          }
        }
      }
      
      if (hasChanges) {
        changes.pb = bodyChanges; // Body point deltas
      }
    }

    return changes;
  }

  /**
   * Get food changes between states
   * @param {Array} prevFoods - Previous foods
   * @param {Array} currFoods - Current foods
   * @returns {Array} Food changes
   */
  getFoodChanges(prevFoods, currFoods) {
    const changes = [];
    
    // Find removed foods
    prevFoods.forEach(prevFood => {
      if (!currFoods.find(f => f.id === prevFood.id)) {
        changes.push({ action: 'remove', id: prevFood.id });
      }
    });

    // Find added foods
    currFoods.forEach(currFood => {
      if (!prevFoods.find(f => f.id === currFood.id)) {
        changes.push({ action: 'add', data: this.optimizeFood(currFood) });
      }
    });

    return changes;
  }

  /**
   * Get dead point changes between states
   * @param {Array} prevPoints - Previous dead points
   * @param {Array} currPoints - Current dead points
   * @returns {Array} Dead point changes
   */
  getDeadPointChanges(prevPoints, currPoints) {
    const changes = [];
    
    // Find removed dead points
    prevPoints.forEach(prevPoint => {
      if (!currPoints.find(p => p.id === prevPoint.id)) {
        changes.push({ action: 'remove', id: prevPoint.id });
      }
    });

    // Find added dead points
    currPoints.forEach(currPoint => {
      if (!prevPoints.find(p => p.id === currPoint.id)) {
        changes.push({ action: 'add', data: this.optimizeDeadPoint(currPoint) });
      }
    });

    return changes;
  }

  /**
   * Clone state for delta comparison
   * @param {Object} state - State to clone
   * @returns {Object} Cloned state
   */
  cloneState(state) {
    return JSON.parse(JSON.stringify(state));
  }

  /**
   * Clean up old player states to prevent memory leaks
   * @param {Array} activePlayerIds - Currently active player IDs
   */
  cleanup(activePlayerIds) {
    const activeIds = new Set(activePlayerIds);
    for (const playerId of this.previousStates.keys()) {
      if (!activeIds.has(playerId)) {
        this.previousStates.delete(playerId);
      }
    }
  }

  /**
   * Get enhanced food changes with delta compression
   * @param {Array} prevFoods - Previous foods
   * @param {Array} currFoods - Current foods
   * @returns {Array} Food changes
   */
  getEnhancedFoodChanges(prevFoods, currFoods) {
    const changes = [];
    
    // Batch removals for efficiency
    const removedIds = [];
    prevFoods.forEach(prevFood => {
      if (!currFoods.find(f => f.id === prevFood.id)) {
        removedIds.push(prevFood.id);
      }
    });
    
    if (removedIds.length > 0) {
      changes.push({ action: 'remove_batch', ids: removedIds });
    }

    // Batch additions for efficiency
    const addedFoods = [];
    currFoods.forEach(currFood => {
      if (!prevFoods.find(f => f.id === currFood.id)) {
        addedFoods.push(this.optimizeFood(currFood));
      }
    });
    
    if (addedFoods.length > 0) {
      changes.push({ action: 'add_batch', data: addedFoods });
    }

    return changes;
  }

  /**
   * Get enhanced dead point changes with delta compression
   * @param {Array} prevPoints - Previous dead points
   * @param {Array} currPoints - Current dead points
   * @returns {Array} Dead point changes
   */
  getEnhancedDeadPointChanges(prevPoints, currPoints) {
    const changes = [];
    
    // Batch removals for efficiency
    const removedIds = [];
    prevPoints.forEach(prevPoint => {
      if (!currPoints.find(p => p.id === prevPoint.id)) {
        removedIds.push(prevPoint.id);
      }
    });
    
    if (removedIds.length > 0) {
      changes.push({ action: 'remove_batch', ids: removedIds });
    }

    // Batch additions for efficiency
    const addedPoints = [];
    currPoints.forEach(currPoint => {
      if (!prevPoints.find(p => p.id === currPoint.id)) {
        addedPoints.push(this.optimizeDeadPoint(currPoint));
      }
    });
    
    if (addedPoints.length > 0) {
      changes.push({ action: 'add_batch', data: addedPoints });
    }

    return changes;
  }

  /**
   * Override serialize to track compression stats
   * @param {Object} data - Data to serialize
   * @returns {Buffer} Serialized binary data
   */
  serialize(data) {
    try {
      const originalSize = JSON.stringify(data).length;
      const compressed = msgpack.encode(data);
      
      // Update compression stats
      this.stats.totalOriginalBytes += originalSize;
      this.stats.totalCompressedBytes += compressed.length;
      this.stats.compressionRatio = this.stats.totalOriginalBytes > 0 
        ? ((this.stats.totalOriginalBytes - this.stats.totalCompressedBytes) / this.stats.totalOriginalBytes) * 100
        : 0;
      
      return compressed;
    } catch (error) {
      console.error('Binary serialization error:', error);
      return Buffer.from(JSON.stringify(data)); // Fallback to JSON
    }
  }

  /**
   * Get comprehensive compression statistics
   * @returns {Object} Compression stats
   */
  getStats() {
    return {
      activeStates: this.previousStates.size,
      compressionThreshold: this.compressionThreshold,
      totalUpdates: this.stats.totalUpdates,
      deltaUpdates: this.stats.deltaUpdates,
      fullUpdates: this.stats.fullUpdates,
      deltaRatio: this.stats.totalUpdates > 0 ? (this.stats.deltaUpdates / this.stats.totalUpdates) * 100 : 0,
      compressionRatio: this.stats.compressionRatio,
      totalOriginalBytes: this.stats.totalOriginalBytes,
      totalCompressedBytes: this.stats.totalCompressedBytes,
      averageCompressionPerUpdate: this.stats.totalUpdates > 0 
        ? this.stats.totalCompressedBytes / this.stats.totalUpdates 
        : 0
    };
  }
}

module.exports = BinaryProtocol;