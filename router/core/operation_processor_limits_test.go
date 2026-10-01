package core

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/dgraph-io/ristretto/v2"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
)

func TestOperationProcessorParserLimitsAfterVariableNormalization(t *testing.T) {
	// Extracting the inline number adds a variable identifier to the selection
	// set, which counts towards the existing tokenizer field limit.
	testParserLimitsAfterVariableProcessing(t, GraphQLRequest{
		Query:         `query Selected { echo(n: 1) }`,
		OperationName: "Selected",
		Variables:     json.RawMessage(`{}`),
	}, false)
}

func TestOperationProcessorParserLimitsAfterVariableRemapping(t *testing.T) {
	// The tokenizer treats "query" as a keyword. Renaming this variable to "a"
	// adds an identifier to its field count without changing the selection set.
	testParserLimitsAfterVariableProcessing(t, GraphQLRequest{
		Query:         `query Selected($query: Int!) { echo(n: $query) }`,
		OperationName: "Selected",
		Variables:     json.RawMessage(`{"query":1}`),
	}, true)
}

func testParserLimitsAfterVariableProcessing(t *testing.T, request GraphQLRequest, remap bool) {
	t.Helper()
	for _, enforce := range []bool{false, true} {
		for _, cached := range []bool{false, true} {
			t.Run(fmt.Sprintf("enforce=%t/cache=%t", enforce, cached), func(t *testing.T) {
				processor, caches := newParserLimitsTestProcessor(t, enforce, cached, 2)
				body, err := json.Marshal(request)
				require.NoError(t, err)

				for attempt := range 2 {
					func() {
						kit, err := processor.NewKit()
						require.NoError(t, err)
						defer kit.Free()
						require.NoError(t, kit.UnmarshalOperationFromBody(body))
						require.NoError(t, kit.Parse())
						normalizationHit, err := kit.NormalizeOperation("test", false)
						require.NoError(t, err)
						require.Equal(t, cached && attempt > 0, normalizationHit)

						_, _, err = kit.NormalizeVariables()
						if remap {
							require.NoError(t, err)
							_, err = kit.RemapVariables(false)
						}

						if enforce {
							require.EqualError(t, err, "allowed number of fields per GraphQL document of '2' exceeded")
							var httpErr HttpError
							require.ErrorAs(t, err, &httpErr)
							require.Equal(t, http.StatusBadRequest, httpErr.StatusCode())
						} else {
							require.NoError(t, err)
							require.Equal(t, `query Selected($a: Int!){echo(n: $a)}`, kit.parsedOperation.NormalizedRepresentation)
						}
					}()
					caches.wait()
				}

				if cached {
					metrics := caches.variables.Metrics
					if remap {
						metrics = caches.remapping.Metrics
					}
					if enforce {
						require.Zero(t, metrics.KeysAdded(), "rejected normalized representations must not be cached")
					} else {
						require.Positive(t, metrics.Hits(), "disabled enforcement must also allow restoration from cache")
					}
				}
			})
		}
	}
}

func TestOperationProcessorParserLimitsPreserveAcceptedOperation(t *testing.T) {
	requests := []GraphQLRequest{
		{
			Query:         `query Selected($value: Int!) { echo(n: $value) }`,
			OperationName: "Selected",
			Variables:     json.RawMessage(`{"value":1}`),
		},
		{
			// The selected operation has a nonzero AST reference before removal of
			// the first operation. Limit checks must preserve that reference.
			Query:         `query Unused { echo(n: 2) } query Selected { ...Value } fragment Value on Query { echo(n: 1) }`,
			OperationName: "Selected",
			Variables:     json.RawMessage(`{}`),
		},
	}

	for index, request := range requests {
		t.Run(fmt.Sprintf("operation=%d", index), func(t *testing.T) {
			body, err := json.Marshal(request)
			require.NoError(t, err)
			var baseline *ParsedOperation
			for _, enforce := range []bool{false, true} {
				for _, cached := range []bool{false, true} {
					t.Run(fmt.Sprintf("enforce=%t/cache=%t", enforce, cached), func(t *testing.T) {
						processor, caches := newParserLimitsTestProcessor(t, enforce, cached, 10)
						for range 2 {
							func() {
								kit, err := processor.NewKit()
								require.NoError(t, err)
								defer kit.Free()
								require.NoError(t, kit.UnmarshalOperationFromBody(body))
								require.NoError(t, kit.Parse())
								_, err = kit.NormalizeOperation("test", false)
								require.NoError(t, err)
								_, err = kit.ValidateOperation()
								require.NoError(t, err)
								_, _, err = kit.NormalizeVariables()
								require.NoError(t, err)
								_, err = kit.RemapVariables(false)
								require.NoError(t, err)
								op := kit.parsedOperation
								require.Equal(t, "Selected", op.Request.OperationName)
								require.Equal(t, `query Selected($a: Int!){echo(n: $a)}`, op.NormalizedRepresentation)
								require.NotZero(t, op.ID)
								require.NotZero(t, op.InternalID)
								if baseline == nil {
									baseline = op
								} else {
									require.Equal(t, baseline.ID, op.ID)
									require.Equal(t, baseline.InternalID, op.InternalID)
									require.Equal(t, baseline.RemapVariables, op.RemapVariables)
									require.JSONEq(t, string(baseline.Request.Variables), string(op.Request.Variables))
								}
							}()
							caches.wait()
						}
					})
				}
			}
		})
	}
}

type parserLimitsTestCaches struct {
	normalization *ristretto.Cache[uint64, NormalizationCacheEntry]
	variables     *ristretto.Cache[uint64, VariablesNormalizationCacheEntry]
	remapping     *ristretto.Cache[uint64, RemapVariablesCacheEntry]
}

func (c *parserLimitsTestCaches) wait() {
	if c.normalization != nil {
		c.normalization.Wait()
		c.variables.Wait()
		c.remapping.Wait()
	}
}

func newParserLimitsTestCache[T any](t *testing.T) *ristretto.Cache[uint64, T] {
	t.Helper()
	cache, err := ristretto.NewCache(&ristretto.Config[uint64, T]{
		NumCounters:        1024,
		MaxCost:            128,
		BufferItems:        64,
		IgnoreInternalCost: true,
		Metrics:            true,
	})
	require.NoError(t, err)
	t.Cleanup(cache.Close)
	return cache
}

func newParserLimitsTestProcessor(t *testing.T, enforce, cacheEnabled bool, maxFields int) (*OperationProcessor, *parserLimitsTestCaches) {
	t.Helper()
	schema, report := astparser.ParseGraphqlDocumentString(`type Query { echo(n: Int!): Int! }`)
	require.False(t, report.HasErrors())
	require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&schema))
	caches := &parserLimitsTestCaches{}
	if cacheEnabled {
		caches.normalization = newParserLimitsTestCache[NormalizationCacheEntry](t)
		caches.variables = newParserLimitsTestCache[VariablesNormalizationCacheEntry](t)
		caches.remapping = newParserLimitsTestCache[RemapVariablesCacheEntry](t)
	}
	processor := NewOperationProcessor(OperationProcessorOptions{
		Executor:                              &Executor{ClientSchema: &schema},
		MaxOperationSizeInBytes:               1 << 20,
		ParseKitPoolSize:                      1,
		ParserTokenizerLimits:                 astparser.TokenizerLimits{MaxFields: maxFields},
		EnforceParserLimitsAfterNormalization: enforce,
		NormalizationCache:                    caches.normalization,
		VariablesNormalizationCache:           caches.variables,
		RemapVariablesCache:                   caches.remapping,
	})
	return processor, caches
}
