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
    
    // Player activity tracking
    this.playerActivity = new Map();
    
    // Configuration for adaptive frequencies
    this.config = {
      baseFrequency: 33,     // 33ms = 30 FPS (improved from 20 FPS)
      minFrequency: 16,      // 16ms = 60 FPS (max)
      maxFrequency: 100,     // 100ms = 10 FPS (min, improved from 5 FPS)
      
      // Activity level multipliers (more aggressive scaling)
      activityMultipliers: {
        idle: 3.0,      // Much slower updates for idle players
        low: 2.0,       // Slower for low activity
        medium: 1.0,    // Normal frequency
        high: 0.7,      // Faster for high activity
        critical: 0.5   // Fastest for critical situations
      },
      
      // Network quality multipliers (optimized for stability)
      networkMultipliers: {
        excellent: 0.7, // Faster updates for excellent connections
        good: 0.9,      // Slightly faster for good connections
        fair: 1.2,      // Slower for fair connections
        poor: 2.0       // Much slower for poor connections
      },
      
      // Server load multipliers (more responsive to load)
      loadMultipliers: {
        low: 0.8,       // Faster when server is idle
        medium: 1.0,    // Normal frequency
        high: 1.6,      // Slower when server is busy
        critical: 2.5   // Much slower when overloaded
      },
      
      // Player priority multipliers (new)
      priorityMultipliers: {
        vip: 0.6,       // VIP players get faster updates
        active: 0.8,    // Active players get priority
        normal: 1.0,    // Normal priority
        background: 1.5 // Background players get slower updates
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
   * Detect player activity level based on movement, actions, and game context
   */
  detectActivityLevel(playerId, playerData, gameObjects = []) {
    const currentTime = Date.now();
    const recentWindow = 3000; // 3 seconds for better analysis
    
    // Get recent activity data
    let activity = this.playerActivity.get(playerId);
    if (!activity) {
      activity = {
        movements: [],
        actions: [],
        lastPosition: { x: playerData.x, y: playerData.y },
        lastUpdate: currentTime,
        combatEvents: [],
        foodEvents: []
      };
      this.playerActivity.set(playerId, activity);
    }
    
    // Calculate movement distance and velocity
    const timeDelta = Math.max(currentTime - activity.lastUpdate, 16); // Min 16ms
    const distance = Math.sqrt(
      Math.pow(playerData.x - activity.lastPosition.x, 2) +
      Math.pow(playerData.y - activity.lastPosition.y, 2)
    );
    const instantVelocity = distance / (timeDelta / 1000); // pixels per second
    
    // Record movement if significant
    if (distance > 3) {
      activity.movements.push({
        distance,
        timestamp: currentTime,
        velocity: instantVelocity,
        acceleration: Math.abs(instantVelocity - (activity.movements[activity.movements.length - 1]?.velocity || 0))
      });
      activity.lastPosition = { x: playerData.x, y: playerData.y };
    }
    
    // Record action if recent
    if (playerData.lastActionTime && currentTime - playerData.lastActionTime < 1000) {
      activity.actions.push({
        timestamp: playerData.lastActionTime,
        type: 'input'
      });
    }
    
    // Detect combat situations (nearby players)
    const nearbyPlayers = gameObjects.filter(obj => {
      if (obj.type !== 'player' || obj.id === playerId) return false;
      const dist = Math.sqrt(
        Math.pow(obj.x - playerData.x, 2) + Math.pow(obj.y - playerData.y, 2)
      );
      return dist < 100; // Within 100 pixels
    });
    
    if (nearbyPlayers.length > 0) {
      activity.combatEvents.push({ timestamp: currentTime, count: nearbyPlayers.length });
    }
    
    // Detect food consumption (score changes)
    if (playerData.score > (activity.lastScore || 0)) {
      activity.foodEvents.push({ timestamp: currentTime, scoreGain: playerData.score - (activity.lastScore || 0) });
    }
    activity.lastScore = playerData.score;
    
    // Clean old data
    const cleanupArrays = ['movements', 'actions', 'combatEvents', 'foodEvents'];
    cleanupArrays.forEach(arrayName => {
      activity[arrayName] = activity[arrayName].filter(
        item => currentTime - item.timestamp < recentWindow
      );
    });
    
    // Calculate comprehensive activity metrics
    const totalMovement = activity.movements.reduce((sum, m) => sum + m.distance, 0);
    const avgVelocity = activity.movements.length > 0
      ? activity.movements.reduce((sum, m) => sum + m.velocity, 0) / activity.movements.length
      : 0;
    const maxVelocity = activity.movements.length > 0
      ? Math.max(...activity.movements.map(m => m.velocity))
      : 0;
    const avgAcceleration = activity.movements.length > 0
      ? activity.movements.reduce((sum, m) => sum + (m.acceleration || 0), 0) / activity.movements.length
      : 0;
    const actionCount = activity.actions.length;
    const combatTime = activity.combatEvents.length;
    const foodCount = activity.foodEvents.length;
    
    // Calculate activity score (0-100)
    let activityScore = 0;
    activityScore += Math.min(totalMovement / 10, 25); // Movement contribution (0-25)
    activityScore += Math.min(avgVelocity / 5, 20); // Velocity contribution (0-20)
    activityScore += Math.min(actionCount * 5, 15); // Input contribution (0-15)
    activityScore += Math.min(combatTime * 8, 20); // Combat contribution (0-20)
    activityScore += Math.min(foodCount * 4, 10); // Food contribution (0-10)
    activityScore += Math.min(avgAcceleration / 2, 10); // Acceleration contribution (0-10)
    
    activity.lastUpdate = currentTime;
    
    // Determine activity level based on score
    if (activityScore < 5) {
      return 'idle';
    } else if (activityScore < 20) {
      return 'low';
    } else if (activityScore < 50) {
      return 'medium';
    } else if (activityScore < 75) {
      return 'high';
    } else {
      return 'critical';
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
   * Assess player priority based on game context
   */
  assessPlayerPriority(playerId, playerData, gameObjects = []) {
    const currentTime = Date.now();
    
    // Check if player is in combat (high priority)
    const nearbyPlayers = gameObjects.filter(obj => {
      if (obj.type !== 'player' || obj.id === playerId) return false;
      const dist = Math.sqrt(
        Math.pow(obj.x - playerData.x, 2) + Math.pow(obj.y - playerData.y, 2)
      );
      return dist < 150; // Combat range
    });
    
    // Check recent activity
    const activity = this.playerActivity.get(playerId);
    const recentActions = activity?.actions.filter(
      action => currentTime - action.timestamp < 2000
    ).length || 0;
    
    // Check score/size (larger players might be more important)
    const scoreRank = playerData.score || 0;
    
    // Determine priority
    if (nearbyPlayers.length >= 2 || recentActions >= 3) {
      return 'vip'; // High priority for combat or very active players
    } else if (nearbyPlayers.length >= 1 || recentActions >= 1 || scoreRank > 100) {
      return 'active'; // Active players get priority
    } else if (recentActions === 0 && (currentTime - (playerData.lastActionTime || currentTime)) > 5000) {
      return 'background'; // Idle players get lower priority
    } else {
      return 'normal'; // Default priority
    }
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
    
    // Assess player priority
    const playerPriority = this.assessPlayerPriority(playerId, playerData, gameObjects);
    
    // Calculate base frequency with multipliers
    let frequency = this.config.baseFrequency;
    frequency *= this.config.activityMultipliers[activityLevel] || 1.0;
    frequency *= this.config.networkMultipliers[networkQuality] || 1.0;
    frequency *= this.config.loadMultipliers[serverLoad] || 1.0;
    frequency *= this.config.priorityMultipliers[playerPriority] || 1.0;
    
    // Apply bounds
    frequency = Math.max(this.config.minFrequency, 
                Math.min(this.config.maxFrequency, frequency));
    
    const result = {
      frequency: Math.round(frequency),
      factors: {
        activity: activityLevel,
        network: networkQuality,
        serverLoad: serverLoad,
        priority: playerPriority
      },
      multipliers: {
        activity: this.config.activityMultipliers[activityLevel],
        network: this.config.networkMultipliers[networkQuality],
        serverLoad: this.config.loadMultipliers[serverLoad],
        priority: this.config.priorityMultipliers[playerPriority]
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
   * Record and smooth ping data for a player
   */
  recordPlayerPing(playerId, pingTime) {
    // Simple ping recording for compatibility
    this.updateNetworkMetrics(playerId, { rtt: pingTime });
    
    return {
      smoothedPing: pingTime,
      jitter: 0,
      isOutlier: false
    };
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