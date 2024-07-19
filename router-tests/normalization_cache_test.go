package integration

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestNormalizationCache(t *testing.T) {
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employee"`),
			Query:         `query Employee( $id: Int! = 4 $withAligators: Boolean! $withCats: Boolean! $skipDogs:Boolean! $skipMouses:Boolean! ) { employee(id: $id) { details { pets { name __typename ...AlligatorFields @include(if: $withAligators) ...CatFields @include(if: $withCats) ...DogFields @skip(if: $skipDogs) ...MouseFields @skip(if: $skipMouses) ...PonyFields @include(if: false) } } } } fragment AlligatorFields on Alligator { __typename class dangerous gender name } fragment CatFields on Cat { __typename class gender name type } fragment DogFields on Dog { __typename breed class gender name } fragment MouseFields on Mouse { __typename class gender name } fragment PonyFields on Pony { __typename class gender name }`,
			Variables:     []byte(`{"withAligators": true,"withCats": true,"skipDogs": false,"skipMouses": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
		require.Equal(t, `{"data":{"employee":{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}}}}`, res.Body)
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employee"`),
			Query:         `query Employee( $id: Int! = 4 $withAligators: Boolean! $withCats: Boolean! $skipDogs:Boolean! $skipMouses:Boolean! ) { employee(id: $id) { details { pets { name __typename ...AlligatorFields @include(if: $withAligators) ...CatFields @include(if: $withCats) ...DogFields @skip(if: $skipDogs) ...MouseFields @skip(if: $skipMouses) ...PonyFields @include(if: false) } } } } fragment AlligatorFields on Alligator { __typename class dangerous gender name } fragment CatFields on Cat { __typename class gender name type } fragment DogFields on Dog { __typename breed class gender name } fragment MouseFields on Mouse { __typename class gender name } fragment PonyFields on Pony { __typename class gender name }`,
			Variables:     []byte(`{"withAligators": true,"withCats": true,"skipDogs": false,"skipMouses": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))
		require.Equal(t, `{"data":{"employee":{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}}}}`, res.Body)
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employee"`),
			Query:         `query Employee( $id: Int! = 4 $withAligators: Boolean! $withCats: Boolean! $skipDogs:Boolean! $skipMouses:Boolean! ) { employee(id: $id) { details { pets { name __typename ...AlligatorFields @include(if: $withAligators) ...CatFields @include(if: $withCats) ...DogFields @skip(if: $skipDogs) ...MouseFields @skip(if: $skipMouses) ...PonyFields @include(if: false) } } } } fragment AlligatorFields on Alligator { __typename class dangerous gender name } fragment CatFields on Cat { __typename class gender name type } fragment DogFields on Dog { __typename breed class gender name } fragment MouseFields on Mouse { __typename class gender name } fragment PonyFields on Pony { __typename class gender name }`,
			Variables:     []byte(`{"withCats": true,"skipDogs": false,"skipMouses": true,"withAligators": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))
		require.Equal(t, `{"data":{"employee":{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}}}}`, res.Body)
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employee"`),
			Query:         `query Employee( $id: Int! = 4 $withAligators: Boolean! $withCats: Boolean! $skipDogs:Boolean! $skipMouses:Boolean! ) { employee(id: $id) { details { pets { name __typename ...AlligatorFields @include(if: $withAligators) ...CatFields @include(if: $withCats) ...DogFields @skip(if: $skipDogs) ...MouseFields @skip(if: $skipMouses) ...PonyFields @include(if: false) } } } } fragment AlligatorFields on Alligator { __typename class dangerous gender name } fragment CatFields on Cat { __typename class gender name type } fragment DogFields on Dog { __typename breed class gender name } fragment MouseFields on Mouse { __typename class gender name } fragment PonyFields on Pony { __typename class gender name }`,
			Variables:     []byte(`{"withCats": true,"skipDogs": false,"skipMouses": true,"withAligators": false,"id": 3}`),
		})
		require.NoError(t, err)
		require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
		require.Equal(t, `{"data":{"employee":{"details":{"pets":[{"name":"Snappy","__typename":"Alligator"}]}}}}`, res.Body)
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employee"`),
			Query:         `query Employee( $id: Int! = 4 $withAligators: Boolean! $withCats: Boolean! $skipDogs:Boolean! $skipMouses:Boolean! ) { employee(id: $id) { details { pets { name __typename ...AlligatorFields @include(if: $withAligators) ...CatFields @include(if: $withCats) ...DogFields @skip(if: $skipDogs) ...MouseFields @skip(if: $skipMouses) ...PonyFields @include(if: false) } } } } fragment AlligatorFields on Alligator { __typename class dangerous gender name } fragment CatFields on Cat { __typename class gender name type } fragment DogFields on Dog { __typename breed class gender name } fragment MouseFields on Mouse { __typename class gender name } fragment PonyFields on Pony { __typename class gender name }`,
			Variables:     []byte(`{"withCats": true,"skipDogs": false,"skipMouses": true,"withAligators": false,"id": 3}`),
		})
		require.NoError(t, err)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))
		require.Equal(t, `{"data":{"employee":{"details":{"pets":[{"name":"Snappy","__typename":"Alligator"}]}}}}`, res.Body)
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employees"`),
			Query:         `query Employees( $withAligators: Boolean! $withCats: Boolean! $skipDogs:Boolean! $skipMouses:Boolean! ) { employees { details { pets { name __typename ...AlligatorFields @include(if: $withAligators) ...CatFields @include(if: $withCats) ...DogFields @skip(if: $skipDogs) ...MouseFields @skip(if: $skipMouses) ...PonyFields @include(if: false) } } } } fragment AlligatorFields on Alligator { __typename class dangerous gender name } fragment CatFields on Cat { __typename class gender name type } fragment DogFields on Dog { __typename breed class gender name } fragment MouseFields on Mouse { __typename class gender name } fragment PonyFields on Pony { __typename class gender name }`,
			Variables:     []byte(`{"withAligators": true,"withCats": true,"skipDogs": false,"skipMouses": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
		require.Equal(t, `{"data":{"employees":[{"details":{"pets":null}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Snappy","__typename":"Alligator","class":"REPTILE","dangerous":"yes","gender":"UNKNOWN"}]}},{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}},{"details":{"pets":[{"name":"Blotch","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"STREET"},{"name":"Grayone","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Rusty","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Manya","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Peach","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"STREET"},{"name":"Panda","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"HOME"},{"name":"Mommy","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"STREET"},{"name":"Terry","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Tilda","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"},{"name":"Vasya","__typename":"Cat","class":"MAMMAL","gender":"MALE","type":"HOME"}]}},{"details":{"pets":null}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Vanson","__typename":"Mouse"}]}},{"details":{"pets":null}},{"details":{"pets":[{"name":"Pepper","__typename":"Cat","class":"MAMMAL","gender":"FEMALE","type":"HOME"}]}}]}}`, res.Body)
	})
}

func TestWithoutNormalizationCache(t *testing.T) {
	testenv.Run(t, &testenv.Config{
		ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
			cfg.EnableNormalizationCache = false
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employee"`),
			Query:         `query Employee( $id: Int! = 4 $withAligators: Boolean! $withCats: Boolean! $skipDogs:Boolean! $skipMouses:Boolean! ) { employee(id: $id) { details { pets { name __typename ...AlligatorFields @include(if: $withAligators) ...CatFields @include(if: $withCats) ...DogFields @skip(if: $skipDogs) ...MouseFields @skip(if: $skipMouses) ...PonyFields @include(if: false) } } } } fragment AlligatorFields on Alligator { __typename class dangerous gender name } fragment CatFields on Cat { __typename class gender name type } fragment DogFields on Dog { __typename breed class gender name } fragment MouseFields on Mouse { __typename class gender name } fragment PonyFields on Pony { __typename class gender name }`,
			Variables:     []byte(`{"withAligators": true,"withCats": true,"skipDogs": false,"skipMouses": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
		require.Equal(t, `{"data":{"employee":{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}}}}`, res.Body)
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"Employee"`),
			Query:         `query Employee( $id: Int! = 4 $withAligators: Boolean! $withCats: Boolean! $skipDogs:Boolean! $skipMouses:Boolean! ) { employee(id: $id) { details { pets { name __typename ...AlligatorFields @include(if: $withAligators) ...CatFields @include(if: $withCats) ...DogFields @skip(if: $skipDogs) ...MouseFields @skip(if: $skipMouses) ...PonyFields @include(if: false) } } } } fragment AlligatorFields on Alligator { __typename class dangerous gender name } fragment CatFields on Cat { __typename class gender name type } fragment DogFields on Dog { __typename breed class gender name } fragment MouseFields on Mouse { __typename class gender name } fragment PonyFields on Pony { __typename class gender name }`,
			Variables:     []byte(`{"withAligators": true,"withCats": true,"skipDogs": false,"skipMouses": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
		require.Equal(t, `{"data":{"employee":{"details":{"pets":[{"name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER","class":"MAMMAL","gender":"FEMALE"},{"name":"Survivor","__typename":"Pony"}]}}}}`, res.Body)
	})
}
