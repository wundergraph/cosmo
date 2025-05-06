package integration

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/sebdah/goldie/v2"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
)

const introspectionQuery = `query IntrospectionQuery {
  __schema {
    queryType {
      name
    }
    mutationType {
      name
    }
    subscriptionType {
      name
    }
    types {
      ...FullType
    }
    directives {
      name
      description
      locations
      args {
        ...InputValue
      }
    }
  }
}

fragment FullType on __Type {
  kind
  name
  description
  fields(includeDeprecated: true) {
    name
    description
    args {
      ...InputValue
    }
    type {
      ...TypeRef
    }
    isDeprecated
    deprecationReason
  }
  inputFields {
    ...InputValue
  }
  interfaces {
    ...TypeRef
  }
  enumValues(includeDeprecated: true) {
    name
    description
    isDeprecated
    deprecationReason
  }
  possibleTypes {
    ...TypeRef
  }
}

fragment InputValue on __InputValue {
  name
  description
  type {
    ...TypeRef
  }
  defaultValue
}

fragment TypeRef on __Type {
  kind
  name
  ofType {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
              }
            }
          }
        }
      }
    }
  }
}`

func TestIntrospection(t *testing.T) {
	t.Parallel()

	g := goldie.New(
		t,
		goldie.WithFixtureDir("testdata/introspection"),
		goldie.WithNameSuffix(".json"),
		goldie.WithDiffEngine(goldie.ClassicDiff),
	)

	t.Run("Return proper introspection result", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: introspectionQuery,
			})
			body := bytes.NewBuffer(nil)
			require.NoError(t, json.Indent(body, []byte(res.Body), "", "  "))
			g.Assert(t, "base-graph-schema", body.Bytes())
		})
	})

	t.Run("Return correct introspection result from feature flag schema", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: introspectionQuery,
				Header: map[string][]string{
					"X-Feature-Flag": {"myff"},
				},
			})
			body := bytes.NewBuffer(nil)
			require.NoError(t, json.Indent(body, []byte(res.Body), "", "  "))
			g.Assert(t, "feature-graph-schema", body.Bytes())
		})
	})

}
