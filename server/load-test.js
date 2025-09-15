/**
 * Load Testing Script for Snake Zone Server
 * Simulates 20-30 concurrent players to identify bottlenecks
 * and validate ping stability improvements
 */

const io = require('socket.io-client');
const axios = require('axios');

class LoadTester {
  constructor(serverUrl = 'http://localhost:9000', targetPlayers = 25) {
    this.serverUrl = serverUrl;
    this.targetPlayers = targetPlayers;
    this.clients = [];
    this.metrics = {
      connections: 0,
      disconnections: 0,
      totalMessages: 0,
      totalLatency: 0,
      errors: 0,
      startTime: null,
      endTime: null
    };
    this.isRunning = false;
    this.testDuration = 300000; // 5 minutes
    this.pingInterval = 2000; // Ping every 2 seconds
  }

  /**
   * Start the load test
   */
  async startTest() {
    console.log(`🚀 Starting load test with ${this.targetPlayers} simulated players`);
    console.log(`📊 Target server: ${this.serverUrl}`);
    console.log(`⏱️ Test duration: ${this.testDuration / 1000} seconds`);
    
    this.metrics.startTime = Date.now();
    this.isRunning = true;

    // Create simulated players
    for (let i = 0; i < this.targetPlayers; i++) {
      setTimeout(() => {
        if (this.isRunning) {
          this.createSimulatedPlayer(i);
        }
      }, i * 200); // Stagger connections every 200ms
    }

    // Monitor network diagnostics
    this.startNetworkMonitoring();

    // Stop test after duration
    setTimeout(() => {
      this.stopTest();
    }, this.testDuration);
  }

  /**
   * Create a simulated player client
   */
  createSimulatedPlayer(playerId) {
    const client = {
      id: playerId,
      socket: null,
      connected: false,
      latencyHistory: [],
      messageCount: 0,
      errorCount: 0,
      lastPing: null,
      position: { x: Math.random() * 1200, y: Math.random() * 800 },
      direction: Math.random() * Math.PI * 2,
      speed: 2 + Math.random() * 3
    };

    // Connect to server
    client.socket = io(this.serverUrl, {
      transports: ['websocket', 'polling'],
      timeout: 10000,
      forceNew: true,
      auth: {
        token: `test-token-${playerId}-${Date.now()}`
      }
    });

    // Connection events
    client.socket.on('connect', () => {
      console.log(`✅ Player ${playerId} connected`);
      client.connected = true;
      this.metrics.connections++;
      
      // Initialize game
      client.socket.emit('gameInit', {
        userName: `TestPlayer${playerId}`,
        userAgent: 'LoadTester/1.0'
      });
      
      // Start player simulation
      this.startPlayerSimulation(client);
    });

    client.socket.on('disconnect', (reason) => {
      console.log(`❌ Player ${playerId} disconnected: ${reason}`);
      client.connected = false;
      this.metrics.disconnections++;
    });

    client.socket.on('connect_error', (error) => {
      console.error(`🔴 Player ${playerId} connection error:`, error.message);
      client.errorCount++;
      this.metrics.errors++;
    });

    // Game events
    client.socket.on('gameState', (data) => {
      client.messageCount++;
      this.metrics.totalMessages++;
    });

    client.socket.on('pong', (timestamp) => {
      if (client.lastPing) {
        const latency = Date.now() - client.lastPing;
        client.latencyHistory.push(latency);
        this.metrics.totalLatency += latency;
        
        // Keep only last 10 latency measurements
        if (client.latencyHistory.length > 10) {
          client.latencyHistory.shift();
        }
      }
    });

    this.clients.push(client);
  }

  /**
   * Start simulating player behavior
   */
  startPlayerSimulation(client) {
    // Send ping periodically
    const pingInterval = setInterval(() => {
      if (client.connected && this.isRunning) {
        client.lastPing = Date.now();
        client.socket.emit('ping', client.lastPing);
      } else {
        clearInterval(pingInterval);
      }
    }, this.pingInterval);

    // Simulate player movement
    const moveInterval = setInterval(() => {
      if (client.connected && this.isRunning) {
        // Update position
        client.position.x += Math.cos(client.direction) * client.speed;
        client.position.y += Math.sin(client.direction) * client.speed;
        
        // Bounce off walls
        if (client.position.x < 0 || client.position.x > 1200) {
          client.direction = Math.PI - client.direction;
        }
        if (client.position.y < 0 || client.position.y > 800) {
          client.direction = -client.direction;
        }
        
        // Clamp position
        client.position.x = Math.max(0, Math.min(1200, client.position.x));
        client.position.y = Math.max(0, Math.min(800, client.position.y));
        
        // Occasionally change direction
        if (Math.random() < 0.1) {
          client.direction += (Math.random() - 0.5) * 0.5;
        }
        
        // Send movement
        client.socket.emit('playerMove', {
          x: client.position.x,
          y: client.position.y,
          direction: client.direction
        });
      } else {
        clearInterval(moveInterval);
      }
    }, 50); // 20 FPS movement
  }

  /**
   * Monitor network diagnostics during test
   */
  startNetworkMonitoring() {
    const monitorInterval = setInterval(async () => {
      if (!this.isRunning) {
        clearInterval(monitorInterval);
        return;
      }

      try {
        const response = await axios.get(`${this.serverUrl}/api/network-diagnostics`);
        const diagnostics = response.data;
        
        console.log('\n📊 Network Diagnostics:');
        console.log(`   Players: ${diagnostics.players.total} (${diagnostics.players.human} human, ${diagnostics.players.bots} bots)`);
        console.log(`   Avg Latency: ${diagnostics.network.averageLatency}ms`);
        console.log(`   Message Rate: ${diagnostics.network.messageRate}/sec`);
        console.log(`   Error Rate: ${diagnostics.network.errorRate}%`);
        console.log(`   Memory: ${diagnostics.server.memory.heapUsed}MB / ${diagnostics.server.memory.heapTotal}MB`);
        console.log(`   Update Rate: ${diagnostics.game.updateInterval}ms`);
        
        if (diagnostics.connectionQuality.averageLatency > 0) {
          console.log(`   Connection Quality: ${diagnostics.connectionQuality.averageLatency}ms avg, ${diagnostics.connectionQuality.averagePacketLoss}% loss`);
        }
        
        // Check for performance issues
        if (diagnostics.network.averageLatency > 100) {
          console.log('⚠️  High latency detected!');
        }
        if (diagnostics.network.errorRate > 5) {
          console.log('⚠️  High error rate detected!');
        }
        if (diagnostics.server.memory.heapUsed > 500) {
          console.log('⚠️  High memory usage detected!');
        }
        
      } catch (error) {
        console.error('❌ Failed to fetch diagnostics:', error.message);
      }
    }, 10000); // Monitor every 10 seconds
  }

  /**
   * Stop the load test and generate report
   */
  stopTest() {
    console.log('\n🛑 Stopping load test...');
    this.isRunning = false;
    this.metrics.endTime = Date.now();

    // Disconnect all clients
    this.clients.forEach(client => {
      if (client.socket && client.connected) {
        client.socket.disconnect();
      }
    });

    // Generate final report
    setTimeout(() => {
      this.generateReport();
    }, 2000);
  }

  /**
   * Generate test report
   */
  async generateReport() {
    const testDuration = (this.metrics.endTime - this.metrics.startTime) / 1000;
    const connectedClients = this.clients.filter(c => c.connected).length;
    const avgLatency = this.metrics.totalLatency / (this.metrics.totalMessages || 1);
    
    console.log('\n📋 LOAD TEST REPORT');
    console.log('='.repeat(50));
    console.log(`Test Duration: ${testDuration.toFixed(1)} seconds`);
    console.log(`Target Players: ${this.targetPlayers}`);
    console.log(`Successful Connections: ${this.metrics.connections}`);
    console.log(`Active Connections: ${connectedClients}`);
    console.log(`Disconnections: ${this.metrics.disconnections}`);
    console.log(`Total Messages: ${this.metrics.totalMessages}`);
    console.log(`Average Latency: ${avgLatency.toFixed(2)}ms`);
    console.log(`Total Errors: ${this.metrics.errors}`);
    console.log(`Messages/Second: ${(this.metrics.totalMessages / testDuration).toFixed(2)}`);
    
    // Client-specific stats
    console.log('\n👥 Client Statistics:');
    this.clients.forEach(client => {
      const avgClientLatency = client.latencyHistory.length > 0 
        ? client.latencyHistory.reduce((a, b) => a + b, 0) / client.latencyHistory.length 
        : 0;
      
      console.log(`   Player ${client.id}: ${client.messageCount} msgs, ${avgClientLatency.toFixed(1)}ms avg latency, ${client.errorCount} errors`);
    });
    
    // Performance assessment
    console.log('\n🎯 Performance Assessment:');
    if (avgLatency < 50) {
      console.log('✅ Excellent latency performance');
    } else if (avgLatency < 100) {
      console.log('✅ Good latency performance');
    } else {
      console.log('⚠️  High latency - optimization needed');
    }
    
    if (this.metrics.errors / this.metrics.totalMessages < 0.01) {
      console.log('✅ Low error rate');
    } else {
      console.log('⚠️  High error rate - stability issues detected');
    }
    
    if (connectedClients >= this.targetPlayers * 0.9) {
      console.log('✅ Good connection stability');
    } else {
      console.log('⚠️  Connection stability issues');
    }
    
    // Final server diagnostics
    try {
      const response = await axios.get(`${this.serverUrl}/api/network-diagnostics`);
      const finalDiagnostics = response.data;
      
      console.log('\n🔍 Final Server State:');
      console.log(`   Memory Usage: ${finalDiagnostics.server.memory.heapUsed}MB`);
      console.log(`   Active Players: ${finalDiagnostics.players.total}`);
      console.log(`   Server Uptime: ${finalDiagnostics.server.uptime}s`);
      
    } catch (error) {
      console.error('❌ Failed to get final diagnostics:', error.message);
    }
    
    console.log('\n✅ Load test completed!');
    process.exit(0);
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const serverUrl = args[0] || 'http://localhost:9000';
  const playerCount = parseInt(args[1]) || 25;
  
  console.log('🧪 Snake Zone Load Tester');
  console.log(`Server: ${serverUrl}`);
  console.log(`Players: ${playerCount}`);
  
  const tester = new LoadTester(serverUrl, playerCount);
  tester.startTest();
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, stopping test...');
    tester.stopTest();
  });
}

module.exports = LoadTester;