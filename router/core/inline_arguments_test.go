package core

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
)

func parseQuery(t *testing.T, query string) *ast.Document {
	t.Helper()
	doc := ast.NewDocument()
	doc.Input.ResetInputBytes([]byte(query))
	report := &operationreport.Report{}
	astparser.NewParser().Parse(doc, report)
	require.False(t, report.HasErrors(), "parse error: %s", report.Error())
	return doc
}

func TestDetectInlineArguments(t *testing.T) {
	t.Parallel()

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
				{Name: "id", ValueKind: "String", Line: 1, Column: 18},
			},
		},
		{
			name:  "inline integer",
			query: `query { employee(id: 1) { id } }`,
			want: []InlineArgument{
				{Name: "id", ValueKind: "Int", Line: 1, Column: 18},
			},
		},
		{
			name:  "inline float",
			query: `query { score(min: 1.5) { id } }`,
			want: []InlineArgument{
				{Name: "min", ValueKind: "Float", Line: 1, Column: 15},
			},
		},
		{
			name:  "inline boolean",
			query: `query { employee(active: true) { id } }`,
			want: []InlineArgument{
				{Name: "active", ValueKind: "Boolean", Line: 1, Column: 18},
			},
		},
		{
			name:  "inline enum",
			query: `query { employees(order: ASC) { id } }`,
			want: []InlineArgument{
				{Name: "order", ValueKind: "Enum", Line: 1, Column: 19},
			},
		},
		{
			name:  "inline null",
			query: `query { employee(id: null) { id } }`,
			want: []InlineArgument{
				{Name: "id", ValueKind: "Null", Line: 1, Column: 18},
			},
		},
		{
			name:  "inline list",
			query: `query { employees(ids: [1, 2]) { id } }`,
			want: []InlineArgument{
				{Name: "ids", ValueKind: "List", Line: 1, Column: 19},
			},
		},
		{
			name:  "inline object",
			query: `query { employees(filter: {active: true}) { id } }`,
			want: []InlineArgument{
				{Name: "filter", ValueKind: "Object", Line: 1, Column: 19},
			},
		},
		{
			name:  "inline empty object",
			query: `query { field(input: {}) }`,
			want: []InlineArgument{
				{Name: "input", ValueKind: "Object", Line: 1, Column: 15},
			},
		},
		{
			name:  "mixed variable and literal",
			query: `query($id: ID!) { employee(id: $id, role: "admin") { id } }`,
			want: []InlineArgument{
				{Name: "role", ValueKind: "String", Line: 1, Column: 37},
			},
		},
		{
			name:  "directive inline argument",
			query: `query { employee(id: $id) @include(if: true) { id } }`,
			want: []InlineArgument{
				{Name: "if", ValueKind: "Boolean", Line: 1, Column: 36},
			},
		},
		{
			name:  "inline arg in skipped node still detected",
			query: `query { employee(id: $id) { posts(first: 10) @skip(if: true) { id } } }`,
			want: []InlineArgument{
				{Name: "first", ValueKind: "Int", Line: 1, Column: 35},
				{Name: "if", ValueKind: "Boolean", Line: 1, Column: 52},
			},
		},
		{
			name:  "introspection field argument",
			query: `query { __type(name: "User") { name } }`,
			want: []InlineArgument{
				{Name: "name", ValueKind: "String", Line: 1, Column: 16},
			},
		},
		{
			name:  "inline arg inside fragment",
			query: `query { ...F } fragment F on Query { employee(id: "1") { id } }`,
			want: []InlineArgument{
				{Name: "id", ValueKind: "String", Line: 1, Column: 47},
			},
		},
		{
			name:  "variable definition default not detected",
			query: `query($x: Int = 5) { employee(id: $x) { id } }`,
			want:  nil,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			doc := parseQuery(t, tc.query)
			got := detectInlineArguments(doc)
			require.Equal(t, tc.want, got)
		})
	}
}
