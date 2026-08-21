package core

import (
	"context"
	"fmt"
	"testing"

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

// TestAPQTTLRenewalDoesNotCorruptStoredQuery is a regression test for the APQ
// TTL renewal path in FetchPersistedOperation.
//
// When a cached APQ operation whose KV entry has a TTL is re-executed, the
// router re-saves it to renew the expiration. It must write back the ORIGINAL
// raw query. On the buggy code it writes NormalizedRepresentation, which has
// @skip/@include directives evaluated and stripped for the current request's
// variable values. That corrupts the stored query: a later request resolving
// the same hash with different variables gets a query missing the conditional
// field.
func TestAPQTTLRenewalDoesNotCorruptStoredQuery(t *testing.T) {
	clientSchema, report := astparser.ParseGraphqlDocumentString(`type Query { a: String b: String }`)
	require.False(t, report.HasErrors(), "failed to parse client schema")
	require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&clientSchema))

	kv := newTTLMockKVClient()

	apqClient, err := apq.NewClient(&apq.Options{
		ApqConfig: &config.AutomaticPersistedQueriesConfig{
			Enabled: true,
			Cache:   config.AutomaticPersistedQueriesCacheConfig{TTL: 300},
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

	clientInfo := &ClientInfo{Name: "test"}

	const sha256Hash = "1111111111111111111111111111111111111111111111111111111111111111"
	const rawQuery = `query Q($skipB: Boolean!) { a b @skip(if: $skipB) }`

	// runRequest drives the same processing sequence the prehandler uses:
	// fetch -> (parse) -> normalize operation -> normalize variables -> remap.
	runRequest := func(body string) {
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
	}

	// Request 1: APQ registration. Query + hash are both in the body, so the
	// raw query is saved to the KV store.
	registerBody := fmt.Sprintf(
		`{"query":%q,"variables":{"skipB":true},"extensions":{"persistedQuery":{"version":1,"sha256Hash":%q}}}`,
		rawQuery, sha256Hash,
	)
	runRequest(registerBody)
	require.Equal(t, rawQuery, string(kv.store[sha256Hash]), "registration must store the raw query")

	// ristretto Set is asynchronous; make request 1's normalization entry
	// visible so request 2 hits the cache and takes the TTL-renewal branch.
	normalizationCache.Wait()

	// Request 2: hash-only request with the same skip variable. This is a
	// persisted-operation cache hit whose key has a TTL, so it renews the TTL.
	replayBody := fmt.Sprintf(
		`{"variables":{"skipB":true},"extensions":{"persistedQuery":{"version":1,"sha256Hash":%q}}}`,
		sha256Hash,
	)
	runRequest(replayBody)

	// The stored query must still be the raw query. On the buggy code it has
	// been overwritten with the normalized, directive-stripped form (`query Q { a }`).
	require.Equal(t, rawQuery, string(kv.store[sha256Hash]),
		"TTL renewal overwrote the stored raw query with the normalized, directive-stripped form")
}
