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

func TestDefaultValuesForSkipInclude(t *testing.T) {
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($yes: Boolean! = true) { employee(id: 1) { details { forename surname @include(if: $yes) } } }`,
			Variables:     []byte(`{}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"employee":{"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
		require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($yes: Boolean! = true) { employee(id: 1) { details { forename surname @include(if: $yes) } } }`,
			Variables:     []byte(`{}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"employee":{"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($yes: Boolean! = true) { employee(id: 1) { details { forename surname @include(if: $yes) } } }`,
			Variables:     []byte(`{"yes": false}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"employee":{"details":{"forename":"Jens"}}}}`, res.Body)
		require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($yes: Boolean! = true) { employee(id: 1) { details { forename surname @include(if: $yes) } } }`,
			Variables:     []byte(`{"yes": false}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"employee":{"details":{"forename":"Jens"}}}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($yes: Boolean! = true) { employee(id: 1) { details { forename surname @include(if: $yes) } } }`,
			Variables:     []byte(`{"yes": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"employee":{"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
		require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($yes: Boolean! = true) { employee(id: 1) { details { forename surname @include(if: $yes) } } }`,
			Variables:     []byte(`{"yes": true}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"employee":{"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))
	})
}

func TestNormalizationCacheWithNestedVariables(t *testing.T) {
	testenv.Run(t, &testenv.Config{
		ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
			cfg.EnableNormalizationCache = true
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"NormalizationQuery"`),
			Query:         `query NormalizationQuery ($arg: String!) {rootFieldWithInput(arg: {string: $arg})}`,
			Variables:     []byte(`{"arg":"a"}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithInput":"a"}}`, res.Body)
		require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"NormalizationQuery"`),
			Query:         `query NormalizationQuery ($arg: String!) {rootFieldWithInput(arg: {string: $arg})}`,
			Variables:     []byte(`{"arg":"a"}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithInput":"a"}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"NormalizationQuery"`),
			Query:         `query NormalizationQuery ($arg: String!) {rootFieldWithInput(arg: {string: $arg})}`,
			Variables:     []byte(`{"arg":"b"}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithInput":"b"}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))

		// rootFieldWithListOfInputArg
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"NormalizationQuery"`),
			Query:         `query NormalizationQuery ($arg: String!) {rootFieldWithListOfInputArg(arg: {arg: $arg}){arg}}`,
			Variables:     []byte(`{"arg":"a"}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListOfInputArg":[{"arg":"a"}]}}`, res.Body)
		require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"NormalizationQuery"`),
			Query:         `query NormalizationQuery ($arg: String!) {rootFieldWithListOfInputArg(arg: {arg: $arg}){arg}}`,
			Variables:     []byte(`{"arg":"a"}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListOfInputArg":[{"arg":"a"}]}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"NormalizationQuery"`),
			Query:         `query NormalizationQuery ($arg: String!) {rootFieldWithListOfInputArg(arg: {arg: $arg}){arg}}`,
			Variables:     []byte(`{"arg":"b"}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListOfInputArg":[{"arg":"b"}]}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))
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
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($arg: [[String!]!]! = "a") {rootFieldWithNestedListArg(arg: $arg)}`,
			Variables:     []byte(`{"arg": "b"}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithNestedListArg":[["b"]]}}`, res.Body)
		require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
	})
}

func TestWithInputListCoercion(t *testing.T) {
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($arg: [String!]!) {rootFieldWithListArg(arg: $arg)}`,
			Variables:     []byte(`{"arg": "a"}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListArg":["a"]}}`, res.Body)
		require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($arg: [String!]!) {rootFieldWithListArg(arg: $arg)}`,
			Variables:     []byte(`{"arg": "a"}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListArg":["a"]}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($arg: [String!]!) {rootFieldWithListArg(arg: $arg)}`,
			Variables:     []byte(`{"arg": "a"}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListArg":["a"]}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))

		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($arg: [String!]! = "a") {rootFieldWithListArg(arg: $arg)}`,
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListArg":["a"]}}`, res.Body)
		require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($arg: [String!]! = "a") {rootFieldWithListArg(arg: $arg)}`,
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListArg":["a"]}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($arg: [String!]! = "a") {rootFieldWithListArg(arg: $arg)}`,
			Variables:     []byte(`{"arg": "b"}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListArg":["b"]}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))

		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($arg: [EnumType!]!) {rootFieldWithListOfEnumArg(arg: $arg)}`,
			Variables:     []byte(`{"arg": "A"}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListOfEnumArg":["A"]}}`, res.Body)
		require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($arg: [EnumType!]!) {rootFieldWithListOfEnumArg(arg: $arg)}`,
			Variables:     []byte(`{"arg": "B"}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListOfEnumArg":["B"]}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))

		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($arg: [InputType!]!) {rootFieldWithListOfInputArg(arg: $arg){arg}}`,
			Variables:     []byte(`{"arg": {"arg": "a"}}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListOfInputArg":[{"arg":"a"}]}}`, res.Body)
		require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($arg: [InputType!]!) {rootFieldWithListOfInputArg(arg: $arg){arg}}`,
			Variables:     []byte(`{"arg": {"arg": "b"}}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithListOfInputArg":[{"arg":"b"}]}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))

		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($arg: [[String!]!]!) {rootFieldWithNestedListArg(arg: $arg)}`,
			Variables:     []byte(`{"arg": "a"}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithNestedListArg":[["a"]]}}`, res.Body)
		require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($arg: [[String!]!]!) {rootFieldWithNestedListArg(arg: $arg)}`,
			Variables:     []byte(`{"arg": "a"}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithNestedListArg":[["a"]]}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($arg: [[String!]!]!) {rootFieldWithNestedListArg(arg: $arg)}`,
			Variables:     []byte(`{"arg": "b"}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithNestedListArg":[["b"]]}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))

		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($arg: [[String!]!]! = "a") {rootFieldWithNestedListArg(arg: $arg)}`,
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithNestedListArg":[["a"]]}}`, res.Body)
		require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($arg: [[String!]!]! = "a") {rootFieldWithNestedListArg(arg: $arg)}`,
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithNestedListArg":[["a"]]}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($arg: [[String!]!]! = "a") {rootFieldWithNestedListArg(arg: $arg)}`,
			Variables:     []byte(`{"arg": "b"}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithNestedListArg":[["b"]]}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))

		// nested lists enum
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($arg: InputArg!) {rootFieldWithInput(arg: $arg)}`,
			Variables:     []byte(`{"arg":{"enums":"A"}}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithInput":"A"}}`, res.Body)
		require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($arg: InputArg!) {rootFieldWithInput(arg: $arg)}`,
			Variables:     []byte(`{"arg":{"enums":"B"}}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithInput":"B"}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))

		// nested lists string
		res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Query:         `query MyQuery($arg: InputArg!) {rootFieldWithInput(arg: $arg)}`,
			Variables:     []byte(`{"arg":{"strings":"a"}}`),
		})
		require.NoError(t, err)
		require.Equal(t, `{"data":{"rootFieldWithInput":"a"}}`, res.Body)
		require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))
	})
}
