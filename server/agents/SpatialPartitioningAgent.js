/**
 * Spatial Partitioning Agent (SPA)
 * Divides game world into grid sectors for efficient O(1) spatial lookups
 * Enables fast culling of game objects based on viewport bounds
 */

class SpatialPartitioningAgent {
  constructor(worldWidth, worldHeight, gridSize = 100) {
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.gridSize = gridSize;
    this.cols = Math.ceil(worldWidth / gridSize);
    this.rows = Math.ceil(worldHeight / gridSize);
    
    // Initialize spatial grid
    this.grid = new Map();
    this.objectToCell = new Map(); // Track which cell each object is in
    
    console.log(`🗂️ Spatial Partitioning Agent initialized: ${this.cols}x${this.rows} grid (${gridSize}px cells)`);
  }

  /**
   * Get grid cell key for coordinates
   */
  getCellKey(x, y) {
    const col = Math.floor(Math.max(0, Math.min(x, this.worldWidth - 1)) / this.gridSize);
    const row = Math.floor(Math.max(0, Math.min(y, this.worldHeight - 1)) / this.gridSize);
    return `${col},${row}`;
  }

  /**
   * Get all cell keys that intersect with a bounding box
   */
  getCellsInBounds(x, y, width, height) {
    const startCol = Math.floor(Math.max(0, x) / this.gridSize);
    const endCol = Math.floor(Math.min(this.worldWidth - 1, x + width) / this.gridSize);
    const startRow = Math.floor(Math.max(0, y) / this.gridSize);
    const endRow = Math.floor(Math.min(this.worldHeight - 1, y + height) / this.gridSize);
    
    const cells = [];
    for (let col = startCol; col <= endCol; col++) {
      for (let row = startRow; row <= endRow; row++) {
        cells.push(`${col},${row}`);
      }
    }
    return cells;
  }

  /**
   * Add object to spatial grid
   */
  addObject(objectId, x, y, objectType = 'generic', data = null) {
    const cellKey = this.getCellKey(x, y);
    
    // Remove from previous cell if exists
    this.removeObject(objectId);
    
    // Add to new cell
    if (!this.grid.has(cellKey)) {
      this.grid.set(cellKey, new Map());
    }
    
    this.grid.get(cellKey).set(objectId, {
      id: objectId,
      x,
      y,
      type: objectType,
      data,
      timestamp: Date.now()
    });
    
    // Track object's current cell
    this.objectToCell.set(objectId, cellKey);
  }

  /**
   * Remove object from spatial grid
   */
  removeObject(objectId) {
    const currentCell = this.objectToCell.get(objectId);
    if (currentCell && this.grid.has(currentCell)) {
      this.grid.get(currentCell).delete(objectId);
      
      // Clean up empty cells
      if (this.grid.get(currentCell).size === 0) {
        this.grid.delete(currentCell);
      }
    }
    this.objectToCell.delete(objectId);
  }

  /**
   * Update object position in spatial grid
   */
  updateObject(objectId, x, y, data = null) {
    const newCellKey = this.getCellKey(x, y);
    const currentCell = this.objectToCell.get(objectId);
    
    // If object moved to different cell, relocate it
    if (currentCell !== newCellKey) {
      // Get existing data
      let existingData = null;
      let objectType = 'generic';
      
      if (currentCell && this.grid.has(currentCell)) {
        const cellObjects = this.grid.get(currentCell);
        if (cellObjects.has(objectId)) {
          const obj = cellObjects.get(objectId);
          existingData = obj.data;
          objectType = obj.type;
        }
      }
      
      // Remove from old cell and add to new cell
      this.removeObject(objectId);
      this.addObject(objectId, x, y, objectType, data || existingData);
    } else if (currentCell && this.grid.has(currentCell)) {
      // Update data in same cell
      const cellObjects = this.grid.get(currentCell);
      if (cellObjects.has(objectId)) {
        const obj = cellObjects.get(objectId);
        obj.x = x;
        obj.y = y;
        if (data !== null) obj.data = data;
        obj.timestamp = Date.now();
      }
    }
  }

  /**
   * Get all objects within viewport bounds
   */
  getObjectsInViewport(viewportX, viewportY, viewportWidth, viewportHeight, objectTypes = null) {
    const cells = this.getCellsInBounds(viewportX, viewportY, viewportWidth, viewportHeight);
    const objects = [];
    const seenObjects = new Set();
    
    for (const cellKey of cells) {
      if (this.grid.has(cellKey)) {
        const cellObjects = this.grid.get(cellKey);
        
        for (const [objectId, obj] of cellObjects) {
          // Avoid duplicates (objects can span multiple cells)
          if (seenObjects.has(objectId)) continue;
          seenObjects.add(objectId);
          
          // Filter by object type if specified
          if (objectTypes && !objectTypes.includes(obj.type)) continue;
          
          // Check if object actually intersects viewport (more precise than cell-based)
          if (this.isInViewport(obj.x, obj.y, viewportX, viewportY, viewportWidth, viewportHeight)) {
            objects.push(obj);
          }
        }
      }
    }
    
    return objects;
  }

  /**
   * Check if point is within viewport bounds
   */
  isInViewport(x, y, viewportX, viewportY, viewportWidth, viewportHeight, radius = 0) {
    return (
      x + radius >= viewportX &&
      x - radius <= viewportX + viewportWidth &&
      y + radius >= viewportY &&
      y - radius <= viewportY + viewportHeight
    );
  }

  /**
   * Get objects near a point (for collision detection)
   */
  getObjectsNear(x, y, radius, objectTypes = null) {
    const viewportX = x - radius;
    const viewportY = y - radius;
    const viewportWidth = radius * 2;
    const viewportHeight = radius * 2;
    
    return this.getObjectsInViewport(viewportX, viewportY, viewportWidth, viewportHeight, objectTypes)
      .filter(obj => {
        const distance = Math.sqrt(Math.pow(obj.x - x, 2) + Math.pow(obj.y - y, 2));
        return distance <= radius;
      });
  }

  /**
   * Get all objects of specific type
   */
  getObjectsByType(objectType) {
    const objects = [];
    
    for (const [cellKey, cellObjects] of this.grid) {
      for (const [objectId, obj] of cellObjects) {
        if (obj.type === objectType) {
          objects.push(obj);
        }
      }
    }
    
    return objects;
  }

  /**
   * Get spatial grid statistics
   */
  getStats() {
    let totalObjects = 0;
    let occupiedCells = 0;
    const typeCount = {};
    
    for (const [cellKey, cellObjects] of this.grid) {
      occupiedCells++;
      totalObjects += cellObjects.size;
      
      for (const [objectId, obj] of cellObjects) {
        typeCount[obj.type] = (typeCount[obj.type] || 0) + 1;
      }
    }
    
    return {
      totalCells: this.cols * this.rows,
      occupiedCells,
      totalObjects,
      objectsByType: typeCount,
      gridSize: this.gridSize,
      worldDimensions: { width: this.worldWidth, height: this.worldHeight },
      efficiency: occupiedCells / (this.cols * this.rows)
    };
  }

  /**
   * Clear all objects from spatial grid
   */
  clear() {
    this.grid.clear();
    this.objectToCell.clear();
    // Removed console.log to reduce log spam
  }

  /**
   * Rebuild spatial grid (useful for optimization)
   */
  rebuild(objects) {
    this.clear();
    
    for (const obj of objects) {
      this.addObject(obj.id, obj.x, obj.y, obj.type, obj.data);
    }
    
    console.log(`🗂️ SPA: Spatial grid rebuilt with ${objects.length} objects`);
  }
}

module.exports = { SpatialPartitioningAgent };