
function round(val, decimals = 1) {
    return +val.toFixed(decimals);
  }
  /**
   * Round player data including position and points
   * @param {Object} player - Player object
   * @param {number} decimals - Number of decimal places (default: 1)
   * @returns {Object} - Player with rounded coordinates
   */
  function roundData(data, decimals = 2) {
    // Handle null or undefined
    if (data == null) {
      return data;
    }
    
    // Handle numbers
    if (typeof data === 'number') {
      return round(data, decimals);
    }
    
    // Handle arrays
    if (Array.isArray(data)) {
      return data.map(item => roundData(item, decimals));
    }
    
    // Handle objects
    if (typeof data === 'object') {
      // Skip special object types (Set, Map, Date, WeakMap, WeakSet, etc.)
      const constructor = data.constructor;
      if (constructor && constructor !== Object && constructor !== Array) {
        return data;
      }
      
      // Check if object has special methods that indicate it's not a plain data object
      if (typeof data.add === 'function' || 
          typeof data.delete === 'function' ||
          typeof data.get === 'function' && typeof data.set === 'function') {
        return data;
      }
      
      // Only process plain objects
      const result = {};
      for (const key in data) {
        if (data.hasOwnProperty(key)) {
          result[key] = roundData(data[key], decimals);
        }
      }
      return result;
    }
    
    // Return all other types as-is (strings, booleans, etc.)
    return data;
  }

  const data = 
  {
    "id": "bot-574zmt2zx",
    "socketId": null,
    "x": 1027.25,
    "y": 159.3300018310547,
    "points": [
        {
            "x": 1027.25,
            "y": 159.3300018310547,
            "radius": 4,
            "color": "orange",
            "type": "apple"
        },
        {
            "x": 1025.25,
            "y": 159.3300018310547,
            "radius": 4,
            "color": "orange",
            "type": "apple"
        },
        {
            "x": 1023.25,
            "y": 159.3300018310547,
            "radius": 4,
            "color": "orange",
            "type": "cherry"
        },
        {
            "x": 1021.25,
            "y": 159.3300018310547,
            "radius": 4,
            "color": "orange",
            "type": "apple"
        },
        {
            "x": 1019.25,
            "y": 159.3300018310547,
            "radius": 4,
            "color": "orange",
            "type": "orange"
        },
        {
            "x": 1017.25,
            "y": 159.3300018310547,
            "radius": 4,
            "color": "orange",
            "type": "cherry"
        },
        {
            "x": 1015.25,
            "y": 159.3300018310547,
            "radius": 4,
            "color": "orange",
            "type": "grapes"
        },
        {
            "x": 1013.25,
            "y": 159.3300018310547,
            "radius": 4,
            "color": "orange",
            "type": "orange"
        },
        {
            "x": 1011.25,
            "y": 159.3300018310547,
            "radius": 4,
            "color": "orange",
            "type": "watermelon"
        },
        {
            "x": 1009.25,
            "y": 159.3300018310547,
            "radius": 4,
            "color": "orange",
            "type": "apple"
        },
        {
            "x": 1007.25,
            "y": 159.3300018310547,
            "radius": 4,
            "color": "orange",
            "type": "grapes"
        },
        {
            "x": 1005.25,
            "y": 159.3300018310547,
            "radius": 4,
            "color": "orange",
            "type": "apple"
        },
        {
            "x": 1003.25,
            "y": 159.3300018310547,
            "radius": 4,
            "color": "orange",
            "type": "grapes"
        },
        {
            "x": 1001.25,
            "y": 159.3300018310547,
            "radius": 4,
            "color": "orange",
            "type": "orange"
        },
        {
            "x": 999.25,
            "y": 159.3300018310547,
            "radius": 4,
            "color": "orange",
            "type": "orange"
        },
        {
            "x": 997.25,
            "y": 159.3300018310547,
            "radius": 4,
            "color": "orange",
            "type": "cherry"
        },
        {
            "x": 995.25,
            "y": 159.3300018310547,
            "radius": 4,
            "color": "orange",
            "type": "apple"
        },
        {
            "x": 993.25,
            "y": 159.3300018310547,
            "radius": 4,
            "color": "orange",
            "type": "watermelon"
        },
        {
            "x": 991.25,
            "y": 159.3300018310547,
            "radius": 4,
            "color": "orange",
            "type": "orange"
        },
        {
            "x": 989.25,
            "y": 159.3300018310547,
            "radius": 4,
            "color": "orange",
            "type": "orange"
        }
    ],
    "angle": 1.840000033378601,
    "radius": 4,
    "speed": 1.5,
    "color": "orange",
    "score": 3,
    "alive": true,
    "isBot": true,
    "spawnProtection": true,
    "spawnTime": 1759893656473,
    "lastDirectionChange": 1759893656473,
    "straightMovementDuration": 6102.68994140625,
    "personality": "explorer",
    "explorationRadius": 36.290000915527344,
    "currentSector": null,
    "visitedSectors": {},
    "lastSectorChange": 1759893656473,
    "movementPattern": "straight",
    "patternStartTime": 1759893656473,
    "patternDuration": 4110.43017578125,
    "momentum": {
        "x": 0,
        "y": 0
    },
    "wanderTarget": null,
    "lastWanderTime": 1759893656473
}
console.log(roundData(data));