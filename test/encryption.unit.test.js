"use strict";

process.env.NODE_ENV = "TEST";
const assert = require("assert");
const crypto = require("crypto");
const encryption = require("../src/commons/encryption");

const TEST_KEY_REF = "env:TEST_ENC_KEY";
const testSecret = "unit-test-secret";
process.env.TEST_ENC_KEY = testSecret;

describe("encryption engine (src/commons/encryption.js)", function () {
  let key;

  before(function () {
    key = encryption.resolveKey(TEST_KEY_REF);
  });

  describe("resolveKey", function () {
    it("resolves env:VAR to a deterministic 32-byte key", function () {
      assert.strictEqual(key.length, 32);
      const again = encryption.resolveKey(TEST_KEY_REF);
      assert.deepStrictEqual(again, key);
    });

    it("accepts a 32-byte base64 literal as-is", function () {
      const literal = crypto.randomBytes(32).toString("base64");
      const resolved = encryption.resolveKey(literal);
      assert.deepStrictEqual(resolved, Buffer.from(literal, "base64"));
      assert.strictEqual(resolved.length, 32);
    });

    it("hashes non-32-byte base64 and plain strings", function () {
      const plain = encryption.resolveKey("some-plain-password");
      assert.strictEqual(plain.length, 32);
      const shortB64 = encryption.resolveKey("abc");
      assert.strictEqual(shortB64.length, 32);
    });

    it("throws for a missing env var", function () {
      assert.throws(() => encryption.resolveKey("env:MISSING_VAR_XYZ"));
    });

    it("throws for an empty reference", function () {
      assert.throws(() => encryption.resolveKey(""));
    });
  });

  describe("encrypt/decrypt roundtrip", function () {
    it("encrypts a value into an envelope with the enc:v1: prefix", function () {
      const envelope = encryption.encrypt("hello world", key, 1);
      assert.ok(envelope.startsWith("enc:v1:"));
    });

    it("decrypts an envelope back to the original plaintext", function () {
      const envelope = encryption.encrypt("hello world", key, 1);
      assert.strictEqual(
        encryption.decrypt(envelope, { 1: key }),
        "hello world",
      );
    });

    it("uses a fresh IV per call (same plaintext produces different output)", function () {
      const a = encryption.encrypt("same", key, 1);
      const b = encryption.encrypt("same", key, 1);
      assert.notStrictEqual(a, b);
    });

    it("survives base64 with embedded + / = characters", function () {
      const plaintext = 'p@ssw0rdWith!/=special+chars "quoted" and \'quotes\'';
      const envelope = encryption.encrypt(plaintext, key, 1);
      assert.strictEqual(
        encryption.decrypt(envelope, { 1: key }),
        plaintext,
      );
    });

    it("round-trips unicode content", function () {
      const plaintext = "héllo wörld — 日本語 🎉";
      const envelope = encryption.encrypt(plaintext, key, 1);
      assert.strictEqual(
        encryption.decrypt(envelope, { 1: key }),
        plaintext,
      );
    });

    it("throws when decrypting a tampered envelope", function () {
      const envelope = encryption.encrypt("secret", key, 1);
      const parts = envelope.split(":");
      const payload = parts.slice(2).join(":");
      const buf = Buffer.from(payload, "base64");
      buf[buf.length - 1] ^= 0xff;
      const tampered = `enc:v1:${buf.toString("base64")}`;
      assert.throws(() => encryption.decrypt(tampered, { 1: key }));
    });

    it("throws when the key version is missing from the keyring", function () {
      const envelope = encryption.encrypt("secret", key, 1);
      assert.throws(
        () => encryption.decrypt(envelope, { 2: key }),
        /No key available for encryption version v1/,
      );
    });

    it("throws on a value that is not an envelope", function () {
      assert.throws(() => encryption.decrypt("plaintext", { 1: key }));
      assert.throws(() => encryption.decrypt("enc:broken", { 1: key }));
    });

    it("throws when encrypting null/undefined", function () {
      assert.throws(() => encryption.encrypt(null, key, 1));
      assert.throws(() => encryption.encrypt(undefined, key, 1));
    });
  });

  describe("parseEnvelope / isEncrypted", function () {
    it("marks envelope strings as encrypted", function () {
      const envelope = encryption.encrypt("x", key, 1);
      assert.strictEqual(encryption.isEncrypted(envelope), true);
      assert.strictEqual(encryption.isEncrypted("plain"), false);
      assert.strictEqual(encryption.isEncrypted(123), false);
      assert.strictEqual(encryption.isEncrypted(null), false);
    });

    it("parses envelope version and payload", function () {
      const envelope = encryption.encrypt("x", key, 7);
      const parsed = encryption.parseEnvelope(envelope);
      assert.strictEqual(parsed.version, 7);
      assert.ok(typeof parsed.payload === "string" && parsed.payload.length > 0);
    });

    it("returns null for malformed values", function () {
      assert.strictEqual(encryption.parseEnvelope("enc:not-a-format"), null);
      assert.strictEqual(encryption.parseEnvelope(42), null);
      assert.strictEqual(encryption.parseEnvelope("plaintext"), null);
    });
  });

  describe("typed serialization", function () {
    it("stringifies numbers before encryption", function () {
      assert.strictEqual(encryption.serializeValue(42, "integer"), "42");
      assert.strictEqual(encryption.serializeValue(3.14, "numeric"), "3.14");
    });

    it("stringifies booleans", function () {
      assert.strictEqual(encryption.serializeValue(true, "boolean"), "true");
      assert.strictEqual(encryption.serializeValue(false, "boolean"), "false");
    });

    it("preserves truthy boolean representations", function () {
      assert.strictEqual(encryption.serializeValue(1, "boolean"), "true");
      assert.strictEqual(encryption.serializeValue(0, "boolean"), "false");
      assert.strictEqual(encryption.serializeValue("true", "boolean"), "true");
      assert.strictEqual(encryption.serializeValue("TRUE", "boolean"), "true");
      assert.strictEqual(encryption.serializeValue("false", "boolean"), "false");
    });

    it("passes null through", function () {
      assert.strictEqual(encryption.serializeValue(null, "string"), null);
    });

    it("round-trips deserializeValue", function () {
      assert.strictEqual(encryption.deserializeValue("42", "integer"), 42);
      assert.strictEqual(encryption.deserializeValue("3.14", "numeric"), 3.14);
      assert.strictEqual(encryption.deserializeValue("true", "boolean"), true);
      assert.strictEqual(encryption.deserializeValue("false", "boolean"), false);
      assert.strictEqual(encryption.deserializeValue("hello", "string"), "hello");
    });

    it("preserves non-numeric strings in typed decryption", function () {
      assert.strictEqual(encryption.deserializeValue("abc", "integer"), "abc");
    });
  });

  describe("compileEncryptionMeta", function () {
    it("collects column-level fields", function () {
      const meta = encryption.compileEncryptionMeta({
        ssn: "encrypted|required|string",
        name: "required|string",
      });
      assert.strictEqual(meta.hasEncrypted, true);
      assert.deepStrictEqual(meta.columns.ssn, { type: "string" });
      assert.strictEqual(meta.columns.name, undefined);
    });

    it("collects dotted JSON keys", function () {
      const meta = encryption.compileEncryptionMeta({
        profile: "object",
        "profile.dob": "encrypted|required|datetime",
      });
      assert.strictEqual(meta.hasEncrypted, true);
      assert.deepStrictEqual(meta.jsonKeys.profile[0].path, ["dob"]);
      assert.strictEqual(meta.jsonKeys.profile[0].type, "datetime");
    });

    it("recognizes sub-typed encrypted columns by their base type", function () {
      const meta = encryption.compileEncryptionMeta({
        raw_response: "encrypted|string:longtext",
        score: "encrypted|integer:unsigned",
        flag: "encrypted|required|boolean",
      });
      assert.strictEqual(meta.hasEncrypted, true);
      assert.deepStrictEqual(meta.columns.raw_response, { type: "string" });
      assert.deepStrictEqual(meta.columns.score, { type: "integer" });
      assert.deepStrictEqual(meta.columns.flag, { type: "boolean" });
    });

    it("returns hasEncrypted=false when nothing is encrypted", function () {
      const meta = encryption.compileEncryptionMeta({
        a: "string",
        b: "object",
      });
      assert.strictEqual(meta.hasEncrypted, false);
    });

    it("ignores non-encryptable types", function () {
      const stderr = [];
      const origWarn = console.warn;
      console.warn = (msg) => stderr.push(msg);
      try {
        const meta = encryption.compileEncryptionMeta({
          blob: "encrypted|string",
          weird: "encrypted|object",
        });
        assert.strictEqual(meta.columns.weird, undefined);
        assert.strictEqual(meta.hasEncrypted, true);
      } finally {
        console.warn = origWarn;
      }
      assert.ok(
        stderr.some((m) => m.includes("weird") && m.includes('type "object"')),
        "should warn about the non-encryptable type",
      );
    });

    it("warns when encrypted has no resolvable base type", function () {
      const stderr = [];
      const origWarn = console.warn;
      console.warn = (msg) => stderr.push(msg);
      try {
        const meta = encryption.compileEncryptionMeta({
          broken: "encrypted|required",
        });
        assert.strictEqual(meta.columns.broken, undefined);
        assert.strictEqual(meta.hasEncrypted, false);
      } finally {
        console.warn = origWarn;
      }
      assert.ok(
        stderr.some((m) => m.includes("broken") && m.includes("(none)")),
        "should warn about the missing base type",
      );
    });

    it("returns empty meta for null/undefined structure", function () {
      assert.strictEqual(encryption.compileEncryptionMeta(undefined).hasEncrypted, false);
      assert.strictEqual(encryption.compileEncryptionMeta(null).hasEncrypted, false);
    });
  });

  describe("sanitizeRule", function () {
    it("strips the encrypted token", function () {
      assert.strictEqual(
        encryption.sanitizeRule("encrypted|required|string"),
        "required|string",
      );
      assert.strictEqual(
        encryption.sanitizeRule("encrypted|string"),
        "string",
      );
    });

    it("passes rules without encrypted through unchanged", function () {
      assert.strictEqual(encryption.sanitizeRule("required|string"), "required|string");
      assert.strictEqual(encryption.sanitizeRule("object"), "object");
    });
  });

  describe("setConfig / getConfig / getKeyring", function () {
    let config;

    it("resolves a single key into the keyring", function () {
      encryption.setConfig({ key: TEST_KEY_REF, version: 1 });
      config = encryption.getConfig();
      assert.strictEqual(config.version, 1);
      assert.ok(Buffer.isBuffer(config.key));
      assert.deepStrictEqual(config.keyring[1], config.key);
    });

    it("adds historical keys from the keys map", function () {
      process.env.TEST_ENC_KEY_OLD = "old-secret";
      encryption.setConfig({
        key: TEST_KEY_REF,
        version: 2,
        keys: { 1: "env:TEST_ENC_KEY_OLD", 2: TEST_KEY_REF },
      });
      config = encryption.getConfig();
      assert.ok(config.keyring[1]);
      assert.ok(config.keyring[2]);
      assert.notDeepStrictEqual(config.keyring[1], config.keyring[2]);
    });

    it("throws for invalid configs", function () {
      assert.throws(() => encryption.setConfig({ key: TEST_KEY_REF, version: 0 }));
      assert.throws(() => encryption.setConfig({ version: 1 }));
      assert.throws(() => encryption.setConfig("nope"));
    });

    it("clears config with setConfig(null)", function () {
      encryption.setConfig(null);
      assert.strictEqual(encryption.getConfig(), null);
      assert.strictEqual(encryption.getKeyring(), null);
    });

    it("exposes keyring via getKeyring", function () {
      encryption.setConfig({ key: TEST_KEY_REF, version: 1 });
      assert.deepStrictEqual(encryption.getKeyring()[1], encryption.getConfig().key);
    });
  });
});