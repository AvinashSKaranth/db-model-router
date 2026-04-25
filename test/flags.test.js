"use strict";

const assert = require("assert");
const { parseFlags, OutputContext } = require("../src/cli/flags");

describe("Flag Parser", function () {
  // -------------------------------------------------------------------------
  // Boolean flags
  // -------------------------------------------------------------------------
  describe("boolean flags", function () {
    it("parses --yes flag", function () {
      const { flags } = parseFlags(["--yes"]);
      assert.strictEqual(flags.yes, true);
    });

    it("parses --json flag", function () {
      const { flags } = parseFlags(["--json"]);
      assert.strictEqual(flags.json, true);
    });

    it("parses --dry-run flag", function () {
      const { flags } = parseFlags(["--dry-run"]);
      assert.strictEqual(flags.dryRun, true);
    });

    it("parses --no-install flag", function () {
      const { flags } = parseFlags(["--no-install"]);
      assert.strictEqual(flags.noInstall, true);
    });

    it("parses --help flag", function () {
      const { flags } = parseFlags(["--help"]);
      assert.strictEqual(flags.help, true);
    });

    it("defaults all flags to false when none provided", function () {
      const { flags } = parseFlags(["generate"]);
      assert.strictEqual(flags.yes, false);
      assert.strictEqual(flags.json, false);
      assert.strictEqual(flags.dryRun, false);
      assert.strictEqual(flags.noInstall, false);
      assert.strictEqual(flags.help, false);
    });
  });

  // -------------------------------------------------------------------------
  // Multiple flags combined
  // -------------------------------------------------------------------------
  describe("flag combinations", function () {
    it("parses all flags together", function () {
      const { flags } = parseFlags([
        "init",
        "--yes",
        "--json",
        "--dry-run",
        "--no-install",
        "--help",
      ]);
      assert.strictEqual(flags.yes, true);
      assert.strictEqual(flags.json, true);
      assert.strictEqual(flags.dryRun, true);
      assert.strictEqual(flags.noInstall, true);
      assert.strictEqual(flags.help, true);
    });

    it("parses flags before and after subcommand", function () {
      const { subcommand, flags } = parseFlags([
        "--json",
        "generate",
        "--dry-run",
      ]);
      assert.strictEqual(subcommand, "generate");
      assert.strictEqual(flags.json, true);
      assert.strictEqual(flags.dryRun, true);
    });
  });

  // -------------------------------------------------------------------------
  // Subcommand extraction
  // -------------------------------------------------------------------------
  describe("subcommand extraction", function () {
    it("extracts the first non-flag argument as subcommand", function () {
      const { subcommand } = parseFlags(["generate"]);
      assert.strictEqual(subcommand, "generate");
    });

    it("returns null when no subcommand is provided", function () {
      const { subcommand } = parseFlags(["--help"]);
      assert.strictEqual(subcommand, null);
    });

    it("returns null for empty argv", function () {
      const { subcommand } = parseFlags([]);
      assert.strictEqual(subcommand, null);
    });

    it("extracts subcommand when mixed with flags", function () {
      const { subcommand } = parseFlags(["--yes", "doctor", "--json"]);
      assert.strictEqual(subcommand, "doctor");
    });
  });

  // -------------------------------------------------------------------------
  // Key-value args
  // -------------------------------------------------------------------------
  describe("key-value args", function () {
    it("collects --from as a key-value arg", function () {
      const { args } = parseFlags(["generate", "--from", "schema.json"]);
      assert.strictEqual(args.from, "schema.json");
    });

    it("collects multiple key-value args", function () {
      const { args } = parseFlags([
        "inspect",
        "--out",
        "output.json",
        "--env",
        ".env.local",
        "--type",
        "postgres",
      ]);
      assert.strictEqual(args.out, "output.json");
      assert.strictEqual(args.env, ".env.local");
      assert.strictEqual(args.type, "postgres");
    });

    it("treats a flag with no following value as boolean true", function () {
      const { args } = parseFlags(["generate", "--models"]);
      assert.strictEqual(args.models, true);
    });

    it("treats a flag followed by another flag as boolean true", function () {
      const { args } = parseFlags(["generate", "--models", "--routes"]);
      assert.strictEqual(args.models, true);
      assert.strictEqual(args.routes, true);
    });
  });
});

describe("OutputContext", function () {
  // -------------------------------------------------------------------------
  // log() behavior
  // -------------------------------------------------------------------------
  describe("log()", function () {
    it("suppresses output when --json is active", function () {
      const logs = [];
      const origLog = console.log;
      console.log = (msg) => logs.push(msg);
      try {
        const ctx = new OutputContext({ json: true });
        ctx.log("hello");
        assert.strictEqual(logs.length, 0);
      } finally {
        console.log = origLog;
      }
    });

    it("prints output when --json is not active", function () {
      const logs = [];
      const origLog = console.log;
      console.log = (msg) => logs.push(msg);
      try {
        const ctx = new OutputContext({ json: false });
        ctx.log("hello");
        assert.strictEqual(logs.length, 1);
        assert.strictEqual(logs[0], "hello");
      } finally {
        console.log = origLog;
      }
    });
  });

  // -------------------------------------------------------------------------
  // result() accumulation
  // -------------------------------------------------------------------------
  describe("result()", function () {
    it("accumulates data for later flushing", function () {
      const ctx = new OutputContext({ json: true });
      ctx.result({ files: ["a.js"] });
      ctx.result({ files: ["b.js"] });
      // Verify internal state via flush
      const logs = [];
      const origLog = console.log;
      console.log = (msg) => logs.push(msg);
      try {
        ctx.flush();
        assert.strictEqual(logs.length, 1);
        const parsed = JSON.parse(logs[0]);
        assert.ok(Array.isArray(parsed));
        assert.strictEqual(parsed.length, 2);
      } finally {
        console.log = origLog;
      }
    });
  });

  // -------------------------------------------------------------------------
  // flush() behavior
  // -------------------------------------------------------------------------
  describe("flush()", function () {
    it("outputs valid JSON when --json is active", function () {
      const logs = [];
      const origLog = console.log;
      console.log = (msg) => logs.push(msg);
      try {
        const ctx = new OutputContext({ json: true });
        ctx.result({ status: "ok", files: ["model.js"] });
        ctx.flush();
        assert.strictEqual(logs.length, 1);
        const parsed = JSON.parse(logs[0]);
        assert.deepStrictEqual(parsed, {
          status: "ok",
          files: ["model.js"],
        });
      } finally {
        console.log = origLog;
      }
    });

    it("outputs single result directly (not wrapped in array)", function () {
      const logs = [];
      const origLog = console.log;
      console.log = (msg) => logs.push(msg);
      try {
        const ctx = new OutputContext({ json: true });
        ctx.result({ count: 3 });
        ctx.flush();
        const parsed = JSON.parse(logs[0]);
        assert.deepStrictEqual(parsed, { count: 3 });
      } finally {
        console.log = origLog;
      }
    });

    it("is a no-op when --json is not active", function () {
      const logs = [];
      const origLog = console.log;
      console.log = (msg) => logs.push(msg);
      try {
        const ctx = new OutputContext({ json: false });
        ctx.result({ data: 1 });
        ctx.flush();
        assert.strictEqual(logs.length, 0);
      } finally {
        console.log = origLog;
      }
    });

    it("is a no-op when no results accumulated", function () {
      const logs = [];
      const origLog = console.log;
      console.log = (msg) => logs.push(msg);
      try {
        const ctx = new OutputContext({ json: true });
        ctx.flush();
        assert.strictEqual(logs.length, 0);
      } finally {
        console.log = origLog;
      }
    });
  });
});
