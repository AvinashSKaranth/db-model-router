"use strict";

const assert = require("assert");
const {
  generateCSV,
  escapeCSVCell,
} = require("../../db-manager/utils/csv-export");

describe("CSV Export Utility", function () {
  describe("escapeCSVCell", function () {
    it("should return empty string for null", function () {
      assert.strictEqual(escapeCSVCell(null), "");
    });

    it("should return empty string for undefined", function () {
      assert.strictEqual(escapeCSVCell(undefined), "");
    });

    it("should convert numbers to string without quotes", function () {
      assert.strictEqual(escapeCSVCell(42), "42");
      assert.strictEqual(escapeCSVCell(3.14), "3.14");
      assert.strictEqual(escapeCSVCell(0), "0");
    });

    it("should return plain string when no special characters", function () {
      assert.strictEqual(escapeCSVCell("hello"), "hello");
      assert.strictEqual(escapeCSVCell("simple text"), "simple text");
    });

    it("should wrap in double quotes when value contains a comma", function () {
      assert.strictEqual(escapeCSVCell("has, comma"), '"has, comma"');
    });

    it("should wrap in double quotes and double internal quotes", function () {
      assert.strictEqual(escapeCSVCell('has "quotes"'), '"has ""quotes"""');
    });

    it("should wrap in double quotes when value contains newline", function () {
      assert.strictEqual(escapeCSVCell("line1\nline2"), '"line1\nline2"');
    });

    it("should wrap in double quotes when value contains carriage return", function () {
      assert.strictEqual(escapeCSVCell("line1\rline2"), '"line1\rline2"');
    });

    it("should handle empty string without quoting", function () {
      assert.strictEqual(escapeCSVCell(""), "");
    });

    it("should handle value with only double quotes", function () {
      assert.strictEqual(escapeCSVCell('""'), '""""""');
    });

    it("should handle value with comma, quote, and newline combined", function () {
      assert.strictEqual(escapeCSVCell('a,"b\n'), '"a,""b\n"');
    });
  });

  describe("generateCSV", function () {
    it("should generate header row from columns", function () {
      var result = generateCSV(["id", "name", "email"], []);
      assert.strictEqual(result, "id,name,email\r\n");
    });

    it("should generate header and data rows", function () {
      var columns = ["id", "name"];
      var rows = [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ];
      var result = generateCSV(columns, rows);
      assert.strictEqual(result, "id,name\r\n1,Alice\r\n2,Bob\r\n");
    });

    it("should handle null values in rows as empty string", function () {
      var columns = ["id", "name"];
      var rows = [{ id: 1, name: null }];
      var result = generateCSV(columns, rows);
      assert.strictEqual(result, "id,name\r\n1,\r\n");
    });

    it("should handle undefined values in rows as empty string", function () {
      var columns = ["id", "name"];
      var rows = [{ id: 1 }]; // name is undefined
      var result = generateCSV(columns, rows);
      assert.strictEqual(result, "id,name\r\n1,\r\n");
    });

    it("should escape cell values containing special characters", function () {
      var columns = ["id", "description"];
      var rows = [{ id: 1, description: 'has, "special"\nnewline' }];
      var result = generateCSV(columns, rows);
      assert.strictEqual(
        result,
        'id,description\r\n1,"has, ""special""\nnewline"\r\n',
      );
    });

    it("should escape column names containing special characters", function () {
      var columns = ["id", "name, first"];
      var rows = [{ id: 1, "name, first": "Alice" }];
      var result = generateCSV(columns, rows);
      assert.strictEqual(result, 'id,"name, first"\r\n1,Alice\r\n');
    });

    it("should handle empty rows array", function () {
      var result = generateCSV(["a", "b"], []);
      assert.strictEqual(result, "a,b\r\n");
    });

    it("should use CRLF line endings per RFC 4180", function () {
      var result = generateCSV(["x"], [{ x: 1 }, { x: 2 }]);
      var lines = result.split("\r\n");
      assert.strictEqual(lines[0], "x");
      assert.strictEqual(lines[1], "1");
      assert.strictEqual(lines[2], "2");
      assert.strictEqual(lines[3], ""); // trailing CRLF produces empty last element
    });
  });
});
