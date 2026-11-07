"use strict";

const fs = require("fs");
const path = require("path");
const { generateTypes } = require("../generate-types");

/**
 * CLI command handler for `db-model-router types`
 */
async function typesCommand(flags, outputContext) {
  const schemaPath = flags.from || flags._?.[1] || "dbmr.schema.json";
  const resolvedSchemaPath = path.resolve(process.cwd(), schemaPath);

  if (!fs.existsSync(resolvedSchemaPath)) {
    const msg = `Schema file not found at: ${resolvedSchemaPath}`;
    if (outputContext) {
      outputContext.error(msg);
      return 1;
    }
    throw new Error(msg);
  }

  let schema;
  try {
    const raw = fs.readFileSync(resolvedSchemaPath, "utf-8");
    schema = JSON.parse(raw);
  } catch (err) {
    const msg = `Failed to parse schema file: ${err.message}`;
    if (outputContext) {
      outputContext.error(msg);
      return 1;
    }
    throw new Error(msg, { cause: err });
  }

  const generatedDts = generateTypes(schema);

  if (flags.stdout) {
    process.stdout.write(generatedDts);
    return 0;
  }

  const outPath = flags.out || path.join("types", "models.d.ts");
  const resolvedOutPath = path.resolve(process.cwd(), outPath);
  const outDir = path.dirname(resolvedOutPath);

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(resolvedOutPath, generatedDts, "utf-8");

  if (outputContext) {
    outputContext.success(`Generated TypeScript definitions at: ${outPath}`);
  } else {
    console.log(`Generated TypeScript definitions at: ${outPath}`);
  }

  return 0;
}

module.exports = typesCommand;
