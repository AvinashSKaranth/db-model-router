function jsonSafeParse(obj) {
  if (typeof obj === "string") {
    try {
      // If the string is a bare numeric literal that would lose precision,
      // return it as-is (string) to preserve the original value.
      if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(obj.trim())) {
        if (wouldLosePrecision(obj.trim())) {
          return obj;
        }
      }
      // Pre-process: find numeric literals in the JSON that would lose precision.
      // A number loses precision if:
      //   - It's an integer with more than 15 significant digits
      //   - It's a float with more than 15 significant digits total
      //   - It exceeds Number.MAX_SAFE_INTEGER (9007199254740991)
      //
      // We wrap those in quotes before JSON.parse sees them.
      const safed = obj.replace(
        /(?<=[:,\[]\s*)-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?(?=\s*[,\}\]])/g,
        (match) => {
          // Check if this number would lose precision
          if (wouldLosePrecision(match)) {
            return '"' + match + '"';
          }
          return match;
        },
      );
      return JSON.parse(safed);
    } catch (err) {
      // If the regex approach fails, fall back to standard reviver
      try {
        return JSON.parse(obj, (key, value) => {
          if (
            typeof value === "number" &&
            !Number.isSafeInteger(value) &&
            !isSmallFloat(value)
          ) {
            return value.toString();
          }
          return value;
        });
      } catch (err2) {
        return obj;
      }
    }
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
    if (decPart && Number(numStr) === parseFloat(numStr)) {
      return false;
    }
    return true;
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
    if (obj.hasOwnProperty(i)) {
      obj = obj[i];
    } else {
      return null;
    }
  }
  return obj;
}

module.exports = {
  jsonSafeParse,
  jsonStringify,
  getType,
  empty,
  objectSelecter,
};
