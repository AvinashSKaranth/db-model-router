/**
 * MySQL → Oracle SQL Translation Layer
 * Preprocesses SQL strings before execution to convert common MySQL patterns to Oracle equivalents.
 */

const MYSQL_TO_ORACLE_DATE_FORMATS = {
  '%Y': 'YYYY', '%y': 'YY', '%m': 'MM', '%d': 'DD',
  '%H': 'HH24', '%h': 'HH', '%i': 'MI', '%s': 'SS',
  '%p': 'AM', '%M': 'MONTH', '%b': 'MON', '%W': 'DAY', '%a': 'DY',
  '%j': 'DDD', '%T': 'HH24:MI:SS', '%r': 'HH:MI:SS AM',
};

function convertDateFormat(mysqlFmt) {
  let oracleFmt = mysqlFmt;
  const keys = Object.keys(MYSQL_TO_ORACLE_DATE_FORMATS).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    oracleFmt = oracleFmt.split(k).join(MYSQL_TO_ORACLE_DATE_FORMATS[k]);
  }
  return oracleFmt;
}

const ORACLE_RESERVED = new Set(['access','add','all','alter','and','any','as','asc','audit','between','by','char','check','cluster','column','comment','compress','connect','create','current','date','decimal','default','delete','desc','distinct','drop','else','exclusive','exists','file','float','for','from','grant','group','having','identified','immediate','in','increment','index','initial','insert','integer','intersect','into','is','level','like','lock','long','maxextents','minus','mlslabel','mode','modify','noaudit','nocompress','not','nowait','null','number','of','offline','on','online','option','or','order','pctfree','prior','public','raw','rename','resource','revoke','row','rowid','rownum','rows','select','session','set','share','size','smallint','start','successful','synonym','sysdate','table','then','to','trigger','type','uid','union','unique','update','user','validate','values','varchar','varchar2','view','whenever','where','with']);

function stripBackticks(sql) {
  return sql.replace(/`([^`]+)`/g, (_, name) => {
    const clean = name.replace(/\s+/g, '_');
    return ORACLE_RESERVED.has(clean.toLowerCase()) ? '"' + clean.toUpperCase() + '"' : clean;
  });
}

/** Parse balanced-paren args for FUNC_NAME(...) starting at the open paren. */
function parseFuncArgs(s, argsStart) {
  let depth = 1, i = argsStart, args = [], argStart = argsStart;
  while (i < s.length && depth > 0) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') { depth--; if (depth === 0) { args.push(s.slice(argStart, i).trim()); break; } }
    else if (s[i] === ',' && depth === 1) { args.push(s.slice(argStart, i).trim()); argStart = i + 1; }
    else if (s[i] === "'") { i++; while (i < s.length && s[i] !== "'") i++; }
    i++;
  }
  return { args, end: i };
}

/** Replace a named function call using balanced-paren arg parsing. Calls replacer(args) → string|null. */
function replaceFuncCall(sql, funcName, replacer) {
  const re = new RegExp('\\b' + funcName + '\\s*\\(', 'i');
  let result = '';
  while (true) {
    const m = re.exec(sql);
    if (!m) { result += sql; break; }
    result += sql.slice(0, m.index);
    const { args, end } = parseFuncArgs(sql, m.index + m[0].length);
    const processedArgs = args.map(a => replaceFuncCall(a, funcName, replacer));
    const replacement = replacer(processedArgs);
    if (replacement != null) {
      result += replacement;
    } else {
      result += m[0] + processedArgs.join(', ') + ')';
    }
    sql = sql.slice(end + 1);
  }
  return result;
}

function translateFunctions(sql) {
  // NOW() → SYSDATE
  sql = sql.replace(/\bNOW\s*\(\s*\)/gi, 'SYSDATE');

  // CURRENT_TIMESTAMP (not in DEFAULT context) → SYSTIMESTAMP
  sql = sql.replace(/\bCURRENT_TIMESTAMP\b(?!\s+ON)/gi, 'SYSTIMESTAMP');

  // IFNULL(a, b) → NVL(a, b)
  sql = sql.replace(/\bIFNULL\s*\(/gi, 'NVL(');

  // GROUP_CONCAT(col SEPARATOR ',') → LISTAGG(col, ',') WITHIN GROUP (ORDER BY col)
  sql = sql.replace(
    /\bGROUP_CONCAT\s*\(\s*([^)]+?)\s+SEPARATOR\s+'([^']*)'\s*\)/gi,
    (_, col, sep) => `LISTAGG(${col.trim()}, '${sep}') WITHIN GROUP (ORDER BY ${col.trim()})`
  );
  // GROUP_CONCAT(col) → LISTAGG(col, ',') WITHIN GROUP (ORDER BY col)
  sql = sql.replace(
    /\bGROUP_CONCAT\s*\(\s*([^)]+?)\s*\)/gi,
    (_, col) => `LISTAGG(${col.trim()}, ',') WITHIN GROUP (ORDER BY ${col.trim()})`
  );

  // UNIX_TIMESTAMP()*1000 → Oracle epoch millis
  sql = sql.replace(
    /\bUNIX_TIMESTAMP\s*\(\s*\)\s*\*\s*1000/gi,
    "((CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS DATE) - DATE '1970-01-01') * 86400000)"
  );

  // CAST(x AS UNSIGNED) → CAST(x AS NUMBER)
  sql = sql.replace(/\bCAST\s*\((.+?)\s+AS\s+UNSIGNED\s*\)/gi, 'CAST($1 AS NUMBER)');
  // CAST(x AS SIGNED) → CAST(x AS NUMBER)
  sql = sql.replace(/\bCAST\s*\((.+?)\s+AS\s+SIGNED\s*\)/gi, 'CAST($1 AS NUMBER)');

  // CURDATE() → TRUNC(SYSDATE)
  sql = sql.replace(/\bCURDATE\s*\(\s*\)/gi, 'TRUNC(SYSDATE)');

  // FROM_UNIXTIME(expr, fmt) → TO_CHAR(TO_DATE('1970-01-01','YYYY-MM-DD') + expr/86400, fmt)
  // FROM_UNIXTIME(expr) → TO_DATE('1970-01-01','YYYY-MM-DD') + expr/86400
  sql = replaceFuncCall(sql, 'FROM_UNIXTIME', (args) => {
    if (args.length === 2) {
      const fmt = args[1].match(/^'([^']*)'$/);
      return fmt
        ? `TO_CHAR(TO_DATE('1970-01-01','YYYY-MM-DD') + (${args[0]})/86400, '${convertDateFormat(fmt[1])}')`
        : null;
    }
    if (args.length === 1) return `(TO_DATE('1970-01-01','YYYY-MM-DD') + (${args[0]})/86400)`;
    return null;
  });

  // JSON_ARRAY_APPEND(arr, '$', val) → append val to JSON array
  // Oracle: use string manipulation to append to JSON array
  sql = replaceFuncCall(sql, 'JSON_ARRAY_APPEND', (args) => {
    if (args.length === 3) {
      const arr = args[0], val = args[2];
      return `CASE WHEN ${arr} IS NULL OR ${arr} = '[]' THEN '[' || ${val} || ']' ELSE SUBSTR(${arr}, 1, LENGTH(${arr})-1) || ',' || ${val} || ']' END`;
    }
    return null;
  });

  // JSON_ARRAY() → '[]'
  sql = sql.replace(/\bJSON_ARRAY\s*\(\s*\)/gi, "'[]'");

  // CAST(? AS JSON) → ?
  sql = sql.replace(/\bCAST\s*\(\s*\?\s+AS\s+JSON\s*\)/gi, '?');

  // LAST_INSERT_ID() — not directly supported, handled by db.js RETURNING clause
  sql = sql.replace(/\bLAST_INSERT_ID\s*\(\s*\)/gi, '0');

  return sql;
}

function translateLimit(sql) {
  // LIMIT n OFFSET m → OFFSET m ROWS FETCH NEXT n ROWS ONLY
  sql = sql.replace(
    /\bLIMIT\s+(\d+)\s+OFFSET\s+(\d+)/gi,
    (_, limit, offset) => `OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
  );
  // LIMIT n,m (MySQL alternate syntax: LIMIT offset, count)
  sql = sql.replace(
    /\bLIMIT\s+(\d+)\s*,\s*(\d+)/gi,
    (_, offset, limit) => `OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
  );
  // LIMIT n (no offset) → FETCH FIRST n ROWS ONLY
  sql = sql.replace(
    /\bLIMIT\s+(\d+)(?!\s+OFFSET)\b/gi,
    (_, limit) => `FETCH FIRST ${limit} ROWS ONLY`
  );
  // Handle placeholder-based LIMIT ? OFFSET ?
  sql = sql.replace(
    /\bLIMIT\s+\?\s+OFFSET\s+\?/gi,
    'OFFSET ? ROWS FETCH NEXT ? ROWS ONLY'
  );
  sql = sql.replace(
    /\bLIMIT\s+\?\s*,\s*\?/gi,
    'OFFSET ? ROWS FETCH NEXT ? ROWS ONLY'
  );
  // LIMIT ? (single placeholder) → FETCH FIRST ? ROWS ONLY
  sql = sql.replace(
    /\bLIMIT\s+\?(?!\s*,)(?!\s+OFFSET)/gi,
    'FETCH FIRST ? ROWS ONLY'
  );
  return sql;
}

/** Convert INTERVAL arithmetic to Oracle date arithmetic.
 *  Oracle uses: date + N (days), date + N/24 (hours), date + N/1440 (minutes), date + N/86400 (seconds)
 */
function intervalToOracle(expr, n, unit, op) {
  const u = unit.toUpperCase();
  switch (u) {
    case 'SECOND': return `(${expr} ${op} (${n}/86400))`;
    case 'MINUTE': return `(${expr} ${op} (${n}/1440))`;
    case 'HOUR':   return `(${expr} ${op} (${n}/24))`;
    case 'DAY':    return `(${expr} ${op} ${n})`;
    case 'WEEK':   return `(${expr} ${op} (${n}*7))`;
    case 'MONTH':  return `ADD_MONTHS(${expr}, ${op === '+' ? n : '-' + n})`;
    case 'YEAR':   return `ADD_MONTHS(${expr}, ${op === '+' ? n + '*12' : '-' + n + '*12'})`;
    default:       return `(${expr} ${op} ${n})`;
  }
}

function translateDateFunctions(sql) {
  // DATE_FORMAT(col, '%Y-%m-%d') → TO_CHAR(col, 'YYYY-MM-DD')
  // Use balanced-paren parsing to handle nested calls like DATE_FORMAT(STR_TO_DATE(...), '%Y-%m-%d')
  sql = replaceFuncCall(sql, 'DATE_FORMAT', (args) => {
    if (args.length !== 2) return null;
    const fmt = args[1].match(/^'([^']*)'$/);
    return fmt ? `TO_CHAR(${args[0]}, '${convertDateFormat(fmt[1])}')` : null;
  });

  // STR_TO_DATE(str, '%Y-%m-%d') → TO_DATE(str, 'YYYY-MM-DD')
  sql = replaceFuncCall(sql, 'STR_TO_DATE', (args) => {
    if (args.length !== 2) return null;
    const fmt = args[1].match(/^'([^']*)'$/);
    return fmt ? `TO_DATE(${args[0]}, '${convertDateFormat(fmt[1])}')` : null;
  });

  // DATE_ADD(expr, INTERVAL n UNIT) → Oracle arithmetic (handles any expr, not just NOW())
  sql = sql.replace(
    /\bDATE_ADD\s*\(\s*(.+?)\s*,\s*INTERVAL\s+(\?|\d+)\s+(SECOND|MINUTE|HOUR|DAY|WEEK|MONTH|YEAR)\s*\)/gi,
    (_, expr, n, unit) => intervalToOracle(expr.trim(), n, unit, '+')
  );

  // DATE_SUB(expr, INTERVAL n UNIT) → Oracle arithmetic (handles any expr, not just NOW())
  sql = sql.replace(
    /\bDATE_SUB\s*\(\s*(.+?)\s*,\s*INTERVAL\s+(\?|\d+)\s+(SECOND|MINUTE|HOUR|DAY|WEEK|MONTH|YEAR)\s*\)/gi,
    (_, expr, n, unit) => intervalToOracle(expr.trim(), n, unit, '-')
  );

  // Bare INTERVAL: expr +/- INTERVAL n UNIT (without DATE_ADD/DATE_SUB wrapper)
  sql = sql.replace(
    /(\+|-)\s*INTERVAL\s+(\?|\d+)\s+(SECOND|MINUTE|HOUR|DAY|WEEK|MONTH|YEAR)\b/gi,
    (_, op, n, unit) => {
      const u = unit.toUpperCase();
      switch (u) {
        case 'SECOND': return `${op} (${n}/86400)`;
        case 'MINUTE': return `${op} (${n}/1440)`;
        case 'HOUR':   return `${op} (${n}/24)`;
        case 'DAY':    return `${op} ${n}`;
        case 'WEEK':   return `${op} (${n}*7)`;
        default:       return `${op} ${n}`;
      }
    }
  );

  return sql;
}

function translateJsonFunctions(sql) {
  // JSON_UNQUOTE(expr) → expr (Oracle JSON_VALUE already returns unquoted text)
  sql = replaceFuncCall(sql, 'JSON_UNQUOTE', (args) => args.length === 1 ? args[0] : null);
  // JSON_SET(col, '$.key', val) → JSON_MERGEPATCH(col, '{"key": ' || val || '}')
  // For simple single-key updates; nested paths use dot notation
  sql = replaceFuncCall(sql, 'JSON_SET', (args) => {
    if (args.length < 3 || args.length % 2 === 0) return null;
    let result = args[0];
    for (let i = 1; i < args.length; i += 2) {
      const pathMatch = args[i].match(/^['"]?\$\.([^'"]+)['"]?$/);
      if (!pathMatch) return null;
      const key = pathMatch[1];
      const val = args[i + 1];
      result = `JSON_MERGEPATCH(${result}, '{"${key}":' || ${val} || '}')`;
    }
    return result;
  });
  // JSON_EXTRACT(col, '$.key') → JSON_VALUE(col, '$.key')
  sql = sql.replace(/\bJSON_EXTRACT\s*\(/gi, 'JSON_VALUE(');

  // JSON_OBJECT('key', val, ...) → JSON_OBJECT(KEY 'key' VALUE val, ...)
  sql = replaceFuncCall(sql, 'JSON_OBJECT', (args) => {
    if (args.length === 0) return 'JSON_OBJECT()';
    if (args.length % 2 !== 0) return null;
    const pairs = [];
    for (let i = 0; i < args.length; i += 2) {
      pairs.push(`KEY ${args[i]} VALUE ${args[i + 1]}`);
    }
    return `JSON_OBJECT(${pairs.join(', ')})`;
  });
  // JSON_CONTAINS(col, val, '$.path') → JSON_EXISTS(col, '$.path')
  sql = sql.replace(
    /\bJSON_CONTAINS\s*\(\s*([^,]+?)\s*,\s*[^,]+?\s*,\s*'\$\.([^']+)'\s*\)/gi,
    (_, col, path) => `JSON_EXISTS(${col.trim()}, '$.${path}')`
  );
  // col->>'$.path' → JSON_VALUE(col, '$.path') — handle alias.col pattern
  // Also handle double-quoted "$.path" (MySQL JSON shorthand): convert to single-quoted for Oracle
  sql = sql.replace(/((?:\w+\.)?\w+)\s*->>\s*"(\$\.[^"]+)"/g, "JSON_VALUE($1, '$2')");
  sql = sql.replace(/((?:\w+\.)?\w+)\s*->>\s*('[^']*')/g, 'JSON_VALUE($1, $2)');
  // col->'$.path' → JSON_VALUE(col, '$.path')
  sql = sql.replace(/((?:\w+\.)?\w+)\s*->\s*"(\$\.[^"]+)"/g, "JSON_VALUE($1, '$2')");
  sql = sql.replace(/((?:\w+\.)?\w+)\s*->\s*('[^']*')/g, 'JSON_VALUE($1, $2)');
  // Fix COALESCE type mismatch: COALESCE(JSON_VALUE(...), 60) → COALESCE(JSON_VALUE(...), '60')
  // But don't fix when inside CAST (e.g. CAST(COALESCE(JSON_VALUE(...), 0) + 1 AS NUMBER))
  sql = sql.replace(/COALESCE\s*\(\s*JSON_VALUE\(([^)]+)\)\s*,\s*(\d+)\s*\)/gi,
    (match, jv, num, offset) => {
      // Check if this COALESCE is inside a CAST
      const before = sql.slice(Math.max(0, offset - 50), offset);
      if (/CAST\s*\(\s*$/i.test(before)) return match;
      return `COALESCE(JSON_VALUE(${jv}), '${num}')`;
    });
  // WHERE 1 (MySQL truthy) → WHERE 1=1
  sql = sql.replace(/\bWHERE\s+1\b(?!\s*=)/gi, 'WHERE 1=1');
  return sql;
}

/**
 * Translate INSERT ... ON DUPLICATE KEY UPDATE → MERGE INTO
 */
function translateOnDuplicateKey(sql) {
  const match = sql.match(
    /INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)\s+(?:AS\s+(\w+)\s+)?ON\s+DUPLICATE\s+KEY\s+UPDATE\s+(.+)$/i
  );
  if (!match) return sql;

  const [, table, colStr, valuesStr, alias, updateClause] = match;
  const columns = colStr.split(',').map(c => c.trim());
  const values = valuesStr.split(',').map(v => v.trim());

  // Parse update assignments: "col = V.col" or "col = VALUES(col)"
  const updates = updateClause.split(',').map(a => {
    const m = a.trim().match(/(\w+)\s*=\s*(?:\w+\.(\w+)|VALUES\s*\(\s*(\w+)\s*\))/i);
    return m ? m[1].trim() : null;
  }).filter(Boolean);

  // ON clause columns = all columns NOT in the update set
  const updateSet = new Set(updates);
  const onColumns = columns.filter(c => !updateSet.has(c));

  // Build MERGE with inline values (not bind placeholders)
  const usingCols = columns.map((c, i) => `${values[i]} AS ${c}`).join(', ');
  const onClause = onColumns.map(k => `t.${k} = s.${k}`).join(' AND ');
  const updateSetSql = updates.map(c => `t.${c} = s.${c}`).join(', ');
  const insertCols = columns.join(', ');
  const insertVals = columns.map(c => `s.${c}`).join(', ');

  return `MERGE INTO ${table} t USING (SELECT ${usingCols} FROM DUAL) s ON (${onClause})` +
    (updateSetSql ? ` WHEN MATCHED THEN UPDATE SET ${updateSetSql}` : '') +
    ` WHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals})`;
}

/**
 * MySQL: UPDATE t1 [AS a] INNER JOIN t2 [AS b] ON cond SET ... WHERE ...
 * Oracle: MERGE INTO t1 a USING t2 b ON (cond AND whereCond) WHEN MATCHED THEN UPDATE SET ...
 */
function translateUpdateJoin(sql) {
  const m = sql.match(
    /^(\s*)UPDATE\s+(\w+)(\s+AS\s+(\w+))?\s+INNER\s+JOIN\s+(\w+)(\s+AS\s+(\w+))?\s+ON\s+([\s\S]+?)\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+)$/i
  );
  if (!m) return sql;
  const [, ws, t1, , a1, t2, , a2, onCond, setCols, whereCond] = m;
  const alias1 = a1 || t1;
  const alias2 = a2 || t2;
  // Strip table alias prefix from SET columns
  const cleanSet = setCols.replace(new RegExp('\\b' + alias1 + '\\.', 'g'), alias1 + '.');
  return `${ws}MERGE INTO ${t1} ${alias1} USING ${t2} ${alias2} ON (${onCond.trim()} AND ${whereCond.trim()}) WHEN MATCHED THEN UPDATE SET ${cleanSet}`;
}

function translateInsertIgnore(sql) {
  // INSERT IGNORE INTO table (cols) VALUES (...) →
  // Wrap in PL/SQL block: BEGIN INSERT INTO ... ; EXCEPTION WHEN DUP_VAL_ON_INDEX THEN NULL; END;
  const match = sql.match(/\bINSERT\s+IGNORE\s+INTO\s+([\s\S]+)$/i);
  if (match) {
    return `BEGIN INSERT INTO ${match[1].replace(/;\s*$/, '')}; EXCEPTION WHEN DUP_VAL_ON_INDEX THEN NULL; END;`;
  }
  return sql;
}

function translate(sql) {
  if (!sql || typeof sql !== "string") return sql;
  // Escape hatch: skip translation for native Oracle SQL
  if (sql.trimStart().startsWith("/* ORACLE_NATIVE */")) return sql;

  sql = stripBackticks(sql);
  sql = translateUpdateJoin(sql);
  sql = translateDateFunctions(sql); // Must run before translateFunctions (which converts NOW() to SYSDATE)
  sql = translateFunctions(sql);
  sql = translateLimit(sql);
  sql = translateJsonFunctions(sql);
  sql = translateOnDuplicateKey(sql);
  sql = translateInsertIgnore(sql);
  // Quote Oracle reserved words used as column aliases
  // Strategy: replace all "as word" then restore those inside CAST(... AS type)
  sql = sql.replace(
    /\bas\s+(user|date|number|level|comment|size|type)\b/gi,
    (m, word) => `as "${word}"`
  );
  // Restore CAST(... as "TYPE") back to CAST(... AS TYPE)
  // Use balanced-paren search to handle any nesting depth
  function fixCastQuoting(s) {
    const re = /\bCAST\s*\(/gi;
    let result = '', lastEnd = 0, m;
    while ((m = re.exec(s)) !== null) {
      result += s.slice(lastEnd, m.index);
      let depth = 1, i = m.index + m[0].length;
      while (i < s.length && depth > 0) {
        if (s[i] === '(') depth++;
        else if (s[i] === ')') depth--;
        else if (s[i] === "'") { i++; while (i < s.length && s[i] !== "'") i++; }
        i++;
      }
      const inner = s.slice(m.index + m[0].length, i - 1);
      const asMatch = inner.match(/^([\s\S]+)\s+as\s+"(\w+)"$/i);
      if (asMatch) {
        result += `CAST(${asMatch[1]} AS ${asMatch[2]})`;
      } else {
        result += s.slice(m.index, i);
      }
      lastEnd = i;
      re.lastIndex = result.length; // adjust for next search
    }
    result += s.slice(lastEnd);
    return result;
  }
  sql = fixCastQuoting(sql);
  // Remove trailing semicolons (Oracle doesn't want them in execute())
  // But preserve semicolons inside PL/SQL blocks (BEGIN...END;)
  if (!/\bBEGIN\b/i.test(sql)) {
    sql = sql.replace(/;\s*$/, "");
  }

  return sql;
}

module.exports = { translate, stripBackticks, translateFunctions, translateLimit, translateDateFunctions, translateJsonFunctions, translateOnDuplicateKey, translateInsertIgnore, convertDateFormat };
