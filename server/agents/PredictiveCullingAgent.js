/**
 * Predictive Culling Agent (PCA)
 * Predicts what game objects clients will need based on movement patterns
 * Enables proactive data loading and smooth gameplay experience
 */

class PredictiveCullingAgent {
  constructor() {
    // Player movement history for prediction
    this.playerHistory = new Map();
    
    // Prediction parameters
    this.config = {
      historySize: 10,           // Number of movement samples to keep
      predictionTime: 1000,      // Predict 1 second ahead (ms)
      velocitySmoothing: 0.7,    // Velocity smoothing factor
      accelerationWeight: 0.3,   // Weight for acceleration in prediction
      bufferZone: 50,           // Extra buffer around predicted area
      minPredictionDistance: 20, // Minimum distance to make predictions
      maxPredictionDistance: 200 // Maximum prediction distance
    };
    
    // Cache for predicted positions
    this.predictionCache = new Map();
    this.cacheTimeout = 100; // Cache predictions for 100ms
    
    console.log('🔮 Predictive Culling Agent initialized');
  }

  /**
   * Update player movement history
   */
  updatePlayerMovement(playerId, x, y, timestamp = Date.now()) {
    if (!this.playerHistory.has(playerId)) {
      this.playerHistory.set(playerId, []);
    }
    
    const history = this.playerHistory.get(playerId);
    
    // Add new position
    history.push({ x, y, timestamp });
    
    // Keep only recent history
    if (history.length > this.config.historySize) {
      history.shift();
    }
    
    // Clear prediction cache for this player
    this.predictionCache.delete(playerId);
  }

  /**
   * Predict future position based on movement history
   */
  predictFuturePosition(playerId, predictionTimeMs = null) {
    const predictionTime = predictionTimeMs || this.config.predictionTime;
    const cacheKey = `${playerId}_${predictionTime}`;
    
    // Check cache first
    const cached = this.predictionCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.prediction;
    }
    
    const history = this.playerHistory.get(playerId);
    if (!history || history.length < 2) {
      return null; // Not enough data for prediction
    }
    
    const latest = history[history.length - 1];
    const previous = history[history.length - 2];
    
    // Calculate velocity
    const deltaTime = latest.timestamp - previous.timestamp;
    if (deltaTime <= 0) return null;
    
    const velocityX = (latest.x - previous.x) / deltaTime;
    const velocityY = (latest.y - previous.y) / deltaTime;
    
    // Calculate acceleration if we have enough history
    let accelerationX = 0;
    let accelerationY = 0;
    
    if (history.length >= 3) {
      const beforePrevious = history[history.length - 3];
      const prevDeltaTime = previous.timestamp - beforePrevious.timestamp;
      
      if (prevDeltaTime > 0) {
        const prevVelocityX = (previous.x - beforePrevious.x) / prevDeltaTime;
        const prevVelocityY = (previous.y - beforePrevious.y) / prevDeltaTime;
        
        accelerationX = (velocityX - prevVelocityX) / deltaTime;
        accelerationY = (velocityY - prevVelocityY) / deltaTime;
      }
    }
    
    // Smooth velocity using exponential moving average
    const smoothedVelocityX = velocityX * this.config.velocitySmoothing;
    const smoothedVelocityY = velocityY * this.config.velocitySmoothing;
    
    // Predict future position
    const predictionSeconds = predictionTime / 1000;
    const predictedX = latest.x + 
      (smoothedVelocityX * predictionSeconds) + 
      (accelerationX * this.config.accelerationWeight * predictionSeconds * predictionSeconds * 0.5);
    const predictedY = latest.y + 
      (smoothedVelocityY * predictionSeconds) + 
      (accelerationY * this.config.accelerationWeight * predictionSeconds * predictionSeconds * 0.5);
    
    // Calculate prediction confidence based on movement consistency
    const confidence = this.calculatePredictionConfidence(history);
    
    // Limit prediction distance
    const predictionDistance = Math.sqrt(
      Math.pow(predictedX - latest.x, 2) + Math.pow(predictedY - latest.y, 2)
    );
    
    let finalPredictedX = predictedX;
    let finalPredictedY = predictedY;
    
    if (predictionDistance > this.config.maxPredictionDistance) {
      const ratio = this.config.maxPredictionDistance / predictionDistance;
      finalPredictedX = latest.x + (predictedX - latest.x) * ratio;
      finalPredictedY = latest.y + (predictedY - latest.y) * ratio;
    }
    
    const prediction = {
      x: finalPredictedX,
      y: finalPredictedY,
      confidence,
      velocity: { x: smoothedVelocityX, y: smoothedVelocityY },
      acceleration: { x: accelerationX, y: accelerationY },
      distance: Math.min(predictionDistance, this.config.maxPredictionDistance)
    };
    
    // Cache the prediction
    this.predictionCache.set(cacheKey, {
      prediction,
      timestamp: Date.now()
    });
    
    return prediction;
  }

  /**
   * Calculate prediction confidence based on movement consistency
   */
  calculatePredictionConfidence(history) {
    if (history.length < 3) return 0.5;
    
    // Calculate velocity consistency
    const velocities = [];
    for (let i = 1; i < history.length; i++) {
      const deltaTime = history[i].timestamp - history[i-1].timestamp;
      if (deltaTime > 0) {
        velocities.push({
          x: (history[i].x - history[i-1].x) / deltaTime,
          y: (history[i].y - history[i-1].y) / deltaTime
        });
      }
    }
    
    if (velocities.length < 2) return 0.5;
    
    // Calculate velocity variance
    const avgVelX = velocities.reduce((sum, v) => sum + v.x, 0) / velocities.length;
    const avgVelY = velocities.reduce((sum, v) => sum + v.y, 0) / velocities.length;
    
    const varianceX = velocities.reduce((sum, v) => sum + Math.pow(v.x - avgVelX, 2), 0) / velocities.length;
    const varianceY = velocities.reduce((sum, v) => sum + Math.pow(v.y - avgVelY, 2), 0) / velocities.length;
    
    const totalVariance = Math.sqrt(varianceX + varianceY);
    
    // Lower variance = higher confidence
    return Math.max(0.1, Math.min(1.0, 1.0 - (totalVariance * 0.001)));
  }

  /**
   * Get predicted viewport bounds for a player
   */
  getPredictedViewport(playerId, currentViewport, predictionTimeMs = null) {
    const prediction = this.predictFuturePosition(playerId, predictionTimeMs);
    if (!prediction) {
      return currentViewport; // Return current viewport if no prediction available
    }
    
    // Calculate predicted viewport center
    const predictedCenterX = prediction.x;
    const predictedCenterY = prediction.y;
    
    // Add buffer zone based on prediction confidence and distance
    const bufferMultiplier = 1 + (prediction.distance / 100) * (1 - prediction.confidence);
    const buffer = this.config.bufferZone * bufferMultiplier;
    
    return {
      left: predictedCenterX - (currentViewport.width / 2) - buffer,
      right: predictedCenterX + (currentViewport.width / 2) + buffer,
      top: predictedCenterY - (currentViewport.height / 2) - buffer,
      bottom: predictedCenterY + (currentViewport.height / 2) + buffer,
      width: currentViewport.width + (buffer * 2),
      height: currentViewport.height + (buffer * 2),
      centerX: predictedCenterX,
      centerY: predictedCenterY,
      prediction: prediction
    };
  }

  /**
   * Predict which objects will be needed soon
   */
  predictNeededObjects(playerId, allObjects, currentViewport, spatialAgent = null) {
    const predictedViewport = this.getPredictedViewport(playerId, currentViewport);
    
    // Get objects in predicted viewport
    let predictedObjects;
    if (spatialAgent) {
      predictedObjects = spatialAgent.getObjectsInBounds(
        predictedViewport.left,
        predictedViewport.right,
        predictedViewport.top,
        predictedViewport.bottom
      );
    } else {
      // Fallback to manual filtering
      predictedObjects = allObjects.filter(obj => 
        obj.x >= predictedViewport.left &&
        obj.x <= predictedViewport.right &&
        obj.y >= predictedViewport.top &&
        obj.y <= predictedViewport.bottom
      );
    }
    
    // Add prediction metadata
    return predictedObjects.map(obj => ({
      ...obj,
      isPredicted: true,
      predictionConfidence: predictedViewport.prediction?.confidence || 0,
      predictionDistance: predictedViewport.prediction?.distance || 0
    }));
  }

  /**
   * Get movement trend for a player
   */
  getMovementTrend(playerId) {
    const history = this.playerHistory.get(playerId);
    if (!history || history.length < 3) {
      return { trend: 'unknown', confidence: 0 };
    }
    
    const recent = history.slice(-3);
    const directions = [];
    
    for (let i = 1; i < recent.length; i++) {
      const dx = recent[i].x - recent[i-1].x;
      const dy = recent[i].y - recent[i-1].y;
      const angle = Math.atan2(dy, dx);
      directions.push(angle);
    }
    
    // Calculate direction consistency
    const avgDirection = directions.reduce((sum, dir) => sum + dir, 0) / directions.length;
    const directionVariance = directions.reduce((sum, dir) => {
      let diff = Math.abs(dir - avgDirection);
      if (diff > Math.PI) diff = 2 * Math.PI - diff; // Handle angle wrapping
      return sum + diff * diff;
    }, 0) / directions.length;
    
    const consistency = Math.max(0, 1 - (directionVariance / (Math.PI * Math.PI)));
    
    // Determine trend
    let trend = 'straight';
    if (directionVariance > 0.5) {
      trend = 'erratic';
    } else if (consistency > 0.8) {
      trend = 'straight';
    } else {
      trend = 'turning';
    }
    
    return {
      trend,
      confidence: consistency,
      direction: avgDirection,
      variance: directionVariance
    };
  }

  /**
   * Clean up old player data
   */
  cleanup(activePlayerIds) {
    const currentTime = Date.now();
    const maxAge = 30000; // 30 seconds
    
    // Remove inactive players
    for (const [playerId, history] of this.playerHistory) {
      if (!activePlayerIds.has(playerId)) {
        this.playerHistory.delete(playerId);
        this.predictionCache.delete(playerId);
        continue;
      }
      
      // Remove old history entries
      const recentHistory = history.filter(entry => 
        currentTime - entry.timestamp < maxAge
      );
      
      if (recentHistory.length === 0) {
        this.playerHistory.delete(playerId);
      } else {
        this.playerHistory.set(playerId, recentHistory);
      }
    }
    
    // Clean prediction cache
    for (const [key, cached] of this.predictionCache) {
      if (currentTime - cached.timestamp > this.cacheTimeout * 10) {
        this.predictionCache.delete(key);
      }
    }
  }

  /**
   * Get prediction statistics
   */
  getStats() {
    const activePlayerCount = this.playerHistory.size;
    const totalHistoryEntries = Array.from(this.playerHistory.values())
      .reduce((sum, history) => sum + history.length, 0);
    const cacheSize = this.predictionCache.size;
    
    return {
      activePlayerCount,
      totalHistoryEntries,
      averageHistoryPerPlayer: activePlayerCount > 0 ? totalHistoryEntries / activePlayerCount : 0,
      cacheSize,
      memoryUsage: {
        historyMB: (totalHistoryEntries * 32) / (1024 * 1024), // Rough estimate
        cacheMB: (cacheSize * 128) / (1024 * 1024) // Rough estimate
      }
    };
  }

  /**
   * Update predictions for all active players
   */
  updatePredictions() {
    const currentTime = Date.now();
    
    // Update predictions for all players with recent movement
    for (const [playerId, history] of this.playerHistory) {
      if (history.length > 0) {
        const lastUpdate = history[history.length - 1].timestamp;
        
        // Only update predictions for recently active players (within last 5 seconds)
        if (currentTime - lastUpdate < 5000) {
          this.predictFuturePosition(playerId);
        }
      }
    }
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log('🔮 PCA: Configuration updated:', this.config);
  }
}

module.exports = { PredictiveCullingAgent };