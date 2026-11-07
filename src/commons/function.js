function jsonSafeParse(obj) {
  if (typeof obj === "string") {
    const trimmed = obj.trim();
    // Only parse strings that represent JSON objects {...} or JSON arrays [...]
    // Plain text scalars ("12345", "true", "null", "hello") must remain strings.
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        // Pre-process: find numeric literals in the JSON that would lose precision.
        const safed = trimmed.replace(
          /* eslint-disable-next-line security/detect-unsafe-regex */
          /([:[,]\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=[,\s\]}])/g,
          (_match, prefix, num) => {
            return prefix + (wouldLosePrecision(num) ? '"' + num + '"' : num);
          },
        );
        return JSON.parse(safed);
      } catch {
        // Fallback to standard reviver if regex transformation fails
        try {
          return JSON.parse(trimmed, (key, value) => {
            if (
              typeof value === "number" &&
              !Number.isSafeInteger(value) &&
              !isSmallFloat(value)
            ) {
              return value.toString();
            }
            return value;
          });
        } catch {
          // Fallback to original object if parsing fails
          return obj;
        }
      }
    }
    return obj;
  } else if (typeof obj === "object" && obj !== null) {
    for (const i in obj) {
      obj[i] = jsonSafeParse(obj[i]);
    }
    return obj;
  } else {
    return obj;
  }
}

/**
 * Check if a numeric string would lose precision when parsed as a JS number.
 */
function wouldLosePrecision(numStr) {
  // Remove sign
  const abs = numStr.replace(/^-/, "");

  // Handle scientific notation
  if (/[eE]/.test(abs)) {
    const num = Number(numStr);
    // If re-stringifying doesn't match, precision was lost
    return num.toString() !== numStr && String(+numStr) !== numStr;
  }

  // Split integer and decimal parts
  const parts = abs.split(".");
  const intPart = parts[0] || "0";
  const decPart = parts[1] || "";

  // Count significant digits (strip leading zeros from integer, trailing zeros from decimal)
  const sigDigits =
    (intPart === "0" ? "" : intPart).replace(/^0+/, "") + decPart;
  const significantCount = sigDigits.replace(/^0+/, "").length;

  // JS can represent ~15-17 significant digits accurately for most values.
  // For integers specifically, anything <= MAX_SAFE_INTEGER is fine regardless of digit count.
  if (significantCount > 16) return true;

  // For integers, also check against MAX_SAFE_INTEGER
  if (!decPart) {
    const n = Number(numStr);
    if (!Number.isSafeInteger(n)) return true;
  }

  // Round-trip check: parse and re-stringify
  const n = Number(numStr);
  if (String(n) !== numStr && n.toString() !== numStr) {
    // Could be trailing zeros in decimal (e.g., "1.50") — that's not precision loss
    return !(decPart && Number(numStr) === parseFloat(numStr));
  }

  return false;
}

/**
 * Check if a float is small enough that toString() preserves it.
 * Floats within normal range with <= 15 significant digits are fine.
 */
function isSmallFloat(value) {
  if (!Number.isFinite(value)) return false;
  if (Number.isInteger(value)) return Number.isSafeInteger(value);
  // For floats, check if round-trip preserves the value
  return value === parseFloat(value.toString());
}

function jsonStringify(obj) {
  if (typeof obj === "object") {
    if (!Array.isArray(obj)) {
      for (const i in obj) {
        if (typeof obj[i] === "object") {
          if (obj[i] != null) obj[i] = JSON.stringify(obj[i]);
        }
      }
      return obj;
    } else {
      for (const i in obj) {
        if (obj[i] != null) obj[i] = jsonStringify(obj[i]);
      }
      return obj;
    }
  } else {
    return obj;
  }
}

function getType(obj) {
  if (Array.isArray(obj)) {
    return "array";
  } else if (obj === null || obj === undefined) {
    return "null";
  } else {
    return typeof obj;
  }
}

function empty(obj) {
  return obj === null || obj === undefined || obj === "";
}

function objectSelecter(obj, picker) {
  for (let i of picker) {
    if (Object.prototype.hasOwnProperty.call(obj, i)) {
      obj = obj[i];
    } else {
      return null;
    }
  }
  return obj;
}

/**
 * Read a value from a nested object using an array path or dot-separated string path.
 * @param {object} obj
 * @param {string[]|string} path - e.g. ["identity", "dob"] or "headers.x-status"
 * @returns {*} value at path, or undefined
 */
function getByPath(obj, path) {
  let parts;
  if (Array.isArray(path)) {
    parts = path;
  } else if (typeof path === "string") {
    parts = path.split(".");
  } else {
    return undefined;
  }
  if (!obj || typeof obj !== "object") {
    return undefined;
  }
  let cur = obj;
  for (const segment of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = cur[segment];
  }
  return cur;
}

/**
 * Set a value inside a nested object using an array path, creating
 * intermediate objects when needed. The root must be an object.
 * @param {object} obj
 * @param {string[]} path
 * @param {*} value
 * @returns {object} the same object reference
 */
function setByPath(obj, path, value) {
  if (!obj || typeof obj !== "object" || !Array.isArray(path)) return obj;
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    if (cur[segment] === null || cur[segment] === undefined) {
      cur[segment] = {};
    }
    if (typeof cur[segment] !== "object") return obj;
    cur = cur[segment];
  }
  const last = path[path.length - 1];
  if (value === undefined) {
    delete cur[last];
  } else {
    cur[last] = value;
  }
  return obj;
}

module.exports = {
  jsonSafeParse,
  jsonStringify,
  wouldLosePrecision,
  isSmallFloat,
  getType,
  empty,
  objectSelecter,
  getByPath,
  setByPath,
};
