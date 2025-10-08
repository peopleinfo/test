/**
 * Position utility functions for server-side bandwidth optimization
 */

function round(val, decimals = 2) {
  const newVal= +val.toFixed(decimals);
  // console.log(`Rounding ${val} to ==== >  ${newVal}`);
  return newVal;
}

/**
 * Round position coordinates to reduce bandwidth usage
 * @param {Object} obj - Object with x, y coordinates
 * @param {number} decimals - Number of decimal places (default: 1)
 * @returns {Object} - Object with rounded coordinates
 */
function roundPos(obj, decimals = 2) {
  if (!obj || typeof obj !== "object") return obj;

  if (typeof obj.x === "number") {
    obj.x = +obj.x.toFixed(decimals);
  }
  if (typeof obj.y === "number") {
    obj.y = +obj.y.toFixed(decimals);
  }
  return obj;
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
  if (typeof data === "number") {
    return round(data, decimals);
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map((item) => roundData(item, decimals));
  }

  // Handle objects
  if (typeof data === "object") {
    // Skip special object types (Set, Map, Date, WeakMap, WeakSet, etc.)
    const constructor = data.constructor;
    if (constructor && constructor !== Object && constructor !== Array) {
      return data;
    }

    // Check if object has special methods that indicate it's not a plain data object
    if (
      typeof data.add === "function" ||
      typeof data.delete === "function" ||
      (typeof data.get === "function" && typeof data.set === "function")
    ) {
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

module.exports = {
  roundPos,
  round,
  roundData,
};
