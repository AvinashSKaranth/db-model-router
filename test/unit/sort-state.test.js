"use strict";

const assert = require("assert");
const { nextSortState } = require("../../db-manager/utils/sort-state");

describe("Sort State Utility", function () {
  describe("nextSortState", function () {
    it("should return asc when clicking a column with no current sort", function () {
      var result = nextSortState({ column: null, dir: null }, "name");
      assert.deepStrictEqual(result, { column: "name", dir: "asc" });
    });

    it("should return desc when clicking the same column that is currently asc", function () {
      var result = nextSortState({ column: "name", dir: "asc" }, "name");
      assert.deepStrictEqual(result, { column: "name", dir: "desc" });
    });

    it("should clear sort when clicking the same column that is currently desc", function () {
      var result = nextSortState({ column: "name", dir: "desc" }, "name");
      assert.deepStrictEqual(result, { column: null, dir: null });
    });

    it("should reset to asc when clicking a different column", function () {
      var result = nextSortState({ column: "name", dir: "asc" }, "email");
      assert.deepStrictEqual(result, { column: "email", dir: "asc" });
    });

    it("should reset to asc when clicking a different column from desc state", function () {
      var result = nextSortState({ column: "name", dir: "desc" }, "id");
      assert.deepStrictEqual(result, { column: "id", dir: "asc" });
    });

    it("should handle clicking a column when current state has null dir on a different column", function () {
      var result = nextSortState({ column: "age", dir: null }, "name");
      assert.deepStrictEqual(result, { column: "name", dir: "asc" });
    });

    it("should complete a full cycle on the same column", function () {
      // Start: no sort
      var state = { column: null, dir: null };

      // First click → asc
      state = nextSortState(state, "price");
      assert.deepStrictEqual(state, { column: "price", dir: "asc" });

      // Second click → desc
      state = nextSortState(state, "price");
      assert.deepStrictEqual(state, { column: "price", dir: "desc" });

      // Third click → clear
      state = nextSortState(state, "price");
      assert.deepStrictEqual(state, { column: null, dir: null });

      // Fourth click → asc again (new cycle)
      state = nextSortState(state, "price");
      assert.deepStrictEqual(state, { column: "price", dir: "asc" });
    });

    it("should handle switching columns mid-cycle", function () {
      // Sort by name desc
      var state = { column: "name", dir: "desc" };

      // Click email → resets to asc on email
      state = nextSortState(state, "email");
      assert.deepStrictEqual(state, { column: "email", dir: "asc" });

      // Click email again → desc on email
      state = nextSortState(state, "email");
      assert.deepStrictEqual(state, { column: "email", dir: "desc" });

      // Click name → resets to asc on name
      state = nextSortState(state, "name");
      assert.deepStrictEqual(state, { column: "name", dir: "asc" });
    });
  });
});
