/**
 * Message Prioritization System
 * Prioritizes critical game messages over non-critical ones
 * Ensures smooth gameplay under high network load
 */

class MessagePrioritization {
  constructor() {
    this.messageQueues = new Map(); // Per-player message queues
    this.priorityLevels = {
      CRITICAL: 0,    // Player death, collisions, immediate game state changes
      HIGH: 1,        // Player movement, food consumption, score updates
      MEDIUM: 2,      // Other player updates, leaderboard changes
      LOW: 3,         // Background updates, statistics
      BACKGROUND: 4   // Non-essential data, analytics
    };
    
    this.messageTypes = {
      // Critical messages - must be sent immediately
      'playerDied': this.priorityLevels.CRITICAL,
      'collision': this.priorityLevels.CRITICAL,
      'gameOver': this.priorityLevels.CRITICAL,
      'playerRespawn': this.priorityLevels.CRITICAL,
      
      // High priority - important for gameplay
      'playerMoved': this.priorityLevels.HIGH,
      'foodEaten': this.priorityLevels.HIGH,
      'scoreUpdate': this.priorityLevels.HIGH,
      'playerJoined': this.priorityLevels.HIGH,
      
      // Medium priority - visible but not critical
      'gameStateUpdate': this.priorityLevels.MEDIUM,
      'leaderboardUpdate': this.priorityLevels.MEDIUM,
      'playerLeft': this.priorityLevels.MEDIUM,
      
      // Low priority - background updates
      'viewportUpdate': this.priorityLevels.LOW,
      'statsUpdate': this.priorityLevels.LOW,
      
      // Background - analytics and non-essential
      'analytics': this.priorityLevels.BACKGROUND,
      'debug': this.priorityLevels.BACKGROUND
    };
    
    this.queueLimits = {
      [this.priorityLevels.CRITICAL]: 50,    // Never drop critical messages
      [this.priorityLevels.HIGH]: 30,       // High capacity for important messages
      [this.priorityLevels.MEDIUM]: 20,     // Moderate capacity
      [this.priorityLevels.LOW]: 10,        // Lower capacity
      [this.priorityLevels.BACKGROUND]: 5   // Minimal capacity
    };
    
    this.processingInterval = null;
    this.processingRate = 16; // Process queues every 16ms (60 FPS)
    this.stats = {
      messagesQueued: 0,
      messagesProcessed: 0,
      messagesDropped: 0,
      averageQueueSize: 0
    };
  }

  /**
   * Start message processing system
   */
  start() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    
    this.processingInterval = setInterval(() => {
      this.processMessageQueues();
    }, this.processingRate);
    
    console.log('📨 Message Prioritization System started');
  }

  /**
   * Stop message processing system
   */
  stop() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    
    console.log('📨 Message Prioritization System stopped');
  }

  /**
   * Queue a message for a player
   */
  queueMessage(playerId, messageType, data, socketId) {
    const priority = this.getMessagePriority(messageType);
    
    // Critical messages bypass queue and send immediately
    if (priority === this.priorityLevels.CRITICAL) {
      this.sendMessageDirectly(socketId, messageType, data);
      return true;
    }
    
    // Get or create player queue
    let playerQueue = this.messageQueues.get(playerId);
    if (!playerQueue) {
      playerQueue = {
        [this.priorityLevels.HIGH]: [],
        [this.priorityLevels.MEDIUM]: [],
        [this.priorityLevels.LOW]: [],
        [this.priorityLevels.BACKGROUND]: [],
        socketId: socketId,
        lastProcessed: Date.now()
      };
      this.messageQueues.set(playerId, playerQueue);
    }
    
    // Update socket ID in case it changed
    playerQueue.socketId = socketId;
    
    // Check queue limit for this priority level
    const queue = playerQueue[priority];
    const limit = this.queueLimits[priority];
    
    if (queue.length >= limit) {
      // Queue full - drop oldest message of same priority
      const dropped = queue.shift();
      this.stats.messagesDropped++;
      console.warn(`📨 Dropped message for player ${playerId}: ${dropped.type}`);
    }
    
    // Add message to appropriate priority queue
    queue.push({
      type: messageType,
      data: data,
      timestamp: Date.now(),
      priority: priority
    });
    
    this.stats.messagesQueued++;
    return true;
  }

  /**
   * Get message priority level
   */
  getMessagePriority(messageType) {
    return this.messageTypes[messageType] || this.priorityLevels.MEDIUM;
  }

  /**
   * Process all player message queues
   */
  processMessageQueues() {
    const now = Date.now();
    
    for (const [playerId, playerQueue] of this.messageQueues) {
      this.processPlayerQueue(playerId, playerQueue, now);
    }
    
    // Update average queue size
    this.updateQueueStats();
  }

  /**
   * Process messages for a single player
   */
  processPlayerQueue(playerId, playerQueue, currentTime) {
    const timeSinceLastProcess = currentTime - playerQueue.lastProcessed;
    
    // Adaptive processing rate based on queue size and player activity
    let messagesToProcess = this.calculateProcessingRate(playerQueue, timeSinceLastProcess);
    
    // Process messages in priority order
    const priorities = [this.priorityLevels.HIGH, this.priorityLevels.MEDIUM, this.priorityLevels.LOW, this.priorityLevels.BACKGROUND];
    
    for (const priority of priorities) {
      if (messagesToProcess <= 0) break;
      
      const queue = playerQueue[priority];
      while (queue.length > 0 && messagesToProcess > 0) {
        const message = queue.shift();
        this.sendMessageDirectly(playerQueue.socketId, message.type, message.data);
        this.stats.messagesProcessed++;
        messagesToProcess--;
      }
    }
    
    playerQueue.lastProcessed = currentTime;
  }

  /**
   * Calculate how many messages to process for a player
   */
  calculateProcessingRate(playerQueue, timeSinceLastProcess) {
    // Base rate: 1 message per 16ms (60 FPS)
    let baseRate = Math.max(1, Math.floor(timeSinceLastProcess / 16));
    
    // Calculate total queue size
    const totalQueueSize = Object.values(playerQueue)
      .filter(Array.isArray)
      .reduce((sum, queue) => sum + queue.length, 0);
    
    // Increase rate if queue is backing up
    if (totalQueueSize > 10) {
      baseRate = Math.min(baseRate * 2, 5); // Max 5 messages per cycle
    }
    
    // Decrease rate if queue is small
    if (totalQueueSize < 3) {
      baseRate = Math.max(1, Math.floor(baseRate / 2));
    }
    
    return baseRate;
  }

  /**
   * Send message directly (bypass queue)
   */
  sendMessageDirectly(socketId, messageType, data) {
    if (global.io && socketId) {
      global.io.to(socketId).emit(messageType, data);
    }
  }

  /**
   * Remove player from message system
   */
  removePlayer(playerId) {
    this.messageQueues.delete(playerId);
  }

  /**
   * Update queue statistics
   */
  updateQueueStats() {
    let totalQueueSize = 0;
    let playerCount = 0;
    
    for (const playerQueue of this.messageQueues.values()) {
      const queueSize = Object.values(playerQueue)
        .filter(Array.isArray)
        .reduce((sum, queue) => sum + queue.length, 0);
      
      totalQueueSize += queueSize;
      playerCount++;
    }
    
    this.stats.averageQueueSize = playerCount > 0 ? totalQueueSize / playerCount : 0;
  }

  /**
   * Get system statistics
   */
  getStats() {
    const queueSizes = {};
    let totalMessages = 0;
    
    for (const [playerId, playerQueue] of this.messageQueues) {
      const playerTotal = Object.values(playerQueue)
        .filter(Array.isArray)
        .reduce((sum, queue) => sum + queue.length, 0);
      
      queueSizes[playerId] = playerTotal;
      totalMessages += playerTotal;
    }
    
    return {
      ...this.stats,
      totalQueuedMessages: totalMessages,
      activePlayerQueues: this.messageQueues.size,
      queueSizes: queueSizes,
      processingRate: this.processingRate
    };
  }

  /**
   * Clear all queues (emergency cleanup)
   */
  clearAllQueues() {
    this.messageQueues.clear();
    console.log('📨 All message queues cleared');
  }

  /**
   * Adjust processing rate dynamically
   */
  adjustProcessingRate(newRate) {
    if (newRate >= 8 && newRate <= 100) {
      this.processingRate = newRate;
      
      // Restart with new rate
      if (this.processingInterval) {
        this.stop();
        this.start();
      }
      
      console.log(`📨 Processing rate adjusted to ${newRate}ms`);
    }
  }

  /**
   * Get queue status for a specific player
   */
  getPlayerQueueStatus(playerId) {
    const playerQueue = this.messageQueues.get(playerId);
    if (!playerQueue) return null;
    
    return {
      high: playerQueue[this.priorityLevels.HIGH].length,
      medium: playerQueue[this.priorityLevels.MEDIUM].length,
      low: playerQueue[this.priorityLevels.LOW].length,
      background: playerQueue[this.priorityLevels.BACKGROUND].length,
      total: Object.values(playerQueue)
        .filter(Array.isArray)
        .reduce((sum, queue) => sum + queue.length, 0)
    };
  }
}

module.exports = { MessagePrioritization };