package core

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
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

func TestNewInlineArgumentsChecker(t *testing.T) {
	t.Parallel()

	t.Run("off and empty mode disable the checker", func(t *testing.T) {
		t.Parallel()
		for _, mode := range []config.DisallowInlineArgumentsMode{config.DisallowInlineArgumentsModeOff, ""} {
			checker, err := NewInlineArgumentsChecker(config.DisallowInlineArguments{Mode: mode})
			require.NoError(t, err)
			require.Nil(t, checker)
		}
	})

	t.Run("warn and enforce create a checker", func(t *testing.T) {
		t.Parallel()
		for _, mode := range []config.DisallowInlineArgumentsMode{config.DisallowInlineArgumentsModeWarn, config.DisallowInlineArgumentsModeEnforce} {
			checker, err := NewInlineArgumentsChecker(config.DisallowInlineArguments{Mode: mode})
			require.NoError(t, err)
			require.NotNil(t, checker)
		}
	})

	// Environment variables bypass the JSON-schema enum validation, which only runs
	// against the YAML config bytes. An unrecognized mode must fail startup instead
	// of silently behaving like warn while the operator believes enforce is active.
	t.Run("unrecognized mode fails instead of degrading to warn", func(t *testing.T) {
		t.Parallel()
		for _, mode := range []config.DisallowInlineArgumentsMode{"ENFORCE", "Enforce", "enfoce", "on"} {
			checker, err := NewInlineArgumentsChecker(config.DisallowInlineArguments{Mode: mode})
			require.Error(t, err)
			require.ErrorContains(t, err, string(mode))
			require.Nil(t, checker)
		}
	})

	// Same env-var bypass as the mode check: the JSON schema bounds the status code
	// to 200-599, but env-derived values skip it, and net/http panics in WriteHeader
	// for codes outside 100-999. Out-of-range codes must fail startup instead of
	// panicking on every enforce-mode rejection.
	t.Run("out-of-range enforce status code fails startup", func(t *testing.T) {
		t.Parallel()
		for _, statusCode := range []int{99, 199, 600, 1000, -1} {
			checker, err := NewInlineArgumentsChecker(config.DisallowInlineArguments{
				Mode:                  config.DisallowInlineArgumentsModeEnforce,
				EnforceHTTPStatusCode: statusCode,
			})
			require.Error(t, err)
			require.ErrorContains(t, err, fmt.Sprintf("%d", statusCode))
			require.Nil(t, checker)
		}
	})

	t.Run("in-range enforce status codes are accepted", func(t *testing.T) {
		t.Parallel()
		for _, statusCode := range []int{200, 400, 599} {
			checker, err := NewInlineArgumentsChecker(config.DisallowInlineArguments{
				Mode:                  config.DisallowInlineArgumentsModeEnforce,
				EnforceHTTPStatusCode: statusCode,
			})
			require.NoError(t, err)
			require.NotNil(t, checker)
		}
	})
}
