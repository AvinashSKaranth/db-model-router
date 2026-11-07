/**
 * Shared scenario registry. Every contender implements the same keys.
 * Iterations: single-row ops run 1000 measured iterations; bulk/tx fewer.
 */
module.exports = [
  { key: "insert_single",   label: "Insert single row (returns record)", iterations: 1000, runs: 5, warmup: 100 },
  { key: "bulk_100",        label: "Bulk insert 100 rows",               iterations: 100,  runs: 5, warmup: 10 },
  { key: "bulk_1000",       label: "Bulk insert 1,000 rows",             iterations: 30,   runs: 5, warmup: 5 },
  { key: "bulk_10000",      label: "Bulk insert 10,000 rows",            iterations: 10,   runs: 3, warmup: 2 },
  { key: "read_pk",         label: "Read by primary key",                iterations: 1000, runs: 5, warmup: 100 },
  { key: "find_filter",     label: "Find with filter (indexed column)",  iterations: 200,  runs: 5, warmup: 20 },
  { key: "find_sort_limit", label: "Find filter + sort + limit 20",      iterations: 200,  runs: 5, warmup: 20 },
  { key: "list_page",       label: "Paginated list (page 1, size 20)",   iterations: 200,  runs: 5, warmup: 20 },
  { key: "update_pk",       label: "Update by primary key",              iterations: 1000, runs: 5, warmup: 100 },
  { key: "bulk_update_100", label: "Bulk update 100 rows by PK list",    iterations: 100,  runs: 5, warmup: 10 },
  { key: "upsert",          label: "Upsert on unique key (half insert / half update)", iterations: 1000, runs: 5, warmup: 100 },
  { key: "delete_pk",       label: "Delete by primary key",              iterations: 1000, runs: 5, warmup: 50, resetPerRun: true },
  { key: "tx_multi",        label: "Transaction: insert + update + audit insert", iterations: 200, runs: 5, warmup: 20 },
  { key: "tx_rollback",     label: "Transaction rollback (forced error)", iterations: 200, runs: 5, warmup: 10 },
  { key: "jsonb_roundtrip", label: "JSONB round-trip (insert + read back)", iterations: 1000, runs: 5, warmup: 100 },
];
