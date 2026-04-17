/**
 * MySQL → PostgreSQL SQL Translation Layer
 * Preprocesses SQL strings before execution to convert common MySQL patterns to PostgreSQL equivalents.
 */

const MYSQL_TO_PG_DATE_FORMATS = {
  '%Y': 'YYYY', '%y': 'YY', '%m': 'MM', '%d': 'DD',
  '%H': 'HH24', '%h': 'HH12', '%i': 'MI', '%s': 'SS',
  '%p': 'AM', '%M': 'Month', '%b': 'Mon', '%W': 'Day', '%a': 'Dy',
  '%j': 'DDD', '%T': 'HH24:MI:SS', '%r': 'HH12:MI:SS AM',
};

function convertDateFormat(mysqlFmt) {
  let pgFmt = mysqlFmt;
  const keys = Object.keys(MYSQL_TO_PG_DATE_FORMATS).sort((a, b) => b.length - a.length);
  for (const k of keys) pgFmt = pgFmt.split(k).join(MYSQL_TO_PG_DATE_FORMATS[k]);
  return pgFmt;
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
    // Recursively process args that may contain the same function
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

function stripBackticks(sql) {
  return sql.replace(/`([^`]+)`/g, (_, name) => '"' + name + '"');
}

function translateFunctions(sql) {
  // NOW() stays as NOW() in PG
  // IFNULL(a, b) → COALESCE(a, b)
  sql = sql.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');

  // GROUP_CONCAT(col SEPARATOR ',') → STRING_AGG(col::text, ',')
  sql = sql.replace(
    /\bGROUP_CONCAT\s*\(\s*([^)]+?)\s+SEPARATOR\s+'([^']*)'\s*\)/gi,
    (_, col, sep) => `STRING_AGG(${col.trim()}::text, '${sep}')`
  );
  // GROUP_CONCAT(col) → STRING_AGG(col::text, ',')
  sql = sql.replace(
    /\bGROUP_CONCAT\s*\(\s*([^)]+?)\s*\)/gi,
    (_, col) => `STRING_AGG(${col.trim()}::text, ',')`
  );

  // UNIX_TIMESTAMP()*1000 → (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
  sql = sql.replace(
    /\bUNIX_TIMESTAMP\s*\(\s*\)\s*\*\s*1000/gi,
    "(EXTRACT(EPOCH FROM NOW()) * 1000)::bigint"
  );

  // UNIX_TIMESTAMP() → EXTRACT(EPOCH FROM NOW())::bigint
  sql = sql.replace(
    /\bUNIX_TIMESTAMP\s*\(\s*\)/gi,
    "EXTRACT(EPOCH FROM NOW())::bigint"
  );

  // FROM_UNIXTIME(expr, fmt) → TO_CHAR(TO_TIMESTAMP(expr), fmt)
  // FROM_UNIXTIME(expr) → TO_TIMESTAMP(expr)
  sql = replaceFuncCall(sql, 'FROM_UNIXTIME', (args) => {
    if (args.length === 2) {
      const fmt = args[1].match(/^'([^']*)'$/);
      return fmt ? `TO_CHAR(TO_TIMESTAMP(${args[0]}), '${convertDateFormat(fmt[1])}')` : null;
    }
    if (args.length === 1) return `TO_TIMESTAMP(${args[0]})`;
    return null;
  });

  // CAST(x AS UNSIGNED) → CAST(x AS BIGINT)
  sql = sql.replace(/\bCAST\s*\((.+?)\s+AS\s+UNSIGNED\s*\)/gi, 'CAST($1 AS BIGINT)');
  // CAST(x AS SIGNED) → CAST(x AS BIGINT)
  sql = sql.replace(/\bCAST\s*\((.+?)\s+AS\s+SIGNED\s*\)/gi, 'CAST($1 AS BIGINT)');

  // DATE_ADD(date, INTERVAL n UNIT) → (date + INTERVAL 'n UNIT')
  // When n is a ? placeholder, use (date + ? * INTERVAL '1 UNIT') to preserve the bind param
  sql = sql.replace(
    /\bDATE_ADD\s*\(\s*(.+?)\s*,\s*INTERVAL\s+(.+?)\s+(SECOND|MINUTE|HOUR|DAY|WEEK|MONTH|YEAR)\s*\)/gi,
    (_, date, n, unit) => {
      n = n.trim();
      if (n === '?') return `(${date.trim()} + ? * INTERVAL '1 ${unit}')`;
      return `(${date.trim()} + INTERVAL '${n} ${unit}')`;
    }
  );
  // DATE_SUB(date, INTERVAL n UNIT) → (date - INTERVAL 'n UNIT')
  sql = sql.replace(
    /\bDATE_SUB\s*\(\s*(.+?)\s*,\s*INTERVAL\s+(.+?)\s+(SECOND|MINUTE|HOUR|DAY|WEEK|MONTH|YEAR)\s*\)/gi,
    (_, date, n, unit) => {
      n = n.trim();
      if (n === '?') return `(${date.trim()} - ? * INTERVAL '1 ${unit}')`;
      return `(${date.trim()} - INTERVAL '${n} ${unit}')`;
    }
  );

  // SUBSTRING_INDEX(str, delim, count) → SPLIT_PART / REVERSE+SPLIT_PART
  sql = replaceFuncCall(sql, 'SUBSTRING_INDEX', (args) => {
    if (args.length !== 3) return null;
    const delimMatch = args[1].match(/^'([^']*)'$/);
    if (!delimMatch) return null;
    const n = parseInt(args[2]);
    if (n > 0) return `SPLIT_PART(${args[0]}, ${args[1]}, ${n})`;
    if (n === -1) return `REVERSE(SPLIT_PART(REVERSE(${args[0]}), ${args[1]}, 1))`;
    return `SPLIT_PART(${args[0]}, ${args[1]}, ${n})`;
  });

  // JSON_SET(col, '$.key', val, ...) → nested jsonb_set(jsonb_set(col, '{key}', to_jsonb(val)), ...)
  // Handles multiple path-value pairs. Process innermost first, then outer.
  function replaceJsonSet(s) {
    const re = /\bJSON_SET\s*\(/i;
    const m = re.exec(s);
    if (!m) return s;
    const start = m.index;
    const argsStart = start + m[0].length;
    let depth = 1, i = argsStart, args = [], argStart = argsStart;
    while (i < s.length && depth > 0) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') { depth--; if (depth === 0) { args.push(s.slice(argStart, i).trim()); break; } }
      else if (s[i] === ',' && depth === 1) { args.push(s.slice(argStart, i).trim()); argStart = i + 1; }
      else if (s[i] === "'" ) { i++; while (i < s.length && s[i] !== "'") i++; }
      else if (s[i] === '"' ) { i++; while (i < s.length && s[i] !== '"') i++; }
      i++;
    }
    // Need odd number of args >= 3: col, path1, val1, [path2, val2, ...]
    if (args.length < 3 || args.length % 2 === 0) return s;
    let col = replaceJsonSet(args[0]);
    for (let j = 1; j < args.length; j += 2) {
      let pathArg = args[j], val = replaceJsonSet(args[j + 1]);
      // Handle both single-quoted '$.path' and double-quoted "$.path"
      const pathMatch = pathArg.match(/['"]?\$\.([^'"]+)['"]?/);
      if (!pathMatch) return s;
      const pgPath = '{' + pathMatch[1].split('.').join(',') + '}';
      col = `jsonb_set(${col}, '${pgPath}', to_jsonb(${val}))`;
    }
    return s.slice(0, start) + col + replaceJsonSet(s.slice(i + 1));
  }
  sql = replaceJsonSet(sql);

  // JSON_ARRAY_APPEND(arr, '$', val) → (arr || val)  (jsonb array append)
  sql = replaceFuncCall(sql, 'JSON_ARRAY_APPEND', (args) => {
    if (args.length === 3) return `(${args[0]} || ${args[2]})`;
    return null;
  });

  // JSON_ARRAY() → '[]'::jsonb
  sql = sql.replace(/\bJSON_ARRAY\s*\(\s*\)/gi, "'[]'::jsonb");

  // CAST(? AS JSON) → ?::jsonb
  sql = sql.replace(/\bCAST\s*\(\s*\?\s+AS\s+JSON\s*\)/gi, '?::jsonb');

  // LAST_INSERT_ID() → lastval()
  sql = sql.replace(/\bLAST_INSERT_ID\s*\(\s*\)/gi, 'lastval()');

  // JSON_OBJECTAGG(key, val) → json_object_agg(key, val)
  sql = sql.replace(/\bJSON_OBJECTAGG\s*\(/gi, 'json_object_agg(');

  // JSON_OBJECT( → json_build_object(
  sql = sql.replace(/\bJSON_OBJECT\s*\(/gi, 'json_build_object(');

  // col REGEXP 'pattern' → col ~ 'pattern'
  sql = sql.replace(/\bREGEXP\s+'/gi, "~ '");

  // CURDATE() → CURRENT_DATE
  sql = sql.replace(/\bCURDATE\s*\(\s*\)/gi, 'CURRENT_DATE');

  return sql;
}

function translateLimit(sql) {
  // UPDATE table SET ... WHERE ... LIMIT n → UPDATE table SET ... WHERE ctid IN (SELECT ctid FROM table WHERE ... LIMIT n)
  const updateLimitMatch = sql.match(
    /^(\s*UPDATE\s+)(\w+|"[^"]+")(\s+SET\s+.+?\s+WHERE\s+)(.+?)\s+LIMIT\s+(\d+|\?)\s*;?\s*$/is
  );
  if (updateLimitMatch) {
    const [, upd, table, set, where, limit] = updateLimitMatch;
    return `${upd}${table}${set}ctid IN (SELECT ctid FROM ${table} WHERE ${where} LIMIT ${limit})`;
  }

  // MySQL LIMIT offset, count → LIMIT count OFFSET offset
  sql = sql.replace(
    /\bLIMIT\s+(\d+)\s*,\s*(\d+)/gi,
    (_, offset, limit) => `LIMIT ${limit} OFFSET ${offset}`
  );
  // Placeholder version
  sql = sql.replace(
    /\bLIMIT\s+\?\s*,\s*\?/gi,
    'LIMIT ? OFFSET ?'
  );
  return sql;
}

function translateDateFunctions(sql) {
  // DATE_FORMAT(col, '%Y-%m-%d') → TO_CHAR(col, 'YYYY-MM-DD')
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
  return sql;
}

function buildJsonPath(col, path) {
  const parts = path.split('.');
  if (parts.length === 1) return `${col}->>'${parts[0]}'`;
  const last = parts.pop();
  const chain = parts.map(p => `->'${p}'`).join('');
  return `${col}${chain}->>'${last}'`;
}

function translateJsonFunctions(sql) {
  // JSON_UNQUOTE(col->'$.path') → col->>'path' (must run before -> conversion)
  sql = sql.replace(
    /\bJSON_UNQUOTE\s*\(\s*((?:"\w+"|\w+)(?:\.(?:"\w+"|\w+))?)\s*->\s*'\$\.([^']+)'\s*\)/gi,
    (_, col, path) => buildJsonPath(col, path)
  );
  // JSON_UNQUOTE(expr) → expr (PG ->> already returns unquoted text; strip leftover wrappers)
  sql = replaceFuncCall(sql, 'JSON_UNQUOTE', (args) => args.length === 1 ? args[0] : null);
  // JSON_EXTRACT(col, '$.key') → col->>'key'
  sql = sql.replace(
    /\bJSON_EXTRACT\s*\(\s*([^,]+?)\s*,\s*'\$\.([^']+)'\s*\)/gi,
    (_, col, key) => `${col.trim()}->>'${key}'`
  );
  // JSON_CONTAINS(col, val, '$.path') → col->>'path' IS NOT NULL
  sql = sql.replace(
    /\bJSON_CONTAINS\s*\(\s*([^,]+?)\s*,\s*[^,]+?\s*,\s*'\$\.([^']+)'\s*\)/gi,
    (_, col, path) => `${col.trim()}->>'${path}' IS NOT NULL`
  );
  // col->>'$.path.sub' or alias.col->>'$.path' → col->>'path' or col->'path'->>'sub'
  // Handles both single-quoted '$.path' and double-quoted "$.path" (MySQL JSON shorthand)
  sql = sql.replace(/((?:"\w+"|\w+)(?:\.(?:"\w+"|\w+))?)\s*->>\s*['"]?\$\.([^'"]+)['"]?/g, (_, col, path) => buildJsonPath(col, path));
  // col->'$.path.sub' or alias.col->'$.path' → col->>'path' or col->'path'->>'sub'
  sql = sql.replace(/((?:"\w+"|\w+)(?:\.(?:"\w+"|\w+))?)\s*->\s*['"]?\$\.([^'"]+)['"]?/g, (_, col, path) => buildJsonPath(col, path));
  // WHERE 1 (MySQL truthy) → WHERE 1=1
  sql = sql.replace(/\bWHERE\s+1\b(?!\s*=)/gi, 'WHERE 1=1');

  // Fix COALESCE type mismatch: COALESCE(expr->>'key', 60) → COALESCE(expr->>'key', '60')
  sql = sql.replace(
    /\bCOALESCE\s*\(\s*((?:(?!COALESCE).)*?->>'[^']+')((?:\s*,\s*(?:'[^']*'|[^,)]+))*)\s*\)/gi,
    (match, jsonExpr, rest) => {
      const fixedRest = rest.replace(/,\s*(\d+(?:\.\d+)?)\b/g, ",'$1'");
      return `COALESCE(${jsonExpr}${fixedRest})`;
    }
  );

  // Fix ->> text result compared to _id columns (bigint): col_id = (SELECT x->>'key' ...) → col_id = (SELECT (x->>'key')::bigint ...)
  // PG ->> returns text; MySQL ->> returns native type. Cast when compared to _id columns.
  sql = sql.replace(
    /"?(\w*_id\w*)"?\s*=\s*\(\s*SELECT\s+((?:"\w+"|\w+)(?:->'\w+')*->>'[^']+')/gi,
    (m, col, jsonExpr) => `"${col}" = ( SELECT (${jsonExpr})::bigint`
  );

  // Fix ->> text result used in arithmetic: expr->>'key' + N → (expr->>'key')::numeric + N
  // Also handles COALESCE(expr->>'key', '0') + N
  sql = sql.replace(
    /(\w+->>'[^']+')\s*(\+|-)\s*(\d+)/g,
    (_, jsonExpr, op, num) => `(${jsonExpr})::numeric ${op} ${num}`
  );
  sql = sql.replace(
    /(COALESCE\s*\([^)]*->>'[^']+[^)]*\))\s*(\+|-)\s*(\d+)/gi,
    (_, coalesceExpr, op, num) => `(${coalesceExpr})::numeric ${op} ${num}`
  );

  return sql;
}

/**
 * Translate INSERT ... ON DUPLICATE KEY UPDATE → INSERT ... ON CONFLICT ... DO UPDATE SET
 */
function translateOnDuplicateKey(sql) {
  const match = sql.match(
    /INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s+(.+?)\s+(?:AS\s+(\w+)\s+)?ON\s+DUPLICATE\s+KEY\s+UPDATE\s+(.+)$/i
  );
  if (!match) return sql;

  const [, table, colStr, valuesClause, , updateClause] = match;
  const columns = colStr.split(',').map(c => c.trim());

  // Parse update assignments
  const updates = updateClause.split(',').map(a => {
    const m = a.trim().match(/(\w+)\s*=\s*(?:\w+\.(\w+)|VALUES\s*\(\s*(\w+)\s*\))/i);
    return m ? m[1].trim() : null;
  }).filter(Boolean);

  const updateSet = new Set(updates);
  const onColumns = columns.filter(c => !updateSet.has(c));
  const conflictCols = onColumns.join(', ');
  const updateSetSql = updates.map(c => `${c} = EXCLUDED.${c}`).join(', ');

  return `INSERT INTO ${table} (${colStr}) VALUES ${valuesClause} ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateSetSql}`;
}

function translateInsertIgnore(sql) {
  // INSERT IGNORE INTO table → INSERT INTO table ... ON CONFLICT DO NOTHING
  // We add a marker that will be appended after VALUES
  sql = sql.replace(
    /\bINSERT\s+IGNORE\s+INTO\s+/gi,
    'INSERT INTO '
  );
  // If the original had INSERT IGNORE, append ON CONFLICT DO NOTHING at the end
  // This is handled by checking a flag, but for simplicity we detect and append
  if (/INSERT\s+INTO\s+/i.test(sql) && !sql.includes('ON CONFLICT')) {
    // Only add if this was originally an INSERT IGNORE (we lost the marker above)
    // We'll handle this via a flag approach instead
  }
  return sql;
}

/**
 * MySQL: UPDATE t1 [AS a] INNER JOIN t2 [AS b] ON cond SET ... WHERE ...
 * PG:    UPDATE t1 AS a SET ... FROM t2 AS b WHERE cond AND ...
 */
function translateUpdateJoin(sql) {
  const m = sql.match(
    /^(\s*UPDATE\s+)(\w+)(\s+AS\s+(\w+))?\s+INNER\s+JOIN\s+(\w+)(\s+AS\s+(\w+))?\s+ON\s+([\s\S]+?)\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+)$/i
  );
  if (!m) return sql;
  const [, prefix, t1, , a1, t2, , a2, onCond, setCols, whereCond] = m;
  const alias1 = a1 || t1;
  const alias2 = a2 || t2;
  // Strip table alias prefix from SET columns (PG doesn't allow alias.col in SET)
  const cleanSet = setCols.replace(new RegExp('\\b' + alias1 + '\\.', 'g'), '');
  return `${prefix}${t1} AS ${alias1} SET ${cleanSet} FROM ${t2} AS ${alias2} WHERE ${onCond.trim()} AND ${whereCond.trim()}`;
}

function translate(sql) {
  if (!sql || typeof sql !== 'string') return sql;
  // Escape hatch: skip translation for native PostgreSQL SQL
  if (sql.trimStart().startsWith('/* PG_NATIVE */')) return sql;

  const wasInsertIgnore = /\bINSERT\s+IGNORE\s+INTO\s+/i.test(sql);

  sql = stripBackticks(sql);
  sql = translateUpdateJoin(sql);
  sql = translateFunctions(sql);
  sql = translateLimit(sql);
  sql = translateDateFunctions(sql);
  sql = translateJsonFunctions(sql);
  sql = translateOnDuplicateKey(sql);
  if (wasInsertIgnore) {
    sql = sql.replace(/\bINSERT\s+IGNORE\s+INTO\s+/gi, 'INSERT INTO ');
    if (!sql.includes('ON CONFLICT')) {
      sql = sql.replace(/;\s*$/, '') + ' ON CONFLICT DO NOTHING';
    }
  }
  // MySQL allows HAVING without GROUP BY to filter on aliases; PG does not.
  // Wrap in subquery: SELECT * FROM (...) _t WHERE <having_cond>
  if (/\bHAVING\b/i.test(sql) && !/\bGROUP\s+BY\b/i.test(sql) && /^\s*SELECT\b/i.test(sql)) {
    const havingMatch = sql.match(/\bHAVING\b\s+([\s\S]+?)(?:\bORDER\s+BY\b|\bLIMIT\b|$)/i);
    if (havingMatch) {
      const havingCond = havingMatch[1].trim().replace(/;\s*$/, '');
      const havingStart = sql.indexOf(havingMatch[0]);
      const inner = sql.slice(0, havingStart).trim().replace(/;\s*$/, '');
      const after = sql.slice(havingStart + havingMatch[0].length - (havingMatch[0].match(/(\bORDER\s+BY\b|\bLIMIT\b)[\s\S]*$/i) || [''])[0].length);
      const rest = sql.slice(havingStart + ('HAVING '.length + havingCond.length)).trim();
      sql = `SELECT * FROM (${inner}) _t WHERE ${havingCond} ${rest}`.replace(/\s+/g, ' ').trim();
    }
  }
  // Remove trailing semicolons
  sql = sql.replace(/;\s*$/, '');
  return sql;
}

module.exports = { translate, stripBackticks, translateFunctions, translateLimit, translateDateFunctions, translateJsonFunctions, translateOnDuplicateKey, translateInsertIgnore, convertDateFormat };
