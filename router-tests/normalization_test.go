package integration

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
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
		t.Parallel()

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
				OperationHash: "1747906364159389403",
				Query: `{
    "query": "query Employee($id: Int! = 1) {\n  employee(id: $id) {\n    id\n} \n}",
    "variables": {
        "id": 1
    },
    "operationName": "Employee"
}`,
				Output:        `{"data": {"employee": {"id": 1}}}`,
				OperationName: "Employee",
			},
			{
				Name:          "Variable with User ID 3",
				OperationHash: "1747906364159389403",
				Query: `{
    "query": "query Employee($id: Int! = 1) {\n  employee(id: $id) {\n    id\n} \n}",
    "variables": {
        "id": 3
    },
    "operationName": "Employee"
}`,
				Output:        `{"data": {"employee": {"id": 3}}}`,
				OperationName: "Employee",
			},
			/**
			 * Queries with different default values should have the same hash
			 */
			{
				Name:          "Variable with default value 1",
				OperationHash: "1747906364159389403",
				Query: `{
    "query": "query Employee($id: Int! = 1) {\n  employee(id: $id) {\n    id\n} \n}",
    "operationName": "Employee"
}`,
				Output:        `{"data": {"employee": {"id": 1}}}`,
				OperationName: "Employee",
			},
			{
				Name:          "Variable with default value 3",
				OperationHash: "1747906364159389403",
				Query: `{
    "query": "query Employee($id: Int! = 3) {\n  employee(id: $id) {\n    id\n} \n}",
    "operationName": "Employee"
}`,
				Output:        `{"data": {"employee": {"id": 3}}}`,
				OperationName: "Employee",
			},
			/**
			 * Queries with different operation names but the same operation should produce same hashes
			 */
			{
				Name:          "Operation with different name",
				OperationHash: "1747906364159389403",
				Query: `{
    "query": "query Test($id: Int! = 3) {\n  employee(id: $id) {\n    id \n} \n}",
    "operationName": "Test"
}`,
				Output:        `{"data": {"employee": {"id": 3}}}`,
				OperationName: "Test",
			},
			/**
			 * Queries with different whitespaces should produce same hashes
			 */
			{
				Name:          "Operation with different whitespaces",
				OperationHash: "1747906364159389403",
				Query: `{
    "query": "query Employee($id: Int! = 3) {\n  employee(id: $id) {\n    id  \n}    \n}",
    "operationName": "Employee"
}`,
				Output:        `{"data": {"employee": {"id": 3}}}`,
				OperationName: "Employee",
			},

			/**
			 * Queries with different inline values should produce same hashes
			 */
			{
				Name:          "Inline value with User ID 1",
				OperationHash: "2190801858633811792",
				Query: `{
    "query": "query Employee{\n  employee(id: 1) {\n    id\n} \n}",
    "operationName": "Employee"
}`,
				Output:        `{"data": {"employee": {"id": 1}}}`,
				OperationName: "Employee",
			},
			{
				Name:          "Inline value with User ID 3",
				OperationHash: "2190801858633811792",
				Query: `{
    "query": "query Employee{\n  employee(id: 3) {\n    id\n} \n}",
    "operationName": "Employee"
}`,
				Output:        `{"data": {"employee": {"id": 3}}}`,
				OperationName: "Employee",
			},
		}

		for _, tc := range testCases {
			tc := tc
			t.Run(tc.Name, func(t *testing.T) {
				t.Parallel()

				exporter := tracetest.NewInMemoryExporter(t)

				defer exporter.Reset()

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

					require.Equal(t, "query "+tc.OperationName, sn[5].Name())
					require.Equal(t, trace.SpanKindClient, sn[5].SpanKind())
					require.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[5].Status())
					require.Contains(t, sn[5].Attributes(), otel.WgOperationHash.String(tc.OperationHash))

				})
			})
		}

	})

	t.Run("Normalize selection set fields order with normalization config", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithOperationNormalizationConfig(&config.OperationNormalizationConfig{
					AdditionalNormalization: config.OperationNormalizationOpts{
						SortSelectionSetFields: true,
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			query := `{
    "query": "query Find($criteria: SearchInput!) {\n  findEmployees(criteria: $criteria) {\n    id\n details {\n surname\n forename\n \n} \n} \n}",
    "variables": {
        "criteria": {
			"nationality": "AMERICAN"
		}
    },
    "operationName": "Find"
}`
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(query))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)

			body, err := io.ReadAll(res.Body)
			require.NoError(t, err)

			t.Log(string(body))

			require.JSONEq(t, `{"data":{"findEmployees":[{"id":3,"details":{"surname":"Avram","forename":"Stefan"}}]}}`, string(body))
			require.Equal(t, `{"data":{"findEmployees":[{"details":{"forename":"Stefan","surname":"Avram"},"id":3}]}}`, string(body))
		})
	})
}
