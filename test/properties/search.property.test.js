/**
 * Property-Based Test: applySearch (multi-column `search=` builder)
 *
 * Verifies the cross-product algebra that combines a free-text `search` term
 * with an existing filter via AND:
 *
 *   merged = for g in base, for sg in searchGroups: [...g, ...sg]
 *
 * where each search column becomes one OR-group containing a single `like`
 * condition. Result OR-joined == (existing OR-groups) AND (col0 LIKE t OR ...).
 */

const assert = require("assert");
const fc = require("fast-check");
const { applySearch } = require("../../src/commons/model");

const arbCol = fc.stringMatching(/^[a-z][a-z0-9_]{0,8}$/);
const arbTerm = fc.string({ minLength: 1, maxLength: 12 }).filter(
  (s) => s.trim().length > 0,
);

const arbCondition = fc.tuple(arbCol, fc.constantFrom("=", ">", "<", "!="), fc.integer());
const arbAndGroup = fc.array(arbCondition, { minLength: 0, maxLength: 3 });
const arbFilter = fc.array(arbAndGroup, { minLength: 1, maxLength: 2 });

describe("Feature: search, Property: applySearch cross-product", function () {
  it("empty search_columns or missing term returns filter unchanged", function () {
    const filter = [[["name", "=", "alice"]]];
    assert.deepStrictEqual(applySearch(filter, [], "alice"), filter);
    assert.deepStrictEqual(applySearch(filter, null, "alice"), filter);
    assert.deepStrictEqual(applySearch(filter, ["name"], null), filter);
    assert.deepStrictEqual(applySearch(filter, ["name"], undefined), filter);
    assert.deepStrictEqual(applySearch(filter, ["name"], "   "), filter);
  });

  it("produces |base| * |searchColumns| groups, each a superset of its base group plus a like condition", function () {
    fc.assert(
      fc.property(arbFilter, fc.array(arbCol, { minLength: 1, maxLength: 3 }), arbTerm, (base, cols, term) => {
        const merged = applySearch(base, cols, term);
        // group count = base groups * search columns (when base non-empty)
        assert.strictEqual(merged.length, base.length * cols.length);
        const trimmed = String(term).trim();
        let idx = 0;
        for (const g of base) {
          for (const c of cols) {
            const group = merged[idx++];
            // base conditions preserved (prefix)
            assert.deepStrictEqual(group.slice(0, g.length), g);
            // last condition is [col, "like", term]
            const searchCond = group[g.length];
            assert.strictEqual(searchCond[0], c);
            assert.strictEqual(searchCond[1], "like");
            assert.strictEqual(searchCond[2], trimmed);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("empty base ([[]]) collapses to one OR-group per search column", function () {
    const merged = applySearch([[]], ["name", "description", "email"], "alice");
    assert.deepStrictEqual(
      merged,
      [
        [["name", "like", "alice"]],
        [["description", "like", "alice"]],
        [["email", "like", "alice"]],
      ],
    );
  });

  it("AND-combines search with existing single-group filter", function () {
    const base = [[["status", "=", "active"]]];
    const merged = applySearch(base, ["name", "description"], "alice");
    assert.deepStrictEqual(
      merged,
      [
        [["status", "=", "active"], ["name", "like", "alice"]],
        [["status", "=", "active"], ["description", "like", "alice"]],
      ],
    );
  });

  it("term is trimmed and stringified", function () {
    const merged = applySearch([[]], ["name"], "  alice  ");
    assert.deepStrictEqual(merged, [[["name", "like", "alice"]]]);
  });
});