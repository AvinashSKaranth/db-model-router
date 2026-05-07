"use strict";

const assert = require("assert");
const { parseFilters } = require("../../db-manager/utils/parse-filters");

describe("Parse Filters Utility", function () {
  describe("parseFilters", function () {
    it("should return empty array when no filter params present", function () {
      var result = parseFilters({ page: "0", limit: "30" });
      assert.deepStrictEqual(result, []);
    });

    it("should parse a single filter parameter", function () {
      var result = parseFilters({ "filter[name]": "ali" });
      assert.deepStrictEqual(result, [["name", "like", "ali"]]);
    });

    it("should parse multiple filter parameters", function () {
      var result = parseFilters({
        "filter[name]": "ali",
        "filter[email]": "gmail",
      });
      assert.strictEqual(result.length, 2);
      assert.deepStrictEqual(result[0], ["name", "like", "ali"]);
      assert.deepStrictEqual(result[1], ["email", "like", "gmail"]);
    });

    it("should ignore non-filter query params", function () {
      var result = parseFilters({
        "filter[name]": "ali",
        page: "0",
        limit: "30",
        sort: "name",
        dir: "asc",
      });
      assert.strictEqual(result.length, 1);
      assert.deepStrictEqual(result[0], ["name", "like", "ali"]);
    });

    it("should return empty array for null input", function () {
      var result = parseFilters(null);
      assert.deepStrictEqual(result, []);
    });

    it("should return empty array for undefined input", function () {
      var result = parseFilters(undefined);
      assert.deepStrictEqual(result, []);
    });

    it("should return empty array for non-object input", function () {
      var result = parseFilters("not an object");
      assert.deepStrictEqual(result, []);
    });

    it("should ignore filter params with empty string value", function () {
      var result = parseFilters({ "filter[name]": "" });
      assert.deepStrictEqual(result, []);
    });

    it("should handle column names with underscores", function () {
      var result = parseFilters({ "filter[first_name]": "john" });
      assert.deepStrictEqual(result, [["first_name", "like", "john"]]);
    });

    it("should handle column names with numbers", function () {
      var result = parseFilters({ "filter[col1]": "test" });
      assert.deepStrictEqual(result, [["col1", "like", "test"]]);
    });

    it("should use 'like' as the operator for all filters", function () {
      var result = parseFilters({
        "filter[a]": "x",
        "filter[b]": "y",
        "filter[c]": "z",
      });
      result.forEach(function (tuple) {
        assert.strictEqual(tuple[1], "like");
      });
    });

    it("should preserve the filter value exactly as provided", function () {
      var result = parseFilters({ "filter[name]": "Ali Ce" });
      assert.deepStrictEqual(result, [["name", "like", "Ali Ce"]]);
    });

    it("should handle empty query params object", function () {
      var result = parseFilters({});
      assert.deepStrictEqual(result, []);
    });
  });
});
