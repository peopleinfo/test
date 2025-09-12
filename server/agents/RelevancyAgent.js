/**
 * Relevancy Scoring Agent (RSA)
 * Scores game objects by distance, importance, and player context
 * Helps prioritize which objects to send to clients for optimal network usage
 */

class RelevancyAgent {
  constructor() {
    this.scoreCache = new Map();
    this.lastCacheUpdate = 0;
    this.CACHE_DURATION = 100; // Cache scores for 100ms
    
    // Scoring weights for different object types
    this.weights = {
      players: {
        base: 100,
        distance: 0.8,
        size: 0.3,
        movement: 0.4
      },
      foods: {
        base: 20,
        distance: 0.6,
        type: 0.2,
        age: 0.1
      },
      deadPoints: {
        base: 30,
        distance: 0.7,
        size: 0.2,
        age: 0.3
      }
    };
    
    console.log('📊 Relevancy Scoring Agent initialized');
  }

  /**
   * Calculate relevancy score for a game object relative to a player's viewport
   */
  calculateRelevancyScore(object, objectType, playerViewport, playerData) {
    const cacheKey = `${objectType}_${object.id || object.x + '_' + object.y}_${playerData.id}`;
    const now = Date.now();
    
    // Check cache first
    if (this.scoreCache.has(cacheKey)) {
      const cached = this.scoreCache.get(cacheKey);
      if (now - cached.timestamp < this.CACHE_DURATION) {
        return cached.score;
      }
    }
    
    let score = 0;
    const weights = this.weights[objectType] || this.weights.foods;
    
    // Base score
    score += weights.base;
    
    // Distance scoring (closer = higher score)
    const distance = this.calculateDistance(object, playerData);
    const maxDistance = Math.max(playerViewport.width, playerViewport.height);
    const distanceScore = Math.max(0, (maxDistance - distance) / maxDistance) * 100;
    score += distanceScore * weights.distance;
    
    // Object-specific scoring
    switch (objectType) {
      case 'players':
        score += this.scorePlayer(object, playerData, weights);
        break;
      case 'foods':
        score += this.scoreFood(object, weights);
        break;
      case 'deadPoints':
        score += this.scoreDeadPoint(object, weights);
        break;
    }
    
    // Viewport priority boost (objects in viewport get higher scores)
    if (this.isInViewport(object, playerViewport)) {
      score *= 1.5;
    }
    
    // Cache the result
    this.scoreCache.set(cacheKey, {
      score: Math.max(0, score),
      timestamp: now
    });
    
    return Math.max(0, score);
  }

  /**
   * Score player objects
   */
  scorePlayer(player, viewerPlayer, weights) {
    let score = 0;
    
    // Size/score importance
    const sizeRatio = (player.score || 0) / Math.max(viewerPlayer.score || 1, 1);
    score += Math.min(sizeRatio * 50, 100) * weights.size;
    
    // Movement activity (moving players are more relevant)
    const timeSinceMove = Date.now() - (player.lastMoveTime || 0);
    const movementScore = Math.max(0, (5000 - timeSinceMove) / 5000) * 50;
    score += movementScore * weights.movement;
    
    // Boost for alive players
    if (player.alive) {
      score += 25;
    }
    
    return score;
  }

  /**
   * Score food objects
   */
  scoreFood(food, weights) {
    let score = 0;
    
    // Food type importance
    const typeMultipliers = {
      'apple': 1.0,
      'watermelon': 1.2,
      'orange': 1.1,
      'banana': 1.0,
      'grape': 0.9
    };
    const typeMultiplier = typeMultipliers[food.type] || 1.0;
    score += typeMultiplier * 20 * weights.type;
    
    // Age factor (newer food is slightly more relevant)
    const age = Date.now() - (food.lastEatenAt || 0);
    const ageScore = Math.max(0, (30000 - age) / 30000) * 10;
    score += ageScore * weights.age;
    
    return score;
  }

  /**
   * Score dead point objects
   */
  scoreDeadPoint(deadPoint, weights) {
    let score = 0;
    
    // Size importance (larger dead points are more valuable)
    const size = deadPoint.size || 5;
    score += (size / 10) * 20 * weights.size;
    
    // Age factor (older dead points can be consumed)
    const age = Date.now() - (deadPoint.createdAt || 0);
    const ageScore = Math.min(age / 30000, 1) * 30; // More valuable as they age
    score += ageScore * weights.age;
    
    return score;
  }

  /**
   * Get top N most relevant objects of a specific type
   */
  getTopRelevantObjects(objects, objectType, playerViewport, playerData, maxCount = 50) {
    const scoredObjects = objects.map(obj => ({
      object: obj,
      score: this.calculateRelevancyScore(obj, objectType, playerViewport, playerData)
    }));
    
    // Sort by score (highest first) and take top N
    return scoredObjects
      .sort((a, b) => b.score - a.score)
      .slice(0, maxCount)
      .map(item => item.object);
  }

  /**
   * Filter objects by minimum relevancy threshold
   */
  filterByRelevancyThreshold(objects, objectType, playerViewport, playerData, threshold = 10) {
    return objects.filter(obj => {
      const score = this.calculateRelevancyScore(obj, objectType, playerViewport, playerData);
      return score >= threshold;
    });
  }

  /**
   * Calculate distance between two objects
   */
  calculateDistance(obj1, obj2) {
    const dx = obj1.x - obj2.x;
    const dy = obj1.y - obj2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Check if object is within viewport bounds
   */
  isInViewport(object, viewport) {
    return (
      object.x >= viewport.x &&
      object.x <= viewport.x + viewport.width &&
      object.y >= viewport.y &&
      object.y <= viewport.y + viewport.height
    );
  }

  /**
   * Clear relevancy cache (call periodically to prevent memory leaks)
   */
  clearCache() {
    const now = Date.now();
    for (const [key, value] of this.scoreCache.entries()) {
      if (now - value.timestamp > this.CACHE_DURATION * 10) {
        this.scoreCache.delete(key);
      }
    }
  }

  /**
   * Get relevancy statistics for debugging
   */
  getStats() {
    return {
      cacheSize: this.scoreCache.size,
      lastCacheUpdate: this.lastCacheUpdate,
      weights: this.weights
    };
  }

  /**
   * Update scoring weights dynamically
   */
  updateWeights(objectType, newWeights) {
    if (this.weights[objectType]) {
      this.weights[objectType] = { ...this.weights[objectType], ...newWeights };
      console.log(`📊 RSA: Updated weights for ${objectType}:`, this.weights[objectType]);
    }
  }
}

module.exports = RelevancyAgent;