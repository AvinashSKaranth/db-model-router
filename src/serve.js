require("dotenv").config();
const express = require("express");
const app = express();
const bodyParser = require("body-parser");
app.use(bodyParser.json({ limit: "128mb" }));
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).send(err); // Bad request
  }
  next();
});
let port = 3000;
if (process.env.NODE_ENV === "TEST") {
  port = process.env.TEST_PORT;
} else {
  port = process.env.port;
}

const { db, model, route } = require("./index");
db.connect({
  connectionLimit: 100,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  charset: "utf8mb4",
});
const test = model(
  db,
  "test",
  {
    test_id: "required|integer",
    user_id: "required|integer",
    name: "required|string",
    description: "string",
    type: "required|integer",
    info: "object",
    is_deleted: "boolean",
  },
  "test_id",
  [],
  { safeDelete: "is_deleted" }
);
app.use((req, res, next) => {
  req.user = { user_id: "2" };
  next();
});
app.use("/test", route(test, { user_id: "user.user_id" }));
app.use("*", (req, res) => {
  res.send({ message: "Not Found" });
});
app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
function authenticate(param) {
  return function (req, res, next) {
    // Is Loggedin
    if (
      !req.hasOwnProperty("session") ||
      !req.session.hasOwnProperty("user_id")
    ) {
      res.status(401);
      res.send({ message: "user not loggedin" });
    } else {
      // Is Role permitting the usage of this api
      if (!param.role.includes(req.session.role_selected.role)) {
        res.status(401);
        res.send({ message: "user not allowed to access this endpoint" });
      }
      // Is Account Offering permitting the usage of this api
      if (!req.session.role_selected.offering.includes(param.offering)) {
        res.status(401);
        res.send({ message: "user not allowed to access this endpoint" });
      }
      //TODO: fine grain control needs to be written
    }
  };
}
module.exports = app;
