/**
 * Connection Quality Assessment
 * Analyzes network metrics to determine connection stability and quality
 */

class ConnectionQualityAssessment {
  constructor() {
    this.qualityThresholds = {
      excellent: { latency: 30, jitter: 5, packetLoss: 0.1 },
      good: { latency: 60, jitter: 15, packetLoss: 1.0 },
      fair: { latency: 100, jitter: 30, packetLoss: 3.0 },
      poor: { latency: 200, jitter: 50, packetLoss: 5.0 }
    };
    
    this.adaptiveSettings = {
      excellent: { updateRate: 60, compressionLevel: 'low', priorityBoost: 1.2 },
      good: { updateRate: 30, compressionLevel: 'medium', priorityBoost: 1.0 },
      fair: { updateRate: 20, compressionLevel: 'high', priorityBoost: 0.8 },
      poor: { updateRate: 15, compressionLevel: 'high', priorityBoost: 0.6 },
      critical: { updateRate: 10, compressionLevel: 'maximum', priorityBoost: 0.4 }
    };
    
    this.playerQualityHistory = new Map(); // playerId -> quality history
    this.qualityChangeCallbacks = new Set();
  }

  /**
   * Assess connection quality for a player
   */
  assessPlayerQuality(playerId, networkMetrics) {
    if (!networkMetrics) return 'unknown';
    
    const {
      averageLatency,
      averageJitter,
      packetLossRate,
      connectionStability,
      messageFrequency
    } = this.calculateMetrics(networkMetrics);
    
    // Calculate quality score (0-100)
    const latencyScore = this.calculateLatencyScore(averageLatency);
    const jitterScore = this.calculateJitterScore(averageJitter);
    const packetLossScore = this.calculatePacketLossScore(packetLossRate);
    const stabilityScore = this.calculateStabilityScore(connectionStability);
    
    // Weighted average (latency 40%, jitter 25%, packet loss 25%, stability 10%)
    const overallScore = (
      latencyScore * 0.4 +
      jitterScore * 0.25 +
      packetLossScore * 0.25 +
      stabilityScore * 0.1
    );
    
    const qualityLevel = this.scoreToQualityLevel(overallScore);
    const adaptiveSettings = this.getAdaptiveSettings(qualityLevel);
    
    const assessment = {
      playerId,
      timestamp: Date.now(),
      qualityLevel,
      overallScore: Math.round(overallScore),
      metrics: {
        latency: Math.round(averageLatency),
        jitter: Math.round(averageJitter),
        packetLoss: Math.round(packetLossRate * 100) / 100,
        stability: Math.round(connectionStability * 100) / 100
      },
      scores: {
        latency: Math.round(latencyScore),
        jitter: Math.round(jitterScore),
        packetLoss: Math.round(packetLossScore),
        stability: Math.round(stabilityScore)
      },
      adaptiveSettings,
      recommendations: this.generateRecommendations(qualityLevel, {
        averageLatency,
        averageJitter,
        packetLossRate,
        connectionStability
      })
    };
    
    // Track quality history
    this.updateQualityHistory(playerId, assessment);
    
    // Notify callbacks of quality changes
    this.notifyQualityChange(playerId, assessment);
    
    return assessment;
  }

  /**
   * Calculate network metrics from raw data
   */
  calculateMetrics(networkMetrics) {
    const {
      latencyHistory = [],
      jitterHistory = [],
      packetsSent = 0,
      packetsReceived = 0,
      packetsLost = 0,
      messagesReceived = 0,
      connectTime = Date.now()
    } = networkMetrics;
    
    // Calculate averages
    const averageLatency = latencyHistory.length > 0 
      ? latencyHistory.reduce((sum, val) => sum + val, 0) / latencyHistory.length 
      : 0;
    
    const averageJitter = jitterHistory.length > 0
      ? jitterHistory.reduce((sum, val) => sum + val, 0) / jitterHistory.length
      : 0;
    
    // Calculate packet loss rate
    const totalPackets = packetsSent + packetsReceived;
    const packetLossRate = totalPackets > 0 ? (packetsLost / totalPackets) * 100 : 0;
    
    // Calculate connection stability (based on latency variance)
    const latencyVariance = this.calculateVariance(latencyHistory);
    const connectionStability = Math.max(0, 100 - latencyVariance) / 100;
    
    // Calculate message frequency
    const connectionDuration = (Date.now() - connectTime) / 1000; // seconds
    const messageFrequency = connectionDuration > 0 ? messagesReceived / connectionDuration : 0;
    
    return {
      averageLatency,
      averageJitter,
      packetLossRate,
      connectionStability,
      messageFrequency
    };
  }

  /**
   * Calculate latency score (0-100, higher is better)
   */
  calculateLatencyScore(latency) {
    if (latency <= this.qualityThresholds.excellent.latency) return 100;
    if (latency <= this.qualityThresholds.good.latency) return 85;
    if (latency <= this.qualityThresholds.fair.latency) return 65;
    if (latency <= this.qualityThresholds.poor.latency) return 40;
    return Math.max(0, 40 - (latency - this.qualityThresholds.poor.latency) / 10);
  }

  /**
   * Calculate jitter score (0-100, higher is better)
   */
  calculateJitterScore(jitter) {
    if (jitter <= this.qualityThresholds.excellent.jitter) return 100;
    if (jitter <= this.qualityThresholds.good.jitter) return 85;
    if (jitter <= this.qualityThresholds.fair.jitter) return 65;
    if (jitter <= this.qualityThresholds.poor.jitter) return 40;
    return Math.max(0, 40 - (jitter - this.qualityThresholds.poor.jitter) / 5);
  }

  /**
   * Calculate packet loss score (0-100, higher is better)
   */
  calculatePacketLossScore(packetLossRate) {
    if (packetLossRate <= this.qualityThresholds.excellent.packetLoss) return 100;
    if (packetLossRate <= this.qualityThresholds.good.packetLoss) return 85;
    if (packetLossRate <= this.qualityThresholds.fair.packetLoss) return 65;
    if (packetLossRate <= this.qualityThresholds.poor.packetLoss) return 40;
    return Math.max(0, 40 - (packetLossRate - this.qualityThresholds.poor.packetLoss));
  }

  /**
   * Calculate stability score (0-100, higher is better)
   */
  calculateStabilityScore(stability) {
    return stability * 100;
  }

  /**
   * Convert overall score to quality level
   */
  scoreToQualityLevel(score) {
    if (score >= 90) return 'excellent';
    if (score >= 75) return 'good';
    if (score >= 60) return 'fair';
    if (score >= 40) return 'poor';
    return 'critical';
  }

  /**
   * Get adaptive settings for quality level
   */
  getAdaptiveSettings(qualityLevel) {
    return { ...this.adaptiveSettings[qualityLevel] };
  }

  /**
   * Generate recommendations based on quality assessment
   */
  generateRecommendations(qualityLevel, metrics) {
    const recommendations = [];
    
    if (qualityLevel === 'critical' || qualityLevel === 'poor') {
      recommendations.push('Consider switching to a more stable network connection');
      
      if (metrics.averageLatency > 150) {
        recommendations.push('High latency detected - check network routing');
      }
      
      if (metrics.packetLossRate > 3) {
        recommendations.push('Significant packet loss - check network stability');
      }
      
      if (metrics.averageJitter > 40) {
        recommendations.push('High jitter detected - network may be congested');
      }
    }
    
    if (qualityLevel === 'fair') {
      recommendations.push('Connection is adequate but could be improved');
    }
    
    if (qualityLevel === 'good' || qualityLevel === 'excellent') {
      recommendations.push('Connection quality is good for optimal gameplay');
    }
    
    return recommendations;
  }

  /**
   * Calculate variance for stability assessment
   */
  calculateVariance(values) {
    if (values.length < 2) return 0;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    return squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
  }

  /**
   * Update quality history for trend analysis
   */
  updateQualityHistory(playerId, assessment) {
    if (!this.playerQualityHistory.has(playerId)) {
      this.playerQualityHistory.set(playerId, []);
    }
    
    const history = this.playerQualityHistory.get(playerId);
    history.push({
      timestamp: assessment.timestamp,
      qualityLevel: assessment.qualityLevel,
      overallScore: assessment.overallScore
    });
    
    // Keep only last 50 assessments
    if (history.length > 50) {
      history.shift();
    }
  }

  /**
   * Get quality trend for a player
   */
  getQualityTrend(playerId) {
    const history = this.playerQualityHistory.get(playerId) || [];
    if (history.length < 3) return 'stable';
    
    const recent = history.slice(-5);
    const scores = recent.map(h => h.overallScore);
    
    const trend = scores[scores.length - 1] - scores[0];
    
    if (trend > 10) return 'improving';
    if (trend < -10) return 'degrading';
    return 'stable';
  }

  /**
   * Register callback for quality changes
   */
  onQualityChange(callback) {
    this.qualityChangeCallbacks.add(callback);
  }

  /**
   * Notify callbacks of quality changes
   */
  notifyQualityChange(playerId, assessment) {
    this.qualityChangeCallbacks.forEach(callback => {
      try {
        callback(playerId, assessment);
      } catch (error) {
        console.error('Error in quality change callback:', error);
      }
    });
  }

  /**
   * Get global quality statistics
   */
  getGlobalQualityStats() {
    const allAssessments = [];
    this.playerQualityHistory.forEach(history => {
      if (history.length > 0) {
        allAssessments.push(history[history.length - 1]);
      }
    });
    
    if (allAssessments.length === 0) {
      return {
        averageScore: 0,
        qualityDistribution: {},
        totalPlayers: 0
      };
    }
    
    const averageScore = allAssessments.reduce((sum, a) => sum + a.overallScore, 0) / allAssessments.length;
    
    const qualityDistribution = {};
    allAssessments.forEach(a => {
      qualityDistribution[a.qualityLevel] = (qualityDistribution[a.qualityLevel] || 0) + 1;
    });
    
    return {
      averageScore: Math.round(averageScore),
      qualityDistribution,
      totalPlayers: allAssessments.length
    };
  }

  /**
   * Clean up disconnected players
   */
  cleanup(playerId) {
    this.playerQualityHistory.delete(playerId);
  }
}

module.exports = { ConnectionQualityAssessment };