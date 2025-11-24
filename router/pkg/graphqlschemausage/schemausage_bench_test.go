package graphqlschemausage

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/astjson"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvalidation"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
)

// setupBenchmark creates a realistic schema usage scenario for benchmarking
// Returns: plan, operation doc, definition doc, variables
func setupBenchmark(b *testing.B) (plan.Plan, *ast.Document, *ast.Document, *astjson.Value) {
	b.Helper()

	operation := `
		query Search($name: String! $filter2: SearchFilter $enumValue: Episode $enumList: [Episode]) {
			searchResults(name: $name, filter: {excludeName: "Jannik"} filter2: $filter2, enumValue: $enumValue enumList: $enumList) {
				__typename
				... on Human {
					name
					inlineName(name: "Jannik")
				}
				... on Droid {
					name
				}
			}
			hero {
				name
			}
		}
	`

	variables := `{"name":"Jannik","filter2":{"enumField":"NEWHOPE"},"enumValue":"EMPIRE","enumList":["JEDI","EMPIRE"]}`

	// Parse schema
	def, rep := astparser.ParseGraphqlDocumentString(schemaUsageInfoTestSchema)
	require.False(b, rep.HasErrors())

	// Parse operation
	op, rep := astparser.ParseGraphqlDocumentString(operation)
	require.False(b, rep.HasErrors())

	// Merge and normalize
	err := asttransform.MergeDefinitionWithBaseSchema(&def)
	require.NoError(b, err)

	report := &operationreport.Report{}
	norm := astnormalization.NewNormalizer(true, true)
	norm.NormalizeOperation(&op, &def, report)
	require.False(b, report.HasErrors())

	valid := astvalidation.DefaultOperationValidator()
	valid.Validate(&op, &def, report)
	require.False(b, report.HasErrors())

	// Create data source configuration
	dsCfg, err := plan.NewDataSourceConfiguration(
		"https://swapi.dev/api",
		&FakeFactory[any]{upstreamSchema: &def},
		&plan.DataSourceMetadata{
			RootNodes: []plan.TypeField{
				{TypeName: "Query", FieldNames: []string{"searchResults", "hero"}},
			},
			ChildNodes: []plan.TypeField{
				{TypeName: "Human", FieldNames: []string{"name", "inlineName"}},
				{TypeName: "Droid", FieldNames: []string{"name"}},
				{TypeName: "SearchResult", FieldNames: []string{"__typename"}},
				{TypeName: "Character", FieldNames: []string{"name", "friends"}},
			},
		},
		nil,
	)
	require.NoError(b, err)

	// Create planner
	planner, err := plan.NewPlanner(plan.Configuration{
		DisableResolveFieldPositions: true,
		DataSources:                  []plan.DataSource{dsCfg},
	})
	require.NoError(b, err)

	// Generate plan
	generatedPlan := planner.Plan(&op, &def, "Search", report)
	require.False(b, report.HasErrors())

	// Parse variables
	vars, err := astjson.Parse(variables)
	require.NoError(b, err)

	inputVariables, err := astjson.ParseBytes(op.Input.Variables)
	require.NoError(b, err)

	merged, _, err := astjson.MergeValues(vars, inputVariables)
	require.NoError(b, err)

	return generatedPlan, &op, &def, merged
}

// BenchmarkGetTypeFieldUsageInfo measures memory allocations when extracting field usage from a plan
func BenchmarkGetTypeFieldUsageInfo(b *testing.B) {
	generatedPlan, _, _, _ := setupBenchmark(b)

	b.ReportAllocs()

	for b.Loop() {
		result := GetTypeFieldUsageInfo(generatedPlan)
		_ = result // Prevent compiler optimization
	}
}

// BenchmarkGetArgumentUsageInfo measures memory allocations when extracting argument usage
func BenchmarkGetArgumentUsageInfo(b *testing.B) {
	_, operation, definition, _ := setupBenchmark(b)

	b.ReportAllocs()

	for b.Loop() {
		result, err := GetArgumentUsageInfo(operation, definition)
		if err != nil {
			b.Fatal(err)
		}
		_ = result // Prevent compiler optimization
	}
}

// BenchmarkGetInputUsageInfo measures memory allocations when extracting input variable usage
func BenchmarkGetInputUsageInfo(b *testing.B) {
	_, operation, definition, variables := setupBenchmark(b)

	b.ReportAllocs()

	for b.Loop() {
		result, err := GetInputUsageInfo(operation, definition, variables)
		if err != nil {
			b.Fatal(err)
		}
		_ = result // Prevent compiler optimization
	}
}

// BenchmarkIntoGraphQLMetrics measures memory allocations when converting to protobuf format
func BenchmarkIntoGraphQLMetrics(b *testing.B) {
	generatedPlan, _, _, _ := setupBenchmark(b)
	typeFieldMetrics := TypeFieldMetrics(GetTypeFieldUsageInfo(generatedPlan))

	b.ReportAllocs()

	for b.Loop() {
		result := typeFieldMetrics.IntoGraphQLMetrics()
		_ = result // Prevent compiler optimization
	}
}

// BenchmarkSchemaUsageEndToEnd measures total memory allocations for complete schema usage extraction
// This simulates a full request lifecycle for schema usage tracking
func BenchmarkSchemaUsageEndToEnd(b *testing.B) {
	generatedPlan, operation, definition, variables := setupBenchmark(b)

	b.ReportAllocs()

	for b.Loop() {
		// Extract type field usage
		typeFieldUsage := GetTypeFieldUsageInfo(generatedPlan)

		// Convert to GraphQL metrics format
		_ = TypeFieldMetrics(typeFieldUsage).IntoGraphQLMetrics()

		// Extract argument usage
		argUsage, err := GetArgumentUsageInfo(operation, definition)
		if err != nil {
			b.Fatal(err)
		}
		_ = argUsage

		// Extract input variable usage
		inputUsage, err := GetInputUsageInfo(operation, definition, variables)
		if err != nil {
			b.Fatal(err)
		}
		_ = inputUsage
	}
}
