package composition

import (
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
			query: Nested @shareable
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
			name: String
		  }`,
	},
	{
		Name: "B",
		Schema: `type Query {
			query: Nested @shareable
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
			age: Int
		  }`,
	},
}

func normalizeWhiteSpace(s string) string {
	return strings.TrimSpace(regexp.MustCompile(`[\s]+`).ReplaceAllString(s, " "))
}

func TestFederateSubgraphs(t *testing.T) {
	const (
		expectedAST = `
			directive @deprecated(reason: String = "No longer supported") on ARGUMENT_DEFINITION | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION

			directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION

			directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION

			type Query {
			query: Nested
			}

			type Nested {
			nest: Nested2
			}

			type Nested2 {
			nest: Nested3
			}

			type Nested3 {
			nest: Nested4
			}

			type Nested4 {
			name: String
			age: Int
			}
		`
		expectedSchema = `
			directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION

			directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION

			type Query {
			query: Nested
			}

			type Nested {
			nest: Nested2
			}

			type Nested2 {
			nest: Nested3
			}

			type Nested3 {
			nest: Nested4
			}

			type Nested4 {
			name: String
			age: Int
			}
		`
	)
	federated, err := Federate(subgraphs...)
	require.NoError(t, err)
	assert.Equal(t, normalizeWhiteSpace(expectedAST), normalizeWhiteSpace(federated.AST))
	assert.Equal(t, normalizeWhiteSpace(expectedSchema), normalizeWhiteSpace(federated.Schema))
	assert.Len(t, federated.ArgumentConfigurations, 0)
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
