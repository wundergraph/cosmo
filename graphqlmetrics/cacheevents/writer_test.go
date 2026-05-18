package cacheevents

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2/lib/column"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/stretchr/testify/require"
	cacheeventsv1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/cacheevents/v1"
	utils "github.com/wundergraph/cosmo/graphqlmetrics/pkg/utils"
	"go.uber.org/zap"
)

func TestFieldPathColumn(t *testing.T) {
	t.Parallel()

	t.Run("nil normalizes to empty slice", func(t *testing.T) {
		got := fieldPathColumn(nil)
		require.NotNil(t, got, "ClickHouse Array column requires non-nil empty slice")
		require.Empty(t, got)
	})

	t.Run("empty slice stays empty", func(t *testing.T) {
		got := fieldPathColumn([]string{})
		require.NotNil(t, got)
		require.Empty(t, got)
	})

	t.Run("non-empty slice passes through unchanged", func(t *testing.T) {
		in := []string{"user", "address", "city"}
		require.Equal(t, in, fieldPathColumn(in))
	})

	t.Run("single-element slice passes through", func(t *testing.T) {
		require.Equal(t, []string{"name"}, fieldPathColumn([]string{"name"}))
	})
}

// fakeBatch is a driver.Batch test double that records every Append call.
// Only Append/Send/Abort are exercised by the writer; the other interface
// methods exist solely to satisfy the type.
type fakeBatch struct {
	mu        sync.Mutex
	rows      [][]any
	sendCalls int
	abortCs   int
	sendErr   error
}

func (b *fakeBatch) Append(v ...any) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	row := make([]any, len(v))
	copy(row, v)
	b.rows = append(b.rows, row)
	return nil
}

func (b *fakeBatch) Send() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.sendCalls++
	return b.sendErr
}

func (b *fakeBatch) Abort() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.abortCs++
	return nil
}

func (b *fakeBatch) AppendStruct(any) error        { return errors.New("not implemented") }
func (b *fakeBatch) Column(int) driver.BatchColumn { return nil }
func (b *fakeBatch) Flush() error                  { return nil }
func (b *fakeBatch) IsSent() bool                  { return false }
func (b *fakeBatch) Rows() int                     { return len(b.rows) }
func (b *fakeBatch) Columns() []column.Interface   { return nil }

func TestAppendCacheEventRow_TimestampFallback(t *testing.T) {
	t.Parallel()

	insert := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)

	t.Run("event without TimestampUnixNano falls back to insertTime", func(t *testing.T) {
		batch := &fakeBatch{}
		ev := &cacheeventsv1.CacheEvent{EventType: cacheeventsv1.EventType_L1_READ}
		require.NoError(t, appendCacheEventRow(batch, insert, "org", "fg", ev))
		require.Len(t, batch.rows, 1)
		require.Equal(t, insert, batch.rows[0][0], "first column is Timestamp; must use insertTime when event timestamp is zero")
	})

	t.Run("event with TimestampUnixNano uses that exact instant in UTC", func(t *testing.T) {
		batch := &fakeBatch{}
		eventTime := time.Date(2026, 4, 1, 9, 30, 0, 12345, time.UTC)
		ev := &cacheeventsv1.CacheEvent{
			EventType:         cacheeventsv1.EventType_L1_WRITE,
			TimestampUnixNano: uint64(eventTime.UnixNano()),
		}
		require.NoError(t, appendCacheEventRow(batch, insert, "org", "fg", ev))
		require.Len(t, batch.rows, 1)
		got, ok := batch.rows[0][0].(time.Time)
		require.True(t, ok)
		require.Truef(t, eventTime.Equal(got), "event timestamp must round-trip: want %s got %s", eventTime, got)
		require.Equal(t, time.UTC, got.Location(), "timestamp must be normalized to UTC")
	})
}

func TestAppendCacheEventRow_CacheOpKindOverridesFreeformString(t *testing.T) {
	t.Parallel()

	insert := time.Now().UTC()

	// CacheOp column is at a fixed position — find it by counting.
	// Order from the source: [Timestamp, OrgID, FedGraphID, RouterConfigVersion,
	//   EventType, OperationHash, OperationName, OperationType, ClientName,
	//   ClientVersion, TraceID, IsShadow, EntityType, SubgraphID, KeyHash,
	//   FieldName, FieldHash, FieldPath, EntityCount, EntityUniqueKeys,
	//   Verdict, ByteSize, CacheAgeMs, TTLMs, WriteReason, Source, FetchSource,
	//   DurationMs, TTFBMs, ItemCount, IsEntityFetch, HttpStatusCode,
	//   ResponseBytes, ErrorMessage, ErrorCode, CacheOp, ...]
	const cacheOpIdx = 35

	t.Run("typed enum wins over the legacy string", func(t *testing.T) {
		batch := &fakeBatch{}
		ev := &cacheeventsv1.CacheEvent{
			EventType:   cacheeventsv1.EventType_CACHE_OP_ERROR,
			CacheOp:     "this should be ignored",
			CacheOpKind: cacheeventsv1.CacheOpKind_DELETE,
		}
		require.NoError(t, appendCacheEventRow(batch, insert, "org", "fg", ev))
		require.Equal(t, "delete", batch.rows[0][cacheOpIdx])
	})

	t.Run("freeform string is used when the enum is unspecified", func(t *testing.T) {
		batch := &fakeBatch{}
		ev := &cacheeventsv1.CacheEvent{
			EventType:   cacheeventsv1.EventType_CACHE_OP_ERROR,
			CacheOp:     "legacy_value",
			CacheOpKind: cacheeventsv1.CacheOpKind_CACHE_OP_KIND_UNSPECIFIED,
		}
		require.NoError(t, appendCacheEventRow(batch, insert, "org", "fg", ev))
		require.Equal(t, "legacy_value", batch.rows[0][cacheOpIdx],
			"old routers populate CacheOp without CacheOpKind; the writer must preserve that path")
	})
}

func TestAppendCacheEventRow_OperationTypeIsLowercased(t *testing.T) {
	t.Parallel()

	const operationTypeIdx = 7

	batch := &fakeBatch{}
	require.NoError(t, appendCacheEventRow(batch, time.Now().UTC(), "o", "f", &cacheeventsv1.CacheEvent{
		OperationType: "MUTATION",
	}))
	require.Equal(t, "mutation", batch.rows[0][operationTypeIdx],
		"OperationType normalization is the writer's last-line-of-defense — even if a router skips it, the column must stay lowercase")
}

func TestAppendCacheEventRow_OrgAndGraphIDsArePropagated(t *testing.T) {
	t.Parallel()

	const orgIdx, fgIdx = 1, 2

	batch := &fakeBatch{}
	require.NoError(t, appendCacheEventRow(batch, time.Now().UTC(), "org-7", "fg-9", &cacheeventsv1.CacheEvent{}))
	require.Equal(t, "org-7", batch.rows[0][orgIdx])
	require.Equal(t, "fg-9", batch.rows[0][fgIdx])
}

func TestAppendCacheEventRow_FieldPath_ServializesAsArrayColumn(t *testing.T) {
	t.Parallel()

	const fieldPathIdx = 17

	t.Run("nil FieldPath becomes empty array, never nil", func(t *testing.T) {
		batch := &fakeBatch{}
		require.NoError(t, appendCacheEventRow(batch, time.Now().UTC(), "o", "f", &cacheeventsv1.CacheEvent{}))
		got, ok := batch.rows[0][fieldPathIdx].([]string)
		require.True(t, ok, "FieldPath column type must be []string")
		require.NotNil(t, got, "ClickHouse Array column rejects untyped nil")
		require.Empty(t, got)
	})

	t.Run("non-empty FieldPath round-trips", func(t *testing.T) {
		batch := &fakeBatch{}
		require.NoError(t, appendCacheEventRow(batch, time.Now().UTC(), "o", "f", &cacheeventsv1.CacheEvent{
			FieldPath: []string{"address", "city"},
		}))
		require.Equal(t, []string{"address", "city"}, batch.rows[0][fieldPathIdx])
	})
}

// clickhouseConnStub satisfies driver.Conn with panicking methods so embedders
// only need to override what they exercise. PrepareBatch is the only call the
// writer makes; if a new dependency is added, the test will panic loudly.
type clickhouseConnStub struct{}

func (clickhouseConnStub) Contributors() []string                        { panic("not implemented") }
func (clickhouseConnStub) ServerVersion() (*driver.ServerVersion, error) { panic("not implemented") }
func (clickhouseConnStub) Select(context.Context, any, string, ...any) error {
	panic("not implemented")
}
func (clickhouseConnStub) Query(context.Context, string, ...any) (driver.Rows, error) {
	panic("not implemented")
}
func (clickhouseConnStub) QueryRow(context.Context, string, ...any) driver.Row {
	panic("not implemented")
}
func (clickhouseConnStub) PrepareBatch(context.Context, string, ...driver.PrepareBatchOption) (driver.Batch, error) {
	panic("not implemented")
}
func (clickhouseConnStub) Exec(context.Context, string, ...any) error { panic("not implemented") }
func (clickhouseConnStub) AsyncInsert(context.Context, string, bool, ...any) error {
	panic("not implemented")
}
func (clickhouseConnStub) Ping(context.Context) error { panic("not implemented") }
func (clickhouseConnStub) Stats() driver.Stats        { panic("not implemented") }
func (clickhouseConnStub) Close() error               { panic("not implemented") }

// recordingConn is the minimal slice of the clickhouse.Conn surface that the
// writer's ProcessBatch path actually exercises. Only PrepareBatch is called
// — the rest of the interface intentionally panics so we notice when a new
// dependency creeps in.
type recordingConn struct {
	clickhouseConnStub
	mu      sync.Mutex
	batches []*fakeBatch
	err     error
}

func (c *recordingConn) PrepareBatch(_ context.Context, _ string, _ ...driver.PrepareBatchOption) (driver.Batch, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.err != nil {
		return nil, c.err
	}
	b := &fakeBatch{}
	c.batches = append(c.batches, b)
	return b, nil
}

func (c *recordingConn) batchCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.batches)
}

func (c *recordingConn) lastBatch() *fakeBatch {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.batches) == 0 {
		return nil
	}
	return c.batches[len(c.batches)-1]
}

func TestWriter_ProcessBatch_EmptyItemsDoesNothing(t *testing.T) {
	t.Parallel()

	conn := &recordingConn{}
	w := NewWriter(zap.NewNop(), conn)

	w.ProcessBatch(context.Background(), nil)
	w.ProcessBatch(context.Background(), []BatchItem{})

	require.Equal(t, 0, conn.batchCount(), "no work means no PrepareBatch call")
}

func TestWriter_ProcessBatch_DropsItemsWithNilClaims(t *testing.T) {
	t.Parallel()

	conn := &recordingConn{}
	w := NewWriter(zap.NewNop(), conn)

	w.ProcessBatch(context.Background(), []BatchItem{
		{Claims: nil, Events: []*cacheeventsv1.CacheEvent{{EventType: cacheeventsv1.EventType_L1_READ}}},
	})

	// PrepareBatch is called speculatively, then the batch is aborted because
	// no rows were appended (the writer cannot tell ClickHouse the rows are
	// missing without first claiming a batch).
	require.Equal(t, 1, conn.batchCount())
	require.Equal(t, 0, len(conn.lastBatch().rows), "no rows must be appended for unauthenticated items")
	require.Equal(t, 1, conn.lastBatch().abortCs, "empty batches must be aborted, not sent")
	require.Equal(t, 0, conn.lastBatch().sendCalls)
}

func TestWriter_ProcessBatch_SkipsNilEvents(t *testing.T) {
	t.Parallel()

	conn := &recordingConn{}
	w := NewWriter(zap.NewNop(), conn)

	claims := &utils.GraphAPITokenClaims{OrganizationID: "org-1", FederatedGraphID: "fg-1"}
	w.ProcessBatch(context.Background(), []BatchItem{
		{
			Claims: claims,
			Events: []*cacheeventsv1.CacheEvent{
				{EventType: cacheeventsv1.EventType_L1_READ, EntityType: "User"},
				nil,
				{EventType: cacheeventsv1.EventType_L2_WRITE, EntityType: "Product"},
			},
		},
	})

	require.Equal(t, 1, conn.batchCount())
	require.Equal(t, 2, conn.lastBatch().Rows(), "nil event entries must be skipped, not appended as zero-value rows")
	require.Equal(t, 1, conn.lastBatch().sendCalls)
}

func TestWriter_ProcessBatch_AppendsOneRowPerEventAcrossItems(t *testing.T) {
	t.Parallel()

	conn := &recordingConn{}
	w := NewWriter(zap.NewNop(), conn)

	w.ProcessBatch(context.Background(), []BatchItem{
		{
			Claims: &utils.GraphAPITokenClaims{OrganizationID: "org-A", FederatedGraphID: "fg-A"},
			Events: []*cacheeventsv1.CacheEvent{{EventType: cacheeventsv1.EventType_L1_READ}, {EventType: cacheeventsv1.EventType_L2_READ}},
		},
		{
			Claims: &utils.GraphAPITokenClaims{OrganizationID: "org-B", FederatedGraphID: "fg-B"},
			Events: []*cacheeventsv1.CacheEvent{{EventType: cacheeventsv1.EventType_L1_WRITE}},
		},
	})

	require.Equal(t, 1, conn.batchCount(), "one ClickHouse batch per ProcessBatch call regardless of item count")
	rows := conn.lastBatch().rows
	require.Len(t, rows, 3)
	// First two rows carry org-A claims; third row carries org-B.
	require.Equal(t, "org-A", rows[0][1])
	require.Equal(t, "fg-A", rows[0][2])
	require.Equal(t, "org-A", rows[1][1])
	require.Equal(t, "org-B", rows[2][1])
	require.Equal(t, "fg-B", rows[2][2])
	require.Equal(t, 1, conn.lastBatch().sendCalls)
}
