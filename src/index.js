const model = require("./commons/model.js");
const route = require("./commons/route.js");
const routers = {
  mysql: "./mysql/db.js",
  mariadb: "./mysql/db.js",
  postgresql: "./postgres/db.js",
  postgres: "./postgres/db.js",
  oracle: "./oracle/db.js",
  sqlite3: "./sqlite3/db.js",
  mssql: "./mssql/db.js",
  cockroachdb: "./cockroachdb/db.js",
  mongodb: "./mongodb/db.js",
  redis: "./redis/db.js",
  dynamodb: "./dynamodb/db.js",
};

let db = null;

function init(DB_TYPE) {
  const dbType = (DB_TYPE || "mysql").toLowerCase();
  const routerPath = routers[dbType];
  if (!routerPath) {
    throw new Error(
      `Unsupported DB_TYPE: "${dbType}". Supported: ${Object.keys(routers).join(", ")}`,
    );
  }
  try {
    db = require(routerPath);
  } catch (err) {
    if (err.code === "MODULE_NOT_FOUND") {
      const driverMap = {
        mysql: "mysql2",
        mariadb: "mysql2",
        postgresql: "pg",
        postgres: "pg",
        oracle: "oracledb",
        sqlite3: "better-sqlite3",
        mssql: "mssql",
        cockroachdb: "pg",
        mongodb: "mongodb",
        redis: "ioredis",
        dynamodb: "@aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb",
      };
      throw new Error(
        `Missing driver for "${dbType}". Install it with: npm install ${driverMap[dbType] || dbType}`,
      );
    }
    throw err;
  }
}

module.exports = {
  init,
  get db() {
    return db;
  },
  model,
  route,
};
