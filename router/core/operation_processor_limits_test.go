package core

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/dgraph-io/ristretto/v2"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
)

const parserLimitsTestSchema = `
type Query { employee(id: Int!): Employee echo(n: Int!): Int! }
type Employee { id: Int! details: Details }
type Details { forename: String! }
`

// Parser limits apply to the original document only. Each processing stage can
// produce a representation with more tokenizer-counted fields than the original,
// and each stage restores its result from a dedicated cache. None of those
// representations may be checked against the limits again.
func TestOperationProcessorParserLimitsApplyToOriginalDocumentOnly(t *testing.T) {
	stages := []string{"normalization", "variables", "remapping"}

	for _, tc := range []struct {
		name      string
		request   GraphQLRequest
		maxFields int
		// exceedsFrom names the first stage whose output exceeds maxFields.
		exceedsFrom string
	}{
		{
			name: "fragment expansion during normalization",
			// The tokenizer counts eleven identifiers in the original document.
			// Inlining EmployeeFields at both spread sites raises that to fourteen.
			request: GraphQLRequest{
				Query: `query Employees($first: Int!, $second: Int!) {
					a: employee(id: $first) { ...EmployeeFields }
					b: employee(id: $second) { ...EmployeeFields }
				}
				fragment EmployeeFields on Employee { id ...EmployeeDetails }
				fragment EmployeeDetails on Employee { details { forename } }`,
				OperationName: "Employees",
				Variables:     json.RawMessage(`{"first":1,"second":2}`),
			},
			maxFields:   13,
			exceedsFrom: "normalization",
		},
		{
			name: "argument extraction during variables normalization",
			// Extracting the inline number adds a variable identifier to the selection set.
			request: GraphQLRequest{
				Query:         `query Selected { echo(n: 1) }`,
				OperationName: "Selected",
				Variables:     json.RawMessage(`{}`),
			},
			maxFields:   2,
			exceedsFrom: "variables",
		},
		{
			name: "variable renaming during remapping",
			// The tokenizer treats the variable name "query" as a keyword. Renaming it
			// to "a" adds an identifier to the field count without changing the selection set.
			request: GraphQLRequest{
				Query:         `query Selected($query: Int!) { echo(n: $query) }`,
				OperationName: "Selected",
				Variables:     json.RawMessage(`{"query":1}`),
			},
			maxFields:   2,
			exceedsFrom: "remapping",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// Guard the fixture: the original document must pass the configured limit.
			require.False(t, fieldsExceedLimit(t, tc.request.Query, tc.maxFields))
			exceedsFrom := -1
			for i, stage := range stages {
				if stage == tc.exceedsFrom {
					exceedsFrom = i
				}
			}
			require.GreaterOrEqual(t, exceedsFrom, 0)

			for _, cached := range []bool{false, true} {
				t.Run(fmt.Sprintf("cache=%t", cached), func(t *testing.T) {
					processor, caches := newParserLimitsTestProcessor(t, cached, tc.maxFields)
					body, err := json.Marshal(tc.request)
					require.NoError(t, err)

					var first *ParsedOperation
					for attempt := range 2 {
						func() {
							kit, err := processor.NewKit()
							require.NoError(t, err)
							defer kit.Free()
							require.NoError(t, kit.UnmarshalOperationFromBody(body))
							require.NoError(t, kit.Parse())

							expectHit := cached && attempt > 0

							normalizationHit, err := kit.NormalizeOperation("test", false)
							require.NoError(t, err)
							require.Equal(t, expectHit, normalizationHit)
							require.Equal(t, exceedsFrom <= 0, fieldsExceedLimit(t, kit.parsedOperation.NormalizedRepresentation, tc.maxFields), "after normalization")

							_, err = kit.ValidateOperation()
							require.NoError(t, err)

							variablesHit, _, err := kit.NormalizeVariables()
							require.NoError(t, err)
							require.Equal(t, expectHit, variablesHit)
							require.Equal(t, exceedsFrom <= 1, fieldsExceedLimit(t, kit.parsedOperation.NormalizedRepresentation, tc.maxFields), "after variables normalization")

							remapHit, err := kit.RemapVariables(false)
							require.NoError(t, err)
							require.Equal(t, expectHit, remapHit)
							require.True(t, fieldsExceedLimit(t, kit.parsedOperation.NormalizedRepresentation, tc.maxFields), "after remapping")

							op := kit.parsedOperation
							require.NotZero(t, op.ID)
							require.NotZero(t, op.InternalID)
							if first == nil {
								first = op
								return
							}
							require.Equal(t, first.NormalizedRepresentation, op.NormalizedRepresentation)
							require.Equal(t, first.ID, op.ID)
							require.Equal(t, first.InternalID, op.InternalID)
							require.Equal(t, first.RemapVariables, op.RemapVariables)
							require.JSONEq(t, string(first.Request.Variables), string(op.Request.Variables))
						}()
						caches.wait()
					}
				})
			}
		})
	}
}

func TestOperationProcessorParserLimitsRejectOriginalDocument(t *testing.T) {
	// The original document counts five identifiers: two in the selection set and
	// three in the unused fragment. Normalization would remove the fragment and
	// extract the inline argument, but the limit applies before either happens.
	request := GraphQLRequest{
		Query:         `query Selected { echo(n: 1) } fragment Unused on Employee { id details { forename } }`,
		OperationName: "Selected",
		Variables:     json.RawMessage(`{}`),
	}
	require.Equal(t, 5, countTokenizerFields(t, request.Query))
	body, err := json.Marshal(request)
	require.NoError(t, err)

	processor, caches := newParserLimitsTestProcessor(t, true, 4)
	for range 2 {
		func() {
			kit, err := processor.NewKit()
			require.NoError(t, err)
			defer kit.Free()
			require.NoError(t, kit.UnmarshalOperationFromBody(body))

			err = kit.Parse()
			require.EqualError(t, err, "allowed number of fields per GraphQL document of '4' exceeded")
			var httpErr HttpError
			require.ErrorAs(t, err, &httpErr)
			require.Equal(t, http.StatusBadRequest, httpErr.StatusCode())
		}()
		caches.wait()
	}

	require.Zero(t, caches.normalization.Metrics.KeysAdded(), "rejected operations must not be cached")
	require.Zero(t, caches.variables.Metrics.KeysAdded(), "rejected operations must not be cached")
	require.Zero(t, caches.remapping.Metrics.KeysAdded(), "rejected operations must not be cached")
}

func TestOperationProcessorParserLimitsIgnorePersistedOperations(t *testing.T) {
	// Five identifiers exceed the limit of four configured below.
	request := GraphQLRequest{
		Query:         `query Selected { echo(n: 1) } fragment Unused on Employee { id details { forename } }`,
		OperationName: "Selected",
		Variables:     json.RawMessage(`{}`),
	}
	body, err := json.Marshal(request)
	require.NoError(t, err)

	for _, tc := range []struct {
		name        string
		ignore      bool
		fromStorage bool
		wantErr     bool
	}{
		{name: "checks operations from storage by default", fromStorage: true, wantErr: true},
		{name: "skips operations from storage when enabled", ignore: true, fromStorage: true},
		{name: "still checks request bodies when enabled", ignore: true, wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			processor, _ := newParserLimitsTestProcessor(t, false, 4, func(opts *OperationProcessorOptions) {
				opts.ParserLimitsIgnorePersistedOperations = tc.ignore
			})
			kit, err := processor.NewKit()
			require.NoError(t, err)
			defer kit.Free()
			require.NoError(t, kit.UnmarshalOperationFromBody(body))
			// FetchPersistedOperation sets both after loading the body from storage.
			kit.parsedOperation.IsPersistedOperation = tc.fromStorage
			kit.persistedOperationFromStorage = tc.fromStorage

			err = kit.Parse()
			if tc.wantErr {
				require.EqualError(t, err, "allowed number of fields per GraphQL document of '4' exceeded")
				return
			}
			require.NoError(t, err)
		})
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
			// the first operation. Restoring from cache must preserve that reference.
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
			for _, cached := range []bool{false, true} {
				t.Run(fmt.Sprintf("cache=%t", cached), func(t *testing.T) {
					processor, caches := newParserLimitsTestProcessor(t, cached, 10)
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
		})
	}
}

// countTokenizerFields returns the field count the parser limits are checked against.
func countTokenizerFields(t *testing.T, document string) int {
	t.Helper()
	var input ast.Input
	input.ResetInputString(document)
	stats, err := astparser.NewTokenizer().TokenizeWithLimits(astparser.TokenizerLimits{}, &input)
	require.NoError(t, err)
	return stats.TotalFields
}

// fieldsExceedLimit reports whether the tokenizer counts more than maxFields
// fields in the document, which is the check Parse applies to the original document.
func fieldsExceedLimit(t *testing.T, document string, maxFields int) bool {
	t.Helper()
	var input ast.Input
	input.ResetInputString(document)
	_, err := astparser.NewTokenizer().TokenizeWithLimits(astparser.TokenizerLimits{MaxFields: maxFields}, &input)
	if err == nil {
		return false
	}
	require.ErrorAs(t, err, &astparser.ErrFieldsLimitExceeded{})
	return true
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

func newParserLimitsTestProcessor(t *testing.T, cacheEnabled bool, maxFields int, modify ...func(*OperationProcessorOptions)) (*OperationProcessor, *parserLimitsTestCaches) {
	t.Helper()
	schema, report := astparser.ParseGraphqlDocumentString(parserLimitsTestSchema)
	require.False(t, report.HasErrors())
	require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&schema))
	caches := &parserLimitsTestCaches{}
	if cacheEnabled {
		caches.normalization = newParserLimitsTestCache[NormalizationCacheEntry](t)
		caches.variables = newParserLimitsTestCache[VariablesNormalizationCacheEntry](t)
		caches.remapping = newParserLimitsTestCache[RemapVariablesCacheEntry](t)
	}
	opts := OperationProcessorOptions{
		Executor:                    &Executor{ClientSchema: &schema},
		MaxOperationSizeInBytes:     1 << 20,
		ParseKitPoolSize:            1,
		ParserTokenizerLimits:       astparser.TokenizerLimits{MaxFields: maxFields},
		NormalizationCache:          caches.normalization,
		VariablesNormalizationCache: caches.variables,
		RemapVariablesCache:         caches.remapping,
	}
	for _, m := range modify {
		m(&opts)
	}
	return NewOperationProcessor(opts), caches
}
