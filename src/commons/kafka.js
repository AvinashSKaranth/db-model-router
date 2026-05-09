/**
 * Kafka Producer Service
 *
 * Produces events to Kafka when database write operations (insert, update, upsert, delete) are performed.
 * Enabled only when KAFKA_BROKER is set in environment variables.
 *
 * Event format:
 * {
 *   table_name: string,
 *   operation_type: "insert" | "update" | "upsert" | "delete",
 *   data: object,
 *   timestamp: string (ISO 8601)
 * }
 *
 * Each row produces its own event. Bulk operations produce one event per entry.
 */

let producer = null;
let kafka = null;
let isConnected = false;
let isEnabled = false;
let topicPrefix = "";

/**
 * Initialize Kafka producer if KAFKA_BROKER env variable is set.
 * @param {object} [options] - Optional configuration overrides
 * @param {string} [options.broker] - Kafka broker URL (default: process.env.KAFKA_BROKER)
 * @param {string} [options.clientId] - Kafka client ID (default: process.env.KAFKA_CLIENT_ID || "db-model-router")
 * @param {string} [options.topicPrefix] - Topic prefix (default: process.env.KAFKA_TOPIC_PREFIX || "dbmr")
 * @returns {Promise<boolean>} Whether Kafka was successfully initialized
 */
async function init(options = {}) {
  const broker = options.broker || process.env.KAFKA_BROKER;
  if (!broker) {
    isEnabled = false;
    return false;
  }

  const clientId =
    options.clientId || process.env.KAFKA_CLIENT_ID || "db-model-router";
  topicPrefix = options.topicPrefix || process.env.KAFKA_TOPIC_PREFIX || "dbmr";

  try {
    const { Kafka } = require("kafkajs");
    kafka = new Kafka({
      clientId,
      brokers: broker.split(",").map((b) => b.trim()),
    });

    producer = kafka.producer();
    await producer.connect();
    isConnected = true;
    isEnabled = true;
    return true;
  } catch (err) {
    console.error(
      "[db-model-router] Kafka initialization failed:",
      err.message,
    );
    isEnabled = false;
    isConnected = false;
    return false;
  }
}

/**
 * Produce Kafka event(s) for a database operation.
 * If data is an array, one event is produced per entry (batched to avoid exceeding message size limits).
 * If data is a single object, one event is produced.
 *
 * @param {string} tableName - The database table name
 * @param {string} operationType - One of: "insert", "update", "upsert", "delete"
 * @param {object|object[]} data - The data involved in the operation
 * @returns {Promise<void>}
 */
async function produce(tableName, operationType, data) {
  if (!isEnabled || !isConnected || !producer) {
    return;
  }

  const topic = `${topicPrefix}.${tableName}`;
  const entries = Array.isArray(data) ? data : [data];
  const timestamp = new Date().toISOString();

  const messages = entries.map((entry) => ({
    key: tableName,
    value: JSON.stringify({
      table_name: tableName,
      operation_type: operationType,
      data: entry,
      timestamp,
    }),
  }));

  // Batch messages to avoid exceeding Kafka's max request size
  const BATCH_SIZE = 500;
  try {
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      await producer.send({ topic, messages: batch });
    }
  } catch (err) {
    console.error(
      `[db-model-router] Kafka produce failed for ${topic}:`,
      err.message,
    );
  }
}

/**
 * Disconnect the Kafka producer gracefully.
 * @returns {Promise<void>}
 */
async function disconnect() {
  if (producer && isConnected) {
    try {
      await producer.disconnect();
    } catch (_) {
      // ignore disconnect errors
    }
    isConnected = false;
    isEnabled = false;
  }
}

/**
 * Check if Kafka is currently enabled and connected.
 * @returns {boolean}
 */
function status() {
  return isEnabled && isConnected;
}

module.exports = {
  init,
  produce,
  disconnect,
  status,
};
