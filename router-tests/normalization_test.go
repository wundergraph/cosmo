package integration

import (
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestNormalization(t *testing.T) {

	t.Run("Whitespaces in variables should not impact normalization", func(t *testing.T) {
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
}
