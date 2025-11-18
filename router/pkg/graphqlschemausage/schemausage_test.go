package graphqlschemausage

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	"github.com/jensneuse/abstractlogger"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/astjson"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvalidation"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"

	graphqlmetricsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
)

const schemaUsageInfoTestSchema = `

directive @defer on FIELD

directive @flushInterval(milliSeconds: Int!) on QUERY | SUBSCRIPTION

directive @stream(initialBatchSize: Int) on FIELD

union SearchResult = Human | Droid | Starship

schema {
    query: Query
    mutation: Mutation
    subscription: Subscription
}

type Query {
	hero: Character
    droid(id: ID!): Droid
    search(name: String!): SearchResult
	searchResults(name: String!, filter: SearchFilter, filter2: SearchFilter, enumValue: Episode enumList: [Episode] enumList2: [Episode] filterList: [SearchFilter]): [SearchResult]
}

input SearchFilter {
	excludeName: String
	enumField: Episode
}

type Mutation {
    createReview(episode: Episode!, review: ReviewInput!): Review
}

type Subscription {
    remainingJedis: Int!
	newReviews: Review
}

input ReviewInput {
    stars: Int!
    commentary: String
}

type Review {
    id: ID!
    stars: Int!
    commentary: String
}

enum Episode {
    NEWHOPE
    EMPIRE
    JEDI
}

interface Creature {
	name: String!
}

interface Character {
    name: String!
    friends: [Character]
}

type Human implements Character & Creature {
    name: String!
    height: String!
    friends: [Character]
	inlineName(name: String!): String!
}

type Droid implements Character {
    name: String!
    primaryFunction: String!
    friends: [Character]
	favoriteEpisode: Episode
}

interface Vehicle {
	length: Float!
}

type Starship implements Vehicle {
    name: String!
    length: Float!
}
`

func TestGetSchemaUsageInfo(t *testing.T) {
	operation := `
		query Search($name: String! $filter2: SearchFilter $enumValue: Episode $enumList: [Episode] $filterList: [SearchFilter]) {
			searchResults(name: $name, filter: {excludeName: "Jannik"} filter2: $filter2, enumValue: $enumValue enumList: $enumList, enumList2: [JEDI, EMPIRE] filterList: $filterList ) {
				__typename
				... on Human {
					name
					inlineName(name: "Jannik")
				}
				... on Droid {
					name
				}
				... on Starship {
					length
				}
			}
			hero {
				name
			}
		}
`

	variables := `{"name":"Jannik","filter2":{"enumField":"NEWHOPE"},"enumValue":"EMPIRE","enumList":["JEDI","EMPIRE","NEWHOPE"],"filterList":[{"excludeName":"Jannik"},{"enumField":"JEDI","excludeName":"Jannik"}]}`

	def, rep := astparser.ParseGraphqlDocumentString(schemaUsageInfoTestSchema)
	require.False(t, rep.HasErrors())
	op, rep := astparser.ParseGraphqlDocumentString(operation)
	require.False(t, rep.HasErrors())
	err := asttransform.MergeDefinitionWithBaseSchema(&def)
	if err != nil {
		t.Fatal(err)
	}
	report := &operationreport.Report{}
	norm := astnormalization.NewNormalizer(true, true)
	norm.NormalizeOperation(&op, &def, report)
	valid := astvalidation.DefaultOperationValidator()
	valid.Validate(&op, &def, report)

	dsCfg, err := plan.NewDataSourceConfiguration[any](
		"https://swapi.dev/api",
		&FakeFactory[any]{
			upstreamSchema: &def,
		},
		&plan.DataSourceMetadata{
			RootNodes: []plan.TypeField{
				{
					TypeName:   "Query",
					FieldNames: []string{"searchResults", "hero"},
				},
			},
			ChildNodes: []plan.TypeField{
				{
					TypeName:   "Human",
					FieldNames: []string{"name", "inlineName"},
				},
				{
					TypeName:   "Droid",
					FieldNames: []string{"name"},
				},
				{
					TypeName:   "Starship",
					FieldNames: []string{"length"},
				},
				{
					TypeName:   "SearchResult",
					FieldNames: []string{"__typename"},
				},
				{
					TypeName:   "Character",
					FieldNames: []string{"name", "friends"},
				},
			},
		},
		nil,
	)
	require.NoError(t, err)

	p, err := plan.NewPlanner(plan.Configuration{
		DisableResolveFieldPositions: true,
		DataSources: []plan.DataSource{
			dsCfg,
		},
	})
	require.NoError(t, err)

	generatedPlan := p.Plan(&op, &def, "Search", report)
	if report.HasErrors() {
		t.Fatal(report.Error())
	}

	vars, err := astjson.Parse(variables)
	assert.NoError(t, err)

	inputVariables, err := astjson.ParseBytes(op.Input.Variables)
	assert.NoError(t, err)

	merged, _, err := astjson.MergeValues(vars, inputVariables)
	assert.NoError(t, err)

	fieldUsageInfo := GetTypeFieldUsageInfo(generatedPlan)
	argumentUsageInfo, err := GetArgumentUsageInfo(&op, &def, generatedPlan)
	assert.NoError(t, err)
	inputUsageInfo, err := GetInputUsageInfo(&op, &def, merged, generatedPlan, nil)
	assert.NoError(t, err)

	subscription := &plan.SubscriptionResponsePlan{
		Response: &resolve.GraphQLSubscription{
			Response: generatedPlan.(*plan.SynchronousResponsePlan).Response,
		},
	}

	subscriptionFieldUsageInfo := GetTypeFieldUsageInfo(subscription)
	subscriptionArgumentUsageInfo, err := GetArgumentUsageInfo(&op, &def, subscription)
	assert.NoError(t, err)
	subscriptionInputUsageInfo, err := GetInputUsageInfo(&op, &def, merged, subscription, nil)
	assert.NoError(t, err)

	assert.Equal(t, fieldUsageInfo, subscriptionFieldUsageInfo)
	assert.Equal(t, argumentUsageInfo, subscriptionArgumentUsageInfo)
	assert.Equal(t, inputUsageInfo, subscriptionInputUsageInfo)

	expectedFieldUsageInfo := []*graphqlmetricsv1.TypeFieldUsageInfo{
		{
			TypeNames:   []string{"Query"},
			Path:        []string{"searchResults"},
			NamedType:   "SearchResult",
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
		{
			Path:        []string{"searchResults", "__typename"},
			TypeNames:   []string{"SearchResult"},
			NamedType:   "String",
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
		{
			Path:        []string{"searchResults", "name"},
			TypeNames:   []string{"Human"},
			NamedType:   "String",
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
		{
			Path:        []string{"searchResults", "inlineName"},
			TypeNames:   []string{"Human"},
			NamedType:   "String",
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
		{
			Path:        []string{"searchResults", "name"},
			TypeNames:   []string{"Droid"},
			NamedType:   "String",
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
		{
			Path:        []string{"searchResults", "length"},
			TypeNames:   []string{"Starship"},
			NamedType:   "Float",
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
		{
			TypeNames:   []string{"Query"},
			Path:        []string{"hero"},
			NamedType:   "Character",
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
		{
			TypeNames:   []string{"Character", "Droid", "Human"},
			Path:        []string{"hero", "name"},
			NamedType:   "String",
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
	}

	expectedArgumentUsageInfo := []*graphqlmetricsv1.ArgumentUsageInfo{
		{
			TypeName:    "Query",
			NamedType:   "String",
			Path:        []string{"searchResults", "name"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
		{
			TypeName:    "Query",
			NamedType:   "SearchFilter",
			Path:        []string{"searchResults", "filter"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
		{
			TypeName:    "Query",
			NamedType:   "SearchFilter",
			Path:        []string{"searchResults", "filter2"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
		{
			TypeName:    "Query",
			NamedType:   "Episode",
			Path:        []string{"searchResults", "enumValue"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
		{
			TypeName:    "Query",
			NamedType:   "Episode",
			Path:        []string{"searchResults", "enumList"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
		{
			TypeName:    "Query",
			NamedType:   "Episode",
			Path:        []string{"searchResults", "enumList2"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
		{
			TypeName:    "Query",
			NamedType:   "SearchFilter",
			Path:        []string{"searchResults", "filterList"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
		{
			TypeName:    "Human",
			NamedType:   "String",
			Path:        []string{"inlineName", "name"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
	}

	expectedInputUsageInfo := []graphqlmetricsv1.InputUsageInfo{
		{
			NamedType:   "String",
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
		{
			NamedType:   "Episode",
			TypeName:    "SearchFilter",
			EnumValues:  []string{"NEWHOPE"},
			Path:        []string{"SearchFilter", "enumField"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
		{
			NamedType:   "SearchFilter",
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
		{
			NamedType:   "Episode",
			EnumValues:  []string{"EMPIRE"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
		{
			NamedType:   "Episode",
			EnumValues:  []string{"JEDI", "EMPIRE", "NEWHOPE"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
		{
			NamedType:   "String",
			TypeName:    "SearchFilter",
			Path:        []string{"SearchFilter", "excludeName"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
		{
			NamedType:   "Episode",
			TypeName:    "SearchFilter",
			EnumValues:  []string{"JEDI"},
			Path:        []string{"SearchFilter", "enumField"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
		{
			NamedType:   "Episode",
			EnumValues:  []string{"JEDI", "EMPIRE"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
	}

	assert.Len(t, fieldUsageInfo, len(expectedFieldUsageInfo))
	assert.Len(t, argumentUsageInfo, len(expectedArgumentUsageInfo))
	assert.Len(t, inputUsageInfo, len(expectedInputUsageInfo))
	for i := range expectedFieldUsageInfo {
		assert.JSONEq(t, prettyJSON(t, expectedFieldUsageInfo[i]), prettyJSON(t, fieldUsageInfo[i].IntoGraphQLMetrics()), "fieldUsageInfo[%d]", i)
	}
	for i := range expectedArgumentUsageInfo {
		assert.JSONEq(t, prettyJSON(t, expectedArgumentUsageInfo[i]), prettyJSON(t, argumentUsageInfo[i]), "argumentUsageInfo[%d]", i)
	}
	for i := range expectedInputUsageInfo {
		assert.JSONEq(t, prettyJSON(t, &expectedInputUsageInfo[i]), prettyJSON(t, inputUsageInfo[i]), "inputUsageInfo[%d]", i)
	}
}

func TestGetSchemaUsageInfoInterfaces(t *testing.T) {
	operation := `
		query Search {
			hero {
				... on Human {
					name
					height
				}
			}
		}
`

	def, rep := astparser.ParseGraphqlDocumentString(schemaUsageInfoTestSchema)
	require.False(t, rep.HasErrors())
	op, rep := astparser.ParseGraphqlDocumentString(operation)
	require.False(t, rep.HasErrors())
	err := asttransform.MergeDefinitionWithBaseSchema(&def)
	if err != nil {
		t.Fatal(err)
	}
	report := &operationreport.Report{}
	norm := astnormalization.NewNormalizer(true, true)
	norm.NormalizeOperation(&op, &def, report)
	valid := astvalidation.DefaultOperationValidator()
	valid.Validate(&op, &def, report)

	dsCfg, err := plan.NewDataSourceConfiguration[any](
		"https://swapi.dev/api",
		&FakeFactory[any]{
			upstreamSchema: &def,
		},
		&plan.DataSourceMetadata{
			RootNodes: []plan.TypeField{
				{
					TypeName:   "Query",
					FieldNames: []string{"searchResults", "hero"},
				},
			},
			ChildNodes: []plan.TypeField{
				{
					TypeName:   "Human",
					FieldNames: []string{"name", "inlineName", "height"},
				},
				{
					TypeName:   "Droid",
					FieldNames: []string{"name"},
				},
				{
					TypeName:   "Starship",
					FieldNames: []string{"length"},
				},
				{
					TypeName:   "SearchResult",
					FieldNames: []string{"__typename"},
				},
				{
					TypeName:   "Character",
					FieldNames: []string{"name", "friends"},
				},
			},
		},
		nil,
	)
	require.NoError(t, err)

	p, err := plan.NewPlanner(plan.Configuration{
		DisableResolveFieldPositions: true,
		DataSources: []plan.DataSource{
			dsCfg,
		},
	})
	require.NoError(t, err)

	generatedPlan := p.Plan(&op, &def, "Search", report)
	if report.HasErrors() {
		t.Fatal(report.Error())
	}

	fieldUsageInfo := GetTypeFieldUsageInfo(generatedPlan)
	argumentUsageInfo, err := GetArgumentUsageInfo(&op, &def, generatedPlan)
	assert.NoError(t, err)
	inputUsageInfo, err := GetInputUsageInfo(&op, &def, astjson.MustParse(`{}`), generatedPlan, nil)
	assert.NoError(t, err)

	subscription := &plan.SubscriptionResponsePlan{
		Response: &resolve.GraphQLSubscription{
			Response: generatedPlan.(*plan.SynchronousResponsePlan).Response,
		},
	}

	subscriptionFieldUsageInfo := GetTypeFieldUsageInfo(subscription)
	subscriptionArgumentUsageInfo, err := GetArgumentUsageInfo(&op, &def, subscription)
	assert.NoError(t, err)
	subscriptionInputUsageInfo, err := GetInputUsageInfo(&op, &def, astjson.MustParse(`{}`), subscription, nil)
	assert.NoError(t, err)

	assert.Equal(t, fieldUsageInfo, subscriptionFieldUsageInfo)
	assert.Equal(t, argumentUsageInfo, subscriptionArgumentUsageInfo)
	assert.Equal(t, inputUsageInfo, subscriptionInputUsageInfo)

	expectedFieldUsageInfo := []*graphqlmetricsv1.TypeFieldUsageInfo{
		{
			TypeNames:   []string{"Query"},
			Path:        []string{"hero"},
			NamedType:   "Character",
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
		{
			TypeNames:   []string{"Human"},
			Path:        []string{"hero", "name"},
			NamedType:   "String",
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
		{
			TypeNames:              []string{"Character"},
			Path:                   []string{"hero", "name"},
			NamedType:              "String",
			SubgraphIDs:            []string{"https://swapi.dev/api"},
			IndirectInterfaceField: true,
		},
		{
			TypeNames:   []string{"Human"},
			Path:        []string{"hero", "height"},
			NamedType:   "String",
			SubgraphIDs: []string{"https://swapi.dev/api"},
		},
	}

	assert.Len(t, fieldUsageInfo, len(expectedFieldUsageInfo))
	for i := range expectedFieldUsageInfo {
		assert.Equal(t, prettyJSON(t, expectedFieldUsageInfo[i]), prettyJSON(t, fieldUsageInfo[i].IntoGraphQLMetrics()), "fieldUsageInfo[%d]", i)
	}
}

// TestInputUsageWithNullVariables verifies that null variable values are not tracked as schema usage
func TestInputUsageWithNullVariables(t *testing.T) {
	schema := `
		schema {
			query: Query
		}
		
		type Query {
			findEmployees(criteria: EmployeeSearchInput): [Employee!]!
		}
		
		type Employee {
			id: ID!
		}
		
		input EmployeeSearchInput {
			hasPets: Boolean
			department: String
		}
	`

	operation := `
		query FindEmployees($criteria: EmployeeSearchInput) {
			findEmployees(criteria: $criteria) {
				id
			}
		}
	`

	// Test with null value
	variables := `{"criteria": null}`

	def, rep := astparser.ParseGraphqlDocumentString(schema)
	require.False(t, rep.HasErrors())
	op, rep := astparser.ParseGraphqlDocumentString(operation)
	require.False(t, rep.HasErrors())
	err := asttransform.MergeDefinitionWithBaseSchema(&def)
	require.NoError(t, err)

	report := &operationreport.Report{}
	norm := astnormalization.NewNormalizer(true, true)
	norm.NormalizeOperation(&op, &def, report)
	require.False(t, report.HasErrors())

	valid := astvalidation.DefaultOperationValidator()
	valid.Validate(&op, &def, report)
	require.False(t, report.HasErrors())

	dsCfg, err := plan.NewDataSourceConfiguration[any](
		"employees-subgraph",
		&FakeFactory[any]{upstreamSchema: &def},
		&plan.DataSourceMetadata{
			RootNodes: []plan.TypeField{
				{TypeName: "Query", FieldNames: []string{"findEmployees"}},
			},
			ChildNodes: []plan.TypeField{
				{TypeName: "Employee", FieldNames: []string{"id"}},
			},
		},
		nil,
	)
	require.NoError(t, err)

	planner, err := plan.NewPlanner(plan.Configuration{
		DisableResolveFieldPositions: true,
		DataSources:                  []plan.DataSource{dsCfg},
	})
	require.NoError(t, err)

	generatedPlan := planner.Plan(&op, &def, "FindEmployees", report)
	require.False(t, report.HasErrors())

	vars, err := astjson.Parse(variables)
	require.NoError(t, err)

	inputUsageInfo, err := GetInputUsageInfo(&op, &def, vars, generatedPlan, nil)
	require.NoError(t, err)

	// Should be empty because the variable value is null
	assert.Empty(t, inputUsageInfo, "Null variable values should not be tracked as usage")
}

// TestInputUsageWithPartialNullFields verifies that null fields within input objects are not tracked
func TestInputUsageWithPartialNullFields(t *testing.T) {
	schema := `
		schema {
			query: Query
		}
		
		type Query {
			findEmployees(criteria: EmployeeSearchInput): [Employee!]!
		}
		
		type Employee {
			id: ID!
		}
		
		input EmployeeSearchInput {
			hasPets: Boolean
			department: String
			minAge: Int
		}
	`

	operation := `
		query FindEmployees($criteria: EmployeeSearchInput) {
			findEmployees(criteria: $criteria) {
				id
			}
		}
	`

	// Test with some null fields - only hasPets should be tracked, not department or minAge
	variables := `{"criteria": {"hasPets": true, "department": null, "minAge": null}}`

	def, rep := astparser.ParseGraphqlDocumentString(schema)
	require.False(t, rep.HasErrors())
	op, rep := astparser.ParseGraphqlDocumentString(operation)
	require.False(t, rep.HasErrors())
	err := asttransform.MergeDefinitionWithBaseSchema(&def)
	require.NoError(t, err)

	report := &operationreport.Report{}
	norm := astnormalization.NewNormalizer(true, true)
	norm.NormalizeOperation(&op, &def, report)
	require.False(t, report.HasErrors())

	valid := astvalidation.DefaultOperationValidator()
	valid.Validate(&op, &def, report)
	require.False(t, report.HasErrors())

	dsCfg, err := plan.NewDataSourceConfiguration[any](
		"employees-subgraph",
		&FakeFactory[any]{upstreamSchema: &def},
		&plan.DataSourceMetadata{
			RootNodes: []plan.TypeField{
				{TypeName: "Query", FieldNames: []string{"findEmployees"}},
			},
			ChildNodes: []plan.TypeField{
				{TypeName: "Employee", FieldNames: []string{"id"}},
			},
		},
		nil,
	)
	require.NoError(t, err)

	planner, err := plan.NewPlanner(plan.Configuration{
		DisableResolveFieldPositions: true,
		DataSources:                  []plan.DataSource{dsCfg},
	})
	require.NoError(t, err)

	generatedPlan := planner.Plan(&op, &def, "FindEmployees", report)
	require.False(t, report.HasErrors())

	vars, err := astjson.Parse(variables)
	require.NoError(t, err)

	inputUsageInfo, err := GetInputUsageInfo(&op, &def, vars, generatedPlan, nil)
	require.NoError(t, err)

	// Should only track the input type and hasPets field, not the null fields
	expectedUsage := []graphqlmetricsv1.InputUsageInfo{
		{
			NamedType:   "Boolean",
			TypeName:    "EmployeeSearchInput",
			Path:        []string{"EmployeeSearchInput", "hasPets"},
			SubgraphIDs: []string{"employees-subgraph"},
		},
		{
			NamedType:   "EmployeeSearchInput",
			SubgraphIDs: []string{"employees-subgraph"},
		},
	}

	assert.Len(t, inputUsageInfo, len(expectedUsage), "Should only track non-null fields")
	for i := range expectedUsage {
		assert.JSONEq(t, prettyJSON(t, &expectedUsage[i]), prettyJSON(t, inputUsageInfo[i]), "inputUsageInfo[%d]", i)
	}
}

// TestInputScalarFieldsInVariables specifically tests that scalar fields inside input objects
// are tracked when passed as variables (not inline)
func TestInputScalarFieldsInVariables(t *testing.T) {
	// Create a simple schema with input type containing scalar fields
	schema := `
		schema {
			query: Query
		}
		
		type Query {
			findEmployees(criteria: EmployeeSearchInput!): [Employee!]!
		}
		
		type Employee {
			id: ID!
		}
		
		input EmployeeSearchInput {
			hasPets: Boolean!
			minAge: Int
			department: String
		}
	`

	operation := `
		query FindEmployeesWithVariable($criteria: EmployeeSearchInput!) {
			findEmployees(criteria: $criteria) {
				id
			}
		}
	`

	variables := `{"criteria": {"hasPets": true, "minAge": 25, "department": "Engineering"}}`

	def, rep := astparser.ParseGraphqlDocumentString(schema)
	require.False(t, rep.HasErrors())
	op, rep := astparser.ParseGraphqlDocumentString(operation)
	require.False(t, rep.HasErrors())
	err := asttransform.MergeDefinitionWithBaseSchema(&def)
	require.NoError(t, err)

	report := &operationreport.Report{}
	norm := astnormalization.NewNormalizer(true, true)
	norm.NormalizeOperation(&op, &def, report)
	require.False(t, report.HasErrors())

	valid := astvalidation.DefaultOperationValidator()
	valid.Validate(&op, &def, report)
	require.False(t, report.HasErrors())

	dsCfg, err := plan.NewDataSourceConfiguration[any](
		"employees-subgraph",
		&FakeFactory[any]{upstreamSchema: &def},
		&plan.DataSourceMetadata{
			RootNodes: []plan.TypeField{
				{TypeName: "Query", FieldNames: []string{"findEmployees"}},
			},
			ChildNodes: []plan.TypeField{
				{TypeName: "Employee", FieldNames: []string{"id"}},
			},
		},
		nil,
	)
	require.NoError(t, err)

	planner, err := plan.NewPlanner(plan.Configuration{
		DisableResolveFieldPositions: true,
		DataSources:                  []plan.DataSource{dsCfg},
	})
	require.NoError(t, err)

	generatedPlan := planner.Plan(&op, &def, "FindEmployeesWithVariable", report)
	require.False(t, report.HasErrors())

	vars, err := astjson.Parse(variables)
	require.NoError(t, err)

	inputUsageInfo, err := GetInputUsageInfo(&op, &def, vars, generatedPlan, nil)
	require.NoError(t, err)

	expectedInputUsageInfo := []graphqlmetricsv1.InputUsageInfo{
		{
			NamedType:   "Boolean",
			TypeName:    "EmployeeSearchInput",
			Path:        []string{"EmployeeSearchInput", "hasPets"},
			SubgraphIDs: []string{"employees-subgraph"},
		},
		{
			NamedType:   "Int",
			TypeName:    "EmployeeSearchInput",
			Path:        []string{"EmployeeSearchInput", "minAge"},
			SubgraphIDs: []string{"employees-subgraph"},
		},
		{
			NamedType:   "String",
			TypeName:    "EmployeeSearchInput",
			Path:        []string{"EmployeeSearchInput", "department"},
			SubgraphIDs: []string{"employees-subgraph"},
		},
		{
			NamedType:   "EmployeeSearchInput",
			SubgraphIDs: []string{"employees-subgraph"},
		},
	}

	assert.Len(t, inputUsageInfo, len(expectedInputUsageInfo))
	for i := range expectedInputUsageInfo {
		assert.JSONEq(t, prettyJSON(t, &expectedInputUsageInfo[i]), prettyJSON(t, inputUsageInfo[i]), "inputUsageInfo[%d]", i)
	}
}

// TestInputNestedScalarFields tests that scalar fields inside nested input objects
// are tracked correctly with proper paths and subgraph IDs
func TestInputNestedScalarFields(t *testing.T) {
	schema := `
		schema {
			query: Query
		}
		
		type Query {
			search(filter: SearchFilter!): [Result!]!
		}
		
		type Result {
			id: ID!
		}
		
		input SearchFilter {
			name: String
			criteria: SearchCriteria
			tags: [String]
		}
		
		input SearchCriteria {
			minScore: Int!
			maxScore: Int
			isActive: Boolean
			nested: NestedCriteria
		}
		
		input NestedCriteria {
			value: String!
		}
	`

	operation := `
		query SearchQuery($filter: SearchFilter!) {
			search(filter: $filter) {
				id
			}
		}
	`

	variables := `{
		"filter": {
			"name": "test",
			"criteria": {
				"minScore": 10,
				"maxScore": 100,
				"isActive": true,
				"nested": {
					"value": "deep"
				}
			},
			"tags": ["tag1", "tag2"]
		}
	}`

	def, rep := astparser.ParseGraphqlDocumentString(schema)
	require.False(t, rep.HasErrors())
	op, rep := astparser.ParseGraphqlDocumentString(operation)
	require.False(t, rep.HasErrors())
	err := asttransform.MergeDefinitionWithBaseSchema(&def)
	require.NoError(t, err)

	report := &operationreport.Report{}
	norm := astnormalization.NewNormalizer(true, true)
	norm.NormalizeOperation(&op, &def, report)
	require.False(t, report.HasErrors())

	valid := astvalidation.DefaultOperationValidator()
	valid.Validate(&op, &def, report)
	require.False(t, report.HasErrors())

	dsCfg, err := plan.NewDataSourceConfiguration[any](
		"search-subgraph",
		&FakeFactory[any]{upstreamSchema: &def},
		&plan.DataSourceMetadata{
			RootNodes: []plan.TypeField{
				{TypeName: "Query", FieldNames: []string{"search"}},
			},
			ChildNodes: []plan.TypeField{
				{TypeName: "Result", FieldNames: []string{"id"}},
			},
		},
		nil,
	)
	require.NoError(t, err)

	planner, err := plan.NewPlanner(plan.Configuration{
		DisableResolveFieldPositions: true,
		DataSources:                  []plan.DataSource{dsCfg},
	})
	require.NoError(t, err)

	generatedPlan := planner.Plan(&op, &def, "SearchQuery", report)
	require.False(t, report.HasErrors())

	vars, err := astjson.Parse(variables)
	require.NoError(t, err)

	inputUsageInfo, err := GetInputUsageInfo(&op, &def, vars, generatedPlan, nil)
	require.NoError(t, err)

	expectedInputUsageInfo := []graphqlmetricsv1.InputUsageInfo{
		{
			NamedType:   "String",
			TypeName:    "SearchFilter",
			Path:        []string{"SearchFilter", "name"},
			SubgraphIDs: []string{"search-subgraph"},
		},
		{
			NamedType:   "Int",
			TypeName:    "SearchCriteria",
			Path:        []string{"SearchCriteria", "minScore"},
			SubgraphIDs: []string{"search-subgraph"},
		},
		{
			NamedType:   "Int",
			TypeName:    "SearchCriteria",
			Path:        []string{"SearchCriteria", "maxScore"},
			SubgraphIDs: []string{"search-subgraph"},
		},
		{
			NamedType:   "Boolean",
			TypeName:    "SearchCriteria",
			Path:        []string{"SearchCriteria", "isActive"},
			SubgraphIDs: []string{"search-subgraph"},
		},
		{
			NamedType:   "String",
			TypeName:    "NestedCriteria",
			Path:        []string{"NestedCriteria", "value"},
			SubgraphIDs: []string{"search-subgraph"},
		},
		{
			NamedType:   "NestedCriteria",
			TypeName:    "SearchCriteria",
			Path:        []string{"SearchCriteria", "nested"},
			SubgraphIDs: []string{"search-subgraph"},
		},
		{
			NamedType:   "SearchCriteria",
			TypeName:    "SearchFilter",
			Path:        []string{"SearchFilter", "criteria"},
			SubgraphIDs: []string{"search-subgraph"},
		},
		{
			NamedType:   "String",
			TypeName:    "SearchFilter",
			Path:        []string{"SearchFilter", "tags"},
			SubgraphIDs: []string{"search-subgraph"},
		},
		{
			NamedType:   "SearchFilter",
			SubgraphIDs: []string{"search-subgraph"},
		},
	}

	assert.Len(t, inputUsageInfo, len(expectedInputUsageInfo))
	for i := range expectedInputUsageInfo {
		assert.JSONEq(t, prettyJSON(t, &expectedInputUsageInfo[i]), prettyJSON(t, inputUsageInfo[i]), "inputUsageInfo[%d]", i)
	}
}

// TestMultipleSubgraphs tests that SubgraphIDs are correctly extracted when
// fields, arguments, and inputs come from different subgraphs
func TestMultipleSubgraphs(t *testing.T) {
	schema := `
		schema {
			query: Query
		}
		
		type Query {
			user(id: ID!): User
			product(filter: ProductFilter!): Product
		}
		
		type User {
			id: ID!
			name: String!
			orders: [Order!]!
		}
		
		type Order {
			id: ID!
			total: Float!
		}
		
		type Product {
			id: ID!
			name: String!
			price: Float!
		}
		
		input ProductFilter {
			minPrice: Float
			maxPrice: Float
			category: String
		}
	`

	operation := `
		query GetData($userId: ID!, $productFilter: ProductFilter!) {
			user(id: $userId) {
				id
				name
				orders {
					id
					total
				}
			}
			product(filter: $productFilter) {
				id
				name
				price
			}
		}
	`

	variables := `{
		"userId": "123",
		"productFilter": {
			"minPrice": 10.0,
			"maxPrice": 100.0,
			"category": "electronics"
		}
	}`

	def, rep := astparser.ParseGraphqlDocumentString(schema)
	require.False(t, rep.HasErrors())
	op, rep := astparser.ParseGraphqlDocumentString(operation)
	require.False(t, rep.HasErrors())
	err := asttransform.MergeDefinitionWithBaseSchema(&def)
	require.NoError(t, err)

	report := &operationreport.Report{}
	norm := astnormalization.NewNormalizer(true, true)
	norm.NormalizeOperation(&op, &def, report)
	require.False(t, report.HasErrors())

	valid := astvalidation.DefaultOperationValidator()
	valid.Validate(&op, &def, report)
	require.False(t, report.HasErrors())

	// Create multiple subgraphs - users and products come from different sources
	usersSubgraph, err := plan.NewDataSourceConfiguration[any](
		"users-subgraph",
		&FakeFactory[any]{upstreamSchema: &def},
		&plan.DataSourceMetadata{
			RootNodes: []plan.TypeField{
				{TypeName: "Query", FieldNames: []string{"user"}},
			},
			ChildNodes: []plan.TypeField{
				{TypeName: "User", FieldNames: []string{"id", "name", "orders"}},
				{TypeName: "Order", FieldNames: []string{"id", "total"}},
			},
		},
		nil,
	)
	require.NoError(t, err)

	productsSubgraph, err := plan.NewDataSourceConfiguration[any](
		"products-subgraph",
		&FakeFactory[any]{upstreamSchema: &def},
		&plan.DataSourceMetadata{
			RootNodes: []plan.TypeField{
				{TypeName: "Query", FieldNames: []string{"product"}},
			},
			ChildNodes: []plan.TypeField{
				{TypeName: "Product", FieldNames: []string{"id", "name", "price"}},
			},
		},
		nil,
	)
	require.NoError(t, err)

	planner, err := plan.NewPlanner(plan.Configuration{
		DisableResolveFieldPositions: true,
		DataSources:                  []plan.DataSource{usersSubgraph, productsSubgraph},
	})
	require.NoError(t, err)

	generatedPlan := planner.Plan(&op, &def, "GetData", report)
	require.False(t, report.HasErrors())

	vars, err := astjson.Parse(variables)
	require.NoError(t, err)

	fieldUsageInfo := GetTypeFieldUsageInfo(generatedPlan)
	argumentUsageInfo, err := GetArgumentUsageInfo(&op, &def, generatedPlan)
	require.NoError(t, err)
	inputUsageInfo, err := GetInputUsageInfo(&op, &def, vars, generatedPlan, nil)
	require.NoError(t, err)

	// Verify field usage - fields should be attributed to the correct subgraph
	expectedFieldUsageInfo := []*graphqlmetricsv1.TypeFieldUsageInfo{
		{
			TypeNames:   []string{"Query"},
			Path:        []string{"user"},
			NamedType:   "User",
			SubgraphIDs: []string{"users-subgraph"},
		},
		{
			TypeNames:   []string{"User"},
			Path:        []string{"user", "id"},
			NamedType:   "ID",
			SubgraphIDs: []string{"users-subgraph"},
		},
		{
			TypeNames:   []string{"User"},
			Path:        []string{"user", "name"},
			NamedType:   "String",
			SubgraphIDs: []string{"users-subgraph"},
		},
		{
			TypeNames:   []string{"User"},
			Path:        []string{"user", "orders"},
			NamedType:   "Order",
			SubgraphIDs: []string{"users-subgraph"},
		},
		{
			TypeNames:   []string{"Order"},
			Path:        []string{"user", "orders", "id"},
			NamedType:   "ID",
			SubgraphIDs: []string{"users-subgraph"},
		},
		{
			TypeNames:   []string{"Order"},
			Path:        []string{"user", "orders", "total"},
			NamedType:   "Float",
			SubgraphIDs: []string{"users-subgraph"},
		},
		{
			TypeNames:   []string{"Query"},
			Path:        []string{"product"},
			NamedType:   "Product",
			SubgraphIDs: []string{"products-subgraph"},
		},
		{
			TypeNames:   []string{"Product"},
			Path:        []string{"product", "id"},
			NamedType:   "ID",
			SubgraphIDs: []string{"products-subgraph"},
		},
		{
			TypeNames:   []string{"Product"},
			Path:        []string{"product", "name"},
			NamedType:   "String",
			SubgraphIDs: []string{"products-subgraph"},
		},
		{
			TypeNames:   []string{"Product"},
			Path:        []string{"product", "price"},
			NamedType:   "Float",
			SubgraphIDs: []string{"products-subgraph"},
		},
	}

	// Verify argument usage - arguments should be attributed to the correct subgraph
	expectedArgumentUsageInfo := []*graphqlmetricsv1.ArgumentUsageInfo{
		{
			TypeName:    "Query",
			NamedType:   "ID",
			Path:        []string{"user", "id"},
			SubgraphIDs: []string{"users-subgraph"},
		},
		{
			TypeName:    "Query",
			NamedType:   "ProductFilter",
			Path:        []string{"product", "filter"},
			SubgraphIDs: []string{"products-subgraph"},
		},
	}

	// Verify input usage - inputs should be attributed to the correct subgraph
	expectedInputUsageInfo := []graphqlmetricsv1.InputUsageInfo{
		{
			NamedType:   "ID",
			SubgraphIDs: []string{"users-subgraph"},
		},
		{
			NamedType:   "Float",
			TypeName:    "ProductFilter",
			Path:        []string{"ProductFilter", "minPrice"},
			SubgraphIDs: []string{"products-subgraph"},
		},
		{
			NamedType:   "Float",
			TypeName:    "ProductFilter",
			Path:        []string{"ProductFilter", "maxPrice"},
			SubgraphIDs: []string{"products-subgraph"},
		},
		{
			NamedType:   "String",
			TypeName:    "ProductFilter",
			Path:        []string{"ProductFilter", "category"},
			SubgraphIDs: []string{"products-subgraph"},
		},
		{
			NamedType:   "ProductFilter",
			SubgraphIDs: []string{"products-subgraph"},
		},
	}

	// Assert all expectations
	assert.Len(t, fieldUsageInfo, len(expectedFieldUsageInfo))
	for i := range expectedFieldUsageInfo {
		assert.JSONEq(t, prettyJSON(t, expectedFieldUsageInfo[i]), prettyJSON(t, fieldUsageInfo[i].IntoGraphQLMetrics()), "fieldUsageInfo[%d]", i)
	}

	assert.Len(t, argumentUsageInfo, len(expectedArgumentUsageInfo))
	for i := range expectedArgumentUsageInfo {
		assert.JSONEq(t, prettyJSON(t, expectedArgumentUsageInfo[i]), prettyJSON(t, argumentUsageInfo[i]), "argumentUsageInfo[%d]", i)
	}

	assert.Len(t, inputUsageInfo, len(expectedInputUsageInfo))
	for i := range expectedInputUsageInfo {
		assert.JSONEq(t, prettyJSON(t, &expectedInputUsageInfo[i]), prettyJSON(t, inputUsageInfo[i]), "inputUsageInfo[%d]", i)
	}

	// Additionally, verify that no field is wrongly attributed to the wrong subgraph
	for _, info := range fieldUsageInfo {
		if len(info.Path) > 0 {
			firstPath := info.Path[0]
			if firstPath == "user" {
				assert.Equal(t, []string{"users-subgraph"}, info.SubgraphIDs, "user fields should only reference users-subgraph")
			} else if firstPath == "product" {
				assert.Equal(t, []string{"products-subgraph"}, info.SubgraphIDs, "product fields should only reference products-subgraph")
			}
		}
	}

	// Verify arguments are attributed correctly
	for _, info := range argumentUsageInfo {
		if len(info.Path) > 0 {
			firstPath := info.Path[0]
			if firstPath == "user" {
				assert.Equal(t, []string{"users-subgraph"}, info.SubgraphIDs, "user arguments should reference users-subgraph")
			} else if firstPath == "product" {
				assert.Equal(t, []string{"products-subgraph"}, info.SubgraphIDs, "product arguments should reference products-subgraph")
			}
		}
	}
}

func prettyJSON(t *testing.T, v interface{}) string {
	b, err := json.MarshalIndent(v, "", "  ")
	require.NoError(t, err)
	return string(b)
}

type StatefulSource struct {
}

func (s *StatefulSource) Start() {

}

type FakeFactory[T any] struct {
	upstreamSchema *ast.Document
}

func (f *FakeFactory[T]) UpstreamSchema(_ plan.DataSourceConfiguration[T]) (*ast.Document, bool) {
	return f.upstreamSchema, true
}

func (f *FakeFactory[T]) PlanningBehavior() plan.DataSourcePlanningBehavior {
	return plan.DataSourcePlanningBehavior{}
}

func (f *FakeFactory[T]) Planner(_ abstractlogger.Logger) plan.DataSourcePlanner[T] {
	source := &StatefulSource{}
	go source.Start()
	return &FakePlanner[T]{
		source:         source,
		upstreamSchema: f.upstreamSchema,
	}
}

func (f *FakeFactory[T]) Context() context.Context {
	return context.TODO()
}

type FakePlanner[T any] struct {
	id             int
	source         *StatefulSource
	upstreamSchema *ast.Document
}

func (f *FakePlanner[T]) ID() int {
	return f.id
}

func (f *FakePlanner[T]) SetID(id int) {
	f.id = id
}

func (f *FakePlanner[T]) UpstreamSchema(_ plan.DataSourceConfiguration[T]) (*ast.Document, bool) {
	return f.upstreamSchema, true
}

func (f *FakePlanner[T]) EnterDocument(_, _ *ast.Document) {

}

func (f *FakePlanner[T]) Register(visitor *plan.Visitor, _ plan.DataSourceConfiguration[T], _ plan.DataSourcePlannerConfiguration) error {
	visitor.Walker.RegisterEnterDocumentVisitor(f)
	return nil
}

func (f *FakePlanner[T]) ConfigureFetch() resolve.FetchConfiguration {
	return resolve.FetchConfiguration{
		DataSource: &FakeDataSource{
			source: f.source,
		},
	}
}

func (f *FakePlanner[T]) ConfigureSubscription() plan.SubscriptionConfiguration {
	return plan.SubscriptionConfiguration{}
}

func (f *FakePlanner[T]) DownstreamResponseFieldAlias(_ int) (alias string, exists bool) {
	return
}

type FakeDataSource struct {
	source *StatefulSource
}

func (f *FakeDataSource) Load(ctx context.Context, input []byte, out *bytes.Buffer) (err error) {
	return
}

func (f *FakeDataSource) LoadWithFiles(ctx context.Context, input []byte, files []*httpclient.FileUpload, out *bytes.Buffer) (err error) {
	return
}
