package core

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/dgraph-io/ristretto/v2"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"

	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/apq"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// ttlMockKVClient is a minimal apq.KVClient backed by an in-memory map so the
// test can assert exactly what body was written to the KV store (Redis).
type ttlMockKVClient struct {
	store map[string][]byte
}

func newTTLMockKVClient() *ttlMockKVClient {
	return &ttlMockKVClient{store: make(map[string][]byte)}
}

func (m *ttlMockKVClient) Get(_ context.Context, operationHash string) ([]byte, error) {
	val, ok := m.store[operationHash]
	if !ok {
		return nil, nil
	}
	return val, nil
}

func (m *ttlMockKVClient) Set(_ context.Context, operationHash string, operationBody []byte, _ int) error {
	m.store[operationHash] = operationBody
	return nil
}

func (m *ttlMockKVClient) Close() {}

const (
	apqTTLSha256   = "1111111111111111111111111111111111111111111111111111111111111111"
	apqTTLRawQuery = `query Q($skipB: Boolean!) { a b @skip(if: $skipB) }`
)

func newAPQTTLProcessor(t *testing.T, kv apq.KVClient) (*OperationProcessor, *persistedoperation.Client, *ristretto.Cache[uint64, NormalizationCacheEntry]) {
	t.Helper()

	clientSchema, report := astparser.ParseGraphqlDocumentString(`type Query { a: String b: String }`)
	require.False(t, report.HasErrors(), "failed to parse client schema")
	require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&clientSchema))

	apqClient, err := apq.NewClient(&apq.Options{
		ApqConfig: &config.AutomaticPersistedQueriesConfig{
			Enabled: true,
			Cache: config.AutomaticPersistedQueriesCacheConfig{
				TTL:  300,
				Size: config.BytesString(1 << 20), // 1MB; only used by the in-memory APQ store
			},
		},
		KVClient: kv,
	})
	require.NoError(t, err)

	poClient, err := persistedoperation.NewClient(&persistedoperation.Options{
		ApqClient: apqClient,
	})
	require.NoError(t, err)

	normalizationCache, err := ristretto.NewCache[uint64, NormalizationCacheEntry](&ristretto.Config[uint64, NormalizationCacheEntry]{
		NumCounters: 1000,
		MaxCost:     1000,
		BufferItems: 64,
	})
	require.NoError(t, err)
	t.Cleanup(normalizationCache.Close)

	executor := &Executor{
		PlanConfig:   plan.Configuration{},
		ClientSchema: &clientSchema,
	}
	processor := NewOperationProcessor(OperationProcessorOptions{
		Executor:                            executor,
		MaxOperationSizeInBytes:             10 << 20,
		ParseKitPoolSize:                    1,
		PersistedOperationClient:            poClient,
		EnablePersistedOperationsCache:      true,
		PersistedOpsNormalizationCache:      normalizationCache,
		AutomaticPersistedOperationCacheTtl: 300,
	})

	return processor, poClient, normalizationCache
}

// runAPQRequest drives the same processing sequence the prehandler uses:
// fetch -> (parse) -> normalize operation -> normalize variables -> remap.
// It returns the normalized representation produced for the request.
func runAPQRequest(t *testing.T, processor *OperationProcessor, clientInfo *ClientInfo, body string) string {
	t.Helper()

	kit, err := processor.NewKit()
	require.NoError(t, err)
	defer kit.Free()

	require.NoError(t, kit.UnmarshalOperationFromBody([]byte(body)))

	skipParse, isApq, err := kit.FetchPersistedOperation(context.Background(), clientInfo)
	require.NoError(t, err)

	if !skipParse {
		require.NoError(t, kit.Parse())
	}

	_, err = kit.NormalizeOperation(clientInfo.Name, isApq)
	require.NoError(t, err)

	_, _, err = kit.NormalizeVariables()
	require.NoError(t, err)

	_, err = kit.RemapVariables(false)
	require.NoError(t, err)

	return kit.parsedOperation.NormalizedRepresentation
}

// TestAPQTTLRenewalDoesNotCorruptStoredQuery is the regression test for the APQ
// TTL renewal path in FetchPersistedOperation (issue #3062, based on PR #3061).
//
// When a cached APQ operation whose KV entry has a TTL is re-executed, the router
// renews the expiration. It must NOT write back the normalized representation,
// which has @skip/@include evaluated and stripped for the current request's
// variable values. Doing so corrupts the stored query so that a later request
// resolving the same hash with different variables gets a query missing the
// conditional field.
func TestAPQTTLRenewalDoesNotCorruptStoredQuery(t *testing.T) {
	t.Parallel()

	kv := newTTLMockKVClient()
	processor, _, normalizationCache := newAPQTTLProcessor(t, kv)
	clientInfo := &ClientInfo{Name: "test"}

	// Request 1: APQ registration. Query + hash are both in the body, so the
	// raw query is saved to the KV store.
	registerBody := fmt.Sprintf(
		`{"query":%q,"variables":{"skipB":true},"extensions":{"persistedQuery":{"version":1,"sha256Hash":%q}}}`,
		apqTTLRawQuery, apqTTLSha256,
	)
	runAPQRequest(t, processor, clientInfo, registerBody)
	require.Equal(t, apqTTLRawQuery, string(kv.store[apqTTLSha256]), "registration must store the raw query")

	// ristretto Set is asynchronous; make request 1's normalization entry visible
	// so request 2 hits the cache and takes the TTL-renewal branch.
	normalizationCache.Wait()

	// Request 2: hash-only request with the same skip variable. This is a
	// persisted-operation cache hit whose key has a TTL, so it renews the TTL.
	replaySkipTrueBody := fmt.Sprintf(
		`{"variables":{"skipB":true},"extensions":{"persistedQuery":{"version":1,"sha256Hash":%q}}}`,
		apqTTLSha256,
	)
	runAPQRequest(t, processor, clientInfo, replaySkipTrueBody)

	// The stored query must still be the raw query. On the buggy code it has been
	// overwritten with the normalized, directive-stripped form (`query Q { a }`).
	require.Equal(t, apqTTLRawQuery, string(kv.store[apqTTLSha256]),
		"TTL renewal overwrote the stored raw query with the normalized, directive-stripped form")

	// Request 3: hash-only request with skipB:false. This resolves the same hash
	// but with different variables. It must receive the conditional field `b`,
	// which is only possible if the stored query was not corrupted.
	replaySkipFalseBody := fmt.Sprintf(
		`{"variables":{"skipB":false},"extensions":{"persistedQuery":{"version":1,"sha256Hash":%q}}}`,
		apqTTLSha256,
	)
	normalized := runAPQRequest(t, processor, clientInfo, replaySkipFalseBody)

	require.Contains(t, normalized, "b",
		"skipB:false must include field b; a corrupted store would drop it")
	require.Equal(t, apqTTLRawQuery, string(kv.store[apqTTLSha256]),
		"the stored raw query must remain intact after renewals")
}

// TestAPQTTLRenewalInMemoryStoreKeepsRawQuery covers the non-distributed (in-memory)
// APQ path of RenewTTL, where there is no KVClient. It asserts the stored body
// (read back via the persisted-operation client) remains the raw query after a
// TTL-renewal replay, and is never the normalized, directive-stripped form.
func TestAPQTTLRenewalInMemoryStoreKeepsRawQuery(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	processor, poClient, normalizationCache := newAPQTTLProcessor(t, nil)
	clientInfo := &ClientInfo{Name: "test"}

	// Request 1: APQ registration saves the raw query into the in-memory store.
	registerBody := fmt.Sprintf(
		`{"query":%q,"variables":{"skipB":true},"extensions":{"persistedQuery":{"version":1,"sha256Hash":%q}}}`,
		apqTTLRawQuery, apqTTLSha256,
	)
	runAPQRequest(t, processor, clientInfo, registerBody)
	normalizationCache.Wait()

	// The in-memory APQ store (ristretto) is eventually consistent; wait until the
	// raw query is retrievable before exercising renewal.
	require.Eventually(t, func() bool {
		body, _, err := poClient.PersistedOperation(ctx, clientInfo.Name, apqTTLSha256)
		return err == nil && string(body) == apqTTLRawQuery
	}, 2*time.Second, 20*time.Millisecond, "registration must store the raw query in the in-memory APQ store")

	// Request 2: hash-only replay triggers the TTL-renewal branch for the in-memory store.
	replaySkipTrueBody := fmt.Sprintf(
		`{"variables":{"skipB":true},"extensions":{"persistedQuery":{"version":1,"sha256Hash":%q}}}`,
		apqTTLSha256,
	)
	runAPQRequest(t, processor, clientInfo, replaySkipTrueBody)

	// The stored body must remain the raw query and must never become the
	// normalized, directive-stripped form (`query Q { a }`). Poll to allow the
	// renewal's re-Set to settle, and fail fast if a corrupted value ever appears.
	require.Eventually(t, func() bool {
		body, _, err := poClient.PersistedOperation(ctx, clientInfo.Name, apqTTLSha256)
		require.NoError(t, err)
		return string(body) == apqTTLRawQuery
	}, 2*time.Second, 20*time.Millisecond, "in-memory store must retain the raw query after TTL renewal")

	// Final, definitive assertion: the stored body is exactly the raw query, i.e.
	// it still declares the conditional field `b` and its @skip directive.
	body, _, err := poClient.PersistedOperation(ctx, clientInfo.Name, apqTTLSha256)
	require.NoError(t, err)
	require.Equal(t, apqTTLRawQuery, string(body),
		"TTL renewal must not overwrite the in-memory store with the normalized form")
}
