/*process.env.NODE_ENV = "TEST";
process.env.TEST_PORT = 3001;
let crypto = require("crypto");
let table = "test-" + crypto.randomUUID();
const request = require("supertest");
const assert = require("assert");
const faker = require("faker");
const app = require("./../src/serve.js");
let id = 0;
const { db } = require("../src/index.js");
describe("Rest APIs", function () {
  describe("Single Entry", function () {
    let name = faker.name.findName();
    it("post an entry", function (done) {
      try {
        request(app)
          .post("/test/add")
          .expect("Content-Type", /json/)
          .send({
            name,
            type: "1",
            description: "Sample Data",
            info: { column: 123 },
            unknown: "123",
          })
          .expect(200)
          .expect((res) => {
            id = res.body.id;
            assert(id > 0);
            assert(res.body.rows === 1);
          })
          .end((err, res) => {
            if (err) return done(err);
            return done();
          });
      } catch (err) {
        console.log(err);
      }
    });
    it("get an entry", function (done) {
      request(app)
        .get("/test/" + id)
        .expect("Content-Type", /json/)
        .expect(200)
        .expect((res) => {
          assert(res.body.test_id === id);
          assert(res.body.name === name);
        })
        .end((err, res) => {
          if (err) return done(err);
          return done();
        });
    });
    it("update an entry", function (done) {
      request(app)
        .put("/test/" + id)
        .send({
          name: name + " Updated",
          type: "1",
          description: "Sample Data Updated",
          info: { column: "abc" },
        })
        .expect("Content-Type", /json/)
        .expect(200)
        .expect((res) => {
          db.get("test", [[["test_id", "=", id]]]).then((result) => {
            assert(result["data"][0]["name"] === name + " Updated");
            assert(result["data"][0]["description"] === "Sample Data Updated");
          });
        })
        .end((err, res) => {
          if (err) return done(err);
          return done();
        });
    });
    it("delete an entry", function (done) {
      request(app)
        .delete("/test/" + id)
        .expect("Content-Type", /json/)
        .expect(200)
        .expect((res) => {
          //assert(res.body.status === "removed");
          db.get("test", [[["test_id", "=", id]]]).then((result) => {
            assert(result["data"].length === 0);
          });
        })
        .end((err, res) => {
          if (err) return done(err);
          return done();
        });
    });
  });
});
*/
