/**
 * Network Adaptation Agent
 * Automatically adjusts network settings based on detected conditions
 * to optimize performance and stability for multiplayer gaming
 */

class NetworkAdaptationAgent {
  constructor() {
    this.currentUpdateRate = 60; // Default 60 FPS
    this.baseUpdateRate = 60;
    this.minUpdateRate = 20;
    this.maxUpdateRate = 120;
    
    this.compressionEnabled = false;
    this.prioritizationEnabled = true;
    
    // Adaptation thresholds
    this.thresholds = {
      highLatency: 100, // ms
      veryHighLatency: 200, // ms
      highPacketLoss: 5, // %
      lowBandwidth: 1000, // bytes/sec
      highPlayerCount: 15,
      veryHighPlayerCount: 25,
      highJitter: 30, // ms
      veryHighJitter: 60 // ms
    };
    
    // Performance history for trend analysis
    this.performanceHistory = [];
    this.maxHistorySize = 20;
    
    // Ping jitter tracking and smoothing
    this.pingJitterData = new Map(); // playerId -> jitter data
    this.smoothingConfig = {
      windowSize: 10,
      smoothingFactor: 0.3, // EMA smoothing factor
      outlierThreshold: 3, // Standard deviations for outlier detection
      adaptiveSmoothing: true
    };
    
    // Network congestion detection
    this.congestionDetection = {
      enabled: true,
      thresholds: {
        packetLossSpike: 10, // % increase in packet loss
        latencySpike: 50, // ms increase in latency
        jitterSpike: 40 // ms increase in jitter
      },
      history: [],
      maxHistorySize: 15
    };
    
    // Adaptation state
    this.lastAdaptation = Date.now();
    this.adaptationCooldown = 5000; // 5 seconds
    this.currentOptimizations = new Set();
    
    console.log('🔧 NetworkAdaptationAgent initialized with jitter reduction and congestion detection');
  }
  
  /**
   * Record and smooth ping data for a player
   */
  recordPlayerPing(playerId, pingTime) {
    if (!this.pingJitterData.has(playerId)) {
      this.pingJitterData.set(playerId, {
        rawPings: [],
        smoothedPings: [],
        jitterHistory: [],
        lastSmoothedPing: pingTime,
        outlierCount: 0,
        adaptiveWindow: this.smoothingConfig.windowSize
      });
    }
    
    const playerData = this.pingJitterData.get(playerId);
    
    // Add raw ping
    playerData.rawPings.push({
      timestamp: Date.now(),
      value: pingTime
    });
    
    // Keep only recent data
    if (playerData.rawPings.length > this.smoothingConfig.windowSize * 2) {
      playerData.rawPings.shift();
    }
    
    // Apply smoothing
    const smoothedPing = this.applySmoothingAlgorithm(playerId, pingTime);
    
    // Calculate and record jitter
    const jitter = this.calculateJitter(playerId);
    if (jitter !== null) {
      playerData.jitterHistory.push({
        timestamp: Date.now(),
        value: jitter
      });
      
      // Keep jitter history manageable
      if (playerData.jitterHistory.length > this.smoothingConfig.windowSize) {
        playerData.jitterHistory.shift();
      }
    }
    
    return {
      smoothedPing,
      jitter,
      isOutlier: this.isOutlier(playerId, pingTime)
    };
  }
  
  /**
   * Apply adaptive smoothing algorithm to reduce ping jitter
   */
  applySmoothingAlgorithm(playerId, rawPing) {
    const playerData = this.pingJitterData.get(playerId);
    if (!playerData) return rawPing;
    
    // Outlier detection
    const isOutlier = this.isOutlier(playerId, rawPing);
    
    if (isOutlier) {
      playerData.outlierCount++;
      // Use previous smoothed value for outliers
      return playerData.lastSmoothedPing;
    }
    
    playerData.outlierCount = Math.max(0, playerData.outlierCount - 1);
    
    // Adaptive smoothing factor based on jitter level
    let smoothingFactor = this.smoothingConfig.smoothingFactor;
    
    if (this.smoothingConfig.adaptiveSmoothing) {
      const recentJitter = this.getRecentJitter(playerId);
      if (recentJitter > this.thresholds.highJitter) {
        // More aggressive smoothing for high jitter
        smoothingFactor = Math.min(0.5, smoothingFactor * 1.5);
      } else if (recentJitter < 10) {
        // Less smoothing for stable connections
        smoothingFactor = Math.max(0.1, smoothingFactor * 0.7);
      }
    }
    
    // Exponential Moving Average (EMA) smoothing
    const smoothedPing = (smoothingFactor * rawPing) + 
                        ((1 - smoothingFactor) * playerData.lastSmoothedPing);
    
    playerData.lastSmoothedPing = smoothedPing;
    playerData.smoothedPings.push({
      timestamp: Date.now(),
      value: smoothedPing
    });
    
    // Keep smoothed history manageable
    if (playerData.smoothedPings.length > this.smoothingConfig.windowSize) {
      playerData.smoothedPings.shift();
    }
    
    return smoothedPing;
  }
  
  /**
   * Calculate jitter for a player
   */
  calculateJitter(playerId) {
    const playerData = this.pingJitterData.get(playerId);
    if (!playerData || playerData.rawPings.length < 3) return null;
    
    const recentPings = playerData.rawPings.slice(-this.smoothingConfig.windowSize)
                                          .map(p => p.value);
    
    // Calculate standard deviation as jitter measure
    const mean = recentPings.reduce((sum, ping) => sum + ping, 0) / recentPings.length;
    const variance = recentPings.reduce((sum, ping) => sum + Math.pow(ping - mean, 2), 0) / recentPings.length;
    
    return Math.sqrt(variance);
  }
  
  /**
   * Detect if a ping value is an outlier
   */
  isOutlier(playerId, pingValue) {
    const playerData = this.pingJitterData.get(playerId);
    if (!playerData || playerData.rawPings.length < 5) return false;
    
    const recentPings = playerData.rawPings.slice(-this.smoothingConfig.windowSize)
                                          .map(p => p.value);
    
    const mean = recentPings.reduce((sum, ping) => sum + ping, 0) / recentPings.length;
    const stdDev = Math.sqrt(
      recentPings.reduce((sum, ping) => sum + Math.pow(ping - mean, 2), 0) / recentPings.length
    );
    
    const zScore = Math.abs(pingValue - mean) / (stdDev || 1);
    return zScore > this.smoothingConfig.outlierThreshold;
  }
  
  /**
   * Get recent jitter level for a player
   */
  getRecentJitter(playerId) {
    const playerData = this.pingJitterData.get(playerId);
    if (!playerData || playerData.jitterHistory.length === 0) return 0;
    
    const recentJitter = playerData.jitterHistory.slice(-3);
    return recentJitter.reduce((sum, j) => sum + j.value, 0) / recentJitter.length;
  }
  
  /**
   * Detect network congestion based on multiple metrics
   */
  detectNetworkCongestion(networkStats, connectionStats) {
    if (!this.congestionDetection.enabled) return null;
    
    const currentMetrics = {
      timestamp: Date.now(),
      avgLatency: connectionStats.averageLatency || 0,
      packetLoss: connectionStats.averagePacketLoss || 0,
      avgJitter: this.getGlobalAverageJitter(),
      messageRate: networkStats.totalMessages / (process.uptime() || 1)
    };
    
    this.congestionDetection.history.push(currentMetrics);
    
    // Keep history manageable
    if (this.congestionDetection.history.length > this.congestionDetection.maxHistorySize) {
      this.congestionDetection.history.shift();
    }
    
    // Need at least 3 data points for trend analysis
    if (this.congestionDetection.history.length < 3) return null;
    
    const recent = this.congestionDetection.history.slice(-3);
    const baseline = this.congestionDetection.history.slice(0, -3);
    
    if (baseline.length === 0) return null;
    
    // Calculate baseline averages
    const baselineAvg = {
      latency: baseline.reduce((sum, m) => sum + m.avgLatency, 0) / baseline.length,
      packetLoss: baseline.reduce((sum, m) => sum + m.packetLoss, 0) / baseline.length,
      jitter: baseline.reduce((sum, m) => sum + m.avgJitter, 0) / baseline.length
    };
    
    // Calculate recent averages
    const recentAvg = {
      latency: recent.reduce((sum, m) => sum + m.avgLatency, 0) / recent.length,
      packetLoss: recent.reduce((sum, m) => sum + m.packetLoss, 0) / recent.length,
      jitter: recent.reduce((sum, m) => sum + m.avgJitter, 0) / recent.length
    };
    
    // Detect spikes
    const spikes = {
      latency: recentAvg.latency - baselineAvg.latency,
      packetLoss: recentAvg.packetLoss - baselineAvg.packetLoss,
      jitter: recentAvg.jitter - baselineAvg.jitter
    };
    
    const congestionLevel = this.calculateCongestionLevel(spikes);
    
    if (congestionLevel > 0) {
      return {
        level: congestionLevel, // 1=mild, 2=moderate, 3=severe
        spikes,
        recommendations: this.getCongestionMitigationActions(congestionLevel)
      };
    }
    
    return null;
  }
  
  /**
   * Calculate congestion level based on detected spikes
   */
  calculateCongestionLevel(spikes) {
    let level = 0;
    const thresholds = this.congestionDetection.thresholds;
    
    // Check each metric against thresholds
    if (spikes.latency > thresholds.latencySpike * 2 ||
        spikes.packetLoss > thresholds.packetLossSpike * 2 ||
        spikes.jitter > thresholds.jitterSpike * 2) {
      level = Math.max(level, 3); // Severe
    } else if (spikes.latency > thresholds.latencySpike ||
               spikes.packetLoss > thresholds.packetLossSpike ||
               spikes.jitter > thresholds.jitterSpike) {
      level = Math.max(level, 2); // Moderate
    } else if (spikes.latency > thresholds.latencySpike * 0.5 ||
               spikes.packetLoss > thresholds.packetLossSpike * 0.5 ||
               spikes.jitter > thresholds.jitterSpike * 0.5) {
      level = Math.max(level, 1); // Mild
    }
    
    return level;
  }
  
  /**
   * Get congestion mitigation actions
   */
  getCongestionMitigationActions(level) {
    switch (level) {
      case 3: // Severe
        return ['aggressive_throttling', 'emergency_compression', 'reduce_precision', 'limit_broadcasts'];
      case 2: // Moderate
        return ['moderate_throttling', 'enable_compression', 'optimize_broadcasts'];
      case 1: // Mild
        return ['gentle_throttling', 'monitor_closely'];
      default:
        return [];
    }
  }
  
  /**
   * Get global average jitter across all players
   */
  getGlobalAverageJitter() {
    if (this.pingJitterData.size === 0) return 0;
    
    let totalJitter = 0;
    let playerCount = 0;
    
    for (const [playerId, data] of this.pingJitterData.entries()) {
      const recentJitter = this.getRecentJitter(playerId);
      if (recentJitter > 0) {
        totalJitter += recentJitter;
        playerCount++;
      }
    }
    
    return playerCount > 0 ? totalJitter / playerCount : 0;
  }
  
  /**
   * Analyze current network conditions and adapt settings
   */
  analyzeAndAdapt(networkStats, connectionStats, playerCount) {
    try {
      const now = Date.now();
      
      // Respect cooldown period
      if (now - this.lastAdaptation < this.adaptationCooldown) {
        return null;
      }
      
      // Calculate current performance metrics
      const avgLatency = networkStats.totalLatency / (networkStats.totalMessages || 1);
      const errorRate = (networkStats.errors / (networkStats.totalMessages || 1)) * 100;
      const messageRate = networkStats.totalMessages / (process.uptime() || 1);
      
      // Detect network congestion using new algorithm
      const congestionInfo = this.detectNetworkCongestion(networkStats, connectionStats);
      
      // Store performance snapshot with congestion data
      this.addPerformanceSnapshot({
        timestamp: now,
        avgLatency,
        errorRate,
        messageRate,
        playerCount,
        avgConnectionLatency: connectionStats.averageLatency,
        avgPacketLoss: connectionStats.averagePacketLoss,
        globalJitter: this.getGlobalAverageJitter(),
        congestionLevel: congestionInfo ? congestionInfo.level : 0
      });
      
      // Determine required adaptations including congestion-based ones
      const adaptations = this.determineAdaptations({
        avgLatency,
        errorRate,
        messageRate,
        playerCount,
        avgConnectionLatency: connectionStats.averageLatency,
        avgPacketLoss: connectionStats.averagePacketLoss,
        globalJitter: this.getGlobalAverageJitter(),
        congestionInfo
      });
      
      if (adaptations.length > 0) {
        this.applyAdaptations(adaptations);
        this.lastAdaptation = now;
        
        // Log congestion detection results
        if (congestionInfo) {
          console.log(`🚨 Network congestion detected - Level ${congestionInfo.level}:`, {
            latencySpike: congestionInfo.spikes.latency.toFixed(1) + 'ms',
            jitterSpike: congestionInfo.spikes.jitter.toFixed(1) + 'ms',
            packetLossSpike: congestionInfo.spikes.packetLoss.toFixed(2) + '%',
            recommendations: congestionInfo.recommendations
          });
        }
        
        return adaptations;
      }
      
      return null;
    } catch (error) {
      console.error('Network adaptation analysis error:', error);
      return null;
    }
  }
  
  /**
   * Determine what adaptations are needed based on current conditions
   */
  determineAdaptations(metrics) {
    const adaptations = [];
    const { avgLatency, errorRate, playerCount, avgConnectionLatency, avgPacketLoss, globalJitter, congestionInfo } = metrics;
    
    // Congestion-based adaptations (highest priority)
    if (congestionInfo) {
      const congestionActions = congestionInfo.recommendations;
      if (congestionActions.length > 0) {
        adaptations.push({
          type: `congestion_mitigation_level_${congestionInfo.level}`,
          reason: `Network congestion detected (Level ${congestionInfo.level})`,
          actions: congestionActions,
          priority: 'high'
        });
      }
    }
    
    // High jitter adaptations
    if (globalJitter > this.thresholds.veryHighJitter) {
      if (!this.currentOptimizations.has('jitter_reduction_aggressive')) {
        adaptations.push({
          type: 'jitter_reduction_aggressive',
          reason: `Very high jitter detected: ${globalJitter.toFixed(1)}ms`,
          actions: ['reduce_update_rate', 'enable_compression', 'increase_smoothing'],
          priority: 'high'
        });
      }
    } else if (globalJitter > this.thresholds.highJitter) {
      if (!this.currentOptimizations.has('jitter_reduction_moderate')) {
        adaptations.push({
          type: 'jitter_reduction_moderate',
          reason: `High jitter detected: ${globalJitter.toFixed(1)}ms`,
          actions: ['moderate_throttling', 'increase_smoothing'],
          priority: 'medium'
        });
      }
    }
    
    // High latency adaptations
    if (avgConnectionLatency > this.thresholds.veryHighLatency) {
      if (!this.currentOptimizations.has('aggressive_optimization')) {
        adaptations.push({
          type: 'aggressive_optimization',
          reason: `Very high latency detected: ${avgConnectionLatency.toFixed(1)}ms`,
          actions: ['reduce_update_rate', 'enable_compression', 'reduce_precision'],
          priority: 'high'
        });
      }
    } else if (avgConnectionLatency > this.thresholds.highLatency) {
      if (!this.currentOptimizations.has('moderate_optimization')) {
        adaptations.push({
          type: 'moderate_optimization',
          reason: `High latency detected: ${avgConnectionLatency.toFixed(1)}ms`,
          actions: ['reduce_update_rate', 'enable_compression'],
          priority: 'medium'
        });
      }
    }
    
    // High packet loss adaptations
    if (avgPacketLoss > this.thresholds.highPacketLoss) {
      if (!this.currentOptimizations.has('packet_loss_mitigation')) {
        adaptations.push({
          type: 'packet_loss_mitigation',
          reason: `High packet loss detected: ${avgPacketLoss.toFixed(1)}%`,
          actions: ['enable_redundancy', 'reduce_update_rate']
        });
      }
    }
    
    // High player count adaptations
    if (playerCount > this.thresholds.veryHighPlayerCount) {
      if (!this.currentOptimizations.has('high_load_optimization')) {
        adaptations.push({
          type: 'high_load_optimization',
          reason: `Very high player count: ${playerCount}`,
          actions: ['reduce_update_rate', 'enable_compression', 'optimize_broadcasts']
        });
      }
    } else if (playerCount > this.thresholds.highPlayerCount) {
      if (!this.currentOptimizations.has('moderate_load_optimization')) {
        adaptations.push({
          type: 'moderate_load_optimization',
          reason: `High player count: ${playerCount}`,
          actions: ['reduce_update_rate', 'optimize_broadcasts']
        });
      }
    }
    
    // High error rate adaptations
    if (errorRate > 5) {
      if (!this.currentOptimizations.has('error_mitigation')) {
        adaptations.push({
          type: 'error_mitigation',
          reason: `High error rate: ${errorRate.toFixed(1)}%`,
          actions: ['reduce_update_rate', 'enable_error_recovery']
        });
      }
    }
    
    // Recovery adaptations (when conditions improve)
    if (this.shouldRecover(metrics)) {
      const recoveryActions = this.getRecoveryActions();
      if (recoveryActions.length > 0) {
        adaptations.push({
          type: 'performance_recovery',
          reason: 'Network conditions improved',
          actions: recoveryActions
        });
      }
    }
    
    return adaptations;
  }
  
  /**
   * Apply the determined adaptations
   */
  applyAdaptations(adaptations) {
    adaptations.forEach(adaptation => {
      console.log(`🔧 ADAPT: ${adaptation.type} - ${adaptation.reason}`);
      
      adaptation.actions.forEach(action => {
        switch (action) {
          case 'reduce_update_rate':
            this.reduceUpdateRate();
            break;
          case 'increase_update_rate':
            this.increaseUpdateRate();
            break;
          case 'enable_compression':
            this.enableCompression();
            break;
          case 'disable_compression':
            this.disableCompression();
            break;
          case 'reduce_precision':
            this.reducePrecision();
            break;
          case 'restore_precision':
            this.restorePrecision();
            break;
          case 'enable_redundancy':
            this.enableRedundancy();
            break;
          case 'optimize_broadcasts':
            this.optimizeBroadcasts();
            break;
          case 'enable_error_recovery':
            this.enableErrorRecovery();
            break;
          case 'aggressive_throttling':
            this.applyAggressiveThrottling();
            break;
          case 'moderate_throttling':
            this.applyModerateThrottling();
            break;
          case 'gentle_throttling':
            this.applyGentleThrottling();
            break;
          case 'emergency_compression':
            this.applyEmergencyCompression();
            break;
          case 'increase_smoothing':
            this.increasePingSmoothing();
            break;
          case 'limit_broadcasts':
            this.limitBroadcasts();
            break;
          case 'monitor_closely':
            this.enableCloseMonitoring();
            break;
        }
      });
      
      this.currentOptimizations.add(adaptation.type);
    });
  }
  
  /**
   * Check if conditions have improved enough to recover performance
   */
  shouldRecover(currentMetrics) {
    if (this.performanceHistory.length < 5) return false;
    
    const recentHistory = this.performanceHistory.slice(-5);
    const avgRecentLatency = recentHistory.reduce((sum, h) => sum + h.avgConnectionLatency, 0) / recentHistory.length;
    const avgRecentPacketLoss = recentHistory.reduce((sum, h) => sum + h.avgPacketLoss, 0) / recentHistory.length;
    
    // Conditions for recovery
    const latencyImproved = avgRecentLatency < this.thresholds.highLatency * 0.8;
    const packetLossImproved = avgRecentPacketLoss < this.thresholds.highPacketLoss * 0.5;
    const playerCountReduced = currentMetrics.playerCount < this.thresholds.highPlayerCount;
    
    return latencyImproved && packetLossImproved && playerCountReduced;
  }
  
  /**
   * Get recovery actions to restore performance
   */
  getRecoveryActions() {
    const actions = [];
    
    if (this.currentUpdateRate < this.baseUpdateRate) {
      actions.push('increase_update_rate');
    }
    
    if (this.compressionEnabled && this.currentOptimizations.has('moderate_optimization')) {
      actions.push('disable_compression');
    }
    
    if (this.currentOptimizations.has('reduce_precision')) {
      actions.push('restore_precision');
    }
    
    return actions;
  }
  
  // Adaptation action methods
  reduceUpdateRate() {
    const newRate = Math.max(this.minUpdateRate, this.currentUpdateRate * 0.8);
    if (newRate !== this.currentUpdateRate) {
      console.log(`📉 Reducing update rate: ${this.currentUpdateRate} → ${newRate} FPS`);
      this.currentUpdateRate = newRate;
    }
  }
  
  increaseUpdateRate() {
    const newRate = Math.min(this.maxUpdateRate, this.currentUpdateRate * 1.2);
    if (newRate !== this.currentUpdateRate) {
      console.log(`📈 Increasing update rate: ${this.currentUpdateRate} → ${newRate} FPS`);
      this.currentUpdateRate = newRate;
    }
  }
  
  enableCompression() {
    if (!this.compressionEnabled) {
      console.log('🗜️ Enabling data compression');
      this.compressionEnabled = true;
    }
  }
  
  disableCompression() {
    if (this.compressionEnabled) {
      console.log('🗜️ Disabling data compression');
      this.compressionEnabled = false;
    }
  }
  
  reducePrecision() {
    console.log('🎯 Reducing coordinate precision');
    // This would be implemented in the game state broadcasting
  }
  
  restorePrecision() {
    console.log('🎯 Restoring coordinate precision');
    // This would be implemented in the game state broadcasting
  }
  
  enableRedundancy() {
    console.log('🔄 Enabling packet redundancy');
    // This would implement redundant packet sending
  }
  
  optimizeBroadcasts() {
    console.log('📡 Optimizing broadcast patterns');
    // This would implement more efficient broadcasting
  }
  
  enableErrorRecovery() {
    console.log('🛠️ Enabling error recovery mechanisms');
    // This would implement error recovery protocols
  }
  
  /**
   * Add performance snapshot to history
   */
  addPerformanceSnapshot(snapshot) {
    this.performanceHistory.push(snapshot);
    if (this.performanceHistory.length > this.maxHistorySize) {
      this.performanceHistory.shift();
    }
  }

  /**
   * Get batch update frequencies for multiple players
   */
  getBatchUpdateFrequencies(players, gameObjects = [], serverMetrics = {}) {
    const frequencies = new Map();
    
    // Convert players array to Map if needed
    const playersMap = players instanceof Map ? players : 
      new Map(players.map(player => [player.id, player]));
    
    for (const [playerId, playerData] of playersMap) {
      if (!playerData.alive) continue;
      
      // Simple frequency calculation based on player count and ping
      const baseFrequency = 33; // 30 FPS default
      let frequency = baseFrequency;
      
      // Adjust based on player ping if available
      if (playerData.ping) {
        if (playerData.ping > 150) {
          frequency = Math.max(50, frequency * 1.5); // Slower updates for high ping
        } else if (playerData.ping < 50) {
          frequency = Math.max(16, frequency * 0.8); // Faster updates for low ping
        }
      }
      
      // Adjust based on total player count
      const playerCount = playersMap.size;
      if (playerCount > 20) {
        frequency = Math.max(50, frequency * 1.3);
      } else if (playerCount < 5) {
        frequency = Math.max(16, frequency * 0.9);
      }
      
      frequencies.set(playerId, frequency);
    }
    
    return frequencies;
  }
  
  /**
   * Get current update rate
   */
  getCurrentUpdateRate() {
    return this.currentUpdateRate;
  }
  
  /**
   * Get optimization suggestions for monitoring
   */
  getOptimizationSuggestions() {
    const suggestions = [];
    
    if (this.currentUpdateRate < this.baseUpdateRate) {
      suggestions.push(`Update rate reduced to ${this.currentUpdateRate} FPS for performance`);
    }
    
    if (this.compressionEnabled) {
      suggestions.push('Data compression enabled to reduce bandwidth');
    }
    
    if (this.currentOptimizations.size === 0) {
      suggestions.push('No active optimizations - performance is stable');
    }
    
    return suggestions;
  }
  
  /**
   * Apply aggressive throttling for severe congestion
   */
  applyAggressiveThrottling() {
    this.currentUpdateRate = Math.max(this.baseUpdateRate * 0.3, 10); // Reduce to 30% or minimum 10ms
    console.log(`🚨 Applied aggressive throttling: ${this.currentUpdateRate}ms update rate`);
  }
  
  /**
   * Apply moderate throttling for moderate congestion
   */
  applyModerateThrottling() {
    this.currentUpdateRate = Math.max(this.baseUpdateRate * 0.6, 15); // Reduce to 60% or minimum 15ms
    console.log(`⚠️ Applied moderate throttling: ${this.currentUpdateRate}ms update rate`);
  }
  
  /**
   * Apply gentle throttling for mild congestion
   */
  applyGentleThrottling() {
    this.currentUpdateRate = Math.max(this.baseUpdateRate * 0.8, 20); // Reduce to 80% or minimum 20ms
    console.log(`📉 Applied gentle throttling: ${this.currentUpdateRate}ms update rate`);
  }
  
  /**
   * Apply emergency compression for severe network issues
   */
  applyEmergencyCompression() {
    this.compressionEnabled = true;
    this.precisionReduced = true;
    console.log('🆘 Applied emergency compression and precision reduction');
  }
  
  /**
   * Increase ping smoothing aggressiveness
   */
  increasePingSmoothing() {
    // Increase smoothing factor for more aggressive jitter reduction
    this.smoothingConfig.smoothingFactor = Math.min(0.7, this.smoothingConfig.smoothingFactor * 1.3);
    this.smoothingConfig.outlierThreshold = Math.max(1.5, this.smoothingConfig.outlierThreshold * 0.8);
    console.log(`🎯 Increased ping smoothing: factor=${this.smoothingConfig.smoothingFactor.toFixed(2)}, outlier threshold=${this.smoothingConfig.outlierThreshold}`);
  }
  
  /**
   * Limit broadcast frequency and scope
   */
  limitBroadcasts() {
    this.broadcastsOptimized = true;
    // Additional broadcast limiting logic would be implemented in the main server
    console.log('📡 Limited broadcast frequency and scope');
  }
  
  /**
   * Enable close monitoring mode
   */
  enableCloseMonitoring() {
    // Reduce adaptation cooldown for more responsive monitoring
    this.adaptationCooldown = Math.max(1000, this.adaptationCooldown * 0.5);
    console.log(`👁️ Enabled close monitoring: cooldown=${this.adaptationCooldown}ms`);
  }
  
  /**
   * Clean up old ping data to prevent memory leaks
   */
  cleanupPingData() {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes
    
    for (const [playerId, data] of this.pingJitterData.entries()) {
      // Remove old ping data
      data.rawPings = data.rawPings.filter(ping => now - ping.timestamp < maxAge);
      data.smoothedPings = data.smoothedPings.filter(ping => now - ping.timestamp < maxAge);
      data.jitterHistory = data.jitterHistory.filter(jitter => now - jitter.timestamp < maxAge);
      
      // Remove player data if no recent pings
      if (data.rawPings.length === 0) {
        this.pingJitterData.delete(playerId);
      }
    }
    
    // Clean up congestion detection history
    this.congestionDetection.history = this.congestionDetection.history.filter(
      metric => now - metric.timestamp < maxAge
    );
  }
  
  /**
   * Get current adaptation status
   */
  getAdaptationStatus() {
    return {
      currentUpdateRate: this.currentUpdateRate,
      baseUpdateRate: this.baseUpdateRate,
      compressionEnabled: this.compressionEnabled,
      precisionReduced: this.precisionReduced,
      redundancyEnabled: this.redundancyEnabled,
      broadcastsOptimized: this.broadcastsOptimized,
      errorRecoveryEnabled: this.errorRecoveryEnabled,
      activeOptimizations: Array.from(this.currentOptimizations),
      lastAdaptation: this.lastAdaptation,
      performanceHistory: this.performanceHistory.slice(-10),
      pingJitterStats: {
        totalPlayers: this.pingJitterData.size,
        globalAverageJitter: this.getGlobalAverageJitter(),
        smoothingConfig: this.smoothingConfig
      },
      congestionDetection: {
        enabled: this.congestionDetection.enabled,
        historySize: this.congestionDetection.history.length
      }
    };
  }
  
  /**
   * Reset all adaptations to baseline
   */
  resetAdaptations() {
    console.log('🔄 Resetting all network adaptations to baseline');
    this.currentUpdateRate = this.baseUpdateRate;
    this.compressionEnabled = false;
    this.precisionReduced = false;
    this.redundancyEnabled = false;
    this.broadcastsOptimized = false;
    this.errorRecoveryEnabled = false;
    this.currentOptimizations.clear();
    this.performanceHistory = [];
    
    // Reset smoothing config to defaults
    this.smoothingConfig.smoothingFactor = 0.3;
    this.smoothingConfig.outlierThreshold = 3;
    this.adaptationCooldown = 5000;
    
    // Clear ping jitter data
    this.pingJitterData.clear();
    this.congestionDetection.history = [];
  }
}

module.exports = NetworkAdaptationAgent;