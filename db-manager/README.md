# DB Manager — Testing Guide

A live database management UI launched via `npx db-model-router db-manager`. This guide covers how to test it against each supported database using Docker.

## Prerequisites

- Docker and Docker Compose installed
- Node.js 18+
- npm dependencies installed (`npm install` from the project root)

## Quick Start (SQLite — no Docker needed)

SQLite requires no external services. Run these commands from the project root:

```bash
# Seed the demo SQLite database
sqlite3 ./db-manager/demo/demo.sqlite < ./db-manager/demo/seeds/sqlite3.sql

# Start the DB Manager
npx db-model-router db-manager --env ./db-manager/demo/sqlite3.env
```

Open http://localhost:4000 in your browser.

## Testing with Docker Databases

### 1. Start Docker Services

From the project root, start all database containers:

```bash
# Start all services
docker compose up -d

# Or start a specific service
docker compose up -d mysql
docker compose up -d postgres
docker compose up -d mssql
docker compose up -d mongodb
docker compose up -d redis
docker compose up -d cockroachdb
docker compose up -d oracle
docker compose up -d dynamodb
```

Wait for the containers to be healthy:

```bash
docker compose ps
```

### 2. Seed the Databases

Run the seed scripts to create sample tables (`users`, `products`) with test data.

#### MySQL

```bash
docker exec -i db-model-router-mysql mysql -uroot -ppassword test_db < ./db-manager/demo/seeds/mysql.sql
```

#### PostgreSQL

```bash
docker exec -i db-model-router-postgres psql -U postgres -d test_db < ./db-manager/demo/seeds/postgres.sql
```

#### MSSQL

```bash
docker exec -i db-model-router-mssql /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "Password123!" -d master -C -i /dev/stdin < ./db-manager/demo/seeds/mssql.sql
```

#### CockroachDB

```bash
docker exec -i db-model-router-cockroachdb cockroach sql --insecure --database=defaultdb < ./db-manager/demo/seeds/cockroachdb.sql
```

#### Oracle

```bash
docker exec -i db-model-router-oracle sqlplus system/oracle@//localhost:1521/FREEPDB1 < ./db-manager/demo/seeds/oracle.sql
```

#### SQLite (no Docker)

```bash
sqlite3 ./db-manager/demo/demo.sqlite < ./db-manager/demo/seeds/sqlite3.sql
```

> **Note:** MongoDB, Redis, and DynamoDB do not use SQL seeds. They will work with the DB Manager once data is inserted through the UI.

### 3. Launch the DB Manager

Run from the project root. Use the `--env` flag to point to the appropriate demo env file.

#### MySQL

```bash
npx db-model-router db-manager --env ./db-manager/demo/mysql.env
```

#### PostgreSQL

```bash
npx db-model-router db-manager --env ./db-manager/demo/postgres.env
```

#### MSSQL

```bash
npx db-model-router db-manager --env ./db-manager/demo/mssql.env
```

#### CockroachDB

```bash
npx db-model-router db-manager --env ./db-manager/demo/cockroachdb.env
```

#### Oracle

```bash
npx db-model-router db-manager --env ./db-manager/demo/oracle.env
```

#### MongoDB

```bash
npx db-model-router db-manager --env ./db-manager/demo/mongodb.env
```

#### Redis

```bash
npx db-model-router db-manager --env ./db-manager/demo/redis.env
```

#### DynamoDB

```bash
npx db-model-router db-manager --env ./db-manager/demo/dynamodb.env
```

#### SQLite

```bash
npx db-model-router db-manager --env ./db-manager/demo/sqlite3.env
```

### 4. Custom Port

Use the `--port` flag to run on a different port:

```bash
npx db-model-router db-manager --env ./db-manager/demo/postgres.env --port 5000
```

## CLI Flags

| Flag              | Default | Description                                      |
| ----------------- | ------- | ------------------------------------------------ |
| `--env <path>`    | `.env`  | Path to the environment file with DB credentials |
| `--port <number>` | `4000`  | Port for the web UI                              |

## Running Tests

From the project root:

```bash
# Run all tests (unit + integration + property tests)
npm test

# Run only the DB Manager property tests
npx mocha test/properties/db-manager.property.test.js --timeout 15000 --exit

# Run only the DB Manager integration tests
npx mocha test/integration/db-manager-app.test.js --timeout 15000 --exit

# Run only the DB Manager CLI unit tests
npx mocha test/commands/db-manager.test.js --timeout 15000 --exit
```

## Stopping Docker Services

```bash
# Stop all services
docker compose down

# Stop and remove volumes (clean slate)
docker compose down -v
```

## Demo Environment Files

Located in `db-manager/demo/`:

| File              | Database       | Host      | Port  |
| ----------------- | -------------- | --------- | ----- |
| `sqlite3.env`     | SQLite3        | —         | —     |
| `mysql.env`       | MySQL 8.0      | localhost | 3306  |
| `postgres.env`    | PostgreSQL 16  | localhost | 5432  |
| `mssql.env`       | SQL Server     | localhost | 1433  |
| `cockroachdb.env` | CockroachDB    | localhost | 26257 |
| `oracle.env`      | Oracle Free    | localhost | 1521  |
| `mongodb.env`     | MongoDB 7      | localhost | 27017 |
| `redis.env`       | Redis 7        | localhost | 6379  |
| `dynamodb.env`    | DynamoDB Local | localhost | 8000  |

## Seed Data

SQL seed files are in `db-manager/demo/seeds/`. Each creates two tables:

- **users** — id, name, email, created_at (5 sample rows)
- **products** — id, name, price, stock, created_at (5 sample rows)

## Troubleshooting

- **Port already in use**: Use `--port` to pick a different port
- **Connection refused**: Make sure the Docker container is running and healthy (`docker compose ps`)
- **Oracle slow to start**: Oracle can take 60–90 seconds to initialize. Wait for the healthcheck to pass
- **MSSQL tools path**: If the seed command fails, try `/opt/mssql-tools/bin/sqlcmd` instead of `/opt/mssql-tools18/bin/sqlcmd`
