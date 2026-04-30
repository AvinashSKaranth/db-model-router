const assert = require("assert");
const {
  parseFilterValue,
  objectToFilter,
  dataToFilter,
} = require("../src/commons/validator");

describe("Filter Operators — parseFilterValue", function () {
  describe("exact match (=)", function () {
    it("should return = for a plain string", function () {
      const [op, val] = parseFilterValue("john");
      assert.strictEqual(op, "=");
      assert.strictEqual(val, "john");
    });

    it("should return = for a number", function () {
      const [op, val] = parseFilterValue(42);
      assert.strictEqual(op, "=");
      assert.strictEqual(val, 42);
    });

    it("should return = for a boolean", function () {
      const [op, val] = parseFilterValue(true);
      assert.strictEqual(op, "=");
      assert.strictEqual(val, true);
    });

    it("should return = for null", function () {
      const [op, val] = parseFilterValue(null);
      assert.strictEqual(op, "=");
      assert.strictEqual(val, null);
    });
  });

  describe("not equal (!=)", function () {
    it("should return != for !value", function () {
      const [op, val] = parseFilterValue("!john");
      assert.strictEqual(op, "!=");
      assert.strictEqual(val, "john");
    });

    it("should return != for !123", function () {
      const [op, val] = parseFilterValue("!123");
      assert.strictEqual(op, "!=");
      assert.strictEqual(val, "123");
    });
  });

  describe("greater than (>)", function () {
    it("should return > for >value", function () {
      const [op, val] = parseFilterValue(">25");
      assert.strictEqual(op, ">");
      assert.strictEqual(val, "25");
    });
  });

  describe("greater than or equal (>=)", function () {
    it("should return >= for >=value", function () {
      const [op, val] = parseFilterValue(">=25");
      assert.strictEqual(op, ">=");
      assert.strictEqual(val, "25");
    });
  });

  describe("less than (<)", function () {
    it("should return < for <value", function () {
      const [op, val] = parseFilterValue("<100");
      assert.strictEqual(op, "<");
      assert.strictEqual(val, "100");
    });
  });

  describe("less than or equal (<=)", function () {
    it("should return <= for <=value", function () {
      const [op, val] = parseFilterValue("<=100");
      assert.strictEqual(op, "<=");
      assert.strictEqual(val, "100");
    });
  });

  describe("like", function () {
    it("should return like for %value% (contains)", function () {
      const [op, val] = parseFilterValue("%john%");
      assert.strictEqual(op, "like");
      assert.strictEqual(val, "%john%");
    });

    it("should return like for %value (ends with)", function () {
      const [op, val] = parseFilterValue("%john");
      assert.strictEqual(op, "like");
      assert.strictEqual(val, "%john");
    });

    it("should return like for value% (starts with)", function () {
      const [op, val] = parseFilterValue("john%");
      assert.strictEqual(op, "like");
      assert.strictEqual(val, "john%");
    });
  });

  describe("not like", function () {
    it("should return not like for !%value%", function () {
      const [op, val] = parseFilterValue("!%john%");
      assert.strictEqual(op, "not like");
      assert.strictEqual(val, "%john%");
    });

    it("should return not like for !%value (ends with negated)", function () {
      const [op, val] = parseFilterValue("!%john");
      assert.strictEqual(op, "not like");
      assert.strictEqual(val, "%john");
    });

    it("should return not like for !value% (starts with negated)", function () {
      const [op, val] = parseFilterValue("!john%");
      assert.strictEqual(op, "not like");
      assert.strictEqual(val, "john%");
    });
  });

  describe("in", function () {
    it("should return in with array for in(a,b,c)", function () {
      const [op, val] = parseFilterValue("in(john,snow,ram)");
      assert.strictEqual(op, "in");
      assert.deepStrictEqual(val, ["john", "snow", "ram"]);
    });

    it("should return in with single item for in(a)", function () {
      const [op, val] = parseFilterValue("in(active)");
      assert.strictEqual(op, "in");
      assert.deepStrictEqual(val, ["active"]);
    });

    it("should be case-insensitive for IN(a,b)", function () {
      const [op, val] = parseFilterValue("IN(x,y)");
      assert.strictEqual(op, "in");
      assert.deepStrictEqual(val, ["x", "y"]);
    });
  });

  describe("not in", function () {
    it("should return not in with array for !in(a,b,c)", function () {
      const [op, val] = parseFilterValue("!in(john,snow,ram)");
      assert.strictEqual(op, "not in");
      assert.deepStrictEqual(val, ["john", "snow", "ram"]);
    });

    it("should return not in with single item for !in(a)", function () {
      const [op, val] = parseFilterValue("!in(blocked)");
      assert.strictEqual(op, "not in");
      assert.deepStrictEqual(val, ["blocked"]);
    });

    it("should be case-insensitive for !IN(a,b)", function () {
      const [op, val] = parseFilterValue("!IN(x,y)");
      assert.strictEqual(op, "not in");
      assert.deepStrictEqual(val, ["x", "y"]);
    });
  });

  describe("operator precedence", function () {
    it("!in(...) should take priority over != prefix", function () {
      const [op] = parseFilterValue("!in(a,b)");
      assert.strictEqual(op, "not in");
    });

    it("in(...) should take priority over = default", function () {
      const [op] = parseFilterValue("in(a)");
      assert.strictEqual(op, "in");
    });

    it("!%value% should be not like, not !=", function () {
      const [op] = parseFilterValue("!%test%");
      assert.strictEqual(op, "not like");
    });

    it(">= should take priority over >", function () {
      const [op, val] = parseFilterValue(">=10");
      assert.strictEqual(op, ">=");
      assert.strictEqual(val, "10");
    });

    it("<= should take priority over <", function () {
      const [op, val] = parseFilterValue("<=10");
      assert.strictEqual(op, "<=");
      assert.strictEqual(val, "10");
    });
  });
});

describe("Filter Operators — objectToFilter", function () {
  it("should produce = for plain values", function () {
    const result = objectToFilter({ name: "john" });
    assert.deepStrictEqual(result, [[["name", "=", "john"]]]);
  });

  it("should produce like for % values", function () {
    const result = objectToFilter({ name: "%john%" });
    assert.deepStrictEqual(result, [[["name", "like", "%john%"]]]);
  });

  it("should produce != for ! prefix", function () {
    const result = objectToFilter({ status: "!active" });
    assert.deepStrictEqual(result, [[["status", "!=", "active"]]]);
  });

  it("should produce > for > prefix", function () {
    const result = objectToFilter({ age: ">25" });
    assert.deepStrictEqual(result, [[["age", ">", "25"]]]);
  });

  it("should produce >= for >= prefix", function () {
    const result = objectToFilter({ age: ">=25" });
    assert.deepStrictEqual(result, [[["age", ">=", "25"]]]);
  });

  it("should produce in for in(...) syntax", function () {
    const result = objectToFilter({ type: "in(a,b,c)" });
    assert.deepStrictEqual(result, [[["type", "in", ["a", "b", "c"]]]]);
  });

  it("should produce not in for !in(...) syntax", function () {
    const result = objectToFilter({ type: "!in(x,y)" });
    assert.deepStrictEqual(result, [[["type", "not in", ["x", "y"]]]]);
  });

  it("should handle multiple keys with mixed operators", function () {
    const result = objectToFilter({
      name: "%john%",
      age: ">25",
      status: "!in(blocked,banned)",
    });
    assert.strictEqual(result[0].length, 3);
    assert.strictEqual(result[0][0][1], "like");
    assert.strictEqual(result[0][1][1], ">");
    assert.strictEqual(result[0][2][1], "not in");
  });

  it("should pass through non-string values with =", function () {
    const result = objectToFilter({ count: 5 });
    assert.deepStrictEqual(result, [[["count", "=", 5]]]);
  });
});

describe("Filter Operators — dataToFilter with operator values", function () {
  it("should parse operator values from object data", function () {
    const data = { name: "%john%", age: ">25" };
    const filter = dataToFilter(data, "id");
    assert.strictEqual(filter[0].length, 2);
    assert.deepStrictEqual(filter[0][0], ["name", "like", "%john%"]);
    assert.deepStrictEqual(filter[0][1], ["age", ">", "25"]);
  });

  it("should handle in() operator in dataToFilter", function () {
    const data = { status: "in(active,pending)" };
    const filter = dataToFilter(data, "id");
    assert.deepStrictEqual(filter[0][0], [
      "status",
      "in",
      ["active", "pending"],
    ]);
  });

  it("should handle != operator in dataToFilter", function () {
    const data = { name: "!admin" };
    const filter = dataToFilter(data, "id");
    assert.deepStrictEqual(filter[0][0], ["name", "!=", "admin"]);
  });
});
