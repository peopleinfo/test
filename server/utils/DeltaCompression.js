/**
 * Delta Compression Utility
 * Reduces network payload by sending only changed data
 */

class DeltaCompression {
  constructor() {
    this.lastGameStates = new Map(); // playerId -> lastState
    this.compressionStats = {
      originalBytes: 0,
      compressedBytes: 0,
      compressionRatio: 0
    };
  }

  /**
   * Create delta update for a specific player
   */
  createDelta(playerId, currentGameState, lastState = null) {
    const playerLastState = lastState || this.lastGameStates.get(playerId);
    
    if (!playerLastState) {
      // First update - send full state
      this.lastGameStates.set(playerId, this.cloneGameState(currentGameState));
      return {
        type: 'full',
        data: currentGameState,
        timestamp: Date.now()
      };
    }

    const delta = {
      type: 'delta',
      timestamp: Date.now(),
      players: this.createPlayersDelta(currentGameState.players, playerLastState.players),
      foods: this.createFoodsDelta(currentGameState.foods, playerLastState.foods),
      deadPoints: this.createDeadPointsDelta(currentGameState.deadPoints, playerLastState.deadPoints)
    };

    // Update last state
    this.lastGameStates.set(playerId, this.cloneGameState(currentGameState));
    
    // Calculate compression stats
    this.updateCompressionStats(currentGameState, delta);
    
    return delta;
  }

  /**
   * Create delta for players array
   */
  createPlayersDelta(currentPlayers, lastPlayers) {
    const delta = {
      updated: [],
      removed: [],
      added: []
    };

    const currentPlayerMap = new Map(currentPlayers.map(p => [p.id, p]));
    const lastPlayerMap = new Map(lastPlayers.map(p => [p.id, p]));

    // Find updated and added players
    for (const [playerId, currentPlayer] of currentPlayerMap) {
      const lastPlayer = lastPlayerMap.get(playerId);
      
      if (!lastPlayer) {
        // New player
        delta.added.push(currentPlayer);
      } else {
        // Check if player data changed
        const playerDelta = this.createPlayerDelta(currentPlayer, lastPlayer);
        if (playerDelta) {
          delta.updated.push({ id: playerId, ...playerDelta });
        }
      }
    }

    // Find removed players
    for (const [playerId] of lastPlayerMap) {
      if (!currentPlayerMap.has(playerId)) {
        delta.removed.push(playerId);
      }
    }

    return delta;
  }

  /**
   * Create delta for individual player
   */
  createPlayerDelta(currentPlayer, lastPlayer) {
    const delta = {};
    let hasChanges = false;

    // Check position changes (with threshold)
    const positionThreshold = 0.5;
    if (Math.abs(currentPlayer.x - lastPlayer.x) > positionThreshold ||
        Math.abs(currentPlayer.y - lastPlayer.y) > positionThreshold) {
      delta.x = currentPlayer.x;
      delta.y = currentPlayer.y;
      hasChanges = true;
    }

    // Check angle changes (with threshold)
    const angleThreshold = 0.01;
    if (Math.abs(currentPlayer.angle - lastPlayer.angle) > angleThreshold) {
      delta.angle = currentPlayer.angle;
      hasChanges = true;
    }

    // Check points array changes (only send if length changed or significant position changes)
    if (currentPlayer.points.length !== lastPlayer.points.length) {
      delta.points = currentPlayer.points;
      hasChanges = true;
    } else {
      // Check if any point moved significantly
      const pointsChanged = currentPlayer.points.some((point, index) => {
        const lastPoint = lastPlayer.points[index];
        return lastPoint && (
          Math.abs(point.x - lastPoint.x) > positionThreshold ||
          Math.abs(point.y - lastPoint.y) > positionThreshold
        );
      });
      
      if (pointsChanged) {
        delta.points = currentPlayer.points;
        hasChanges = true;
      }
    }

    // Check score changes
    if (currentPlayer.score !== lastPlayer.score) {
      delta.score = currentPlayer.score;
      hasChanges = true;
    }

    return hasChanges ? delta : null;
  }

  /**
   * Create delta for foods array
   */
  createFoodsDelta(currentFoods, lastFoods) {
    const delta = {
      updated: [],
      removed: [],
      added: []
    };

    const currentFoodMap = new Map(currentFoods.map(f => [f.id, f]));
    const lastFoodMap = new Map(lastFoods.map(f => [f.id, f]));

    // Find updated and added foods
    for (const [foodId, currentFood] of currentFoodMap) {
      const lastFood = lastFoodMap.get(foodId);
      
      if (!lastFood) {
        delta.added.push(currentFood);
      } else {
        // Check if food changed (position, type, etc.)
        if (currentFood.x !== lastFood.x || 
            currentFood.y !== lastFood.y || 
            currentFood.type !== lastFood.type ||
            currentFood.color !== lastFood.color) {
          delta.updated.push(currentFood);
        }
      }
    }

    // Find removed foods
    for (const [foodId] of lastFoodMap) {
      if (!currentFoodMap.has(foodId)) {
        delta.removed.push(foodId);
      }
    }

    return delta;
  }

  /**
   * Create delta for dead points array
   */
  createDeadPointsDelta(currentDeadPoints, lastDeadPoints) {
    // Dead points are usually only added, rarely removed
    // Send only new dead points
    const lastDeadPointIds = new Set(lastDeadPoints.map(dp => `${dp.x}-${dp.y}-${dp.createdAt}`));
    const newDeadPoints = currentDeadPoints.filter(dp => 
      !lastDeadPointIds.has(`${dp.x}-${dp.y}-${dp.createdAt}`)
    );

    return {
      added: newDeadPoints,
      // Remove old dead points (older than 30 seconds)
      removed: lastDeadPoints.filter(dp => Date.now() - dp.createdAt > 30000).map(dp => `${dp.x}-${dp.y}-${dp.createdAt}`)
    };
  }

  /**
   * Apply delta to reconstruct full game state on client
   */
  applyDelta(lastGameState, delta) {
    if (delta.type === 'full') {
      return delta.data;
    }

    const newGameState = this.cloneGameState(lastGameState);

    // Apply player deltas
    if (delta.players) {
      // Remove players
      delta.players.removed.forEach(playerId => {
        newGameState.players = newGameState.players.filter(p => p.id !== playerId);
      });

      // Add new players
      delta.players.added.forEach(player => {
        newGameState.players.push(player);
      });

      // Update existing players
      delta.players.updated.forEach(playerDelta => {
        const playerIndex = newGameState.players.findIndex(p => p.id === playerDelta.id);
        if (playerIndex !== -1) {
          Object.assign(newGameState.players[playerIndex], playerDelta);
        }
      });
    }

    // Apply food deltas
    if (delta.foods) {
      // Remove foods
      delta.foods.removed.forEach(foodId => {
        newGameState.foods = newGameState.foods.filter(f => f.id !== foodId);
      });

      // Add new foods
      delta.foods.added.forEach(food => {
        newGameState.foods.push(food);
      });

      // Update existing foods
      delta.foods.updated.forEach(food => {
        const foodIndex = newGameState.foods.findIndex(f => f.id === food.id);
        if (foodIndex !== -1) {
          newGameState.foods[foodIndex] = food;
        }
      });
    }

    // Apply dead points deltas
    if (delta.deadPoints) {
      // Add new dead points
      delta.deadPoints.added.forEach(deadPoint => {
        newGameState.deadPoints.push(deadPoint);
      });

      // Remove old dead points
      delta.deadPoints.removed.forEach(deadPointId => {
        newGameState.deadPoints = newGameState.deadPoints.filter(dp => 
          `${dp.x}-${dp.y}-${dp.createdAt}` !== deadPointId
        );
      });
    }

    return newGameState;
  }

  /**
   * Clone game state for comparison
   */
  cloneGameState(gameState) {
    return JSON.parse(JSON.stringify(gameState));
  }

  /**
   * Update compression statistics
   */
  updateCompressionStats(originalState, delta) {
    const originalSize = JSON.stringify(originalState).length;
    const compressedSize = JSON.stringify(delta).length;
    
    this.compressionStats.originalBytes += originalSize;
    this.compressionStats.compressedBytes += compressedSize;
    this.compressionStats.compressionRatio = 
      (1 - this.compressionStats.compressedBytes / this.compressionStats.originalBytes) * 100;
  }

  /**
   * Get compression statistics
   */
  getStats() {
    return {
      ...this.compressionStats,
      savedBytes: this.compressionStats.originalBytes - this.compressionStats.compressedBytes
    };
  }

  /**
   * Reset compression statistics
   */
  resetStats() {
    this.compressionStats = {
      originalBytes: 0,
      compressedBytes: 0,
      compressionRatio: 0
    };
  }

  /**
   * Clear player state (when player disconnects)
   */
  clearPlayerState(playerId) {
    this.lastGameStates.delete(playerId);
  }

  /**
   * Clear all states (for cleanup)
   */
  clearAllStates() {
    this.lastGameStates.clear();
  }
}

module.exports = DeltaCompression;