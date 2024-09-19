# Introduction of new schemausage table to speed up checks and pruning

## Purpose:
This migration will help customers transition from the existing `gql_metrics_schema_usage_5m_90d` table to the newly introduced `gql_metrics_schema_usage_lite_1d_90d` table for faster GraphQL pruning and checks.

### Migration Overview:
We are migrating the data into a more optimized structure with daily buckets to improve the efficiency of pruning and subgraph checks. The new table, `gql_metrics_schema_usage_lite_1d_90d`, will store data in a daily format, which will enhance query performance.

---

## Prerequisites:
Before proceeding, ensure the following:

1. **Back up existing data**: Always back up your existing tables and data to avoid any accidental data loss.
2. **Ensure access**: You need write access to both the old and new tables in your database.
3. **Database maintenance window**: Schedule downtime if necessary to avoid service interruptions during the migration.

---

## Migration Steps

### Step 1: Apply New Migrations
Please ensure the latest version of Cosmo has been deployed. This migration is only applicable to the following components:

- **Graphqlmetrics**: 0.23.0
- **Controlplane**: 0.108.0

Once the new graphlmetrics is deployed, the new tables `gql_metrics_schema_usage_lite_1d_90d` and `gql_metrics_schema_usage_lite_1d_90d_mv` will be created automatically.

Please run the [sql query](./insert_into_gql_metrics_schema_usage_lite_1d_90d.sql) to insert data into `gql_metrics_schema_usage_lite_1d_90d` from `gql_metrics_schema_usage_5m_90d`.

### Step 3: Verify Data Integrity
Once the data has been migrated, it is important to verify the integrity and accuracy of the data. Use the following SQL queries to check that the data has been correctly migrated:

1. **Count records**: Ensure the row count matches between the old and new tables (allowing for daily aggregation in the new table).
   ```sql
   SELECT COUNT(*) FROM gql_metrics_schema_usage_5m_90d;
   SELECT COUNT(*) FROM gql_metrics_schema_usage_lite_1d_90d;
   ```

### Step 4: Verify end-to-end functionality

After applying the migration, ensure that the system is functioning as expected. This includes:

1. Querying your graph.
2. Running GraphQL pruning and subgraph checks and verify if the functionality is working as expected.

---

## Potential Issues & Troubleshooting

- **Data mismatch**: If there are discrepancies in the row count, check for errors in aggregation or data types in both tables.
- **Performance degradation**: If the migration takes too long, consider migrating in batches to avoid locking the database.

---

## Post-Migration Steps:
Once the migration is complete, ensure your system is functioning as expected. This includes:

1. **Monitoring performance improvements**: Track whether the changes have led to better query performance in your GraphQL pruning and subgraph checks.
2. **Alerting**: Set up any necessary alerts or notifications for monitoring the health of the new table.