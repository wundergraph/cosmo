package integration

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// TestPersistedOperationSkipIncludeConcurrency reproduces the wrong-response bug
// caused by unsafe string aliasing in skipIncludeVariableNames.
//
// Root cause:
//
//   - OperationKit.skipIncludeVariableNames() returned strings produced via
//     unsafebytes.BytesToString — they aliased kit.doc.Input.RawBytes.
//   - savePersistedOperationToCache() stored those strings in the long-lived
//     persistedOperationVariableNames map without strings.Clone().
//   - Parse kits are pooled. When a kit is freed and reused, doc.Reset() keeps
//     the underlying buffer and the new request overwrites it.
//   - writeSkipIncludeCacheKeyToKeyGen then looks up the wrong variable names,
//     mapping variant A's request to variant B's normalization-cache entry and
//     vice versa — returning the wrong response body.
//
// Why single-letter variable names:
//
//	Both $a and $b are exactly 1 byte.  polluterQuery is identical to query
//	except $a and $b are swapped in the two @include directive arguments.
//	The queries have the same byte length, so parsing polluterQuery overwrites
//	the kit buffer at byte 130 (where "a" lives in query's first @include arg)
//	with 'b', and byte 160 (where "b" lives) with 'a'.
//
//	skipIncludeVariableNames returns a sorted slice, so aliases[0]→"a" (byte 130)
//	and aliases[1]→"b" (byte 160).  After one polluter parse they read "b" and "a".
//	writeSkipIncludeCacheKeyToKeyGen then:
//	  - for variant {a:true,  b:false}: Get("b")=false, Get("a")=true  → key "ft" (B's key)
//	  - for variant {a:false, b:true}:  Get("b")=true,  Get("a")=false → key "tf" (A's key)
//
//	Each variant hits the other's normalization entry.  Because the normalizer
//	evaluates @include at plan time, variant A receives a plan that omits
//	AlligatorFields — returning empty pets instead of Snappy — and variant B
//	receives a plan that includes AlligatorFields — returning Snappy instead of
//	empty pets.
//
// See also TestSkipIncludeVariableNamesStableAfterKitReuse in router/core for
// the targeted unit test that directly demonstrates the aliasing.
func TestPersistedOperationSkipIncludeConcurrency(t *testing.T) {
	t.Parallel()

	// $a controls AlligatorFields, $b controls CatFields.
	// Variable names are single bytes so polluterQuery causes a clean byte-swap.
	const query = `query Employee($id: Int! = 3, $a: Boolean!, $b: Boolean!) { employee(id: $id) { details { pets { ...AlligatorFields @include(if: $a) ...CatFields @include(if: $b) } } } } fragment AlligatorFields on Alligator { __typename class dangerous gender name } fragment CatFields on Cat { __typename class gender name type }`

	// Same byte length as query; $a and $b are swapped in the @include args.
	// Parsing this writes 'b' at byte 130 and 'a' at byte 160 of the kit buffer,
	// reversing the aliases stored for the Employee query sha.
	const polluterQuery = `query Employee($id: Int! = 3, $a: Boolean!, $b: Boolean!) { employee(id: $id) { details { pets { ...AlligatorFields @include(if: $b) ...CatFields @include(if: $a) } } } } fragment AlligatorFields on Alligator { __typename class dangerous gender name } fragment CatFields on Cat { __typename class gender name type }`

	sum := sha256.Sum256([]byte(query))
	sha := hex.EncodeToString(sum[:])

	type variant struct {
		name      string
		variables string
		expected  string
	}

	variants := []variant{
		{
			name:      "a=true b=false",
			variables: `{"a":true,"b":false}`,
			// AlligatorFields included → Snappy; CatFields excluded.
			expected: `{"data":{"employee":{"details":{"pets":[{"__typename":"Alligator","class":"REPTILE","dangerous":"yes","gender":"UNKNOWN","name":"Snappy"}]}}}}`,
		},
		{
			name:      "a=false b=true",
			variables: `{"a":false,"b":true}`,
			// AlligatorFields excluded; CatFields included but pet is Alligator → no Cat match.
			expected: `{"data":{"employee":{"details":{"pets":[{}]}}}}`,
		},
	}

	testenv.Run(t, &testenv.Config{
		ModifyEngineExecutionConfiguration: func(c *config.EngineExecutionConfiguration) {
			// Single kit slot forces every request to share the same buffer.
			c.ParseKitPoolSize = 1
		},
		ApqConfig: config.AutomaticPersistedQueriesConfig{
			Enabled: true,
			Cache: config.AutomaticPersistedQueriesCacheConfig{
				Size: 1024 * 1024,
			},
		},
		RouterOptions: []core.Option{
			core.WithGraphApiToken(""),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		header := func() http.Header {
			h := make(http.Header)
			h.Add("graphql-client-name", "concurrency-client")
			return h
		}

		extensions := fmt.Sprintf(`{"persistedQuery": {"version": 1, "sha256Hash": %q}}`, sha)

		// 1) Register both variants with the full query body so the APQ store and
		//    normalization cache are pre-populated with separate entries.
		for _, v := range variants {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:         query,
				OperationName: []byte(`"Employee"`),
				Variables:     []byte(v.variables),
				Extensions:    []byte(extensions),
				Header:        header(),
			})
			assert.Equalf(t, v.expected, res.Body, "registration mismatch for %s", v.name)
		}

		// 2) Hammer both variants concurrently (hash-only, no query body).
		//    Polluter goroutines parse polluterQuery through the same single-slot
		//    kit, swapping bytes 130 and 160 in the buffer.  Without strings.Clone
		//    the stored aliases are reversed: each variant looks up the other's
		//    normalization entry and receives the wrong response body.
		const iterations = 200
		const parallelism = 32
		const polluterParallelism = 8

		var wg sync.WaitGroup
		errCh := make(chan error, parallelism*iterations)

		for w := 0; w < parallelism; w++ {
			wg.Add(1)
			go func(workerID int) {
				defer wg.Done()
				for i := 0; i < iterations; i++ {
					v := variants[(workerID+i)%len(variants)]
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						OperationName: []byte(`"Employee"`),
						Variables:     []byte(v.variables),
						Extensions:    []byte(extensions),
						Header:        header(),
					})
					if res.Body != v.expected {
						errCh <- fmt.Errorf(
							"variant %q (vars=%s) returned wrong body:\n  got:  %s\n  want: %s",
							v.name, v.variables, res.Body, v.expected,
						)
					}
				}
			}(w)
		}

		// Polluters parse polluterQuery (same length as query, $a/$b swapped) to
		// overwrite the alias bytes in the shared kit buffer.
		for p := 0; p < polluterParallelism; p++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for i := 0; i < iterations; i++ {
					_, _ = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
						Query:     polluterQuery,
						Variables: []byte(`{"a":true,"b":true}`),
						Header:    header(),
					})
				}
			}()
		}

		wg.Wait()
		close(errCh)

		var mismatches []error
		for e := range errCh {
			mismatches = append(mismatches, e)
		}
		require.Emptyf(t, mismatches,
			"%d/%d responses crossed variants (sample: %v)",
			len(mismatches), parallelism*iterations, firstN(mismatches, 3))
	})
}

func firstN[T any](s []T, n int) []T {
	if len(s) < n {
		return s
	}
	return s[:n]
}
