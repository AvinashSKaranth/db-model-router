/*process.env.NODE_ENV = "TEST";
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
describe("Development Testing", function () {
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
  });
  it("Add and Update Single", async function () {
    this.timeout(10000);
    try {
      let payload = {
        name: faker.name.findName(),
        description: "123ABC",
        type: 1,
        info: { message: "test message" },
      };
      let testItem = await test.insert(payload);
      testItem.type = 2;
      testItem = await test.update(testItem);
      assert.equal(testItem.type, 2);
    } catch (err) {
      console.log(err);
    }
  });
  it("Add and Update Multiple", async function () {
    this.timeout(10000);
    try {
      let payload = [
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
      ];
      let testItems = await test.insert(payload);
      testItems = await test.find({});
      for (const testItem of testItems.data) {
        testItem.type = 3;
      }

      await sleep(5000);
      testItems = await test.update(testItems);
      testItems = await test.find({});
      console.log(testItems);
    } catch (err) {
      console.log(err);
    }
  });
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
*/
