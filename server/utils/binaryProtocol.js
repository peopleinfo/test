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
   * Create optimized game state with delta compression and batching
   * @param {string} playerId - Target player ID
   * @param {Object} currentState - Current game state
   * @param {Array} batchedUpdates - Optional batched updates from other players
   * @returns {Object} Optimized state data
   */
  createOptimizedGameState(playerId, currentState, batchedUpdates = null) {
    const previousState = this.previousStates.get(playerId);
    this.stats.totalUpdates++;
    
    if (!previousState) {
      // First update - send full state with batched data
      const optimizedState = this.optimizeStateData(currentState);
      
      // Include batched updates if available
      if (batchedUpdates && batchedUpdates.length > 0) {
        optimizedState.batchedPlayerUpdates = batchedUpdates;
      }
      
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
    
    // Add batched updates to delta if available
    if (batchedUpdates && batchedUpdates.length > 0) {
      delta.batchedPlayerUpdates = batchedUpdates;
    }
    
    // Check if delta is worth sending (if it's too large, send full state)
    const deltaSize = JSON.stringify(delta).length;
    const fullSize = JSON.stringify(this.optimizeStateData(currentState)).length;
    
    if (deltaSize > fullSize * 0.7) {
      // Delta is too large, send full state
      const optimizedState = this.optimizeStateData(currentState);
      
      // Include batched updates in full state
      if (batchedUpdates && batchedUpdates.length > 0) {
        optimizedState.batchedPlayerUpdates = batchedUpdates;
      }
      
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
   * Get enhanced player changes with improved delta compression
   * Only sends position deltas, not absolute coordinates
   * @param {Object} prev - Previous player state
   * @param {Object} curr - Current player state
   * @returns {Object} Enhanced player changes
   */
  getEnhancedPlayerChanges(prev, curr) {
    const changes = {};
    
    // Enhanced position delta compression - only send if significant change
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Only include position deltas if movement is significant (> 2 pixels)
    if (distance > 2) {
      // Use smaller precision for deltas to save bandwidth
      changes.dx = Math.round(dx * 10) / 10; // 0.1 pixel precision
      changes.dy = Math.round(dy * 10) / 10;
    }
    
    // Enhanced angle delta compression
    let angleDiff = curr.a - prev.a;
    // Normalize angle difference to [-180, 180] range
    while (angleDiff > 180) angleDiff -= 360;
    while (angleDiff < -180) angleDiff += 360;
    
    // Only include angle delta if change is significant (> 2 degrees)
    if (Math.abs(angleDiff) > 2) {
      changes.da = Math.round(angleDiff); // Integer degrees for deltas
    }
    
    // Enhanced radius delta compression
    const radiusDiff = curr.r - prev.r;
    if (Math.abs(radiusDiff) > 0.5) { // Only if radius changed significantly
      changes.dr = Math.round(radiusDiff * 10) / 10; // 0.1 precision
    }
    
    // Enhanced body point delta compression - only changed segments
    if (curr.p && prev.p && curr.p.length > 0 && prev.p.length > 0) {
      const bodyDeltas = [];
      const maxSegments = Math.min(curr.p.length, prev.p.length, 15); // Limit segments
      
      for (let i = 0; i < maxSegments; i++) {
        const currPoint = curr.p[i];
        const prevPoint = prev.p[i];
        
        if (currPoint && prevPoint) {
          const pdx = currPoint.x - prevPoint.x;
          const pdy = currPoint.y - prevPoint.y;
          const segmentDistance = Math.sqrt(pdx * pdx + pdy * pdy);
          
          // Only include segment delta if movement is significant (> 3 pixels)
          if (segmentDistance > 3) {
            bodyDeltas[i] = {
              dx: Math.round(pdx * 5) / 5, // 0.2 pixel precision for body
              dy: Math.round(pdy * 5) / 5
            };
          }
        }
      }
      
      // Only include body deltas if there are changes
      if (bodyDeltas.length > 0 && bodyDeltas.some(delta => delta)) {
        changes.pb = bodyDeltas.filter(delta => delta); // Remove empty slots
      }
    }
    
    // Only include spawn protection if it changed
    if (curr.sp !== prev.sp) {
      changes.sp = curr.sp;
    }
    
    return changes;
  }

  /**
   * Create batched player update for efficient transmission with enhanced delta compression
   * @param {Array} playerUpdates - Array of player position updates with previous states
   * @returns {Object} Batched update object with delta compression
   */
  createBatchedPlayerUpdate(playerUpdates) {
    if (!playerUpdates || playerUpdates.length === 0) return null;
    
    const batchedUpdate = {
      type: 'batch',
      timestamp: Date.now(),
      updates: []
    };
    
    for (const update of playerUpdates) {
      const deltaUpdate = { id: update.playerId };
      
      // Enhanced position delta compression
      if (update.prevX !== undefined && update.prevY !== undefined) {
        const dx = update.x - update.prevX;
        const dy = update.y - update.prevY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Only include position deltas if movement is significant
        if (distance > 2) {
          deltaUpdate.dx = Math.round(dx * 10) / 10; // 0.1 pixel precision
          deltaUpdate.dy = Math.round(dy * 10) / 10;
        }
      } else {
        // Fallback to absolute position if no previous state
        deltaUpdate.x = Math.round(update.x * 10) / 10;
        deltaUpdate.y = Math.round(update.y * 10) / 10;
      }
      
      // Enhanced angle delta compression
      if (update.prevAngle !== undefined) {
        let angleDiff = (update.angle || 0) - update.prevAngle;
        // Normalize angle difference
        while (angleDiff > 180) angleDiff -= 360;
        while (angleDiff < -180) angleDiff += 360;
        
        if (Math.abs(angleDiff) > 2) {
          deltaUpdate.da = Math.round(angleDiff);
        }
      } else {
        // Fallback to compressed absolute angle
        deltaUpdate.a = Math.round((update.angle || 0) * 255 / 360);
      }
      
      // Include spawn protection only if specified
      if (update.spawnProtection !== undefined) {
        deltaUpdate.sp = update.spawnProtection ? 1 : 0;
      }
      
      // Only add update if it has meaningful changes
      if (Object.keys(deltaUpdate).length > 1) { // More than just ID
        batchedUpdate.updates.push(deltaUpdate);
      }
    }
    
    return batchedUpdate.updates.length > 0 ? batchedUpdate : null;
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