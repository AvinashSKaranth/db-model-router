process.env.NODE_ENV = "TEST";
process.env.TEST_PORT = 30001;
let crypto = require("crypto");
let table = "test-" + crypto.randomUUID();
const assert = require("assert");
const faker = require("faker");
const { db, model } = require("../src/index.js");
const app = require("../src/serve.js");
let test = model(
  db,
  table,
  {
    test_id: "required|integer",
    name: "required|string",
    description: "required|string",
    type: "required|integer",
    info: "required|object",
  },
  "test_id",
  ["test_id"]
);
describe("Model Function", function () {
  before(function (done) {
    db.query(
      "CREATE TABLE IF NOT EXISTS`" +
        table +
        "` (" +
        "`test_id` int(11) NOT NULL AUTO_INCREMENT," +
        "`name` varchar(63) NOT NULL DEFAULT ''," +
        "`description` varchar(255) NOT NULL DEFAULT ''," +
        "`type` int(11) NOT NULL NOT NULL DEFAULT 0," +
        "`info` json NOT NULL," +
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
    done();
  });
  let test_id = 0;
  let payload = {
    name: faker.name.findName(),
    description: "123ABC",
    type: 1,
    info: { message: "test message" },
  };
  let payloadUpd = {
    name: faker.name.findName(),
    description: "123ABC Upd",
    type: 2,
    info: { message: "test message Upd" },
  };
  let bulkPayload = {
    data: [
      {
        name: faker.name.findName(),
        description: "123ABC",
        type: 1,
        info: { message: "test message" },
      },
      {
        name: faker.name.findName(),
        description: "123ABC",
        type: 1,
        info: { message: "test message" },
      },
      {
        name: faker.name.findName(),
        description: "123ABC",
        type: 1,
        info: { message: "test message" },
      },
      {
        name: faker.name.findName(),
        description: "123ABC",
        type: 2,
        info: { message: "test message" },
      },
      {
        name: faker.name.findName(),
        description: "123ABC",
        type: 2,
        info: { message: "test message" },
      },
    ],
  };
  let bulkPayloadUpd = {
    data: [
      {
        test_id: 2,
        name: faker.name.findName(),
        description: "123ABC",
        type: 1,
        info: { message: "test message" },
      },
      {
        test_id: 3,
        name: faker.name.findName(),
        description: "123ABC",
        type: 1,
        info: { message: "test message" },
      },
      {
        test_id: 4,
        name: faker.name.findName(),
        description: "123ABC",
        type: 1,
        info: { message: "test message" },
      },
      {
        test_id: 5,
        name: faker.name.findName(),
        description: "123ABC",
        type: 2,
        info: { message: "test message" },
      },
      {
        test_id: 6,
        name: faker.name.findName(),
        description: "123ABC",
        type: 2,
        info: { message: "test message" },
      },
    ],
  };
  describe("insert", function () {
    it("Add a Single Entry", function (done) {
      test
        .insert({ ...payload })
        .then((data) => {
          test_id = data.test_id;
          assert.equal(data.test_id > 0, true);
          assert.equal(payload.name, data.name);
          assert.equal(payload.description, data.description);
          assert.equal(payload.type, data.type);
          assert.equal(JSON.stringify(payload.info), JSON.stringify(data.info));
          done();
        })
        .catch((err) => {
          console.log(err);
          done();
        });
    });
    it("Add multiple entries", function (done) {
      test
        .insert({ ...bulkPayload })
        .then((data) => {
          console.log();
          assert.equal(data.rows, bulkPayload.data.length);
          done();
        })
        .catch((err) => {
          console.log(err);
          done();
        });
    });
  });
  describe("update", function () {
    it("Update an Entry", function (done) {
      test
        .update({ ...payloadUpd, test_id })
        .then((data) => {
          assert.equal(test_id, data.test_id);
          assert.equal(payloadUpd.name, data.name);
          assert.equal(payloadUpd.description, data.description);
          assert.equal(payloadUpd.type, data.type);
          assert.equal(
            JSON.stringify(payloadUpd.info),
            JSON.stringify(data.info)
          );
          done();
        })
        .catch((err) => {
          console.log("Error", err);
          done();
        });
    });
    it("Update multiple entries", function (done) {
      test
        .update({ ...bulkPayloadUpd })
        .then((data) => {
          assert.equal(data.rows, bulkPayloadUpd.data.length);
          done();
        })
        .catch((err) => {
          console.log(err);
          done();
        });
    });
  });
  describe("byId", function () {
    it("Get an Entry byId", function (done) {
      test
        .byId(test_id)
        .then((data) => {
          assert.equal(test_id, data.test_id);
          done();
        })
        .catch((err) => {
          console.log(err);
        });
    });
  });
  describe("find", function () {
    it("findOne an Entry by Id", function (done) {
      test
        .findOne({ test_id })
        .then((data) => {
          assert.equal(test_id, data.test_id);
          done();
        })
        .catch((err) => {
          console.log(err);
        });
    });
    it("findOne an Entry by Invalid Id", function (done) {
      test
        .findOne({ test_id: -1 })
        .then((data) => {
          assert.equal(false, data);
          done();
        })
        .catch((err) => {
          console.log(err);
        });
    });
    it("find an Entry by Id", function (done) {
      test
        .find(test_id)
        .then((data) => {
          assert.equal(test_id, data.data[0].test_id);
          done();
        })
        .catch((err) => {
          console.log(err);
        });
    });
    it("find an Entry by filter object", function (done) {
      test
        .find({ test_id })
        .then((data) => {
          assert.equal(test_id, data.data[0].test_id);
          done();
        })
        .catch((err) => {
          console.log(err);
        });
    });
    it("find an Entry by filter array", function (done) {
      test
        .find({ filter: [[["test_id", "=", test_id]]] })
        .then((data) => {
          assert.equal(test_id, data.data[0].test_id);
          done();
        })
        .catch((err) => {
          console.log(err);
        });
    });
    it("find an Entries by filter object", function (done) {
      test
        .find({ type: 1 })
        .then((data) => {
          assert.equal(3, data.count);
          done();
        })
        .catch((err) => {
          console.log(err);
        });
    });
    it("find an Entries by filter array", function (done) {
      test
        .find({ filter: [[["type", "=", 1]]] })
        .then((data) => {
          assert.equal(3, data.count);
          done();
        })
        .catch((err) => {
          console.log(err);
        });
    });
    it("find an Entries by filter array as string", function (done) {
      test
        .find({ filter: '[[["type", "=", 1]]]' })
        .then((data) => {
          assert.equal(3, data.count);
          done();
        })
        .catch((err) => {
          console.log(err);
        });
    });
  });
  describe("remove", function () {
    it("remove an Entry byId", function (done) {
      test
        .remove(test_id)
        .then((data) => {
          assert(data, true);
          test.byId(test_id).then((data) => {
            assert.equal(data, null);
            done();
          });
        })
        .catch((err) => {
          console.log(err);
        });
    });
    it("remove entries by filter array", function (done) {
      test.find({ filter: [[["type", "=", 1]]] }).then((data) => {
        assert.equal(data.count > 0, true);
        test
          .remove({ filter: [[["type", "=", 1]]] })
          .then((data) => {
            assert(data, true);
            test.find({ filter: [[["type", "=", 1]]] }).then((data) => {
              assert.equal(data.count, 0);
              done();
            });
          })
          .catch((err) => {
            console.log(err);
          });
      });
    });
    it("remove entries by filter object", function (done) {
      test.find({ type: 2 }).then((data) => {
        assert.equal(data.count > 0, true);
        test
          .remove({ type: 2 })
          .then((data) => {
            assert(data, true);
            test.find({ type: 2 }).then((data) => {
              assert.equal(data.count, 0);
              done();
            });
          })
          .catch((err) => {
            console.log(err);
          });
      });
    });
  });
  describe("list", function () {
    let bulkPayload = { data: [] };
    for (let i = 0; i < 100; i++) {
      bulkPayload.data.push({
        name: faker.name.findName(),
        description: "123ABC",
        type: i % 5,
        info: { message: "test message" },
      });
    }
    it("Add 100 entries", function (done) {
      test.insert(bulkPayload).then((response) => {
        done();
      });
    });
    it("List with Page 0 should list 30 entries", function (done) {
      test.list({ page: 0 }).then((response) => {
        assert.equal(response.data.length, 30);
        done();
      });
    });
    it("List with Page 3 should list 10 entries", function (done) {
      test.list({ page: 3 }).then((response) => {
        assert.equal(response.data.length, 10);
        done();
      });
    });
    it("List with Filter Object", function (done) {
      test.list({ type: 0 }).then((response) => {
        assert.equal(response.data.length, 20);
        done();
      });
    });
    it("List with Filter array", function (done) {
      test.list({ filter: [[["type", "in", [0, 1]]]] }).then((response) => {
        assert.equal(response.count, 40);
        done();
      });
    });
  });
});
