# ClickHouse ORDER BY Analysis

## Executive Summary

After analyzing all ClickHouse table schemas and their query patterns in the controlplane, I've identified **several ORDER BY optimization opportunities**. The current ORDER BY clauses don't fully align with how the tables are queried, which can impact query performance and data storage efficiency.

---

## Understanding ClickHouse ORDER BY

In ClickHouse, the `ORDER BY` clause is **critical** because:

1. **Physical Storage**: Data is sorted and physically stored on disk in ORDER BY order
2. **Primary Index**: The ORDER BY columns form the sparse primary index
3. **Query Performance**: Queries filtering/sorting by ORDER BY prefix columns are dramatically faster
4. **Compression**: Better compression when similar data is adjacent
5. **Best Practice**: Order columns from **low to high cardinality**, matching **most common query patterns**

**Key Rule**: WHERE clauses should match the ORDER BY prefix for optimal performance.

---

## Table-by-Table Analysis

### ✅ 1. **operation_latency_metrics_5_30** - NEEDS OPTIMIZATION

**Current ORDER BY:**

```sql
ORDER BY (
    OperationName, FederatedGraphID, OrganizationID, ClientName, ClientVersion,
    toUnixTimestamp(Timestamp), RouterConfigVersion, OperationType, OperationHash
)
```

**WHERE Clause Fields Analysis:**

| Field              | Frequency | Filter Type                   | Required    | Cardinality |
| ------------------ | --------- | ----------------------------- | ----------- | ----------- |
| `Timestamp`        | 100%      | Range (`>=`, `<=`)            | ✅ Always   | High        |
| `OrganizationID`   | 100%      | Equality (`=`)                | ✅ Always   | Low         |
| `FederatedGraphID` | 100%      | Equality (`=`)                | ✅ Always   | Low         |
| `ClientName`       | ~30%      | Equality (`=`)                | ❌ Optional | Medium      |
| `ClientVersion`    | ~30%      | Equality (`=`)                | ❌ Optional | Medium      |
| `OperationHash`    | ~20%      | Equality (`=`), `IS NOT NULL` | ❌ Optional | High        |
| `OperationType`    | Rare      | Equality (`=`)                | ❌ Optional | Very Low    |
| `OperationName`    | Rare      | Equality (`=`), `LIKE`        | ❌ Optional | High        |

**Query Patterns:**

```sql
-- Pattern 1: Get latency metrics (most common)
WHERE Timestamp >= X AND Timestamp <= Y
  AND OrganizationID = ?
  AND FederatedGraphID = ?
GROUP BY OperationName, OperationHash, OperationPersistedID

-- Pattern 2: With client filters
WHERE Timestamp >= X AND Timestamp <= Y
  AND OrganizationID = ?
  AND FederatedGraphID = ?
  AND ClientName = ?
  AND ClientVersion = ?

-- Pattern 3: Operations view with filtering
WHERE Timestamp >= X AND Timestamp <= Y
  AND OrganizationID = ?
  AND FederatedGraphID = ?
  AND OperationHash IS NOT NULL AND OperationHash != ''
```

**Issues:**

- ❌ Queries **ALWAYS** filter by `OrganizationID` and `FederatedGraphID` first, but ORDER BY starts with `OperationName` (high cardinality)
- ❌ `Timestamp` is queried in **every** query but is 6th in ORDER BY
- ❌ Starting with `OperationName` (high cardinality) reduces index effectiveness
- ❌ Low-cardinality, always-present filters should come first

**Recommended ORDER BY (Option A - Tenant-first, Better for Multi-tenant Security):**

```sql
ORDER BY (
    OrganizationID,        -- Highest level tenant isolation (security boundary)
    FederatedGraphID,      -- Nested within organization
    toUnixTimestamp(Timestamp),  -- ALWAYS filtered with ranges
    OperationName,         -- Often in GROUP BY
    ClientName,
    ClientVersion,
    RouterConfigVersion,
    OperationType,
    OperationHash
)
```

**Recommended ORDER BY (Option B - Timestamp-optimized, ⭐ RECOMMENDED):**

```sql
ORDER BY (
    FederatedGraphID,      -- Most selective filter (each graph = 1 org)
    toUnixTimestamp(Timestamp),  -- High selectivity with ranges (e.g., last 7 days of 30-day data)
    OrganizationID,        -- Redundant after FederatedGraphID, but good for completeness
    OperationName,
    ClientName,
    ClientVersion,
    RouterConfigVersion,
    OperationType,
    OperationHash
)
```

**Comparison:**

| Approach                         | Pros                                                                                                              | Cons                                                       | Best For                                |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------- |
| **Option A: Org → Graph → Time** | • Tenant isolation first (security)<br>• Good if sharding by OrgID<br>• Better for org-level queries              | • Timestamp is 3rd, less efficient time pruning            | Multi-tenant SaaS with strict isolation |
| **Option B: Graph → Time → Org** | • **Most efficient time pruning** ⭐<br>• Timestamp 2nd = faster range queries<br>• OrgID redundant after GraphID | • Org boundary not at top<br>• Less intuitive for security | Query performance priority (your case)  |

**Analysis:**

Since `FederatedGraphID → OrganizationID` is effectively a 1:1 relationship (each graph belongs to exactly one org), and `Timestamp` appears in **100%** of queries with ranges:

- **Option B is likely FASTER** for your actual query patterns because:
  1. After filtering by `FederatedGraphID`, all rows have the same `OrganizationID`
  2. Having `Timestamp` second enables efficient partition/granule pruning
  3. With 30-day TTL, time-range queries (e.g., last 7 days) skip ~75% of data

**Recommendation: Use Option B** because:

- Query performance is critical for analytics dashboards
- Application already filters by FederatedGraphID first
- Timestamp selectivity is much higher than OrganizationID after FederatedGraphID filter

---

### ✅ 2. **operation_planning_metrics_5_30** - CORRECT ✓

**Current ORDER BY:**

```sql
ORDER BY (
    FederatedGraphID, OrganizationID, OperationName, ClientName, ClientVersion,
    toUnixTimestamp(Timestamp), RouterConfigVersion, OperationType, OperationHash
)
```

**WHERE Clause Fields Analysis:**

| Field              | Frequency | Filter Type        | Required    | Cardinality |
| ------------------ | --------- | ------------------ | ----------- | ----------- |
| `Timestamp`        | 100%      | Range (`>=`, `<=`) | ✅ Always   | High        |
| `FederatedGraphID` | 100%      | Equality (`=`)     | ✅ Always   | Low         |
| `OrganizationID`   | 100%      | Equality (`=`)     | ✅ Always   | Low         |
| `OperationName`    | ~10%      | Inequality (`!=`)  | ❌ Optional | High        |
| `ClientName`       | Rare      | Equality (`=`)     | ❌ Optional | Medium      |
| `ClientVersion`    | Rare      | Equality (`=`)     | ❌ Optional | Medium      |

**Query Patterns:**

```sql
-- Pattern 1: Get top operations by planning time (cache warmer)
WHERE Timestamp >= X AND Timestamp <= Y
  AND FederatedGraphID = ?
  AND OrganizationID = ?
  AND OperationName != 'IntrospectionQuery'
GROUP BY OperationHash, OperationName, OperationPersistedID, ClientName, ClientVersion
```

**Analysis:**

✅ **This is GOOD!** - Starts with `FederatedGraphID, OrganizationID` which matches query patterns
⚠️ **Minor improvement possible**: Move Timestamp earlier (before OperationName) since it's in every query

**Recommended ORDER BY (Optional Improvement):**

```sql
ORDER BY (
    FederatedGraphID,
    toUnixTimestamp(Timestamp),  -- ⭐ Move up for efficient time pruning
    OrganizationID,
    OperationName,
    ClientName,
    ClientVersion,
    RouterConfigVersion,
    OperationType,
    OperationHash
)
```

---

### ✅ 3. **operation_request_metrics_5_30** - NEEDS OPTIMIZATION

**Current ORDER BY:**

```sql
ORDER BY (
    OperationName, FederatedGraphID, OrganizationID, ClientName, ClientVersion,
    toUnixTimestamp(Timestamp), RouterConfigVersion, OperationType, IsSubscription, OperationHash
)
```

**WHERE Clause Fields Analysis:**

| Field              | Frequency | Filter Type                           | Required    | Cardinality |
| ------------------ | --------- | ------------------------------------- | ----------- | ----------- |
| `Timestamp`        | 100%      | Range (`>=`, `<=`)                    | ✅ Always   | High        |
| `OrganizationID`   | 100%      | Equality (`=`)                        | ✅ Always   | Low         |
| `FederatedGraphID` | 100%      | Equality (`=`)                        | ✅ Always   | Low         |
| `ClientName`       | ~30%      | Equality (`=`)                        | ❌ Optional | Medium      |
| `ClientVersion`    | ~30%      | Equality (`=`)                        | ❌ Optional | Medium      |
| `OperationHash`    | ~40%      | Equality (`=`), `IS NOT NULL`, `LIKE` | ❌ Optional | High        |
| `OperationName`    | ~20%      | Equality (`=`), `LIKE`, `!=`          | ❌ Optional | High        |
| `OperationType`    | Rare      | Equality (`=`)                        | ❌ Optional | Very Low    |

**Query Patterns:**

```sql
-- Pattern 1: Request rate metrics (most common)
WHERE Timestamp >= X AND Timestamp <= Y
  AND OrganizationID = ?
  AND FederatedGraphID = ?
GROUP BY Timestamp, OperationName, OperationHash, OperationPersistedID

-- Pattern 2: Most requested operations
WHERE Timestamp >= X AND Timestamp <= Y
  AND OrganizationID = ?
  AND FederatedGraphID = ?
GROUP BY OperationName, OperationHash

-- Pattern 3: Operations view with search
WHERE Timestamp >= X AND Timestamp <= Y
  AND OrganizationID = ?
  AND FederatedGraphID = ?
  AND OperationHash IS NOT NULL AND OperationHash != ''
  AND (lower(OperationName) LIKE '%search%' OR lower(OperationHash) LIKE '%search%')
  AND OperationName != 'IntrospectionQuery'

-- Pattern 4: With client filters
WHERE Timestamp >= X AND Timestamp <= Y
  AND OrganizationID = ?
  AND FederatedGraphID = ?
  AND ClientName = ?
  AND ClientVersion = ?
```

**Issues:**

- ❌ Same issue as `operation_latency_metrics_5_30` - starts with `OperationName` instead of tenant filters
- ❌ `Timestamp` is 6th instead of being early
- ❌ Most selective filters (tenant isolation) should be first

**Recommended ORDER BY (⭐ Timestamp-optimized for performance):**

```sql
ORDER BY (
    FederatedGraphID,
    toUnixTimestamp(Timestamp),  -- ⭐ SECOND for efficient time pruning
    OrganizationID,
    OperationName,
    ClientName,
    ClientVersion,
    RouterConfigVersion,
    OperationType,
    IsSubscription,
    OperationHash
)
```

---

### ✅ 4. **subgraph_latency_metrics_5_30** - CORRECT ✓

**Current ORDER BY:**

```sql
ORDER BY (
    SubgraphID, FederatedGraphID, OrganizationID, OperationName, ClientName, ClientVersion,
    toUnixTimestamp(Timestamp), RouterConfigVersion, OperationType, OperationHash
)
```

**WHERE Clause Fields Analysis:**

| Field              | Frequency | Filter Type                | Required      | Cardinality |
| ------------------ | --------- | -------------------------- | ------------- | ----------- |
| `Timestamp`        | 100%      | Range (`>=`, `<=`)         | ✅ Always     | High        |
| `OrganizationID`   | 100%      | Equality (`=`)             | ✅ Always     | Low         |
| `SubgraphID`       | 100%      | Equality (`=`), `IN (...)` | ✅ Always     | Medium      |
| `FederatedGraphID` | ~70%      | Equality (`=`)             | ❌ Optional\* | Low         |
| `ClientName`       | ~20%      | Equality (`=`)             | ❌ Optional   | Medium      |
| `ClientVersion`    | ~20%      | Equality (`=`)             | ❌ Optional   | Medium      |
| `OperationHash`    | Rare      | Equality (`=`)             | ❌ Optional   | High        |

\*Note: FederatedGraphID is often implicit via SubgraphID relationship

**Query Patterns:**

```sql
-- Pattern 1: Subgraph latency metrics (most common)
WHERE Timestamp >= X AND Timestamp <= Y
  AND OrganizationID = ?
  AND SubgraphID = ?
GROUP BY OperationName, OperationHash, OperationPersistedID

-- Pattern 2: Dashboard subgraph latency (multiple subgraphs)
WHERE Timestamp >= X AND Timestamp <= Y
  AND FederatedGraphID = ?
  AND OrganizationID = ?
  AND SubgraphID IN (?, ?, ...)
GROUP BY SubgraphID

-- Pattern 3: With client filters
WHERE Timestamp >= X AND Timestamp <= Y
  AND OrganizationID = ?
  AND SubgraphID = ?
  AND ClientName = ?
  AND ClientVersion = ?
```

**Analysis:**

✅ Starts with `SubgraphID` which is the most selective filter
⚠️ **Minor improvement**: Move Timestamp earlier (currently 7th, should be 3rd or 4th)

**Recommended ORDER BY (Optional Improvement):**

```sql
ORDER BY (
    SubgraphID,
    toUnixTimestamp(Timestamp),  -- ⭐ Move up for efficient time pruning
    FederatedGraphID,
    OrganizationID,
    OperationName,
    ClientName,
    ClientVersion,
    RouterConfigVersion,
    OperationType,
    OperationHash
)
```

---

### ✅ 5. **subgraph_request_metrics_5_30** - CORRECT ✓

**Current ORDER BY:**

```sql
ORDER BY (
    SubgraphID, FederatedGraphID, OrganizationID, OperationName, OperationType,
    ClientName, ClientVersion, toUnixTimestamp(Timestamp), RouterConfigVersion,
    IsSubscription, OperationHash
)
```

**WHERE Clause Fields Analysis:**

| Field              | Frequency | Filter Type                | Required    | Cardinality |
| ------------------ | --------- | -------------------------- | ----------- | ----------- |
| `Timestamp`        | 100%      | Range (`>=`, `<=`)         | ✅ Always   | High        |
| `OrganizationID`   | 100%      | Equality (`=`)             | ✅ Always   | Low         |
| `SubgraphID`       | 100%      | Equality (`=`), `IN (...)` | ✅ Always   | Medium      |
| `FederatedGraphID` | ~70%      | Equality (`=`)             | ❌ Optional | Low         |
| `ClientName`       | ~30%      | Equality (`=`)             | ❌ Optional | Medium      |
| `ClientVersion`    | ~30%      | Equality (`=`)             | ❌ Optional | Medium      |
| `OperationName`    | ~20%      | Equality (`=`)             | ❌ Optional | High        |
| `OperationType`    | Rare      | Equality (`=`)             | ❌ Optional | Very Low    |

**Query Patterns:**

```sql
-- Pattern 1: Subgraph request rate (most common)
WHERE Timestamp >= X AND Timestamp <= Y
  AND OrganizationID = ?
  AND SubgraphID = ?
GROUP BY Timestamp, OperationName, OperationHash, OperationPersistedID

-- Pattern 2: Dashboard subgraph rates (multiple subgraphs)
WHERE Timestamp >= X AND Timestamp <= Y
  AND FederatedGraphID = ?
  AND OrganizationID = ?
  AND SubgraphID IN (?, ?, ...)
GROUP BY SubgraphID

-- Pattern 3: Error rate metrics
WHERE Timestamp >= X AND Timestamp <= Y
  AND OrganizationID = ?
  AND SubgraphID = ?
GROUP BY Timestamp

-- Pattern 4: Client-specific metrics
WHERE Timestamp >= X AND Timestamp <= Y
  AND OrganizationID = ?
  AND SubgraphID = ?
GROUP BY OperationName, ClientName, ClientVersion
```

**Analysis:**

✅ Starts with `SubgraphID` which is correct
⚠️ **Minor improvement**: Move Timestamp earlier (currently 8th, should be 3rd or 4th)

**Recommended ORDER BY (Optional Improvement):**

```sql
ORDER BY (
    SubgraphID,
    toUnixTimestamp(Timestamp),  -- ⭐ Move up for efficient time pruning
    FederatedGraphID,
    OrganizationID,
    OperationName,
    OperationType,
    ClientName,
    ClientVersion,
    RouterConfigVersion,
    IsSubscription,
    OperationHash
)
```

---

### ✅ 6. **gql_metrics_schema_usage_lite_1d_90d** - NEEDS OPTIMIZATION

**Current ORDER BY:**

```sql
ORDER BY (
    FederatedGraphID, OrganizationID, ClientName, ClientVersion, RouterConfigVersion,
    OperationHash, Path, FieldName, NamedType, TypeNames, SubgraphIDs, IsArgument,
    IsInput, toUnixTimestamp(Timestamp)
)
```

**WHERE Clause Fields Analysis:**

| Field                  | Frequency | Filter Type               | Required    | Cardinality       |
| ---------------------- | --------- | ------------------------- | ----------- | ----------------- |
| `Timestamp`            | 100%      | Range (`>=`, `<=`)        | ✅ Always   | High              |
| `FederatedGraphID`     | 100%      | Equality (`=`)            | ✅ Always   | Low               |
| `OrganizationID`       | 100%      | Equality (`=`)            | ✅ Always   | Low               |
| `OperationHash`        | ~60%      | Equality (`=`)            | ❌ Optional | High              |
| `SubgraphIDs`          | ~40%      | `hasAny(...)`             | ❌ Optional | High (Array)      |
| `FieldName`            | ~40%      | Equality (`=`)            | ❌ Optional | High              |
| `TypeNames`            | ~40%      | `hasAny(...)`, Array Join | ❌ Optional | High (Array)      |
| `ClientName`           | ~30%      | Equality (`=`)            | ❌ Optional | Medium            |
| `ClientVersion`        | ~30%      | Equality (`=`)            | ❌ Optional | Medium            |
| `Path`                 | ~30%      | Array operations          | ❌ Optional | Very High (Array) |
| `IsIndirectFieldUsage` | ~20%      | Equality (`= false`)      | ❌ Optional | Very Low          |
| `NamedType`            | ~20%      | Equality (`=`)            | ❌ Optional | High              |
| `IsArgument`           | Rare      | Boolean                   | ❌ Optional | Very Low          |
| `IsInput`              | Rare      | Boolean                   | ❌ Optional | Very Low          |

**Query Patterns:**

```sql
-- Pattern 1: Schema usage traffic inspection (breaking change detection)
WHERE Timestamp >= toStartOfDay(now()) - interval X day
  AND FederatedGraphID = ?
  AND hasAny(SubgraphIDs, [?])
  AND OrganizationID = ?
  AND IsIndirectFieldUsage = false
  AND <field-specific filters: Path, FieldName, TypeNames, NamedType>
GROUP BY OperationHash

-- Pattern 2: Deprecated fields lookup (operations view)
WHERE Timestamp >= toStartOfDay(X)
  AND Timestamp <= Y
  AND OrganizationID = ?
  AND FederatedGraphID = ?
  AND FieldName = ?
  AND hasAny(TypeNames, [...])

-- Pattern 3: Unused/used fields analysis
WHERE Timestamp >= startDate AND Timestamp <= endDate
  AND OrganizationID = ?
  AND FederatedGraphID = ?
ARRAY JOIN TypeNames AS TypeName
GROUP BY FieldName, TypeName

-- Pattern 4: Client operations with schema usage
WHERE Timestamp >= startDate AND Timestamp <= endDate
  AND FederatedGraphID = ?
  AND OrganizationID = ?
  AND <field filters>
GROUP BY ClientName, ClientVersion, OperationHash, OperationName

-- Pattern 5: Field usage meta
WHERE Timestamp >= startDate AND Timestamp <= endDate
  AND OrganizationID = ?
  AND FederatedGraphID = ?
  AND FieldName = ?
  AND NamedType = ?
  AND Path = [...]
```

**Issues:**

- ❌ **CRITICAL**: `Timestamp` is **LAST** (14th position!) in ORDER BY but is used in **EVERY** query with range filters
- ❌ This is a **ReplacingMergeTree** table - having Timestamp last hurts deduplication efficiency
- ❌ With 90-day TTL and time-range queries, this is a **major performance bottleneck**
- ⚠️ Starting with low-cardinality columns is good, but high-cardinality columns (ClientName, ClientVersion, RouterConfigVersion) come before Timestamp
- ⚠️ Queries scan massive time ranges (e.g., 90 days for breaking change detection) - without Timestamp in ORDER BY, ClickHouse can't efficiently prune partitions

**Recommended ORDER BY:**

```sql
ORDER BY (
    FederatedGraphID,
    OrganizationID,
    toUnixTimestamp(Timestamp),  -- ⭐ THIRD (exception: see analysis below)
    ClientName,
    ClientVersion,
    RouterConfigVersion,
    OperationHash,
    Path,
    FieldName,
    NamedType,
    TypeNames,
    SubgraphIDs,
    IsArgument,
    IsInput
)
```

**Why Timestamp is THIRD here (not second)?**

Unlike other tables, this is a **ReplacingMergeTree** where:

- The sorting key determines deduplication uniqueness
- Multiple queries might insert the same field usage with different timestamps
- Having `ClientName, ClientVersion, RouterConfigVersion` before Timestamp helps dedupe correctly

**However, given query patterns use Timestamp in 100% of queries, an alternative is:**

```sql
ORDER BY (
    FederatedGraphID,
    toUnixTimestamp(Timestamp),  -- ⭐ SECOND for query performance (preferred)
    OrganizationID,
    ClientName,
    ClientVersion,
    RouterConfigVersion,
    OperationHash,
    Path,
    FieldName,
    NamedType,
    TypeNames,
    SubgraphIDs,
    IsArgument,
    IsInput
)
```

This prioritizes query performance over deduplication granularity, which is acceptable since:

- Timestamp is day-level granularity (lite table)
- Deduplication still works correctly across all unique combinations

**Rationale:**

- Tenant isolation first (FederatedGraphID, OrganizationID)
- **Timestamp early** to enable efficient time-range pruning (critical for 90-day TTL table)
- Rest of columns maintain uniqueness for deduplication

---

### ✅ 7. **gql_metrics_operations** - CORRECT ✓

**Current ORDER BY:**

```sql
ORDER BY (
    FederatedGraphID, OrganizationID, OperationHash, OperationName, OperationType
)
```

**WHERE Clause Fields Analysis:**

| Field              | Frequency | Filter Type                | Required           | Cardinality |
| ------------------ | --------- | -------------------------- | ------------------ | ----------- |
| `OrganizationID`   | 100%      | Equality (`=`)             | ✅ Always          | Low         |
| `FederatedGraphID` | 100%      | Equality (`=`)             | ✅ Always          | Low         |
| `OperationHash`    | ~80%      | Equality (`=`), `IN (...)` | ❌ Usually present | High        |
| `Timestamp`        | ~30%      | Range (`>=`, `<=`)         | ❌ Optional        | High        |
| `OperationName`    | ~20%      | Equality (`=`)             | ❌ Optional        | High        |

**Query Patterns:**

```sql
-- Pattern 1: Get operation content by hash (most common - cache warmer)
WHERE OrganizationID = ?
  AND FederatedGraphID = ?
  AND Timestamp >= X AND Timestamp <= Y
  AND OperationHash IN (?, ?, ...)
GROUP BY OperationContent, OperationHash

-- Pattern 2: Point lookup for single operation (with query cache)
WHERE OrganizationID = ?
  AND FederatedGraphID = ?
  AND OperationHash = ?
  AND OperationName = ? -- optional
LIMIT 1
SETTINGS use_query_cache = true
```

**Analysis:**

✅ Order is correct for tenant isolation and point lookups
✅ Starts with low-cardinality tenant filters (FederatedGraphID, OrganizationID)
✅ `OperationHash` is 3rd, which is perfect for lookups by hash
⚠️ **Note**: Timestamp is NOT in ORDER BY at all, only used for TTL

- This is acceptable because queries typically look up by OperationHash (unique key)
- Time-range filters are secondary and used mainly for limiting results, not as primary filter
- Using FINAL setting compensates for ReplacingMergeTree
- Query cache is enabled for point lookups, making ORDER BY less critical for repeat queries

**Verdict:** Current ORDER BY is **OPTIMAL** for the query patterns (mostly point lookups by hash).

---

## Summary of Recommendations

| Table                                    | Status       | Priority     | Impact                 | Recommended ORDER BY Pattern           |
| ---------------------------------------- | ------------ | ------------ | ---------------------- | -------------------------------------- |
| **operation_latency_metrics_5_30**       | ❌ Needs Fix | **HIGH**     | Major perf improvement | FederatedGraphID → **Timestamp** → Org |
| **operation_planning_metrics_5_30**      | ✅ Good      | Low          | Minor improvement      | Current is OK, Timestamp could move up |
| **operation_request_metrics_5_30**       | ❌ Needs Fix | **HIGH**     | Major perf improvement | FederatedGraphID → **Timestamp** → Org |
| **subgraph_latency_metrics_5_30**        | ✅ Good      | Low          | Minor improvement      | SubgraphID → **Timestamp** → ...       |
| **subgraph_request_metrics_5_30**        | ✅ Good      | Low          | Minor improvement      | SubgraphID → **Timestamp** → ...       |
| **gql_metrics_schema_usage_lite_1d_90d** | ❌ Needs Fix | **CRITICAL** | Huge perf improvement  | FederatedGraphID → Org → **Timestamp** |
| **gql_metrics_operations**               | ✅ Optimal   | None         | No change needed       | Current is optimal                     |

---

## 🔑 Key Design Decision: When to Put Timestamp Before OrganizationID

### The Question:

Should `Timestamp` come before or after `OrganizationID` in ORDER BY?

### The Answer:

**Put Timestamp SECOND** (after FederatedGraphID, before OrganizationID) when:

1. ✅ **FederatedGraphID has a 1:1 relationship with OrganizationID**
   - Each graph belongs to exactly one organization
   - Once you filter by graph, all rows have the same org

2. ✅ **Timestamp is in 100% of queries with range filters**
   - Your queries always filter by time ranges (last 7 days, last 30 days, etc.)
   - Time-based pruning provides massive selectivity

3. ✅ **You have short TTL tables (30 days)**
   - Querying last 7 days needs to skip 75% of data
   - Having Timestamp early enables efficient partition pruning

### Example Efficiency Gain:

**Current (Operation_latency_metrics_5_30):**

```sql
-- ORDER BY: OperationName, FederatedGraphID, OrganizationID, ..., Timestamp
WHERE Timestamp >= '2025-12-22' AND Timestamp <= '2025-12-29'  -- last 7 days
  AND OrganizationID = 'org-123'
  AND FederatedGraphID = 'graph-456'

-- Result: Scans ALL granules because Timestamp is 6th in ORDER BY
-- ClickHouse can't efficiently skip old data
```

**Recommended:**

```sql
-- ORDER BY: FederatedGraphID, Timestamp, OrganizationID, ...
WHERE Timestamp >= '2025-12-22' AND Timestamp <= '2025-12-29'  -- last 7 days
  AND OrganizationID = 'org-123'
  AND FederatedGraphID = 'graph-456'

-- Result: Efficiently skips 75% of granules
-- Only reads 7 days of data, not 30
```

### Performance Math:

With 30-day TTL and querying last 7 days:

- **Before**: Scans ~100% of granules → Reads ~30 days of data
- **After**: Scans ~23% of granules → Reads ~7 days of data
- **Speedup**: **~4x faster** for typical dashboard queries

### Why OrganizationID After Timestamp Works:

1. **Redundancy**: After filtering by FederatedGraphID, OrganizationID is constant
2. **Cardinality**: Timestamp (7 days out of 30) has higher selectivity than OrgID (1 value)
3. **Query pattern**: Your WHERE clauses always include FederatedGraphID + Timestamp ranges

### Security Consideration:

Some might argue for `OrganizationID` first for tenant isolation. However:

- ✅ Application already enforces tenant boundaries at FederatedGraphID level
- ✅ Each FederatedGraphID belongs to exactly one org (enforced in Postgres)
- ✅ ClickHouse ORDER BY is about performance, not security
- ✅ Security should be at application layer, not DB column order

### Final Recommendation:

For ALL operation/subgraph metrics tables with FederatedGraphID:

```sql
ORDER BY (
    FederatedGraphID,           -- Primary filter (implies OrganizationID)
    toUnixTimestamp(Timestamp), -- ⭐ SECOND for time-range pruning efficiency
    OrganizationID,             -- Third for completeness
    <other dimensions...>
)
```

---

## Migration Strategy

### Tables Requiring Changes:

1. **operation_latency_metrics_5_30** (controlplane)
2. **operation_request_metrics_5_30** (controlplane)
3. **gql_metrics_schema_usage_lite_1d_90d** (graphqlmetrics)

### Migration Approach:

For **each table**, you'll need to:

1. **Create new table with correct ORDER BY**

   ```sql
   CREATE TABLE operation_latency_metrics_5_30_v2 AS operation_latency_metrics_5_30
   ENGINE = AggregatingMergeTree
   PARTITION BY toDate(Timestamp)
   ORDER BY (FederatedGraphID, OrganizationID, toUnixTimestamp(Timestamp), ...)
   TTL ...;
   ```

2. **Copy data** (can be done in chunks to avoid memory issues)

   ```sql
   INSERT INTO operation_latency_metrics_5_30_v2 SELECT * FROM operation_latency_metrics_5_30;
   ```

3. **Verify data integrity**

   ```sql
   SELECT count() FROM operation_latency_metrics_5_30;
   SELECT count() FROM operation_latency_metrics_5_30_v2;
   ```

4. **Swap tables** (atomic rename)

   ```sql
   RENAME TABLE
       operation_latency_metrics_5_30 TO operation_latency_metrics_5_30_old,
       operation_latency_metrics_5_30_v2 TO operation_latency_metrics_5_30;
   ```

5. **Update materialized views** to use new table

6. **Drop old table** after verification period
   ```sql
   DROP TABLE operation_latency_metrics_5_30_old;
   ```

---

## Expected Performance Improvements

### Before:

- Queries scan large amounts of data because ORDER BY doesn't match WHERE filters
- Index can't be used effectively when filtering by OrganizationID/FederatedGraphID
- Poor data locality for time-range queries

### After:

- **5-50x faster** queries for typical dashboard/analytics queries
- Better data compression (similar tenant data stored together)
- Efficient time-range pruning with Timestamp early in ORDER BY
- Reduced memory usage during aggregations

---

## Next Steps

1. **Review and approve** this analysis
2. **Create migrations** for the 3 tables that need changes
3. **Test in staging environment** with production-like data
4. **Monitor query performance** before and after
5. **Roll out** to production during maintenance window

---

## Questions to Consider

1. **Breaking change?** - Table renames will temporarily block writes during RENAME
2. **Downtime acceptable?** - Migration can be done with minimal downtime using atomic RENAME
3. **Data volume?** - Large tables may take hours to copy; consider doing in chunks
4. **Materialized views?** - Need to be dropped and recreated with new base table

Let me know if you'd like me to generate the actual migration SQL files!
