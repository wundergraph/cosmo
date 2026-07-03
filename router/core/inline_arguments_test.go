package core

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
)

const inlineArgumentsTestSchema = `
type Query {
	employee(id: ID, active: Boolean, role: String): Employee
	employees(order: Order, ids: [Int], filter: Filter): [Employee]
	score(min: Float): Employee
	field(input: Filter): String
}

type Employee {
	id: ID
	posts(first: Int): [Employee]
}

enum Order {
	ASC
	DESC
}

input Filter {
	active: Boolean
}
`

func parseTestSchema(t *testing.T) *ast.Document {
	t.Helper()
	definition, report := astparser.ParseGraphqlDocumentString(inlineArgumentsTestSchema)
	require.False(t, report.HasErrors(), "schema parse error: %s", report.Error())
	require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&definition))
	return &definition
}

func parseQuery(t *testing.T, query string) *ast.Document {
	t.Helper()
	doc := ast.NewDocument()
	doc.Input.ResetInputBytes([]byte(query))
	report := &operationreport.Report{}
	astparser.NewParser().Parse(doc, report)
	require.False(t, report.HasErrors(), "parse error: %s", report.Error())
	return doc
}

// TestDetectInlineArguments exercises the detection walk in isolation on parsed
// documents. In the request pipeline the walk runs on the normalized document
// (see detectInlineArguments); the pruning behavior that implies is covered by
// the integration tests in router-tests/security/disallow_inline_arguments_test.go.
func TestDetectInlineArguments(t *testing.T) {
	t.Parallel()

	definition := parseTestSchema(t)

	tests := []struct {
		name  string
		query string
		want  []InlineArgument
	}{
		{
			name:  "no arguments",
			query: `query { employee { id } }`,
			want:  nil,
		},
		{
			name:  "variable only",
			query: `query($id: ID!) { employee(id: $id) { id } }`,
			want:  nil,
		},
		{
			name:  "inline string",
			query: `query { employee(id: "1") { id } }`,
			want: []InlineArgument{
				{Name: "id", ValueKind: "String"},
			},
		},
		{
			name:  "inline integer",
			query: `query { employee(id: 1) { id } }`,
			want: []InlineArgument{
				{Name: "id", ValueKind: "Int"},
			},
		},
		{
			name:  "inline float",
			query: `query { score(min: 1.5) { id } }`,
			want: []InlineArgument{
				{Name: "min", ValueKind: "Float"},
			},
		},
		{
			name:  "inline boolean",
			query: `query { employee(active: true) { id } }`,
			want: []InlineArgument{
				{Name: "active", ValueKind: "Boolean"},
			},
		},
		{
			name:  "inline enum",
			query: `query { employees(order: ASC) { id } }`,
			want: []InlineArgument{
				{Name: "order", ValueKind: "Enum"},
			},
		},
		{
			name:  "inline null",
			query: `query { employee(id: null) { id } }`,
			want: []InlineArgument{
				{Name: "id", ValueKind: "Null"},
			},
		},
		{
			name:  "inline list",
			query: `query { employees(ids: [1, 2]) { id } }`,
			want: []InlineArgument{
				{Name: "ids", ValueKind: "List"},
			},
		},
		{
			name:  "inline object",
			query: `query { employees(filter: {active: true}) { id } }`,
			want: []InlineArgument{
				{Name: "filter", ValueKind: "Object"},
			},
		},
		{
			name:  "inline empty object",
			query: `query { field(input: {}) }`,
			want: []InlineArgument{
				{Name: "input", ValueKind: "Object"},
			},
		},
		{
			name:  "mixed variable and literal",
			query: `query($id: ID!) { employee(id: $id, role: "admin") { id } }`,
			want: []InlineArgument{
				{Name: "role", ValueKind: "String"},
			},
		},
		{
			name:  "directive inline argument",
			query: `query($id: ID!) { employee(id: $id) @include(if: true) { id } }`,
			want: []InlineArgument{
				{Name: "if", ValueKind: "Boolean"},
			},
		},
		{
			name:  "nested field argument",
			query: `query($id: ID!) { employee(id: $id) { posts(first: 10) { id } } }`,
			want: []InlineArgument{
				{Name: "first", ValueKind: "Int"},
			},
		},
		{
			name:  "introspection field argument",
			query: `query { __type(name: "User") { name } }`,
			want: []InlineArgument{
				{Name: "name", ValueKind: "String"},
			},
		},
		{
			name:  "inline arg inside spread fragment",
			query: `query { ...F } fragment F on Query { employee(id: "1") { id } }`,
			want: []InlineArgument{
				{Name: "id", ValueKind: "String"},
			},
		},
		{
			name:  "variable definition default not detected",
			query: `query($x: ID = "5") { employee(id: $x) { id } }`,
			want:  nil,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			doc := parseQuery(t, tc.query)
			got := detectInlineArguments(doc, definition)
			require.Equal(t, tc.want, got)
		})
	}
}
