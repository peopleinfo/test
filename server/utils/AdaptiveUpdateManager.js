/**
 * Adaptive Update Manager
 * Dynamically adjusts update frequencies based on player activity and network conditions
 * Optimizes performance for 20-30 concurrent players
 */

class AdaptiveUpdateManager {
  constructor() {
    this.playerMetrics = new Map(); // Track per-player metrics
    this.globalMetrics = {
      averagePing: 0,
      playerCount: 0,
      serverLoad: 0,
      networkBandwidth: 0
    };
    
    // Update frequency tiers (ms)
    this.updateTiers = {
      high: 33,    // 30 FPS - for active players
      medium: 50,  // 20 FPS - for moderate activity
      low: 100,    // 10 FPS - for inactive players
      minimal: 200 // 5 FPS - for very inactive players
    };
    
    // Activity thresholds
    this.activityThresholds = {
      movement: 5,      // pixels per second
      direction: 0.1,   // radians per second
      interaction: 1000 // ms since last interaction
    };
    
    this.lastUpdate = Date.now();
    this.updateHistory = [];
  }

  /**
   * Update player metrics and determine optimal update frequency
   */
  updatePlayerMetrics(playerId, playerData, ping = 0) {
    const now = Date.now();
    let metrics = this.playerMetrics.get(playerId);
    
    if (!metrics) {
      metrics = {
        lastPosition: { x: playerData.x, y: playerData.y },
        lastDirection: playerData.angle || 0,
        lastUpdate: now,
        lastInteraction: now,
        movementSpeed: 0,
        directionChange: 0,
        ping: ping,
        activityLevel: 'medium',
        updateFrequency: this.updateTiers.medium,
        consecutiveInactive: 0
      };
      this.playerMetrics.set(playerId, metrics);
      return metrics.updateFrequency;
    }

    const deltaTime = now - metrics.lastUpdate;
    if (deltaTime < 16) return metrics.updateFrequency; // Minimum 16ms between updates

    // Calculate movement speed
    const distance = Math.sqrt(
      Math.pow(playerData.x - metrics.lastPosition.x, 2) +
      Math.pow(playerData.y - metrics.lastPosition.y, 2)
    );
    metrics.movementSpeed = distance / (deltaTime / 1000); // pixels per second

    // Calculate direction change
    const currentAngle = playerData.angle || 0;
    let angleDiff = Math.abs(currentAngle - metrics.lastDirection);
    if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
    metrics.directionChange = angleDiff / (deltaTime / 1000); // radians per second

    // Update ping with smoothing
    if (ping > 0) {
      metrics.ping = metrics.ping * 0.8 + ping * 0.2;
    }

    // Determine activity level
    const activityLevel = this.calculateActivityLevel(metrics);
    metrics.activityLevel = activityLevel;

    // Adjust update frequency based on activity and network conditions
    metrics.updateFrequency = this.calculateUpdateFrequency(metrics);

    // Update stored values
    metrics.lastPosition = { x: playerData.x, y: playerData.y };
    metrics.lastDirection = currentAngle;
    metrics.lastUpdate = now;

    // Track consecutive inactive periods
    if (activityLevel === 'minimal') {
      metrics.consecutiveInactive++;
    } else {
      metrics.consecutiveInactive = 0;
    }

    return metrics.updateFrequency;
  }

  /**
   * Calculate player activity level
   */
  calculateActivityLevel(metrics) {
    const { movementSpeed, directionChange, ping, consecutiveInactive } = metrics;
    
    // High activity: fast movement or frequent direction changes
    if (movementSpeed > this.activityThresholds.movement * 2 ||
        directionChange > this.activityThresholds.direction * 2) {
      return 'high';
    }
    
    // Medium activity: moderate movement
    if (movementSpeed > this.activityThresholds.movement ||
        directionChange > this.activityThresholds.direction) {
      return 'medium';
    }
    
    // Low activity: minimal movement
    if (movementSpeed > this.activityThresholds.movement * 0.5 ||
        directionChange > this.activityThresholds.direction * 0.5) {
      return 'low';
    }
    
    // Minimal activity: almost stationary
    return 'minimal';
  }

  /**
   * Calculate optimal update frequency
   */
  calculateUpdateFrequency(metrics) {
    let baseFrequency = this.updateTiers[metrics.activityLevel];
    
    // Adjust for network conditions
    if (metrics.ping > 100) {
      // High ping - reduce frequency
      baseFrequency = Math.min(baseFrequency * 1.5, this.updateTiers.minimal);
    } else if (metrics.ping < 30) {
      // Low ping - can increase frequency for active players
      if (metrics.activityLevel === 'high') {
        baseFrequency = Math.max(baseFrequency * 0.8, this.updateTiers.high);
      }
    }
    
    // Adjust for server load
    const playerCount = this.playerMetrics.size;
    if (playerCount > 20) {
      // High player count - reduce frequency
      const loadFactor = Math.min(playerCount / 20, 2);
      baseFrequency = Math.min(baseFrequency * loadFactor, this.updateTiers.minimal);
    }
    
    // Adjust for consecutive inactive periods
    if (metrics.consecutiveInactive > 10) {
      baseFrequency = this.updateTiers.minimal;
    }
    
    return Math.round(baseFrequency);
  }

  /**
   * Check if player should receive update based on their frequency
   */
  shouldUpdatePlayer(playerId) {
    const metrics = this.playerMetrics.get(playerId);
    if (!metrics) return true;
    
    const now = Date.now();
    const timeSinceLastUpdate = now - metrics.lastUpdate;
    
    return timeSinceLastUpdate >= metrics.updateFrequency;
  }

  /**
   * Get players grouped by update frequency for batched processing
   */
  getPlayersByUpdateTier() {
    const tiers = {
      high: [],
      medium: [],
      low: [],
      minimal: []
    };
    
    for (const [playerId, metrics] of this.playerMetrics) {
      const tier = this.getFrequencyTier(metrics.updateFrequency);
      tiers[tier].push(playerId);
    }
    
    return tiers;
  }

  /**
   * Get frequency tier name from frequency value
   */
  getFrequencyTier(frequency) {
    if (frequency <= this.updateTiers.high) return 'high';
    if (frequency <= this.updateTiers.medium) return 'medium';
    if (frequency <= this.updateTiers.low) return 'low';
    return 'minimal';
  }

  /**
   * Update global metrics
   */
  updateGlobalMetrics(playerCount, averagePing, serverLoad) {
    this.globalMetrics.playerCount = playerCount;
    this.globalMetrics.averagePing = averagePing;
    this.globalMetrics.serverLoad = serverLoad;
    
    // Adjust global thresholds based on server performance
    if (serverLoad > 0.8) {
      // High server load - reduce all frequencies
      Object.keys(this.updateTiers).forEach(tier => {
        this.updateTiers[tier] = Math.min(this.updateTiers[tier] * 1.2, 200);
      });
    } else if (serverLoad < 0.3) {
      // Low server load - can increase frequencies
      Object.keys(this.updateTiers).forEach(tier => {
        this.updateTiers[tier] = Math.max(this.updateTiers[tier] * 0.9, 16);
      });
    }
  }

  /**
   * Mark player interaction (input received)
   */
  markPlayerInteraction(playerId) {
    const metrics = this.playerMetrics.get(playerId);
    if (metrics) {
      metrics.lastInteraction = Date.now();
      // Boost update frequency temporarily for responsive input
      if (metrics.updateFrequency > this.updateTiers.medium) {
        metrics.updateFrequency = this.updateTiers.medium;
      }
    }
  }

  /**
   * Remove player metrics
   */
  removePlayer(playerId) {
    this.playerMetrics.delete(playerId);
  }

  /**
   * Get performance statistics
   */
  getStats() {
    const playersByTier = this.getPlayersByUpdateTier();
    const totalPlayers = this.playerMetrics.size;
    
    return {
      totalPlayers,
      playersByTier: {
        high: playersByTier.high.length,
        medium: playersByTier.medium.length,
        low: playersByTier.low.length,
        minimal: playersByTier.minimal.length
      },
      averageFrequency: this.calculateAverageFrequency(),
      globalMetrics: this.globalMetrics,
      updateTiers: this.updateTiers
    };
  }

  /**
   * Calculate average update frequency
   */
  calculateAverageFrequency() {
    if (this.playerMetrics.size === 0) return 0;
    
    let totalFrequency = 0;
    for (const metrics of this.playerMetrics.values()) {
      totalFrequency += metrics.updateFrequency;
    }
    
    return Math.round(totalFrequency / this.playerMetrics.size);
  }

  /**
   * Cleanup inactive players
   */
  cleanup() {
    const now = Date.now();
    const inactiveThreshold = 30000; // 30 seconds
    const toRemove = [];
    
    for (const [playerId, metrics] of this.playerMetrics) {
      if (now - metrics.lastUpdate > inactiveThreshold) {
        toRemove.push(playerId);
      }
    }
    
    for (const playerId of toRemove) {
      this.playerMetrics.delete(playerId);
    }
    
    if (toRemove.length > 0) {
      console.log(`🎯 Adaptive: Cleaned up ${toRemove.length} inactive player metrics`);
    }
  }
}

module.exports = { AdaptiveUpdateManager };