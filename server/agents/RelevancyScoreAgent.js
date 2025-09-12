/**
 * Relevancy Scoring Agent (RSA)
 * Scores game objects by distance, importance, and player interaction likelihood
 * Enables intelligent prioritization of network updates
 */

class RelevancyScoreAgent {
  constructor() {
    // Scoring weights for different factors
    this.weights = {
      distance: 0.4,        // Closer objects are more relevant
      size: 0.2,           // Larger objects are more visible/important
      movement: 0.2,       // Moving objects need more frequent updates
      interaction: 0.1,    // Objects player can interact with
      type: 0.1           // Object type importance
    };
    
    // Type-based importance scores
    this.typeImportance = {
      'player': 1.0,       // Other players are most important
      'food': 0.6,         // Food is moderately important
      'deadPoint': 0.4,    // Dead points are less important
      'bot': 0.8          // Bots are important but less than real players
    };
    
    // Distance thresholds for scoring
    this.distanceThresholds = {
      immediate: 100,      // Very close - maximum relevance
      near: 200,          // Near - high relevance
      medium: 400,        // Medium distance - moderate relevance
      far: 800           // Far - low relevance
    };
    
    console.log('📊 Relevancy Scoring Agent initialized');
  }

  /**
   * Calculate relevancy score for an object relative to a player
   */
  calculateScore(object, playerX, playerY, playerRadius = 10, playerSpeed = 0) {
    const distance = Math.sqrt(
      Math.pow(object.x - playerX, 2) + Math.pow(object.y - playerY, 2)
    );
    
    // Distance score (inverse relationship - closer = higher score)
    const distanceScore = this.calculateDistanceScore(distance);
    
    // Size score (larger objects are more important)
    const sizeScore = this.calculateSizeScore(object, playerRadius);
    
    // Movement score (moving objects need more updates)
    const movementScore = this.calculateMovementScore(object, playerSpeed);
    
    // Interaction score (can player interact with this object?)
    const interactionScore = this.calculateInteractionScore(object, distance, playerRadius);
    
    // Type score (object type importance)
    const typeScore = this.typeImportance[object.type] || 0.5;
    
    // Weighted final score
    const finalScore = (
      distanceScore * this.weights.distance +
      sizeScore * this.weights.size +
      movementScore * this.weights.movement +
      interactionScore * this.weights.interaction +
      typeScore * this.weights.type
    );
    
    return {
      score: Math.max(0, Math.min(1, finalScore)), // Clamp between 0-1
      distance,
      components: {
        distance: distanceScore,
        size: sizeScore,
        movement: movementScore,
        interaction: interactionScore,
        type: typeScore
      }
    };
  }

  /**
   * Calculate distance-based score
   */
  calculateDistanceScore(distance) {
    if (distance <= this.distanceThresholds.immediate) {
      return 1.0; // Maximum relevance for very close objects
    } else if (distance <= this.distanceThresholds.near) {
      return 0.8; // High relevance for nearby objects
    } else if (distance <= this.distanceThresholds.medium) {
      return 0.5; // Medium relevance
    } else if (distance <= this.distanceThresholds.far) {
      return 0.2; // Low relevance for far objects
    } else {
      return 0.05; // Very low relevance for very far objects
    }
  }

  /**
   * Calculate size-based score
   */
  calculateSizeScore(object, playerRadius) {
    const objectRadius = object.radius || object.data?.radius || 5;
    const sizeRatio = objectRadius / playerRadius;
    
    // Larger objects relative to player are more important
    return Math.min(1.0, sizeRatio * 0.5 + 0.3);
  }

  /**
   * Calculate movement-based score
   */
  calculateMovementScore(object, playerSpeed) {
    const objectSpeed = object.data?.speed || 0;
    const relativeSpeed = Math.abs(objectSpeed - playerSpeed);
    
    // Objects with different speeds need more frequent updates
    return Math.min(1.0, relativeSpeed * 0.1 + 0.3);
  }

  /**
   * Calculate interaction potential score
   */
  calculateInteractionScore(object, distance, playerRadius) {
    const objectRadius = object.radius || object.data?.radius || 5;
    const interactionDistance = playerRadius + objectRadius + 20; // Buffer for interaction
    
    if (distance <= interactionDistance) {
      // High score for objects player can potentially interact with
      return 1.0;
    } else if (distance <= interactionDistance * 2) {
      // Medium score for objects player might reach soon
      return 0.6;
    } else {
      // Low score for objects too far to interact with
      return 0.2;
    }
  }

  /**
   * Score and sort objects by relevancy for a specific player
   */
  scoreObjectsForPlayer(objects, playerX, playerY, playerRadius = 10, playerSpeed = 0, maxObjects = null) {
    const scoredObjects = objects.map(object => {
      const scoring = this.calculateScore(object, playerX, playerY, playerRadius, playerSpeed);
      return {
        ...object,
        relevancyScore: scoring.score,
        distance: scoring.distance,
        scoreComponents: scoring.components
      };
    });
    
    // Sort by relevancy score (highest first)
    scoredObjects.sort((a, b) => b.relevancyScore - a.relevancyScore);
    
    // Limit number of objects if specified
    if (maxObjects && scoredObjects.length > maxObjects) {
      return scoredObjects.slice(0, maxObjects);
    }
    
    return scoredObjects;
  }

  /**
   * Filter objects by minimum relevancy threshold
   */
  filterByRelevancy(objects, playerX, playerY, minScore = 0.1, playerRadius = 10, playerSpeed = 0) {
    return objects.filter(object => {
      const scoring = this.calculateScore(object, playerX, playerY, playerRadius, playerSpeed);
      return scoring.score >= minScore;
    });
  }

  /**
   * Get adaptive update frequency based on relevancy score
   */
  getUpdateFrequency(relevancyScore) {
    if (relevancyScore >= 0.8) {
      return 50; // 20 FPS for highly relevant objects
    } else if (relevancyScore >= 0.6) {
      return 100; // 10 FPS for moderately relevant objects
    } else if (relevancyScore >= 0.3) {
      return 200; // 5 FPS for less relevant objects
    } else if (relevancyScore >= 0.1) {
      return 500; // 2 FPS for low relevance objects
    } else {
      return 1000; // 1 FPS for very low relevance objects
    }
  }

  /**
   * Score objects for a specific player (interface expected by server)
   */
  scoreObjects(objects, playerX, playerY, objectType = 'generic') {
    const playerRadius = 10;
    const playerSpeed = 0;
    
    return objects.map(object => {
      const scoring = this.calculateScore(object, playerX, playerY, playerRadius, playerSpeed);
      return {
        object: object,
        score: scoring.score,
        distance: scoring.distance,
        components: scoring.components
      };
    }).sort((a, b) => b.score - a.score);
  }

  /**
   * Batch score objects for multiple players efficiently
   */
  batchScoreObjects(objects, players) {
    const results = new Map();
    
    for (const [playerId, player] of players) {
      if (!player.alive || !player.x || !player.y) continue;
      
      const playerRadius = player.radius || 10;
      const playerSpeed = player.speed || 0;
      
      const scoredObjects = this.scoreObjectsForPlayer(
        objects,
        player.x,
        player.y,
        playerRadius,
        playerSpeed
      );
      
      results.set(playerId, scoredObjects);
    }
    
    return results;
  }

  /**
   * Update scoring weights (for tuning)
   */
  updateWeights(newWeights) {
    this.weights = { ...this.weights, ...newWeights };
    console.log('📊 RSA: Scoring weights updated:', this.weights);
  }

  /**
   * Update type importance scores
   */
  updateTypeImportance(newImportance) {
    this.typeImportance = { ...this.typeImportance, ...newImportance };
    console.log('📊 RSA: Type importance updated:', this.typeImportance);
  }

  /**
   * Get scoring statistics
   */
  getStats(scoredObjects) {
    if (!scoredObjects || scoredObjects.length === 0) {
      return { averageScore: 0, scoreDistribution: {}, totalObjects: 0 };
    }
    
    const scores = scoredObjects.map(obj => obj.relevancyScore || 0);
    const averageScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    
    // Score distribution
    const distribution = {
      high: scores.filter(s => s >= 0.7).length,
      medium: scores.filter(s => s >= 0.4 && s < 0.7).length,
      low: scores.filter(s => s < 0.4).length
    };
    
    return {
      averageScore,
      scoreDistribution: distribution,
      totalObjects: scoredObjects.length,
      highRelevanceRatio: distribution.high / scoredObjects.length
    };
  }
}

module.exports = RelevancyScoreAgent;