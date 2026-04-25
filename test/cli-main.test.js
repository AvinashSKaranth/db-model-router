"use strict";

const assert = require("assert");

/**
 * Helper: capture console.log and console.error output during a callback.
 */
async function captureOutput(fn) {
  const logs = [];
  const errors = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => errors.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.error = origError;
  }
  return { logs, errors };
}

describe("CLI Entry Point (src/cli/main.js)", function () {
  this.timeout(10000);

  let main, COMMANDS;
  let savedExitCode;

  beforeEach(function () {
    savedExitCode = process.exitCode;
    process.exitCode = 0;
    delete require.cache[require.resolve("../src/cli/main")];
    const mod = require("../src/cli/main");
    main = mod;
    COMMANDS = mod.COMMANDS;
  });

  afterEach(function () {
    process.exitCode = savedExitCode;
  });

  // -------------------------------------------------------------------
  // Requirement 10.2: No subcommand displays help
  // -------------------------------------------------------------------
  describe("no subcommand", function () {
    it("should display help when no subcommand is provided", async function () {
      const { logs } = await captureOutput(() => main([]));
      const output = logs.join("\n");
      assert.ok(output.includes("Usage:"), "Should show usage line");
      assert.ok(output.includes("Commands:"), "Should list commands");
      assert.ok(output.includes("init"), "Should mention init");
      assert.ok(output.includes("inspect"), "Should mention inspect");
      assert.ok(output.includes("generate"), "Should mention generate");
      assert.ok(output.includes("doctor"), "Should mention doctor");
      assert.ok(output.includes("diff"), "Should mention diff");
    });
  });

  // -------------------------------------------------------------------
  // Requirement 10.3: --help displays help
  // -------------------------------------------------------------------
  describe("--help flag", function () {
    it("should display help when --help is provided", async function () {
      const { logs } = await captureOutput(() => main(["--help"]));
      const output = logs.join("\n");
      assert.ok(output.includes("Usage:"), "Should show usage line");
      assert.ok(output.includes("Commands:"), "Should list commands");
    });

    it("should display help when --help is provided with a subcommand", async function () {
      // --help takes precedence and shows top-level help
      const { logs } = await captureOutput(() => main(["generate", "--help"]));
      const output = logs.join("\n");
      assert.ok(output.includes("Usage:"), "Should show usage line");
    });
  });

  // -------------------------------------------------------------------
  // Requirement 10.5: Unknown subcommand exits with code 1
  // -------------------------------------------------------------------
  describe("unknown subcommand", function () {
    it("should exit with code 1 for unknown subcommand", async function () {
      await captureOutput(() => main(["foobar"]));
      assert.strictEqual(process.exitCode, 1, "Should set exit code to 1");
    });

    it("should list valid subcommands in error message", async function () {
      const { errors } = await captureOutput(() => main(["foobar"]));
      const output = errors.join("\n");
      assert.ok(
        output.includes("Unknown command: foobar"),
        "Should show unknown command error",
      );
      assert.ok(output.includes("init"), "Should list init as valid");
      assert.ok(output.includes("inspect"), "Should list inspect as valid");
      assert.ok(output.includes("generate"), "Should list generate as valid");
      assert.ok(output.includes("doctor"), "Should list doctor as valid");
      assert.ok(output.includes("diff"), "Should list diff as valid");
    });
  });

  // -------------------------------------------------------------------
  // Requirement 10.1: Subcommand dispatch
  // -------------------------------------------------------------------
  describe("subcommand dispatch", function () {
    it("should have all expected command handlers registered", function () {
      assert.ok(typeof COMMANDS.init === "function", "init handler exists");
      assert.ok(
        typeof COMMANDS.inspect === "function",
        "inspect handler exists",
      );
      assert.ok(
        typeof COMMANDS.generate === "function",
        "generate handler exists",
      );
      assert.ok(typeof COMMANDS.doctor === "function", "doctor handler exists");
      assert.ok(typeof COMMANDS.diff === "function", "diff handler exists");
    });

    it("should dispatch to the correct handler for each subcommand", async function () {
      const dispatched = [];
      const origCommands = {};

      // Temporarily replace command handlers with stubs
      for (const name of Object.keys(COMMANDS)) {
        origCommands[name] = COMMANDS[name];
        COMMANDS[name] = async (args, flags, ctx) => {
          dispatched.push(name);
        };
      }

      try {
        for (const name of ["init", "inspect", "generate", "doctor", "diff"]) {
          dispatched.length = 0;
          await captureOutput(() => main([name]));
          assert.deepStrictEqual(
            dispatched,
            [name],
            `Should dispatch to ${name}`,
          );
        }
      } finally {
        // Restore original handlers
        for (const name of Object.keys(origCommands)) {
          COMMANDS[name] = origCommands[name];
        }
      }
    });
  });

  // -------------------------------------------------------------------
  // Requirement 10.1: Unified bin entry
  // -------------------------------------------------------------------
  describe("bin entry", function () {
    it("should have the db-model-router bin entry pointing to main.js", function () {
      const pkg = require("../package.json");
      assert.strictEqual(
        pkg.bin["db-model-router"],
        "src/cli/main.js",
        "db-model-router should point to src/cli/main.js",
      );
    });

    it("should only have the unified bin entry", function () {
      const pkg = require("../package.json");
      const binKeys = Object.keys(pkg.bin);
      assert.deepStrictEqual(binKeys, ["db-model-router"]);
    });
  });
});
