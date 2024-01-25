package composition

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var subgraphs = []*Subgraph{
	{
		Name: "A",
		Schema: `type Query {
			query(arg: String!): Nested @shareable
		  }
		  
		  type Nested @shareable {
			nest: Nested2
		  }
		  
		  type Nested2 @shareable {
			nest: Nested3
		  }
		  
		  type Nested3 @shareable {
			nest: Nested4 @requiresScopes(scopes: [["read:field"]])
		  }
		  
		  type Nested4 {
			name: String
		  }`,
	},
	{
		Name: "B",
		Schema: `type Query {
			query(arg: String!): Nested @shareable
		  }
		  
		  type Nested @shareable {
			nest: Nested2
		  }
		  
		  type Nested2 @shareable {
			nest: Nested3
		  }
		  
		  type Nested3 @shareable {
			nest: Nested4
		  }
		  
		  type Nested4 {
			age: Int @authenticated
		  }`,
	},
}

func normalizeWhiteSpace(s string) string {
	return strings.TrimSpace(regexp.MustCompile(`[\s]+`).ReplaceAllString(s, " "))
}

func TestFederateSubgraphs(t *testing.T) {
	const (
		expectedSDL = `
			directive @deprecated(reason: String = "No longer supported") on ARGUMENT_DEFINITION | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION

			directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION

			directive @authenticated on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR

			directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION

			directive @requiresScopes(scopes: [[openfed__Scope!]!]!) on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR 

			scalar openfed__Scope

			type Query {
				query(arg: String!): Nested
			}

			type Nested {
				nest: Nested2
			}

			type Nested2 {
				nest: Nested3
			}

			type Nested3 {
				nest: Nested4 @requiresScopes(scopes: [["read:field"]])
			}

			type Nested4 {
				name: String
				age: Int @authenticated
			}
		`
	)
	federated, err := Federate(subgraphs...)
	require.NoError(t, err)
	assert.Equal(t, normalizeWhiteSpace(expectedSDL), normalizeWhiteSpace(federated.SDL))
	assert.Len(t, federated.FieldConfigurations, 3)
	assert.Equal(t, &FieldConfiguration{
		ArgumentNames: []string{"arg"},
		FieldName:     "query",
		TypeName:      "Query",
	}, federated.FieldConfigurations[0])
	assert.Equal(t, &FieldConfiguration{
		ArgumentNames:  []string{},
		FieldName:      "nest",
		TypeName:       "Nested3",
		RequiredScopes: [][]string{{"read:field"}},
	}, federated.FieldConfigurations[1])
	assert.Equal(t, &FieldConfiguration{
		ArgumentNames:          []string{},
		FieldName:              "age",
		TypeName:               "Nested4",
		RequiresAuthentication: true,
		RequiredScopes:         [][]string{},
	}, federated.FieldConfigurations[2])
}

func TestBuildRouterConfiguration(t *testing.T) {
	federated, err := BuildRouterConfiguration(subgraphs...)
	require.NoError(t, err)
	// Since the configuration format might change, we don't
	// test the whole payload, just that it contains valid
	// JSON and the engineConfig key
	var m map[string]any
	require.NoError(t, json.Unmarshal([]byte(federated), &m))
	assert.NotNil(t, m["engineConfig"])
}

func BenchmarkFederateSubgraphs(b *testing.B) {
	b.ReportAllocs()
	for ii := 0; ii < b.N; ii++ {
		if _, err := Federate(subgraphs...); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkFederateDirectory(b *testing.B) {
	b.ReportAllocs()
	directory := os.Getenv("FEDERATION_SCHEMAS_DIR")
	if directory == "" {
		b.Skip("no FEDERATION_SCHEMAS_DIR")
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		b.Fatal(err)
	}
	var subgraphs []*Subgraph
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) != ".graphql" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(directory, entry.Name()))
		if err != nil {
			b.Fatal(err)
		}
		subgraphs = append(subgraphs, &Subgraph{
			Name:   filepath.Base(entry.Name()),
			Schema: string(data),
		})
	}
	b.ResetTimer()
	for ii := 0; ii < b.N; ii++ {
		if _, err := Federate(subgraphs...); err != nil {
			b.Fatal(err)
		}
	}
}
