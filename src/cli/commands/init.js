"use strict";

const fs = require("fs");
const path = require("path");
const { parseSchema } = require("../../schema/schema-parser");
const {
  generateFiles,
  updatePackageJson,
  runInstall,
  printSummary,
  ensurePackageJson,
} = require("../init");
const { buildSchemaArtifacts } = require("./generate");

/**
 * Init command handler for the unified CLI.
 *
 * First-buildout ONLY. Scaffolds a full project (app.js, commons/, routes/,
 * migrations/, models/, tests, OpenAPI spec, optional SaaS structure) from a
 * single `dbmr.schema.json` file. All project config lives in the schema's
 * `options` block — no config flags here. Refuses to run if a project already
 * exists (app.js or package.json present in cwd).
 *
 * To add new tables/models/routes after buildout, do it manually — see
 * `db-model-router help init` for the procedure.
 *
 * @param {object} args - Parsed args; args._[0] or args.from may hold schema path
 * @param {object} flags - Universal flags: { yes, json, dryRun, noInstall, help }
 * @param {import('../flags').OutputContext} ctx - Output context for --json support
 */
async function init(args, flags, ctx) {
  // Resolve schema path: positional arg, --from, or default ./dbmr.schema.json
  const schemaPathArg =
    (args._ && args._[0]) || args.from || "./dbmr.schema.json";
  const schemaPath = path.resolve(schemaPathArg);

  if (!fs.existsSync(schemaPath)) {
    const msg = `Schema file not found: ${schemaPathArg}`;
    if (flags.json) {
      ctx.result({ error: true, code: "SCHEMA_NOT_FOUND", message: msg });
    } else {
      ctx.log(`Error: ${msg}`);
    }
    process.exitCode = 1;
    return;
  }

  let schema;
  try {
    const raw = fs.readFileSync(schemaPath, "utf8");
    schema = parseSchema(raw);
  } catch (err) {
    const msg = `Schema parse error: ${err.message}`;
    if (flags.json) {
      ctx.result({
        error: true,
        code: "SCHEMA_VALIDATION",
        message: msg,
        errors: err.errors || [],
      });
    } else {
      ctx.log(`Error: ${msg}`);
    }
    process.exitCode = 1;
    return;
  }

  // All config comes from schema.options.
  const outputDir = (schema.options && schema.options.output) || "";
  const baseDir = path.resolve(outputDir || process.cwd());

  const answers = {
    framework: schema.framework,
    database: schema.adapter,
    session: (schema.options && schema.options.session) || "memory",
    rateLimiting: !!(schema.options && schema.options.rateLimiting),
    helmet: !!(schema.options && schema.options.helmet),
    logger: !!(schema.options && schema.options.logger),
    loki: !!(schema.options && schema.options.loki),
    port: schema.options && schema.options.port,
    apiBasePath: schema.options && schema.options.apiBasePath,
    output: outputDir,
  };

  // First-buildout-only guard: refuse if a project already exists in cwd.
  // app.js is the db-model-router project marker (package.json may pre-exist
  // as a legit npm project, so it alone does not block a first buildout).
  if (!flags.dryRun) {
    const cwd = process.cwd();
    if (fs.existsSync(path.join(cwd, "app.js"))) {
      const msg =
        `init is first-buildout only; a project already exists in ${cwd} ` +
        `(app.js present). To add new tables, models, or routes, do it ` +
        `manually — see: db-model-router help init`;
      if (flags.json) {
        ctx.result({ error: true, code: "PROJECT_EXISTS", message: msg });
      } else {
        ctx.log(`Error: ${msg}`);
      }
      process.exitCode = 1;
      return;
    }
  }

  // --- dry-run: report planned files without writing ---
  if (flags.dryRun) {
    const planned = planFiles(answers, outputDir);
    if (flags.json) {
      ctx.result({
        files: planned,
        dependencies: { installed: false },
        actions: ["dry-run"],
      });
    } else {
      ctx.log("Dry run — the following scaffold files would be created:");
      for (const f of planned) {
        ctx.log(`  ${f}`);
      }
    }
    // Preview schema-driven artifacts too (non-writing)
    await buildSchemaArtifacts({ schema, baseDir, ctx, flags });
    if (!flags.json) {
      ctx.log("\nNo files were written.");
    }
    return;
  }

  // --- real run ---
  ensurePackageJson();

  const generated = generateFiles(answers, outputDir);
  updatePackageJson(answers, outputDir);

  const installed = !flags.noInstall;

  // Build init's JSON result first so it lands at ctx._results[0] (buildSchemaArtifacts
  // pushes its own result afterward).
  const allFiles = [
    ...generated.files,
    ...generated.migrationFiles.map((m) => {
      const base = outputDir || ".";
      return base === "." ? `migrations/${m}` : `${base}/migrations/${m}`;
    }),
  ];
  if (flags.json) {
    ctx.result({
      files: allFiles,
      dependencies: { installed },
      actions: installed ? ["scaffolded", "installed"] : ["scaffolded"],
    });
  }

  // Schema-driven artifacts: models, routes, migrations, openapi, tests, SaaS.
  // Generated BEFORE npm install so all files exist on disk first; bail skips
  // install if the build reported an error.
  await buildSchemaArtifacts({ schema, baseDir, ctx, flags });
  if (process.exitCode) return; // bail if build reported an error

  // Install dependencies only after every project file has been written.
  if (installed) {
    runInstall();
  }

  // Human-readable summary (non-json only)
  if (!flags.json) {
    printSummary(generated);
    if (!installed) {
      ctx.log(
        "\nSkipped npm install (--no-install). Run `npm install` manually.",
      );
    }
  }
}

/**
 * Compute the list of scaffold files that would be created (for --dry-run).
 * Mirrors generateFiles() without writing anything.
 *
 * @param {object} answers
 * @param {string} [outputDir] - relative output directory for source files
 * @returns {string[]}
 */
function planFiles(answers, outputDir) {
  const { isSql } = require("../init/generators");
  const srcBase = outputDir || ".";
  const prefix = srcBase === "." ? "" : srcBase + "/";

  const files = [
    "app.js",
    ".env",
    ".env.example",
    ".gitignore",
    "Dockerfile",
    ".dockerignore",
  ];

  if (answers.database !== "sqlite3") {
    files.push("docker-compose.yml");
  }

  files.push(
    `${prefix}middleware/logger.js`,
    `${prefix}commons/session.js`,
    `${prefix}commons/migrate.js`,
    `${prefix}commons/add_migration.js`,
    `${prefix}commons/security.js`,
    `${prefix}commons/db.js`,
    `${prefix}routes/health.js`,
    `${prefix}routes/index.js`,
    `${prefix}migrations/<timestamp>_create_migrations_table` +
      (isSql(answers.database) ? ".sql" : ".js"),
  );

  if (answers.session === "database" && isSql(answers.database)) {
    files.push(`${prefix}migrations/<timestamp>_create_sessions_table.sql`);
  }

  return files;
}

module.exports = init;