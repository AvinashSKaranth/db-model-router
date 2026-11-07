const model = require("./commons/model.js");
const route = require("./commons/route.js");
const kafka = require("./commons/kafka.js");
const encryption = require("./commons/encryption.js");
const adapterLoaders = {
  mysql: () => require("./mysql/db.js"),
  mariadb: () => require("./mariadb/db.js"),
  postgresql: () => require("./postgres/db.js"),
  postgres: () => require("./postgres/db.js"),
  oracle: () => require("./oracle/db.js"),
  sqlite3: () => require("./sqlite3/db.js"),
  mssql: () => require("./mssql/db.js"),
  cockroachdb: () => require("./cockroachdb/db.js"),
  mongodb: () => require("./mongodb/db.js"),
  redis: () => require("./redis/db.js"),
  dynamodb: () => require("./dynamodb/db.js"),
};

let db = null;
let initConfig = null;

function init(DB_TYPE, config) {
  const dbType = (DB_TYPE || "mysql").toLowerCase();
  const loader = adapterLoaders[dbType];
  if (!loader) {
    throw new Error(
      `Unsupported DB_TYPE: "${dbType}". Supported: ${Object.keys(adapterLoaders).join(", ")}`,
    );
  }
  try {
    db = loader();
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
        { cause: err },
      );
    }
    throw err;
  }
  // Resolve the active encryption configuration once at initialization.
  // Only override when a config object is explicitly provided. A bare
  // re-init (e.g. the CLI's connectDb) must preserve an already-resolved
  // keyring so backfill/rotation work without nulling out the active key.
  if (config !== undefined && config !== null) {
    initConfig = config;
    if (config.encryption) {
      encryption.setConfig(config.encryption);
    }
  } else if (initConfig === null) {
    initConfig = null;
  }
}

module.exports = {
  init,
  get db() {
    return db;
  },
  get initConfig() {
    return initConfig;
  },
  transaction: async (fn) => {
    if (!db || typeof db.transaction !== "function") {
      throw new Error("Active database adapter does not support transactions.");
    }
    return db.transaction(fn);
  },
  model,
  route,
  kafka,
  encryption,
};
