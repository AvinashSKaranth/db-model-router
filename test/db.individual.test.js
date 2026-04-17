process.env.NODE_ENV = "TEST";
process.env.TEST_PORT = 30001;
let crypto = require("crypto");
let table = "test-" + crypto.randomUUID();
const assert = require("assert");
const faker = require("faker");
const app = require("../src/serve.js");
const { db } = require("../src/index.js");
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
  describe("Single Entry", function () {
    let name = faker.name.findName();
    it("Add an Entry", function (done) {
      db.change(table, { test_name: name }).then((data) => {
        assert.ok(data.rows == 1);
        done();
      });
    });
    it("Get the entry by ID", function (done) {
      db.get(table, [[["test_id", "=", "1"]]]).then((response) => {
        assert.ok(response["data"].length == 1);
        assert.ok(response["data"][0].test_id == 1);
        done();
      });
    });
    it("Get the entry by conditions", function (done) {
      db.get(table, [[["test_name", "=", name]]]).then((data) => {
        assert.ok(data["data"].length == 1);
        assert.ok(data["data"][0].test_name == name);
        done();
      });
    });
    it("Remove Entry with ID", function (done) {
      db.remove(table, [[["test_id", "=", "1"]]]).then((data) => {
        //assert.ok(data.status === "removed");
        db.get(table, [[["test_id", "=", "1"]]]).then((data) => {
          assert.ok(data["data"].length == 0);
          done();
        });
      });
    });
    it("Remove Entry with filter", function (done) {
      db.change(table, [{ test_name: name }]).then((data) => {
        db.remove(table, [[["test_name", "=", name]]]).then((data) => {
          //assert.ok(data.status === "removed");
          db.get(table, [[["test_name", "=", name]]]).then((data) => {
            assert.ok(data["data"].length == 0);
            done();
          });
        });
      });
    });

    //Ignores Data with Incorrect field
    it("Add an Entry with incorrect data", function (done) {
      db.change(table, "{ my_name: name }")
        .then((data) => {})
        .catch((err) => {
          assert.ok(err.message == "Unknown column '0' in 'field list'");
          done();
        });
    });
    it("Remove Entry with incorrect data", function (done) {
      db.remove(table, [[["my_name", "=", name]]])
        .then((data) => {
          console.log("result", data);
        })
        .catch((err) => {
          assert.ok(
            err.message == "Unknown column 'my_name' in 'where clause'"
          );
          done();
        });
    });
    it("Get Entries with incorrect data", function (done) {
      db.get(table, [[["my_name", "=", name]]])
        .then((data) => {})
        .catch((err) => {
          assert.ok(
            err.message == "Unknown column 'my_name' in 'where clause'"
          );
          done();
        });
    });
    it("Get Entries with non existant data", function (done) {
      db.get(table, [[["test_name", "=", name + "salt"]]]).then((data) => {
        assert.ok(data["data"].length === 0);
        done();
      });
    });
  });
});
