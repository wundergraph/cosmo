package integration

import (
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
)

func TestNormalization(t *testing.T) {
	t.Parallel()

	t.Run("Whitespaces in variables should not impact normalization", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			query := `{
  "query": "query Employee( $id: Int! = 4 $withAligators: Boolean! $withCats: Boolean! $skipDogs:Boolean! $skipMouses:Boolean! ) { employee(id: $id) { details { pets { name __typename ...AlligatorFields @include(if: $withAligators) ...CatFields @include(if: $withCats) ...DogFields @skip(if: $skipDogs) ...MouseFields @skip(if: $skipMouses) ...PonyFields @include(if: false) } } } } fragment AlligatorFields on Alligator { __typename class dangerous gender name } fragment CatFields on Cat { __typename class gender name type } fragment DogFields on Dog { __typename breed class gender name } fragment MouseFields on Mouse { __typename class gender name } fragment PonyFields on Pony { __typename class gender name }",
  "operationName": "Employee",
  "variables": {
    "unused": true
	,"withAligators": true,"withCats": true
,
	"skipDogs": false,
	"skipMouses": true
  }
}`
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(query))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)

			body, err := io.ReadAll(res.Body)
			require.NoError(t, err)

			require.JSONEq(t, `{"data":{"employee":{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}}}}`, string(body))

		})
	})

	t.Run("Different variable values should not produce different hashes", func(t *testing.T) {

		testCases := []struct {
			Name          string
			Query         string
			OperationHash string
			Output        string
			OperationName string
		}{
			/**
			 * Queries with different variable values should not produce different hashes
			 */
			{
				Name:          "Variable with User ID 1",
				OperationHash: "17367320933561257453",
				Query: `{
    "query": "query Employee($id: Int! = 1) {\n  employee(id: $id) {\n    details {\n      pets {\n        name\n      }\n    }\n  }\n}",
    "variables": {
        "id": 1
    },
    "operationName": "Employee"
}`,
				Output:        `{"data":{"employee":{"details":{"pets":null}}}}`,
				OperationName: "Employee",
			},
			{
				Name:          "Variable with User ID 3",
				OperationHash: "17367320933561257453",
				Query: `{
    "query": "query Employee($id: Int! = 1) {\n  employee(id: $id) {\n    details {\n      pets {\n        name\n      }\n    }\n  }\n}",
    "variables": {
        "id": 3
    },
    "operationName": "Employee"
}`,
				Output:        `{"data":{"employee":{"details":{"pets":[{"name":"Snappy"}]}}}}`,
				OperationName: "Employee",
			},
			/**
			 * Queries with different default values should have the same hash
			 */
			{
				Name:          "Variable with default value 1",
				OperationHash: "17367320933561257453",
				Query: `{
    "query": "query Employee($id: Int! = 1) {\n  employee(id: $id) {\n    details {\n      pets {\n        name\n      }\n    }\n  }\n}",
    "operationName": "Employee"
}`,
				Output:        `{"data":{"employee":{"details":{"pets":null}}}}`,
				OperationName: "Employee",
			},
			{
				Name:          "Variable with default value 3",
				OperationHash: "17367320933561257453",
				Query: `{
    "query": "query Employee($id: Int! = 3) {\n  employee(id: $id) {\n    details {\n      pets {\n        name\n      }\n    }\n  }\n}",
    "operationName": "Employee"
}`,
				Output:        `{"data":{"employee":{"details":{"pets":[{"name":"Snappy"}]}}}}`,
				OperationName: "Employee",
			},
			/**
			 * Queries with different operation names but the same operation should produce same hashes
			 */
			{
				Name:          "Operation with different name",
				OperationHash: "17367320933561257453",
				Query: `{
    "query": "query Test($id: Int! = 3) {\n  employee(id: $id) {\n    details {\n      pets {\n        name\n      }\n    }\n  }\n}",
    "operationName": "Test"
}`,
				Output:        `{"data":{"employee":{"details":{"pets":[{"name":"Snappy"}]}}}}`,
				OperationName: "Test",
			},
			/**
			 * Queries with different whitespaces should produce same hashes
			 */
			{
				Name:          "Operation with different whitespaces",
				OperationHash: "17367320933561257453",
				Query: `{
    "query": "query Employee($id: Int! = 3) {\n  employee(id: $id) {\n    details {pets {\n        name\n      }\n    }\n  }}",
    "operationName": "Employee"
}`,
				Output:        `{"data":{"employee":{"details":{"pets":[{"name":"Snappy"}]}}}}`,
				OperationName: "Employee",
			},

			/**
			 * Queries with different inline values should produce same hashes
			 */
			{
				Name:          "Inline value with User ID 1",
				OperationHash: "14247917063282800240",
				Query: `{
    "query": "query Employee{\n  employee(id: 1) {\n    details {\n      pets {\n        name\n      }\n    }\n  }\n}",
    "operationName": "Employee"
}`,
				Output:        `{"data":{"employee":{"details":{"pets":null}}}}`,
				OperationName: "Employee",
			},
			{
				Name:          "Inline value with User ID 3",
				OperationHash: "14247917063282800240",
				Query: `{
    "query": "query Employee{\n  employee(id: 3) {\n    details {\n      pets {\n        name\n      }\n    }\n  }\n}",
    "operationName": "Employee"
}`,
				Output:        `{"data":{"employee":{"details":{"pets":[{"name":"Snappy"}]}}}}`,
				OperationName: "Employee",
			},
		}

		for _, tc := range testCases {
			tc := tc
			t.Run(tc.Name, func(t *testing.T) {
				exporter := tracetest.NewInMemoryExporter(t)
				testenv.Run(t, &testenv.Config{
					TraceExporter: exporter,
				}, func(t *testing.T, xEnv *testenv.Environment) {
					res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(tc.Query))
					require.NoError(t, err)
					defer res.Body.Close()
					require.Equal(t, http.StatusOK, res.StatusCode)

					body, err := io.ReadAll(res.Body)
					require.NoError(t, err)

					require.JSONEq(t, tc.Output, string(body))

					sn := exporter.GetSpans().Snapshots()

					require.Equal(t, "query "+ tc.OperationName, sn[7].Name())
					require.Equal(t, trace.SpanKindClient, sn[7].SpanKind())
					require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[7].Status())
					require.Contains(t, sn[7].Attributes(), otel.WgOperationHash.String(tc.OperationHash))

				})
			})
		}

	})
}
