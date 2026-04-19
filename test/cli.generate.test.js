process.env.NODE_ENV = "TEST";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const {
  introspectSQLite3,
  generateModelFile,
  generateIndexFile,
  isTimestampColumn,
  isSafeDeleteColumn,
  detectOptionColumns,
  safeVarName,
} = require("../src/cli/generate-model.js");

const db = require("../src/sqlite3/db.js");
const model = require("../src/commons/model.js");

const TEST_DB = path.join(
  __dirname,
  "test_generate_" + crypto.randomUUID().slice(0, 8) + ".db",
);
const OUTPUT_DIR = path.join(
  __dirname,
  "test_models_" + crypto.randomUUID().slice(0, 8),
);

// 10 tables with varying schemas
const TABLE_DEFS = [
  {
    name: "users",
    sql: `CREATE TABLE users (
      user_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      age INTEGER,
      bio TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    uniqueIdx: "CREATE UNIQUE INDEX idx_users_email ON users(email)",
  },
  {
    name: "posts",
    sql: `CREATE TABLE posts (
      post_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      status INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      modified_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: "comments",
    sql: `CREATE TABLE comments (
      comment_id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: "categories",
    sql: `CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT ''
    )`,
  },
  {
    name: "tags",
    sql: `CREATE TABLE tags (
      tag_id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL
    )`,
  },
  {
    name: "post_tags",
    sql: `CREATE TABLE post_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL
    )`,
    uniqueIdx:
      "CREATE UNIQUE INDEX idx_post_tags ON post_tags(post_id, tag_id)",
  },
  {
    name: "user_settings",
    sql: `CREATE TABLE user_settings (
      setting_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT DEFAULT ''
    )`,
    uniqueIdx:
      "CREATE UNIQUE INDEX idx_user_settings ON user_settings(user_id, key)",
  },
  {
    name: "audit_log",
    sql: `CREATE TABLE audit_log (
      log_id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: "products",
    sql: `CREATE TABLE products (
      product_id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    uniqueIdx: "CREATE UNIQUE INDEX idx_products_sku ON products(sku)",
  },
  {
    name: "orders",
    sql: `CREATE TABLE orders (
      order_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      total REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      modified_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: "articles",
    sql: `CREATE TABLE articles (
      article_id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: "notifications",
    sql: `CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      createDate DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
  },
];

describe("CLI Generate - db-model-router-generate", function () {
  let rawDb;

  before(function () {
    // Create the test sqlite3 database with 10 tables
    rawDb = new Database(TEST_DB);
    for (const def of TABLE_DEFS) {
      rawDb.exec(def.sql);
      if (def.uniqueIdx) rawDb.exec(def.uniqueIdx);
    }
    rawDb.close();
  });

  after(function () {
    // Cleanup generated files and test DB
    if (fs.existsSync(OUTPUT_DIR)) {
      fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    }
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }
  });

  describe("Introspection", function () {
    let models;

    before(async function () {
      db.connect({ database: TEST_DB });
      models = await introspectSQLite3(db);
    });

    after(function () {
      db.disconnect();
    });

    it("should discover all 12 tables", function () {
      assert.strictEqual(models.length, 12);
      const names = models.map((m) => m.table).sort();
      const expected = TABLE_DEFS.map((d) => d.name).sort();
      assert.deepStrictEqual(names, expected);
    });

    it("should detect correct primary keys", function () {
      const usersModel = models.find((m) => m.table === "users");
      assert.strictEqual(usersModel.primary_key, "user_id");
      const categoriesModel = models.find((m) => m.table === "categories");
      assert.strictEqual(categoriesModel.primary_key, "id");
    });

    it("should detect unique constraints", function () {
      const usersModel = models.find((m) => m.table === "users");
      assert.ok(
        usersModel.unique.includes("email"),
        "users should have email as unique",
      );
      const productsModel = models.find((m) => m.table === "products");
      assert.ok(
        productsModel.unique.includes("sku"),
        "products should have sku as unique",
      );
      // post_tags has a composite unique index on (post_id, tag_id)
      const postTagsModel = models.find((m) => m.table === "post_tags");
      assert.deepStrictEqual(
        postTagsModel.unique,
        ["post_id", "tag_id"],
        "post_tags should have multi-column unique [post_id, tag_id]",
      );
      // user_settings has a composite unique index on (user_id, key)
      const userSettingsModel = models.find((m) => m.table === "user_settings");
      assert.deepStrictEqual(
        userSettingsModel.unique,
        ["user_id", "key"],
        "user_settings should have multi-column unique [user_id, key]",
      );
    });

    it("should fall back to [pk] when no unique index exists", function () {
      const postsModel = models.find((m) => m.table === "posts");
      assert.deepStrictEqual(
        postsModel.unique,
        ["post_id"],
        "posts has no unique index so should fall back to [post_id]",
      );
      const commentsModel = models.find((m) => m.table === "comments");
      assert.deepStrictEqual(
        commentsModel.unique,
        ["comment_id"],
        "comments has no unique index so should fall back to [comment_id]",
      );
    });

    it("should prefer multi-column unique index over single-column", function () {
      // post_tags has a composite unique — should use that, not PK
      const postTagsModel = models.find((m) => m.table === "post_tags");
      assert.strictEqual(postTagsModel.unique.length, 2);
      assert.ok(!postTagsModel.unique.includes("id"));
    });

    it("should exclude timestamp columns from structure", function () {
      for (const m of models) {
        for (const key of Object.keys(m.structure)) {
          assert.ok(
            !isTimestampColumn(key),
            `${m.table}.${key} should not be in structure (timestamp column)`,
          );
        }
      }
    });

    it("should exclude primary key from structure", function () {
      for (const m of models) {
        assert.ok(
          !m.structure.hasOwnProperty(m.primary_key),
          `${m.table} structure should not contain PK "${m.primary_key}"`,
        );
      }
    });

    it("should mark columns with defaults as not required", function () {
      const usersModel = models.find((m) => m.table === "users");
      // bio has DEFAULT ''
      assert.ok(
        !usersModel.structure.bio.startsWith("required"),
        "users.bio has a default so should not be required",
      );
      // age is nullable
      assert.ok(
        !usersModel.structure.age.startsWith("required"),
        "users.age is nullable so should not be required",
      );
      // name is NOT NULL and no default
      assert.ok(
        usersModel.structure.name.startsWith("required"),
        "users.name is NOT NULL without default so should be required",
      );
    });

    it("should mark NOT NULL columns without defaults as required", function () {
      const postsModel = models.find((m) => m.table === "posts");
      assert.ok(
        postsModel.structure.user_id.startsWith("required"),
        "posts.user_id should be required",
      );
      assert.ok(
        postsModel.structure.title.startsWith("required"),
        "posts.title should be required",
      );
      // status has DEFAULT 0
      assert.ok(
        !postsModel.structure.status.startsWith("required"),
        "posts.status has default so should not be required",
      );
    });

    it("should map column types correctly", function () {
      const productsModel = models.find((m) => m.table === "products");
      assert.ok(productsModel.structure.name.includes("string"));
      assert.ok(productsModel.structure.price.includes("numeric"));
      assert.ok(productsModel.structure.stock.includes("integer"));
    });

    it("should detect safeDelete column (is_deleted)", function () {
      const articlesModel = models.find((m) => m.table === "articles");
      assert.strictEqual(articlesModel.option.safeDelete, "is_deleted");
    });

    it("should detect safeDelete column (is_active)", function () {
      const notificationsModel = models.find(
        (m) => m.table === "notifications",
      );
      assert.strictEqual(notificationsModel.option.safeDelete, "is_active");
    });

    it("should exclude safeDelete columns from structure", function () {
      const articlesModel = models.find((m) => m.table === "articles");
      assert.ok(!articlesModel.structure.hasOwnProperty("is_deleted"));
      const notificationsModel = models.find(
        (m) => m.table === "notifications",
      );
      assert.ok(!notificationsModel.structure.hasOwnProperty("is_active"));
    });

    it("should detect created_at timestamp column", function () {
      const usersModel = models.find((m) => m.table === "users");
      assert.strictEqual(usersModel.option.created_at, "created_at");
      const notificationsModel = models.find(
        (m) => m.table === "notifications",
      );
      assert.strictEqual(notificationsModel.option.created_at, "createDate");
    });

    it("should detect modified_at timestamp column", function () {
      const usersModel = models.find((m) => m.table === "users");
      assert.strictEqual(usersModel.option.modified_at, "updated_at");
      const postsModel = models.find((m) => m.table === "posts");
      assert.strictEqual(postsModel.option.modified_at, "modified_at");
    });

    it("should set null for missing option columns", function () {
      const tagsModel = models.find((m) => m.table === "tags");
      assert.strictEqual(tagsModel.option.safeDelete, null);
      assert.strictEqual(tagsModel.option.created_at, null);
      assert.strictEqual(tagsModel.option.modified_at, null);
      const categoriesModel = models.find((m) => m.table === "categories");
      assert.strictEqual(categoriesModel.option.safeDelete, null);
    });
  });

  describe("Code Generation", function () {
    let models;

    before(async function () {
      db.connect({ database: TEST_DB });
      models = await introspectSQLite3(db);
      db.disconnect();
    });

    it("should generate valid model file content", function () {
      const usersModel = models.find((m) => m.table === "users");
      const content = generateModelFile(usersModel);
      assert.ok(content.includes('require("db-model-router")'));
      assert.ok(content.includes('"users"'));
      assert.ok(content.includes('"user_id"'));
      assert.ok(content.includes("module.exports"));
    });

    it("should preserve exact table name in exports", function () {
      const postTagsModel = models.find((m) => m.table === "post_tags");
      const content = generateModelFile(postTagsModel);
      assert.ok(content.includes("const post_tags = model("));
      assert.ok(content.includes("module.exports = post_tags;"));
    });

    it("should generate index file with exact table names", function () {
      const content = generateIndexFile(models);
      for (const m of models) {
        const varName = safeVarName(m.table);
        assert.ok(
          content.includes(`const ${varName} = require("./${m.table}")`),
          `index should import ${m.table}`,
        );
        assert.ok(
          content.includes(`  ${varName},`),
          `index should export ${varName}`,
        );
      }
    });

    it("should include option with safeDelete in generated model file", function () {
      const articlesModel = models.find((m) => m.table === "articles");
      const content = generateModelFile(articlesModel);
      assert.ok(content.includes('safeDelete: "is_deleted"'));
      assert.ok(content.includes('created_at: "created_at"'));
      assert.ok(content.includes('modified_at: "updated_at"'));
    });

    it("should include option with timestamps in generated model file", function () {
      const usersModel = models.find((m) => m.table === "users");
      const content = generateModelFile(usersModel);
      assert.ok(content.includes('created_at: "created_at"'));
      assert.ok(content.includes('modified_at: "updated_at"'));
    });

    it("should not include option when no special columns detected", function () {
      const tagsModel = models.find((m) => m.table === "tags");
      const content = generateModelFile(tagsModel);
      assert.ok(!content.includes("safeDelete"));
      assert.ok(!content.includes("created_at:"));
      assert.ok(!content.includes("modified_at:"));
    });
  });

  describe("File Generation via CLI", function () {
    before(async function () {
      // Generate model files by running introspection + file write
      db.connect({ database: TEST_DB });
      const models = await introspectSQLite3(db);
      db.disconnect();

      if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      }
      for (const m of models) {
        const filePath = path.join(OUTPUT_DIR, m.table + ".js");
        fs.writeFileSync(filePath, generateModelFile(m));
      }
      fs.writeFileSync(
        path.join(OUTPUT_DIR, "index.js"),
        generateIndexFile(models),
      );
    });

    it("should create a .js file for each of the 12 tables", function () {
      for (const def of TABLE_DEFS) {
        const filePath = path.join(OUTPUT_DIR, def.name + ".js");
        assert.ok(fs.existsSync(filePath), `${def.name}.js should exist`);
      }
    });

    it("should create an index.js file", function () {
      const indexPath = path.join(OUTPUT_DIR, "index.js");
      assert.ok(fs.existsSync(indexPath), "index.js should exist");
    });

    it("should have valid JS syntax in all generated files", function () {
      const files = fs.readdirSync(OUTPUT_DIR).filter((f) => f.endsWith(".js"));
      for (const file of files) {
        const content = fs.readFileSync(path.join(OUTPUT_DIR, file), "utf8");
        // Replace the require("db-model-router") with a mock so we can syntax-check
        const testable = content.replace(
          /require\("db-model-router"\)/g,
          "{ db: {}, model: function() { return {} } }",
        );
        assert.doesNotThrow(
          () => new Function(testable),
          `${file} should have valid JS syntax`,
        );
      }
    });
  });

  describe("Data Operations with Generated Models", function () {
    before(function () {
      db.connect({ database: TEST_DB });
    });

    after(function () {
      db.disconnect();
    });

    it("should insert and retrieve a user", async function () {
      const users = model(
        db,
        "users",
        {
          name: "required|string",
          email: "required|string",
          age: "integer",
          bio: "string",
        },
        "user_id",
        ["user_id", "email"],
      );
      const inserted = await users.insert({
        name: "TestUser",
        email: "test@example.com",
        age: 25,
      });
      assert.ok(inserted);
      assert.ok(inserted.user_id > 0);
      assert.strictEqual(inserted.name, "TestUser");

      const found = await users.byId(inserted.user_id);
      assert.strictEqual(found.email, "test@example.com");
    });

    it("should insert and retrieve a product", async function () {
      const products = model(
        db,
        "products",
        {
          sku: "required|string",
          name: "required|string",
          price: "required|numeric",
          stock: "integer",
        },
        "product_id",
        ["product_id", "sku"],
      );
      const inserted = await products.insert({
        sku: "SKU-001",
        name: "Widget",
        price: 9.99,
        stock: 100,
      });
      assert.ok(inserted);
      assert.ok(inserted.product_id > 0);
      assert.strictEqual(inserted.name, "Widget");

      const found = await products.byId(inserted.product_id);
      assert.strictEqual(found.sku, "SKU-001");
      assert.strictEqual(found.price, 9.99);
    });

    it("should insert, update, and find a post", async function () {
      const posts = model(
        db,
        "posts",
        {
          user_id: "required|integer",
          title: "required|string",
          body: "string",
          status: "integer",
        },
        "post_id",
        ["post_id"],
      );
      const inserted = await posts.insert({
        user_id: 1,
        title: "Hello World",
        body: "First post",
      });
      assert.ok(inserted);
      assert.ok(inserted.post_id > 0);

      const updated = await posts.update({
        post_id: inserted.post_id,
        user_id: 1,
        title: "Hello World Updated",
        body: "First post updated",
        status: 1,
      });
      assert.strictEqual(updated.title, "Hello World Updated");
      assert.strictEqual(updated.status, 1);

      const result = await posts.find({ status: 1 });
      assert.ok(result.count >= 1);
      assert.strictEqual(result.data[0].title, "Hello World Updated");
    });

    it("should insert and delete a comment", async function () {
      const comments = model(
        db,
        "comments",
        {
          post_id: "required|integer",
          user_id: "required|integer",
          content: "required|string",
        },
        "comment_id",
        ["comment_id"],
      );
      const inserted = await comments.insert({
        post_id: 1,
        user_id: 1,
        content: "Nice post!",
      });
      assert.ok(inserted.comment_id > 0);

      await comments.remove(inserted.comment_id);
      const found = await comments.byId(inserted.comment_id);
      assert.strictEqual(found, null);
    });

    it("should insert and list orders with pagination", async function () {
      const orders = model(
        db,
        "orders",
        {
          user_id: "required|integer",
          product_id: "required|integer",
          quantity: "integer",
          total: "required|numeric",
          status: "string",
        },
        "order_id",
        ["order_id"],
      );
      // Insert 5 orders
      for (let i = 0; i < 5; i++) {
        await orders.insert({
          user_id: 1,
          product_id: 1,
          quantity: i + 1,
          total: (i + 1) * 10.5,
        });
      }
      const page0 = await orders.list({ page: 0, size: 3 });
      assert.strictEqual(page0.data.length, 3);
      assert.strictEqual(page0.count, 5);

      const page1 = await orders.list({ page: 1, size: 3 });
      assert.strictEqual(page1.data.length, 2);
    });

    it("should insert and findOne a tag", async function () {
      const tags = model(db, "tags", { label: "required|string" }, "tag_id", [
        "tag_id",
      ]);
      await tags.insert({ label: "javascript" });
      await tags.insert({ label: "nodejs" });

      const found = await tags.findOne({ label: "javascript" });
      assert.ok(found);
      assert.strictEqual(found.label, "javascript");

      const notFound = await tags.findOne({ label: "nonexistent" });
      assert.strictEqual(notFound, false);
    });

    it("should insert into user_settings with composite unique", async function () {
      const user_settings = model(
        db,
        "user_settings",
        {
          user_id: "required|integer",
          key: "required|string",
          value: "string",
        },
        "setting_id",
        ["user_id", "key"],
      );
      const inserted = await user_settings.insert({
        user_id: 1,
        key: "theme",
        value: "dark",
      });
      assert.ok(inserted.setting_id > 0);

      const found = await user_settings.find({ user_id: 1 });
      assert.ok(found.count >= 1);
      assert.strictEqual(found.data[0].key, "theme");
    });

    it("should insert into categories and audit_log", async function () {
      const categories = model(
        db,
        "categories",
        { name: "required|string", description: "string" },
        "id",
        ["id"],
      );
      const cat = await categories.insert({ name: "Tech" });
      assert.ok(cat.id > 0);

      const audit_log = model(
        db,
        "audit_log",
        {
          entity: "required|string",
          action: "required|string",
          payload: "string",
        },
        "log_id",
        ["log_id"],
      );
      const log = await audit_log.insert({
        entity: "categories",
        action: "create",
        payload: JSON.stringify({ id: cat.id }),
      });
      assert.ok(log.log_id > 0);
    });

    it("should insert into post_tags junction table", async function () {
      const post_tags = model(
        db,
        "post_tags",
        { post_id: "required|integer", tag_id: "required|integer" },
        "id",
        ["post_id", "tag_id"],
      );
      const inserted = await post_tags.insert({ post_id: 1, tag_id: 1 });
      assert.ok(inserted.id > 0);

      const result = await post_tags.find({ post_id: 1 });
      assert.ok(result.count >= 1);
    });

    it("should soft-delete an article using detected safeDelete column", async function () {
      const articles = model(
        db,
        "articles",
        { title: "required|string", body: "string" },
        "article_id",
        ["article_id"],
        {
          safeDelete: "is_deleted",
          created_at: "created_at",
          modified_at: "updated_at",
        },
      );
      const inserted = await articles.insert({
        title: "Test Article",
        body: "Content",
      });
      assert.ok(inserted.article_id > 0);

      // Soft delete
      await articles.remove(inserted.article_id);

      // byId with safeDelete should return null (is_deleted = 1 is filtered out)
      const found = await articles.byId(inserted.article_id);
      assert.strictEqual(found, null);

      // But the row still exists in the DB (soft deleted)
      const raw = db.query(
        `SELECT * FROM articles WHERE article_id = ${inserted.article_id}`,
      );
      assert.strictEqual(raw.length, 1);
      assert.strictEqual(raw[0].is_deleted, 1);
    });
  });
});
