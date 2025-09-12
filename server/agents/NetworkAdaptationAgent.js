/**
 * Network Adaptation Agent (NAA)
 * Manages adaptive update frequencies and network optimization
 * Adjusts update rates based on player activity, network conditions, and server load
 */

class NetworkAdaptationAgent {
  constructor() {
    // Player-specific update frequencies
    this.playerUpdateFreqs = new Map();
    
    // Network performance tracking
    this.networkMetrics = new Map();
    
    // Adaptive frequency configuration
    this.config = {
      baseFrequency: 100,        // Base update frequency (ms)
      minFrequency: 50,          // Minimum update frequency (20 FPS)
      maxFrequency: 1000,        // Maximum update frequency (1 FPS)
      
      // Activity-based multipliers
      activityMultipliers: {
        high: 0.5,               // High activity = 2x faster updates
        medium: 1.0,             // Medium activity = normal updates
        low: 2.0,                // Low activity = 2x slower updates
        idle: 4.0                // Idle = 4x slower updates
      },
      
      // Network condition multipliers
      networkMultipliers: {
        excellent: 0.8,          // Excellent network = faster updates
        good: 1.0,               // Good network = normal updates
        fair: 1.5,               // Fair network = slower updates
        poor: 2.5                // Poor network = much slower updates
      },
      
      // Server load multipliers
      loadMultipliers: {
        low: 0.9,                // Low load = slightly faster
        medium: 1.0,             // Medium load = normal
        high: 1.3,               // High load = slower
        critical: 2.0            // Critical load = much slower
      },
      
      // Thresholds for activity detection
      activityThresholds: {
        movementSpeed: 2.0,      // Speed threshold for activity
        interactionDistance: 50, // Distance for interaction detection
        idleTime: 5000          // Time to consider player idle (ms)
      },
      
      // Network quality thresholds
      networkThresholds: {
        rtt: { excellent: 30, good: 60, fair: 120 }, // Round trip time (ms)
        packetLoss: { excellent: 0.01, good: 0.05, fair: 0.1 } // Packet loss ratio
      }
    };
    
    // Performance tracking
    this.performanceHistory = {
      updateTimes: [],
      networkLatencies: [],
      serverLoad: []
    };
    
    // Update frequency cache
    this.frequencyCache = new Map();
    this.cacheTimeout = 1000; // Cache frequencies for 1 second
    
    console.log('🌐 Network Adaptation Agent initialized');
  }

  /**
   * Update player network metrics
   */
  updateNetworkMetrics(playerId, metrics) {
    const timestamp = Date.now();
    
    if (!this.networkMetrics.has(playerId)) {
      this.networkMetrics.set(playerId, {
        rtt: [],
        packetLoss: [],
        bandwidth: [],
        lastUpdate: timestamp
      });
    }
    
    const playerMetrics = this.networkMetrics.get(playerId);
    
    // Update metrics with timestamp
    if (metrics.rtt !== undefined) {
      playerMetrics.rtt.push({ value: metrics.rtt, timestamp });
      if (playerMetrics.rtt.length > 10) playerMetrics.rtt.shift();
    }
    
    if (metrics.packetLoss !== undefined) {
      playerMetrics.packetLoss.push({ value: metrics.packetLoss, timestamp });
      if (playerMetrics.packetLoss.length > 10) playerMetrics.packetLoss.shift();
    }
    
    if (metrics.bandwidth !== undefined) {
      playerMetrics.bandwidth.push({ value: metrics.bandwidth, timestamp });
      if (playerMetrics.bandwidth.length > 10) playerMetrics.bandwidth.shift();
    }
    
    playerMetrics.lastUpdate = timestamp;
  }

  /**
   * Detect player activity level
   */
  detectActivityLevel(playerId, playerData, gameObjects = []) {
    const currentTime = Date.now();
    
    // Check movement speed
    const speed = Math.sqrt(
      Math.pow(playerData.velocityX || 0, 2) + 
      Math.pow(playerData.velocityY || 0, 2)
    );
    
    // Check time since last significant action
    const timeSinceLastAction = currentTime - (playerData.lastActionTime || currentTime);
    
    // Check proximity to other objects (interaction potential)
    const nearbyObjects = gameObjects.filter(obj => {
      const distance = Math.sqrt(
        Math.pow(obj.x - playerData.x, 2) + 
        Math.pow(obj.y - playerData.y, 2)
      );
      return distance <= this.config.activityThresholds.interactionDistance;
    });
    
    // Determine activity level
    if (timeSinceLastAction > this.config.activityThresholds.idleTime) {
      return 'idle';
    } else if (speed > this.config.activityThresholds.movementSpeed || nearbyObjects.length > 3) {
      return 'high';
    } else if (speed > this.config.activityThresholds.movementSpeed * 0.5 || nearbyObjects.length > 0) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  /**
   * Assess network quality for a player
   */
  assessNetworkQuality(playerId) {
    const metrics = this.networkMetrics.get(playerId);
    if (!metrics) return 'good'; // Default to good if no metrics
    
    // Calculate average RTT
    const avgRtt = metrics.rtt.length > 0 
      ? metrics.rtt.reduce((sum, m) => sum + m.value, 0) / metrics.rtt.length
      : 50; // Default RTT
    
    // Calculate average packet loss
    const avgPacketLoss = metrics.packetLoss.length > 0
      ? metrics.packetLoss.reduce((sum, m) => sum + m.value, 0) / metrics.packetLoss.length
      : 0; // Default no packet loss
    
    // Determine network quality
    const thresholds = this.config.networkThresholds;
    
    if (avgRtt <= thresholds.rtt.excellent && avgPacketLoss <= thresholds.packetLoss.excellent) {
      return 'excellent';
    } else if (avgRtt <= thresholds.rtt.good && avgPacketLoss <= thresholds.packetLoss.good) {
      return 'good';
    } else if (avgRtt <= thresholds.rtt.fair && avgPacketLoss <= thresholds.packetLoss.fair) {
      return 'fair';
    } else {
      return 'poor';
    }
  }

  /**
   * Assess current server load
   */
  assessServerLoad(playerCount, objectCount, cpuUsage = null) {
    // Simple load assessment based on player and object count
    const totalLoad = playerCount + (objectCount * 0.1);
    
    if (cpuUsage) {
      // If CPU usage is available, factor it in
      if (cpuUsage > 80) return 'critical';
      if (cpuUsage > 60) return 'high';
      if (cpuUsage > 40) return 'medium';
      return 'low';
    }
    
    // Fallback to simple metrics
    if (totalLoad > 100) return 'critical';
    if (totalLoad > 50) return 'high';
    if (totalLoad > 20) return 'medium';
    return 'low';
  }

  /**
   * Calculate adaptive update frequency for a player
   */
  calculateUpdateFrequency(playerId, playerData, gameObjects = [], serverMetrics = {}) {
    const cacheKey = `${playerId}_${Date.now() - (Date.now() % this.cacheTimeout)}`;
    
    // Check cache first
    const cached = this.frequencyCache.get(cacheKey);
    if (cached) return cached;
    
    // Detect activity level
    const activityLevel = this.detectActivityLevel(playerId, playerData, gameObjects);
    
    // Assess network quality
    const networkQuality = this.assessNetworkQuality(playerId);
    
    // Assess server load
    const serverLoad = this.assessServerLoad(
      serverMetrics.playerCount || 1,
      serverMetrics.objectCount || 0,
      serverMetrics.cpuUsage
    );
    
    // Calculate base frequency with multipliers
    let frequency = this.config.baseFrequency;
    frequency *= this.config.activityMultipliers[activityLevel] || 1.0;
    frequency *= this.config.networkMultipliers[networkQuality] || 1.0;
    frequency *= this.config.loadMultipliers[serverLoad] || 1.0;
    
    // Apply bounds
    frequency = Math.max(this.config.minFrequency, 
                Math.min(this.config.maxFrequency, frequency));
    
    const result = {
      frequency: Math.round(frequency),
      factors: {
        activity: activityLevel,
        network: networkQuality,
        serverLoad: serverLoad
      },
      multipliers: {
        activity: this.config.activityMultipliers[activityLevel],
        network: this.config.networkMultipliers[networkQuality],
        serverLoad: this.config.loadMultipliers[serverLoad]
      }
    };
    
    // Cache the result
    this.frequencyCache.set(cacheKey, result);
    
    return result;
  }

  /**
   * Get update frequency for a player (simplified interface)
   */
  getUpdateFrequency(playerId, playerData, gameObjects = [], serverMetrics = {}) {
    const result = this.calculateUpdateFrequency(playerId, playerData, gameObjects, serverMetrics);
    return result.frequency;
  }

  /**
   * Update player's last update frequency
   */
  updatePlayerFrequency(playerId, frequency, factors = {}) {
    this.playerUpdateFreqs.set(playerId, {
      frequency,
      factors,
      lastUpdate: Date.now()
    });
  }

  /**
   * Get batch update frequencies for multiple players
   */
  getBatchUpdateFrequencies(players, gameObjects = [], serverMetrics = {}) {
    const frequencies = new Map();
    
    for (const [playerId, playerData] of players) {
      if (!playerData.alive) continue;
      
      const frequency = this.getUpdateFrequency(playerId, playerData, gameObjects, serverMetrics);
      frequencies.set(playerId, frequency);
    }
    
    return frequencies;
  }

  /**
   * Determine if a player should receive an update now
   */
  shouldUpdatePlayer(playerId, lastUpdateTime = 0) {
    const playerFreq = this.playerUpdateFreqs.get(playerId);
    if (!playerFreq) return true; // Update if no frequency set
    
    const timeSinceUpdate = Date.now() - lastUpdateTime;
    return timeSinceUpdate >= playerFreq.frequency;
  }

  /**
   * Get adaptive batch size based on server load
   */
  getAdaptiveBatchSize(serverLoad = 'medium', baseSize = 50) {
    const multipliers = {
      low: 1.5,
      medium: 1.0,
      high: 0.7,
      critical: 0.4
    };
    
    return Math.round(baseSize * (multipliers[serverLoad] || 1.0));
  }

  /**
   * Record performance metrics
   */
  recordPerformance(updateTime, networkLatency = null, serverLoad = null) {
    const timestamp = Date.now();
    
    // Record update time
    this.performanceHistory.updateTimes.push({ value: updateTime, timestamp });
    if (this.performanceHistory.updateTimes.length > 100) {
      this.performanceHistory.updateTimes.shift();
    }
    
    // Record network latency
    if (networkLatency !== null) {
      this.performanceHistory.networkLatencies.push({ value: networkLatency, timestamp });
      if (this.performanceHistory.networkLatencies.length > 100) {
        this.performanceHistory.networkLatencies.shift();
      }
    }
    
    // Record server load
    if (serverLoad !== null) {
      this.performanceHistory.serverLoad.push({ value: serverLoad, timestamp });
      if (this.performanceHistory.serverLoad.length > 100) {
        this.performanceHistory.serverLoad.shift();
      }
    }
  }

  /**
   * Clean up old data
   */
  cleanup(activePlayerIds) {
    const currentTime = Date.now();
    const maxAge = 60000; // 1 minute
    
    // Clean player frequencies
    for (const [playerId, data] of this.playerUpdateFreqs) {
      if (!activePlayerIds.has(playerId) || currentTime - data.lastUpdate > maxAge) {
        this.playerUpdateFreqs.delete(playerId);
      }
    }
    
    // Clean network metrics
    for (const [playerId, metrics] of this.networkMetrics) {
      if (!activePlayerIds.has(playerId) || currentTime - metrics.lastUpdate > maxAge) {
        this.networkMetrics.delete(playerId);
      }
    }
    
    // Clean frequency cache
    for (const [key, data] of this.frequencyCache) {
      if (currentTime - (parseInt(key.split('_')[1]) || 0) > this.cacheTimeout * 2) {
        this.frequencyCache.delete(key);
      }
    }
  }

  /**
   * Get adaptation statistics
   */
  getStats() {
    const currentTime = Date.now();
    
    // Calculate average frequencies
    const frequencies = Array.from(this.playerUpdateFreqs.values())
      .map(data => data.frequency);
    const avgFrequency = frequencies.length > 0 
      ? frequencies.reduce((sum, freq) => sum + freq, 0) / frequencies.length
      : this.config.baseFrequency;
    
    // Calculate performance averages
    const recentUpdateTimes = this.performanceHistory.updateTimes
      .filter(entry => currentTime - entry.timestamp < 30000); // Last 30 seconds
    const avgUpdateTime = recentUpdateTimes.length > 0
      ? recentUpdateTimes.reduce((sum, entry) => sum + entry.value, 0) / recentUpdateTimes.length
      : 0;
    
    // Network quality distribution
    const networkQualities = Array.from(this.networkMetrics.keys())
      .map(playerId => this.assessNetworkQuality(playerId));
    const qualityDistribution = {
      excellent: networkQualities.filter(q => q === 'excellent').length,
      good: networkQualities.filter(q => q === 'good').length,
      fair: networkQualities.filter(q => q === 'fair').length,
      poor: networkQualities.filter(q => q === 'poor').length
    };
    
    return {
      activePlayerCount: this.playerUpdateFreqs.size,
      averageFrequency: Math.round(avgFrequency),
      frequencyRange: {
        min: Math.min(...frequencies, this.config.maxFrequency),
        max: Math.max(...frequencies, this.config.minFrequency)
      },
      averageUpdateTime: Math.round(avgUpdateTime * 100) / 100,
      networkQualityDistribution: qualityDistribution,
      cacheSize: this.frequencyCache.size,
      performanceHistorySize: {
        updateTimes: this.performanceHistory.updateTimes.length,
        networkLatencies: this.performanceHistory.networkLatencies.length,
        serverLoad: this.performanceHistory.serverLoad.length
      }
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log('🌐 NAA: Configuration updated:', this.config);
  }
}

module.exports = { NetworkAdaptationAgent };