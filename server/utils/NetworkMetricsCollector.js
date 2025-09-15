/**
 * Network Metrics Collector
 * Comprehensive server-side network performance monitoring
 */

class NetworkMetricsCollector {
  constructor() {
    this.playerMetrics = new Map(); // playerId -> metrics
    this.globalMetrics = {
      totalConnections: 0,
      activeConnections: 0,
      totalDisconnections: 0,
      averageLatency: 0,
      peakLatency: 0,
      minLatency: Infinity,
      packetsPerSecond: 0,
      bytesPerSecond: 0,
      connectionErrors: 0,
      timeouts: 0,
      reconnections: 0,
      startTime: Date.now(),
      lastReset: Date.now()
    };
    
    this.recentLatencies = [];
    this.maxLatencyHistory = 1000;
    this.packetCount = 0;
    this.byteCount = 0;
    this.lastPacketReset = Date.now();
    
    // Connection quality thresholds
    this.qualityThresholds = {
      excellent: { latency: 30, jitter: 5, packetLoss: 0.1 },
      good: { latency: 60, jitter: 15, packetLoss: 1 },
      fair: { latency: 100, jitter: 30, packetLoss: 3 },
      poor: { latency: 200, jitter: 50, packetLoss: 5 }
    };
    
    // Start periodic cleanup and calculations
    this.startPeriodicTasks();
  }
  
  /**
   * Record player connection
   */
  recordConnection(playerId, socketId, userAgent = '', ipAddress = '') {
    const now = Date.now();
    
    this.playerMetrics.set(playerId, {
      socketId,
      connectTime: now,
      lastActivity: now,
      latencyHistory: [],
      jitterHistory: [],
      packetsSent: 0,
      packetsReceived: 0,
      packetsLost: 0,
      bytesTransferred: 0,
      reconnectCount: 0,
      userAgent,
      ipAddress,
      connectionQuality: 'unknown',
      avgLatency: 0,
      avgJitter: 0,
      packetLossRate: 0,
      isStable: true,
      warningCount: 0,
      lastPingTime: 0,
      consecutiveTimeouts: 0
    });
    
    this.globalMetrics.totalConnections++;
    this.globalMetrics.activeConnections++;
    
    console.log(`📊 Player connected: ${playerId} (Total: ${this.globalMetrics.activeConnections})`);
  }
  
  /**
   * Record player disconnection
   */
  recordDisconnection(playerId, reason = 'unknown') {
    const playerData = this.playerMetrics.get(playerId);
    if (playerData) {
      const sessionDuration = Date.now() - playerData.connectTime;
      
      console.log(`📊 Player disconnected: ${playerId}, Duration: ${sessionDuration}ms, Reason: ${reason}`);
      console.log(`📊 Final stats - Avg Latency: ${playerData.avgLatency}ms, Quality: ${playerData.connectionQuality}`);
      
      this.playerMetrics.delete(playerId);
    }
    
    this.globalMetrics.activeConnections = Math.max(0, this.globalMetrics.activeConnections - 1);
    this.globalMetrics.totalDisconnections++;
  }
  
  /**
   * Record ping/latency measurement
   */
  recordLatency(playerId, latency, jitter = 0) {
    const playerData = this.playerMetrics.get(playerId);
    if (!playerData) return;
    
    const now = Date.now();
    playerData.lastActivity = now;
    playerData.lastPingTime = now;
    playerData.consecutiveTimeouts = 0;
    
    // Update latency history
    playerData.latencyHistory.push(latency);
    if (playerData.latencyHistory.length > 50) {
      playerData.latencyHistory.shift();
    }
    
    // Update jitter history
    if (jitter > 0) {
      playerData.jitterHistory.push(jitter);
      if (playerData.jitterHistory.length > 50) {
        playerData.jitterHistory.shift();
      }
    }
    
    // Calculate averages
    playerData.avgLatency = playerData.latencyHistory.reduce((a, b) => a + b, 0) / playerData.latencyHistory.length;
    playerData.avgJitter = playerData.jitterHistory.length > 0 ? 
      playerData.jitterHistory.reduce((a, b) => a + b, 0) / playerData.jitterHistory.length : 0;
    
    // Update global metrics
    this.recentLatencies.push(latency);
    if (this.recentLatencies.length > this.maxLatencyHistory) {
      this.recentLatencies.shift();
    }
    
    this.updateGlobalLatencyStats();
    this.assessConnectionQuality(playerId);
    
    // Check for stability issues
    this.checkStabilityIssues(playerId, latency);
  }
  
  /**
   * Record packet transmission
   */
  recordPacket(playerId, bytes, type = 'outbound') {
    const playerData = this.playerMetrics.get(playerId);
    if (playerData) {
      if (type === 'outbound') {
        playerData.packetsSent++;
      } else {
        playerData.packetsReceived++;
      }
      playerData.bytesTransferred += bytes;
      playerData.lastActivity = Date.now();
    }
    
    this.packetCount++;
    this.byteCount += bytes;
  }
  
  /**
   * Record packet loss
   */
  recordPacketLoss(playerId) {
    const playerData = this.playerMetrics.get(playerId);
    if (playerData) {
      playerData.packetsLost++;
      playerData.packetLossRate = (playerData.packetsLost / 
        (playerData.packetsSent + playerData.packetsReceived)) * 100;
      
      this.assessConnectionQuality(playerId);
    }
  }
  
  /**
   * Record timeout event
   */
  recordTimeout(playerId) {
    const playerData = this.playerMetrics.get(playerId);
    if (playerData) {
      playerData.consecutiveTimeouts++;
      playerData.warningCount++;
      
      if (playerData.consecutiveTimeouts >= 3) {
        playerData.isStable = false;
        console.warn(`⚠️ Player ${playerId} experiencing consecutive timeouts: ${playerData.consecutiveTimeouts}`);
      }
    }
    
    this.globalMetrics.timeouts++;
  }
  
  /**
   * Record reconnection
   */
  recordReconnection(playerId) {
    const playerData = this.playerMetrics.get(playerId);
    if (playerData) {
      playerData.reconnectCount++;
      playerData.warningCount++;
    }
    
    this.globalMetrics.reconnections++;
  }
  
  /**
   * Assess connection quality for a player
   */
  assessConnectionQuality(playerId) {
    const playerData = this.playerMetrics.get(playerId);
    if (!playerData || playerData.latencyHistory.length < 5) return;
    
    const avgLatency = playerData.avgLatency;
    const avgJitter = playerData.avgJitter;
    const packetLoss = playerData.packetLossRate;
    
    let quality = 'poor';
    
    if (avgLatency <= this.qualityThresholds.excellent.latency && 
        avgJitter <= this.qualityThresholds.excellent.jitter && 
        packetLoss <= this.qualityThresholds.excellent.packetLoss) {
      quality = 'excellent';
    } else if (avgLatency <= this.qualityThresholds.good.latency && 
               avgJitter <= this.qualityThresholds.good.jitter && 
               packetLoss <= this.qualityThresholds.good.packetLoss) {
      quality = 'good';
    } else if (avgLatency <= this.qualityThresholds.fair.latency && 
               avgJitter <= this.qualityThresholds.fair.jitter && 
               packetLoss <= this.qualityThresholds.fair.packetLoss) {
      quality = 'fair';
    }
    
    const previousQuality = playerData.connectionQuality;
    playerData.connectionQuality = quality;
    
    // Log quality changes
    if (previousQuality !== quality && previousQuality !== 'unknown') {
      console.log(`📊 Player ${playerId} connection quality changed: ${previousQuality} → ${quality}`);
    }
  }
  
  /**
   * Check for stability issues
   */
  checkStabilityIssues(playerId, currentLatency) {
    const playerData = this.playerMetrics.get(playerId);
    if (!playerData || playerData.latencyHistory.length < 10) return;
    
    const recentLatencies = playerData.latencyHistory.slice(-10);
    const variance = this.calculateVariance(recentLatencies);
    const avgLatency = recentLatencies.reduce((a, b) => a + b, 0) / recentLatencies.length;
    
    // Check for high variance (instability)
    if (variance > 1000 || currentLatency > avgLatency * 2) {
      playerData.isStable = false;
      playerData.warningCount++;
      
      if (playerData.warningCount % 5 === 0) {
        console.warn(`⚠️ Player ${playerId} experiencing ping instability. Variance: ${variance.toFixed(2)}, Current: ${currentLatency}ms, Avg: ${avgLatency.toFixed(2)}ms`);
      }
    } else if (variance < 100 && playerData.warningCount > 0) {
      // Connection stabilized
      playerData.isStable = true;
      playerData.warningCount = Math.max(0, playerData.warningCount - 1);
    }
  }
  
  /**
   * Calculate variance for stability analysis
   */
  calculateVariance(values) {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(value => Math.pow(value - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  }
  
  /**
   * Update global latency statistics
   */
  updateGlobalLatencyStats() {
    if (this.recentLatencies.length === 0) return;
    
    const sum = this.recentLatencies.reduce((a, b) => a + b, 0);
    this.globalMetrics.averageLatency = sum / this.recentLatencies.length;
    this.globalMetrics.peakLatency = Math.max(...this.recentLatencies);
    this.globalMetrics.minLatency = Math.min(...this.recentLatencies);
  }
  
  /**
   * Get player metrics
   */
  getPlayerMetrics(playerId) {
    return this.playerMetrics.get(playerId) || null;
  }
  
  /**
   * Get all player metrics
   */
  getAllPlayerMetrics() {
    const metrics = {};
    for (const [playerId, data] of this.playerMetrics) {
      metrics[playerId] = { ...data };
    }
    return metrics;
  }
  
  /**
   * Get global network metrics
   */
  getGlobalMetrics() {
    const now = Date.now();
    const timeDiff = (now - this.lastPacketReset) / 1000;
    
    return {
      ...this.globalMetrics,
      uptime: now - this.globalMetrics.startTime,
      packetsPerSecond: timeDiff > 0 ? (this.packetCount / timeDiff).toFixed(2) : 0,
      bytesPerSecond: timeDiff > 0 ? (this.byteCount / timeDiff).toFixed(2) : 0,
      connectionQualityDistribution: this.getQualityDistribution(),
      unstableConnections: this.getUnstableConnectionCount(),
      averageSessionDuration: this.getAverageSessionDuration()
    };
  }
  
  /**
   * Get connection quality distribution
   */
  getQualityDistribution() {
    const distribution = { excellent: 0, good: 0, fair: 0, poor: 0, unknown: 0 };
    
    for (const [, data] of this.playerMetrics) {
      distribution[data.connectionQuality]++;
    }
    
    return distribution;
  }
  
  /**
   * Get count of unstable connections
   */
  getUnstableConnectionCount() {
    let count = 0;
    for (const [, data] of this.playerMetrics) {
      if (!data.isStable) count++;
    }
    return count;
  }
  
  /**
   * Get average session duration
   */
  getAverageSessionDuration() {
    if (this.playerMetrics.size === 0) return 0;
    
    const now = Date.now();
    let totalDuration = 0;
    
    for (const [, data] of this.playerMetrics) {
      totalDuration += now - data.connectTime;
    }
    
    return totalDuration / this.playerMetrics.size;
  }
  
  /**
   * Reset metrics (for testing or periodic cleanup)
   */
  resetMetrics() {
    this.globalMetrics.lastReset = Date.now();
    this.recentLatencies = [];
    this.packetCount = 0;
    this.byteCount = 0;
    this.lastPacketReset = Date.now();
    
    console.log('📊 Network metrics reset');
  }
  
  /**
   * Start periodic tasks
   */
  startPeriodicTasks() {
    // Reset packet counters every minute for accurate per-second calculations
    setInterval(() => {
      this.packetCount = 0;
      this.byteCount = 0;
      this.lastPacketReset = Date.now();
    }, 60000);
    
    // Log summary metrics every 30 seconds
    setInterval(() => {
      this.logSummaryMetrics();
    }, 30000);
    
    // Clean up old latency data every 5 minutes
    setInterval(() => {
      if (this.recentLatencies.length > this.maxLatencyHistory) {
        this.recentLatencies = this.recentLatencies.slice(-this.maxLatencyHistory / 2);
      }
    }, 300000);
  }
  
  /**
   * Log summary metrics
   */
  logSummaryMetrics() {
    const metrics = this.getGlobalMetrics();
    const qualityDist = metrics.connectionQualityDistribution;
    
    console.log('📊 Network Metrics Summary:');
    console.log(`   Active Connections: ${metrics.activeConnections}`);
    console.log(`   Average Latency: ${metrics.averageLatency.toFixed(2)}ms`);
    console.log(`   Peak Latency: ${metrics.peakLatency}ms`);
    console.log(`   Packets/sec: ${metrics.packetsPerSecond}`);
    console.log(`   Quality Distribution: E:${qualityDist.excellent} G:${qualityDist.good} F:${qualityDist.fair} P:${qualityDist.poor}`);
    console.log(`   Unstable Connections: ${metrics.unstableConnections}`);
    console.log(`   Timeouts: ${metrics.timeouts}, Reconnections: ${metrics.reconnections}`);
  }
  
  /**
   * Get network health status
   */
  getNetworkHealth() {
    const metrics = this.getGlobalMetrics();
    const qualityDist = metrics.connectionQualityDistribution;
    const totalConnections = metrics.activeConnections;
    
    if (totalConnections === 0) {
      return { status: 'idle', score: 100, issues: [] };
    }
    
    const issues = [];
    let score = 100;
    
    // Check average latency
    if (metrics.averageLatency > 150) {
      issues.push('High average latency');
      score -= 20;
    } else if (metrics.averageLatency > 100) {
      issues.push('Moderate latency');
      score -= 10;
    }
    
    // Check unstable connections
    const unstableRatio = metrics.unstableConnections / totalConnections;
    if (unstableRatio > 0.3) {
      issues.push('High number of unstable connections');
      score -= 25;
    } else if (unstableRatio > 0.1) {
      issues.push('Some unstable connections');
      score -= 10;
    }
    
    // Check connection quality distribution
    const poorRatio = qualityDist.poor / totalConnections;
    if (poorRatio > 0.2) {
      issues.push('Many poor quality connections');
      score -= 20;
    }
    
    // Check timeout rate
    if (metrics.timeouts > totalConnections * 2) {
      issues.push('High timeout rate');
      score -= 15;
    }
    
    let status = 'excellent';
    if (score < 60) status = 'poor';
    else if (score < 75) status = 'fair';
    else if (score < 90) status = 'good';
    
    return { status, score: Math.max(0, score), issues };
  }
}

module.exports = { NetworkMetricsCollector };