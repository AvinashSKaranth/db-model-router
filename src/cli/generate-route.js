#!/usr/bin/env node

const path = require("path");
const fs = require("fs");

const DB_TYPE_MAP = {
  mysql: "mysql",
  postgres: "postgres",
  postgresql: "postgres",
  sqlite3: "sqlite3",
  mssql: "mssql",
  oracle: "oracle",
  cockroachdb: "cockroachdb",
};

const SUPPORTED_TYPES = Object.keys(DB_TYPE_MAP);

function safeVarName(name) {
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) return name;
  return name.replace(/[^a-zA-Z0-9_$]/g, "_");
}

/**
 * Generate a route file for a single model.
 */
function generateRouteFile(tableName, modelsRelPath) {
  const varName = safeVarName(tableName);
  return `const { route } = require("db-model-router");
const ${varName} = require("${modelsRelPath}/${tableName}");

module.exports = route(${varName});
`;
}

/**
 * Generate a child route file that scopes queries by parent FK.
 * e.g., posts/:post_id/comments — filters comments where post_id = :post_id
 */
function generateChildRouteFile(
  childTable,
  parentTable,
  fkColumn,
  modelsRelPath,
) {
  const varName = safeVarName(childTable);
  return `const { route } = require("db-model-router");
const ${varName} = require("${modelsRelPath}/${childTable}");

// Child route: scoped by parent ${parentTable} via ${fkColumn}
module.exports = route(${varName}, { ${fkColumn}: "params.${fkColumn}" });
`;
}

/**
 * Generate the routes index file that mounts all routes on an express Router.
 * Supports parent-child nesting: parent/:pk/child
 */
function generateRoutesIndexFile(tableNames, relationships = []) {
  let imports = `let express;\ntry { express = require("ultimate-express"); } catch (_) { express = require("express"); }\nconst router = express.Router();\n\n`;

  // Collect child tables that are nested under parents
  const nestedChildren = new Set();
  for (const rel of relationships) {
    nestedChildren.add(rel.child);
  }

  for (const table of tableNames) {
    const varName = safeVarName(table);
    imports += `const ${varName}Route = require("./${table}");\n`;
  }
  // Import child routes with _child suffix for nested ones
  for (const rel of relationships) {
    const varName = safeVarName(rel.child);
    imports += `const ${varName}ChildRoute = require("./${rel.child}_child_of_${rel.parent}");\n`;
  }

  imports += "\n";

  // Mount top-level routes (skip tables that are ONLY children)
  for (const table of tableNames) {
    if (nestedChildren.has(table)) continue;
    const varName = safeVarName(table);
    imports += `router.use("/${table}", ${varName}Route);\n`;
  }

  // Mount nested child routes under parent
  for (const rel of relationships) {
    const parentVar = safeVarName(rel.parent);
    const childVar = safeVarName(rel.child);
    // Find parent PK from model file name convention — use fkColumn without _id suffix as parent pk param
    imports += `router.use("/${rel.parent}/:${rel.fkColumn}/${rel.child}", ${childVar}ChildRoute);\n`;
  }

  // Also mount children as top-level for direct access
  for (const rel of relationships) {
    const varName = safeVarName(rel.child);
    imports += `router.use("/${rel.child}", ${varName}Route);\n`;
  }

  imports += "\nmodule.exports = router;\n";
  return imports;
}

/**
 * Generate the routes index file (simple version, no relationships).
 */
function generateSimpleRoutesIndexFile(tableNames) {
  return generateRoutesIndexFile(tableNames, []);
}

/**
 * Read model directory to discover table names from generated model files.
 * Looks for .js files that are not index.js.
 */
function discoverModels(modelsDir) {
  if (!fs.existsSync(modelsDir)) return [];
  const files = fs
    .readdirSync(modelsDir)
    .filter((f) => f.endsWith(".js") && f !== "index.js");
  return files.map((f) => f.replace(/\.js$/, ""));
}

// --- Main CLI ---

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const modelsDir = path.resolve(args.models || "./models");
  const routesDir = path.resolve(args.output || "./routes");

  // Check if models exist; if not, generate them first
  let tableNames = discoverModels(modelsDir);

  if (tableNames.length === 0) {
    console.log("No models found. Generating models first...\n");

    const dbType = DB_TYPE_MAP[(args.type || "").toLowerCase()];
    if (!dbType) {
      console.error(
        `Error: No models found in "${modelsDir}" and no --type provided to generate them.\n` +
          `Either generate models first with rest-router-generate-model, or provide --type to auto-generate.`,
      );
      process.exit(1);
    }

    // Build the generate-model command args and run it
    const generateArgs = ["--type", dbType, "--output", modelsDir];
    if (args.host) generateArgs.push("--host", args.host);
    if (args.port) generateArgs.push("--port", args.port);
    if (args.database) generateArgs.push("--database", args.database);
    if (args.user) generateArgs.push("--user", args.user);
    if (args.password) generateArgs.push("--password", args.password);
    if (args.schema) generateArgs.push("--schema", args.schema);
    if (args.env) generateArgs.push("--env", args.env);
    if (args.tables) generateArgs.push("--tables", args.tables);

    const { execFileSync } = require("child_process");
    try {
      const generateScript = path.join(__dirname, "generate-model.js");
      execFileSync(process.execPath, [generateScript, ...generateArgs], {
        stdio: "inherit",
      });
    } catch (err) {
      console.error("Model generation failed.");
      process.exit(1);
    }

    tableNames = discoverModels(modelsDir);
    if (tableNames.length === 0) {
      console.error("No models were generated. Cannot create routes.");
      process.exit(1);
    }
    console.log(""); // blank line after model generation output
  }

  // Calculate relative path from routes dir to models dir
  const modelsRelPath = path.relative(routesDir, modelsDir).replace(/\\/g, "/");

  // Parse --tables for parent.child relationships
  const relationships = [];
  if (args.tables) {
    const tableSpecs = args.tables.split(",").map((s) => s.trim());
    for (const spec of tableSpecs) {
      if (spec.includes(".")) {
        const parts = spec.split(".");
        const parent = parts[0];
        const child = parts[1];
        // Guess FK column: parent_id or parent's PK name
        // Convention: child table has a column named <parent>_id or <parent_singular>_id
        const fkColumn = parent.replace(/s$/, "") + "_id";
        // Only add if both tables exist in our model set
        if (tableNames.includes(parent) && tableNames.includes(child)) {
          relationships.push({ parent, child, fkColumn });
        }
      }
    }
  }

  // Write route files
  if (!fs.existsSync(routesDir)) {
    fs.mkdirSync(routesDir, { recursive: true });
  }

  for (const table of tableNames) {
    const filePath = path.join(routesDir, table + ".js");
    fs.writeFileSync(filePath, generateRouteFile(table, modelsRelPath));
    console.log(`  Created ${filePath}`);
  }

  // Write child route files for parent-child relationships
  for (const rel of relationships) {
    const fileName = `${rel.child}_child_of_${rel.parent}.js`;
    const filePath = path.join(routesDir, fileName);
    fs.writeFileSync(
      filePath,
      generateChildRouteFile(
        rel.child,
        rel.parent,
        rel.fkColumn,
        modelsRelPath,
      ),
    );
    console.log(`  Created ${filePath}`);
  }

  const indexPath = path.join(routesDir, "index.js");
  fs.writeFileSync(
    indexPath,
    generateRoutesIndexFile(tableNames, relationships),
  );
  console.log(`  Created ${indexPath}`);

  console.log(`\nGenerated ${tableNames.length} route(s) in ${routesDir}`);

  // Generate OpenAPI spec if model metadata is available
  try {
    const { introspectSQLite3 } = require("./generate-model.js");
    // Try to read model files to extract metadata for OpenAPI
    const { generateOpenAPISpec } = require("./generate-openapi.js");
    const modelMeta = [];
    for (const table of tableNames) {
      const modelPath = path.join(modelsDir, table + ".js");
      if (fs.existsSync(modelPath)) {
        const content = fs.readFileSync(modelPath, "utf8");
        // Extract structure, pk, unique from generated model file
        const meta = parseModelFile(content, table);
        if (meta) modelMeta.push(meta);
      }
    }
    if (modelMeta.length > 0) {
      const spec = generateOpenAPISpec(modelMeta);
      const specPath = path.join(routesDir, "openapi.json");
      fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));
      console.log(`  Created ${specPath}`);
    }
  } catch (e) {
    // OpenAPI generation is optional, don't fail
  }

  process.exit(0);
}

/**
 * Parse a generated model file to extract metadata for OpenAPI generation.
 */
function parseModelFile(content, tableName) {
  try {
    // Extract structure JSON
    const structMatch = content.match(/model\(\s*\n?\s*db,\s*\n?\s*"[^"]+",\s*\n?\s*(\{[\s\S]*?\}),/);
    if (!structMatch) return null;
    const structure = JSON.parse(structMatch[1]);
    // Extract primary key
    const pkMatch = content.match(/"([^"]+)",\s*\n?\s*\[/);
    const primary_key = pkMatch ? pkMatch[1] : "id";
    return { table: tableName, structure, primary_key };
  } catch (e) {
    return null;
  }

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function printUsage() {
  console.log(`
Usage: rest-router-generate-route [options]

Options:
  --models      Path to models directory (default: ./models)
  --output      Output directory for routes (default: ./routes)
  --type        Database type — used to auto-generate models if missing
                (${SUPPORTED_TYPES.join(", ")})
  --host        Database host (passed to model generation)
  --port        Database port (passed to model generation)
  --database    Database name or file path (passed to model generation)
  --user        Database user (passed to model generation)
  --password    Database password (passed to model generation)
  --schema      Schema name, postgres only (passed to model generation)
  --env         Path to .env file (passed to model generation)
  --help        Show this help message

Examples:
  # Generate routes from existing models
  rest-router-generate-route --models ./models --output ./routes

  # Auto-generate models + routes in one step
  rest-router-generate-route --type mysql --env .env --models ./models --output ./routes

  # SQLite3 example
  rest-router-generate-route --type sqlite3 --database ./myapp.db
`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}

module.exports = {
  generateRouteFile,
  generateChildRouteFile,
  generateRoutesIndexFile,
  discoverModels,
  safeVarName,
};
