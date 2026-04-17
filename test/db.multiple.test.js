process.env.NODE_ENV = "TEST";
process.env.TEST_PORT = 30001;
let crypto = require("crypto");
let table = "test-" + crypto.randomUUID();
const assert = require("assert");
const faker = require("faker");
const { db } = require("../src/index.js");
const app = require("./../src/serve.js");
describe("Database Functions", function () {
  before(function (done) {
    db.query(
      "CREATE TABLE IF NOT EXISTS`" +
        table +
        "` (" +
        "`test_id` int(11) NOT NULL AUTO_INCREMENT," +
        "`test_name` varchar(63) NOT NULL DEFAULT ''," +
        "`created_at` datetime NOT NULL DEFAULT current_timestamp()," +
        "`modified_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()," +
        "PRIMARY KEY (`test_id`)" +
        ") ENGINE=InnoDB AUTO_INCREMENT=0 DEFAULT CHARSET=utf8mb4"
    ).then((data) => {
      done();
    });
  });
  after(function (done) {
    db.query("DROP TABLE `" + table + "`;").then(() => {
      done();
    });
  });

  describe("Multiple Entry", function () {
    let number = 100000;
    it("Add a lot of Entries (100K)", function (done) {
      this.timeout(30000);
      let input = [];
      for (let i = 0; i < number; i++) {
        input.push({ test_name: faker.name.findName() });
      }
      db.change(table, input).then((data) => {
        assert.ok(data.rows == number);
        done();
      });
    });
    it("Remove a particular Entry", function (done) {
      db.remove(table, [[["test_id", "=", "500"]]]).then((data) => {
        db.get(table, [[["test_id", "=", "500"]]]).then((response) => {
          assert.ok(response["data"].length == 0);
          done();
        });
      });
    });
    it("fails to delete when no filter attribute", function (done) {
      db.remove(table, [])
        .then((data) => {})
        .catch((err) => {
          assert.ok(
            err.status == "unable to remove as there is not filter attributes"
          );
          done();
        });
    });
    it("Remove multiple entries", function (done) {
      db.remove(table, [[["test_id", "in", ["3", "4", "5", "6", "7"]]]]).then(
        (data) => {
          //assert.ok(data.status == "removed");
          db.get(table, [[["test_id", "in", ["3", "4", "5", "6", "7"]]]]).then(
            (response) => {
              assert.ok(response["data"].length == 0);
              done();
            }
          );
        }
      );
    });
    it("Get all entries ", function (done) {
      this.timeout(30000);
      db.get(table, [[[]]]).then((data) => {
        assert.ok(data.count === number - 6);
        done();
      });
    });
    it("Get specific entries", function (done) {
      db.get(table, [[["test_id", "in", ["8", "9", "10", "11", "12"]]]]).then(
        (data) => {
          assert.ok(data.count == 5);
          done();
        }
      );
    });
    it("List First page", function (done) {
      db.list(table).then((data) => {
        assert.ok(data["data"].length == 30);
        done();
      });
    });
    it("List Second page", function (done) {
      db.list(table, [], [], null, 1).then((data) => {
        assert.ok(data["data"].length == 30);
        done();
      });
    });
    it("List First page Seachable", function (done) {
      db.list(table, [[["test_name", "like", "Mr"]]], [], null, 0).then(
        (data) => {
          assert.ok(data["data"].length <= 30 && data["data"].length > 0);
          done();
        }
      );
    });
    it("List Second page Seachable", function (done) {
      db.list(table, [[["test_name", "like", "Mr"]]], [], null, 1).then(
        (data) => {
          assert.ok(data["data"].length <= 30);
          done();
        }
      );
    });
    it("List with incorrect data", function (done) {
      db.list(table, [[["unknown_column", "=", "Mr."]]], [], null, 1)
        .then((data) => {})
        .catch((err) => {
          assert.ok(
            err.message == "Unknown column 'unknown_column' in 'where clause'"
          );
          done();
        });
    });
    it("List with invalid object", function (done) {
      db.list(table, { unknown_column: "Mr." }, [], null, 1)
        .then((data) => {})
        .catch((err) => {
          assert.ok(err.message == "Invalid filter object");
          done();
        });
    });
    it("Get specific entries with incorrect entries", function (done) {
      db.get(table, [[["id", "in", ["8", "9", "10", "11", "12"]]]])
        .then((data) => {})
        .catch((err) => {
          assert.ok(err.message == "Unknown column 'id' in 'where clause'");
          done();
        });
    });

    it("Remove all entries", function (done) {
      this.timeout(30000);
      db.remove(table, [[["test_id", "like", "%"]]]).then((data) => {
        //assert.ok(data.status == "removed");
        db.get(table).then((data) => {
          assert.ok(data.count == 0);
          done();
        });
      });
    });
  });
});
