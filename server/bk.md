// Safe spawn zones across the map - completely redesigned for proper distribution
function getSpawnZones() {
  const margin = 120; // Increased minimum distance from edges
  const zoneSize = 180; // Increased size of each spawn zone
  const zones = [];

  // Create 16 spawn zones distributed across the map in a 4x4 grid
  const cols = 4;
  const rows = 4;

  // Calculate available space for zones
  const availableWidth = gameState.worldWidth - 2 * margin;
  const availableHeight = gameState.worldHeight - 2 * margin;

  // Calculate spacing between zone centers
  const colSpacing = availableWidth / (cols - 1);
  const rowSpacing = availableHeight / (rows - 1);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Proper distribution calculation
      const x = margin + col * colSpacing;
      const y = margin + row * rowSpacing;

      // Add some randomization to prevent perfect grid alignment
      const randomOffsetX = (Math.random() - 0.5) * 40; // ±20px random offset
      const randomOffsetY = (Math.random() - 0.5) * 40; // ±20px random offset

      const finalX = Math.max(
        margin,
        Math.min(gameState.worldWidth - margin, x + randomOffsetX)
      );
      const finalY = Math.max(
        margin,
        Math.min(gameState.worldHeight - margin, y + randomOffsetY)
      );

      zones.push({ x: finalX, y: finalY, size: zoneSize });
    }
  }
  return zones;
}

// Check if position is safe (no collision with existing worms) - enhanced safety checks
function isPositionSafe(x, y, radius, minDistance = 200) {
  // Check boundaries with increased buffer for better safety
  const boundaryBuffer = 80;
  if (
    x < boundaryBuffer ||
    x > gameState.worldWidth - boundaryBuffer ||
    y < boundaryBuffer ||
    y > gameState.worldHeight - boundaryBuffer
  ) {
    // console.log(`❌ DEBUG: Position unsafe - too close to boundaries`);
    return false;
  }

  for (const [playerId, player] of gameState.players.entries()) {
    if (!player.alive) continue;

    // Check distance from player head with increased safety margin
    const distance = Math.hypot(x - player.x, y - player.y);
    const requiredDistance = minDistance + radius + player.radius;
    if (distance < requiredDistance) {
      // console.log(
      //   `❌ DEBUG: Position unsafe - too close to player ${playerId} head (distance: ${distance.toFixed(
      //     2
      //   )}, required: ${requiredDistance.toFixed(2)})`
      // );
      // return false;
    }

    // Check distance from player body points with enhanced safety
    for (const point of player.points) {
      const pointDistance = Math.hypot(x - point.x, y - point.y);
      const requiredPointDistance = minDistance + radius + point.radius;
      if (pointDistance < requiredPointDistance) {
        return false;
      }
    }
  }

  // Check distance from dead points to avoid spawning on food
  for (const deadPoint of gameState.deadPoints) {
    const deadDistance = Math.hypot(x - deadPoint.x, y - deadPoint.y);
    if (deadDistance < 40 + radius) {
      return false;
    }
  }

  // Check distance from food to avoid spawning in food clusters
  let nearbyFoodCount = 0;
  for (const food of gameState.foods) {
    const foodDistance = Math.hypot(x - food.x, y - food.y);
    if (foodDistance < 60) {
      nearbyFoodCount++;
      if (nearbyFoodCount >= 3) {
        return false;
      }
    }
  }

  // Additional safety check: ensure spawn direction is clear
  const testAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  let clearDirections = 0;
  for (const angle of testAngles) {
    const testDistance = 100;
    const testX = x + Math.cos(angle) * testDistance;
    const testY = y + Math.sin(angle) * testDistance;

    if (
      testX >= boundaryBuffer &&
      testX <= gameState.worldWidth - boundaryBuffer &&
      testY >= boundaryBuffer &&
      testY <= gameState.worldHeight - boundaryBuffer
    ) {
      let directionClear = true;
      for (const [playerId, player] of gameState.players.entries()) {
        if (!player.alive) continue;
        const distToPlayer = Math.hypot(testX - player.x, testY - player.y);
        if (distToPlayer < minDistance * 0.7) {
          directionClear = false;
          break;
        }
      }
      if (directionClear) clearDirections++;
    }
  }

  if (clearDirections < 2) {
    // console.log(
    //   `❌ DEBUG: Position unsafe - insufficient clear directions (${clearDirections}/4)`
    // );
    return false;
  }
  return true;
}

// Find safe spawn position - enhanced with better distribution and emergency fallback
function findSafeSpawnPosition(radius) {
  console.log(`🎯 DEBUG: Finding safe spawn position for radius ${radius}`);
  const spawnZones = getSpawnZones();
  const maxZoneAttempts = 50; // Increased per-zone attempts for better success rate
  const maxFallbackAttempts = 150; // Further increased fallback attempts
  const maxRetries = 3; // Multiple retry attempts with different strategies

  // Prioritize zones with fewer nearby players for better distribution
  const zonesWithPlayerCount = spawnZones.map((zone) => {
    const nearbyPlayers = getAlivePlayers().filter(
      (p) => Math.hypot(p.x - zone.x, p.y - zone.y) < 300
    ).length;
    return { zone, nearbyPlayers, index: spawnZones.indexOf(zone) };
  });

  // Sort zones by player count (fewer players = higher priority)
  zonesWithPlayerCount.sort((a, b) => a.nearbyPlayers - b.nearbyPlayers);

  // Try each zone in priority order
  for (const zoneData of zonesWithPlayerCount) {
    const { zone, index } = zoneData;

    for (let attempt = 0; attempt < maxZoneAttempts; attempt++) {
      // Random position within the zone with better distribution
      const offsetX = (Math.random() - 0.5) * zone.size * 0.8; // Use 80% of zone size
      const offsetY = (Math.random() - 0.5) * zone.size * 0.8;
      const x = zone.x + offsetX;
      const y = zone.y + offsetY;

      // Ensure position is within world bounds with proper margins
      const margin = 60;
      const clampedX = Math.max(
        margin,
        Math.min(gameState.worldWidth - margin, x)
      );
      const clampedY = Math.max(
        margin,
        Math.min(gameState.worldHeight - margin, y)
      );

      if (isPositionSafe(clampedX, clampedY, radius)) {
        return { x: clampedX, y: clampedY };
      }
    }
  }

  console.log(`⚠️ DEBUG: All zones failed, trying enhanced fallback positions`);
  // Enhanced fallback: try scattered positions across the entire map
  for (let attempt = 0; attempt < maxFallbackAttempts; attempt++) {
    const margin = 80;
    const x = margin + Math.random() * (gameState.worldWidth - 2 * margin);
    const y = margin + Math.random() * (gameState.worldHeight - 2 * margin);

    if (isPositionSafe(x, y, radius, 100)) {
      // Reduced safety distance for fallback
      return { x, y };
    }
  }

  // Strategy 1: Emergency scatter spawn with relaxed safety requirements
  for (let retry = 0; retry < maxRetries; retry++) {
    // console.log(`🔄 DEBUG: Emergency retry ${retry + 1}/${maxRetries}`);
    let bestPosition = null;
    let maxMinDistance = 0;
    const relaxedMinDistance = Math.max(50, 150 - retry * 30); // Gradually relax requirements

    for (let attempt = 0; attempt < 75; attempt++) {
      const margin = 120 - retry * 20; // Gradually reduce margin
      const x = margin + Math.random() * (gameState.worldWidth - 2 * margin);
      const y = margin + Math.random() * (gameState.worldHeight - 2 * margin);

      // Find minimum distance to any existing player
      let minDistance = Infinity;
      for (const player of gameState.players.values()) {
        if (!player.alive) continue;
        const distance = Math.hypot(x - player.x, y - player.y);
        minDistance = Math.min(minDistance, distance);
      }

      if (minDistance > maxMinDistance && minDistance >= relaxedMinDistance) {
        maxMinDistance = minDistance;
        bestPosition = { x, y };
      }
    }

    if (
      bestPosition &&
      isPositionSafe(bestPosition.x, bestPosition.y, radius, relaxedMinDistance)
    ) {
      return bestPosition;
    }
  }

  // Strategy 2: Grid-based systematic search
  console.log(`🔍 DEBUG: Trying systematic grid search`);
  const gridSize = 8;
  const stepX = (gameState.worldWidth - 200) / gridSize;
  const stepY = (gameState.worldHeight - 200) / gridSize;

  for (let gx = 0; gx < gridSize; gx++) {
    for (let gy = 0; gy < gridSize; gy++) {
      const x = 100 + gx * stepX + Math.random() * stepX * 0.5;
      const y = 100 + gy * stepY + Math.random() * stepY * 0.5;

      if (isPositionSafe(x, y, radius, 80)) {
        return { x, y };
      }
    }
  }

  console.log(`🚨 DEBUG: All methods failed, using safe edge position`);
  // Absolute last resort: safe edge position
  const edge = Math.floor(Math.random() * 4);
  const safeMargin = 100;
  const edgePosition = {
    0: {
      x: safeMargin,
      y: safeMargin + Math.random() * (gameState.worldHeight - 2 * safeMargin),
    },
    1: {
      x: gameState.worldWidth - safeMargin,
      y: safeMargin + Math.random() * (gameState.worldHeight - 2 * safeMargin),
    },
    2: {
      x: safeMargin + Math.random() * (gameState.worldWidth - 2 * safeMargin),
      y: safeMargin,
    },
    3: {
      x: safeMargin + Math.random() * (gameState.worldWidth - 2 * safeMargin),
      y: gameState.worldHeight - safeMargin,
    },
  }[edge];
  return edgePosition;
}

// Calculate safe spawn direction that avoids borders and obstacles
function calculateSafeSpawnDirection(x, y, radius) {
  const borderBuffer = 250; // Increased distance to avoid from borders
  const playerAvoidanceRadius = 180; // Distance to avoid other players
  const mapCenterX = gameState.worldWidth / 2;
  const mapCenterY = gameState.worldHeight / 2;

  // Calculate distances to each border
  const distToLeft = x;
  const distToRight = gameState.worldWidth - x;
  const distToTop = y;
  const distToBottom = gameState.worldHeight - y;

  // Find which borders are too close
  const tooCloseToLeft = distToLeft < borderBuffer;
  const tooCloseToRight = distToRight < borderBuffer;
  const tooCloseToTop = distToTop < borderBuffer;
  const tooCloseToBottom = distToBottom < borderBuffer;

  let safeAngles = [];

  // If not near any borders, prefer direction toward center with some randomness
  if (
    !tooCloseToLeft &&
    !tooCloseToRight &&
    !tooCloseToTop &&
    !tooCloseToBottom
  ) {
    const angleToCenter = Math.atan2(mapCenterY - y, mapCenterX - x);
    // Add some randomness around center direction (±60 degrees)
    const randomOffset = (Math.random() - 0.5) * (Math.PI / 3);
    return angleToCenter + randomOffset;
  }

  // Generate safe angle ranges avoiding problematic borders and players
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 12) {
    // More precise angle testing
    const testDistance = 200; // Increased distance to test in this direction
    const testX = x + Math.cos(angle) * testDistance;
    const testY = y + Math.sin(angle) * testDistance;

    // Check if this direction leads to safe territory (borders)
    const wouldHitBorder =
      testX < borderBuffer ||
      testX > gameState.worldWidth - borderBuffer ||
      testY < borderBuffer ||
      testY > gameState.worldHeight - borderBuffer;

    // Check if this direction would lead too close to other players
    let tooCloseToPlayer = false;
    for (const player of gameState.players.values()) {
      if (!player.alive) continue;
      const playerDistance = Math.hypot(testX - player.x, testY - player.y);
      if (playerDistance < playerAvoidanceRadius) {
        tooCloseToPlayer = true;
        break;
      }
    }

    if (!wouldHitBorder && !tooCloseToPlayer) {
      safeAngles.push(angle);
    }
  }

  // If we have safe angles, pick one randomly
  if (safeAngles.length > 0) {
    const baseAngle = safeAngles[Math.floor(Math.random() * safeAngles.length)];
    // Add small random variation (±15 degrees)
    const variation = (Math.random() - 0.5) * (Math.PI / 6);
    return baseAngle + variation;
  }

  // Fallback: point toward the most open direction
  const openDirections = [];
  if (
    distToLeft > distToRight &&
    distToLeft > distToTop &&
    distToLeft > distToBottom
  ) {
    openDirections.push(Math.PI); // Left
  }
  if (
    distToRight > distToLeft &&
    distToRight > distToTop &&
    distToRight > distToBottom
  ) {
    openDirections.push(0); // Right
  }
  if (
    distToTop > distToLeft &&
    distToTop > distToRight &&
    distToTop > distToBottom
  ) {
    openDirections.push(Math.PI * 1.5); // Up
  }
  if (
    distToBottom > distToLeft &&
    distToBottom > distToRight &&
    distToBottom > distToTop
  ) {
    openDirections.push(Math.PI * 0.5); // Down
  }

  if (openDirections.length > 0) {
    const baseDirection =
      openDirections[Math.floor(Math.random() * openDirections.length)];
    const variation = (Math.random() - 0.5) * (Math.PI / 4); // ±45 degrees
    return baseDirection + variation;
  }

  return Math.random() * Math.PI * 2;
}