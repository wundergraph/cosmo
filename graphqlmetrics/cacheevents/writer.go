package cacheevents

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/avast/retry-go"
	"github.com/google/uuid"
	cacheeventsv1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/cacheevents/v1"
	"go.uber.org/zap"
)

const insertCacheEventsRawQuery = `INSERT INTO gql_cache_events_raw`

// Writer ships batches of cache events to ClickHouse.
type Writer struct {
	logger *zap.Logger
	conn   clickhouse.Conn
}

// NewWriter constructs a Writer bound to the given ClickHouse connection.
func NewWriter(logger *zap.Logger, conn clickhouse.Conn) *Writer {
	return &Writer{
		logger: logger,
		conn:   conn,
	}
}

// ProcessBatch is the dispatcher passed to the batchprocessor. It opens a
// single ClickHouse batch, appends one row per CacheEvent across all items
// in the input slice, then sends the batch with retry. Errors are logged
// but never returned: the batch processor has no error channel.
func (w *Writer) ProcessBatch(ctx context.Context, items []BatchItem) {
	if len(items) == 0 {
		return
	}

	insertTime := time.Now().UTC()

	// Stable per-logical-batch deduplication token reused across retries.
	// clickhouse-go v2 marks a batch "sent" even when Send() returns an
	// error, so the only safe retry is to build a fresh batch — which would
	// duplicate rows if ClickHouse had already committed the first attempt.
	// insert_deduplication_token tells the server to drop matching repeats.
	dedupCtx := clickhouse.Context(ctx, clickhouse.WithSettings(clickhouse.Settings{
		"insert_deduplicate":         uint8(1),
		"insert_deduplication_token": uuid.NewString(),
	}))

	err := retry.Do(
		func() error {
			batch, err := w.conn.PrepareBatch(dedupCtx, insertCacheEventsRawQuery)
			if err != nil {
				return fmt.Errorf("prepare batch: %w", err)
			}

			rows := 0
			for _, item := range items {
				if item.Claims == nil {
					continue
				}
				for _, ev := range item.Events {
					if ev == nil {
						continue
					}
					if err := appendCacheEventRow(batch, insertTime, item.Claims.OrganizationID, item.Claims.FederatedGraphID, ev); err != nil {
						w.logger.Error("Failed to append cache event row", zap.Error(err))
						continue
					}
					rows++
				}
			}

			if rows == 0 {
				_ = batch.Abort()
				return nil
			}

			if err := batch.Send(); err != nil {
				return fmt.Errorf("send batch: %w", err)
			}

			w.logger.Debug("Cache events batch sent", zap.Int("rows", rows))
			return nil
		},
		retry.Attempts(3),
		retry.Delay(100*time.Millisecond),
		retry.MaxDelay(1*time.Second),
		retry.DelayType(retry.BackOffDelay),
		retry.Context(ctx),
	)
	if err != nil {
		w.logger.Error("Failed to flush cache events batch after retries", zap.Error(err))
	}
}

// appendCacheEventRow appends one row to the ClickHouse batch in the same
// column order as the gql_cache_events_raw migration.
func appendCacheEventRow(
	batch driver.Batch,
	insertTime time.Time,
	organizationID, federatedGraphID string,
	ev *cacheeventsv1.CacheEvent,
) error {
	ts := insertTime
	if ev.TimestampUnixNano != 0 {
		ts = time.Unix(0, int64(ev.TimestampUnixNano)).UTC()
	}

	// Prefer the typed CacheOpKind enum when set; fall back to the legacy
	// freeform string for backward compatibility with older routers.
	cacheOp := ev.CacheOp
	if ev.CacheOpKind != cacheeventsv1.CacheOpKind_CACHE_OP_KIND_UNSPECIFIED {
		cacheOp = CacheOpKindString(ev.CacheOpKind)
	}

	return batch.Append(
		ts,                                // Timestamp
		organizationID,                    // OrganizationID
		federatedGraphID,                  // FederatedGraphID
		ev.RouterConfigVersion,            // RouterConfigVersion
		EventTypeString(ev.EventType),     // EventType
		ev.OperationHash,                  // OperationHash
		ev.OperationName,                  // OperationName
		strings.ToLower(ev.OperationType), // OperationType
		ev.ClientName,                     // ClientName
		ev.ClientVersion,                  // ClientVersion
		ev.TraceId,                        // TraceID
		ev.IsShadow,                       // IsShadow
		ev.EntityType,                     // EntityType
		ev.SubgraphId,                     // SubgraphID
		ev.KeyHash,                        // KeyHash
		VerdictString(ev.Verdict),         // Verdict
		ev.ByteSize,                       // ByteSize
		ev.CacheAgeMs,                     // CacheAgeMs
		ev.TtlMs,                          // TTLMs
		ev.WriteReason,                    // WriteReason
		ev.Source,                         // Source
		FieldSourceString(ev.FetchSource), // FetchSource
		ev.DurationMs,                     // DurationMs
		ev.TtfbMs,                         // TTFBMs
		ev.ItemCount,                      // ItemCount
		ev.IsEntityFetch,                  // IsEntityFetch
		uint16(ev.HttpStatusCode),         // HttpStatusCode
		ev.ResponseBytes,                  // ResponseBytes
		ev.ErrorMessage,                   // ErrorMessage
		ev.ErrorCode,                      // ErrorCode
		cacheOp,                           // CacheOp
		ev.CacheName,                      // CacheName
		ev.ShadowIsFresh,                  // ShadowIsFresh
		ev.CachedHash,                     // CachedHash
		ev.FreshHash,                      // FreshHash
		ev.CachedBytes,                    // CachedBytes
		ev.FreshBytes,                     // FreshBytes
		ev.ConfiguredTtlMs,                // ConfiguredTTLMs
		ev.MutationRootField,              // MutationRootField
		ev.FieldName,                      // FieldName
		ev.FieldHash,                      // FieldHash
		fieldPathColumn(ev.FieldPath),     // FieldPath (Array(LowCardinality(String)))
		ev.EntityCount,                    // EntityCount
		ev.EntityUniqueKeys,               // EntityUniqueKeys
		ev.HadCachedValue,                 // HadCachedValue
		ev.IsStale,                        // IsStale
		ev.BaseKeyHash,                    // BaseKeyHash
		ev.HeaderHash,                     // HeaderHash
		ev.ResponseHash,                   // ResponseHash
	)
}

// fieldPathColumn normalizes a possibly-nil FieldPath onto the empty slice the
// ClickHouse driver expects for an Array column. Empty slice marks a direct
// entity scalar (no value-type traversal). Older routers that don't populate
// FieldPath will arrive nil and serialize as []string{}.
func fieldPathColumn(p []string) []string {
	if len(p) == 0 {
		return []string{}
	}
	return p
}
