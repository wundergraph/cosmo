package graphqlschemausage

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
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
	argumentUsageInfo, err := GetArgumentUsageInfo(&op, &def, merged, generatedPlan, nil)
	assert.NoError(t, err)
	inputUsageInfo, err := GetInputUsageInfo(&op, &def, merged, generatedPlan, nil)
	assert.NoError(t, err)

	subscription := &plan.SubscriptionResponsePlan{
		Response: &resolve.GraphQLSubscription{
			Response: generatedPlan.(*plan.SynchronousResponsePlan).Response,
		},
	}

	subscriptionFieldUsageInfo := GetTypeFieldUsageInfo(subscription)
	subscriptionArgumentUsageInfo, err := GetArgumentUsageInfo(&op, &def, merged, subscription, nil)
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
			IsNull:      false,
		},
		{
			TypeName:    "Query",
			NamedType:   "SearchFilter",
			Path:        []string{"searchResults", "filter"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
			IsNull:      false,
		},
		{
			TypeName:    "Query",
			NamedType:   "SearchFilter",
			Path:        []string{"searchResults", "filter2"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
			IsNull:      false,
		},
		{
			TypeName:    "Query",
			NamedType:   "Episode",
			Path:        []string{"searchResults", "enumValue"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
			IsNull:      false,
		},
		{
			TypeName:    "Query",
			NamedType:   "Episode",
			Path:        []string{"searchResults", "enumList"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
			IsNull:      false,
		},
		{
			TypeName:    "Query",
			NamedType:   "Episode",
			Path:        []string{"searchResults", "enumList2"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
			IsNull:      false,
		},
		{
			TypeName:    "Query",
			NamedType:   "SearchFilter",
			Path:        []string{"searchResults", "filterList"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
			IsNull:      false,
		},
		{
			TypeName:    "Human",
			NamedType:   "String",
			Path:        []string{"inlineName", "name"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
			IsNull:      false,
		},
	}

	expectedInputUsageInfo := []graphqlmetricsv1.InputUsageInfo{
		{
			NamedType:   "String",
			Path:        []string{"String"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
			IsNull:      false,
		},
		{
			NamedType:   "Episode",
			TypeName:    "SearchFilter",
			EnumValues:  []string{"NEWHOPE"},
			Path:        []string{"SearchFilter", "enumField"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
			IsNull:      false,
		},
		{
			// filter2 has enumField but excludeName is implicitly null
			NamedType:   "String",
			TypeName:    "SearchFilter",
			Path:        []string{"SearchFilter", "excludeName"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
			IsNull:      true,
		},
		{
			NamedType:   "SearchFilter",
			Path:        []string{"SearchFilter"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
			IsNull:      false,
		},
		{
			NamedType:   "Episode",
			Path:        []string{"Episode"},
			EnumValues:  []string{"EMPIRE"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
			IsNull:      false,
		},
		{
			NamedType:   "Episode",
			Path:        []string{"Episode"},
			EnumValues:  []string{"JEDI", "EMPIRE", "NEWHOPE"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
			IsNull:      false,
		},
		{
			NamedType:   "String",
			TypeName:    "SearchFilter",
			Path:        []string{"SearchFilter", "excludeName"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
			IsNull:      false,
		},
		{
			// filterList[0] has excludeName but enumField is implicitly null
			NamedType:   "Episode",
			TypeName:    "SearchFilter",
			Path:        []string{"SearchFilter", "enumField"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
			IsNull:      true,
		},
		{
			NamedType:   "Episode",
			TypeName:    "SearchFilter",
			EnumValues:  []string{"JEDI"},
			Path:        []string{"SearchFilter", "enumField"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
			IsNull:      false,
		},
		{
			NamedType:   "Episode",
			Path:        []string{"Episode"},
			EnumValues:  []string{"JEDI", "EMPIRE"},
			SubgraphIDs: []string{"https://swapi.dev/api"},
			IsNull:      false,
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
	argumentUsageInfo, err := GetArgumentUsageInfo(&op, &def, astjson.MustParse(`{}`), generatedPlan, nil)
	assert.NoError(t, err)
	inputUsageInfo, err := GetInputUsageInfo(&op, &def, astjson.MustParse(`{}`), generatedPlan, nil)
	assert.NoError(t, err)

	subscription := &plan.SubscriptionResponsePlan{
		Response: &resolve.GraphQLSubscription{
			Response: generatedPlan.(*plan.SynchronousResponsePlan).Response,
		},
	}

	subscriptionFieldUsageInfo := GetTypeFieldUsageInfo(subscription)
	subscriptionArgumentUsageInfo, err := GetArgumentUsageInfo(&op, &def, astjson.MustParse(`{}`), subscription, nil)
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

// TestInputUsageWithNullVariables verifies that null variable values are tracked with IsNull flag
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

	// Should track null value with IsNull flag set to true
	expectedUsage := []graphqlmetricsv1.InputUsageInfo{
		{
			NamedType:   "EmployeeSearchInput",
			Path:        []string{"EmployeeSearchInput"},
			SubgraphIDs: []string{"employees-subgraph"},
			IsNull:      true,
		},
	}

	assert.Len(t, inputUsageInfo, len(expectedUsage), "Null variable values should be tracked with IsNull=true")
	for i := range expectedUsage {
		assert.JSONEq(t, prettyJSON(t, &expectedUsage[i]), prettyJSON(t, inputUsageInfo[i]), "inputUsageInfo[%d]", i)
	}
}

// TestInputUsageWithPartialNullFields verifies that null fields within input objects are tracked with IsNull flag
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

	// Should track the input type, hasPets field, and null fields with IsNull flag
	expectedUsage := []graphqlmetricsv1.InputUsageInfo{
		{
			NamedType:   "Boolean",
			TypeName:    "EmployeeSearchInput",
			Path:        []string{"EmployeeSearchInput", "hasPets"},
			SubgraphIDs: []string{"employees-subgraph"},
			IsNull:      false,
		},
		{
			NamedType:   "String",
			TypeName:    "EmployeeSearchInput",
			Path:        []string{"EmployeeSearchInput", "department"},
			SubgraphIDs: []string{"employees-subgraph"},
			IsNull:      true,
		},
		{
			NamedType:   "Int",
			TypeName:    "EmployeeSearchInput",
			Path:        []string{"EmployeeSearchInput", "minAge"},
			SubgraphIDs: []string{"employees-subgraph"},
			IsNull:      true,
		},
		{
			NamedType:   "EmployeeSearchInput",
			Path:        []string{"EmployeeSearchInput"},
			SubgraphIDs: []string{"employees-subgraph"},
			IsNull:      false,
		},
	}

	assert.Len(t, inputUsageInfo, len(expectedUsage), "Should track all fields including null ones")
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
			IsNull:      false,
		},
		{
			NamedType:   "Int",
			TypeName:    "EmployeeSearchInput",
			Path:        []string{"EmployeeSearchInput", "minAge"},
			SubgraphIDs: []string{"employees-subgraph"},
			IsNull:      false,
		},
		{
			NamedType:   "String",
			TypeName:    "EmployeeSearchInput",
			Path:        []string{"EmployeeSearchInput", "department"},
			SubgraphIDs: []string{"employees-subgraph"},
			IsNull:      false,
		},
		{
			NamedType:   "EmployeeSearchInput",
			Path:        []string{"EmployeeSearchInput"},
			SubgraphIDs: []string{"employees-subgraph"},
			IsNull:      false,
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
			IsNull:      false,
		},
		{
			NamedType:   "Int",
			TypeName:    "SearchCriteria",
			Path:        []string{"SearchCriteria", "minScore"},
			SubgraphIDs: []string{"search-subgraph"},
			IsNull:      false,
		},
		{
			NamedType:   "Int",
			TypeName:    "SearchCriteria",
			Path:        []string{"SearchCriteria", "maxScore"},
			SubgraphIDs: []string{"search-subgraph"},
			IsNull:      false,
		},
		{
			NamedType:   "Boolean",
			TypeName:    "SearchCriteria",
			Path:        []string{"SearchCriteria", "isActive"},
			SubgraphIDs: []string{"search-subgraph"},
			IsNull:      false,
		},
		{
			NamedType:   "String",
			TypeName:    "NestedCriteria",
			Path:        []string{"NestedCriteria", "value"},
			SubgraphIDs: []string{"search-subgraph"},
			IsNull:      false,
		},
		{
			NamedType:   "NestedCriteria",
			TypeName:    "SearchCriteria",
			Path:        []string{"SearchCriteria", "nested"},
			SubgraphIDs: []string{"search-subgraph"},
			IsNull:      false,
		},
		{
			NamedType:   "SearchCriteria",
			TypeName:    "SearchFilter",
			Path:        []string{"SearchFilter", "criteria"},
			SubgraphIDs: []string{"search-subgraph"},
			IsNull:      false,
		},
		{
			NamedType:   "String",
			TypeName:    "SearchFilter",
			Path:        []string{"SearchFilter", "tags"},
			SubgraphIDs: []string{"search-subgraph"},
			IsNull:      false,
		},
		{
			NamedType:   "SearchFilter",
			Path:        []string{"SearchFilter"},
			SubgraphIDs: []string{"search-subgraph"},
			IsNull:      false,
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
	argumentUsageInfo, err := GetArgumentUsageInfo(&op, &def, vars, generatedPlan, nil)
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
			IsNull:      false,
		},
		{
			TypeName:    "Query",
			NamedType:   "ProductFilter",
			Path:        []string{"product", "filter"},
			SubgraphIDs: []string{"products-subgraph"},
			IsNull:      false,
		},
	}

	// Verify input usage - inputs should be attributed to the correct subgraph
	expectedInputUsageInfo := []graphqlmetricsv1.InputUsageInfo{
		{
			NamedType:   "ID",
			Path:        []string{"ID"},
			SubgraphIDs: []string{"users-subgraph"},
			IsNull:      false,
		},
		{
			NamedType:   "Float",
			TypeName:    "ProductFilter",
			Path:        []string{"ProductFilter", "minPrice"},
			SubgraphIDs: []string{"products-subgraph"},
			IsNull:      false,
		},
		{
			NamedType:   "Float",
			TypeName:    "ProductFilter",
			Path:        []string{"ProductFilter", "maxPrice"},
			SubgraphIDs: []string{"products-subgraph"},
			IsNull:      false,
		},
		{
			NamedType:   "String",
			TypeName:    "ProductFilter",
			Path:        []string{"ProductFilter", "category"},
			SubgraphIDs: []string{"products-subgraph"},
			IsNull:      false,
		},
		{
			NamedType:   "ProductFilter",
			Path:        []string{"ProductFilter"},
			SubgraphIDs: []string{"products-subgraph"},
			IsNull:      false,
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

// TestNullPropagationScenarios tests the null propagation scenarios from the breaking change detection document
func TestNullPropagationScenarios(t *testing.T) {
	schema := `
		schema {
			query: Query
		}
		
		type Query {
			a(input: Input): ID
		}
		
		input Input {
			a: NestedInput
		}
		
		input NestedInput {
			a: SuperNestedInput
		}
		
		input SuperNestedInput {
			a: ID
		}
	`

	tests := []struct {
		name          string
		variables     string
		expectedUsage []graphqlmetricsv1.InputUsageInfo
		description   string
	}{
		{
			name:      "input null - explicitly",
			variables: `{"input": null}`,
			expectedUsage: []graphqlmetricsv1.InputUsageInfo{
				{
					NamedType:   "Input",
					Path:        []string{"Input"},
					SubgraphIDs: []string{"test-subgraph"},
					IsNull:      true,
				},
			},
			description: "Explicit null at top level - chain ends here",
		},
		{
			name:      "input empty object - implicit null nested field",
			variables: `{"input": {}}`,
			expectedUsage: []graphqlmetricsv1.InputUsageInfo{
				{
					NamedType:   "NestedInput",
					TypeName:    "Input",
					Path:        []string{"Input", "a"},
					SubgraphIDs: []string{"test-subgraph"},
					IsNull:      true,
				},
				{
					NamedType:   "Input",
					Path:        []string{"Input"},
					SubgraphIDs: []string{"test-subgraph"},
					IsNull:      false,
				},
			},
			description: "Empty object means nested field 'a' is implicitly null and should be tracked",
		},
		{
			name:      "input.a null - explicitly",
			variables: `{"input": {"a": null}}`,
			expectedUsage: []graphqlmetricsv1.InputUsageInfo{
				{
					NamedType:   "NestedInput",
					TypeName:    "Input",
					Path:        []string{"Input", "a"},
					SubgraphIDs: []string{"test-subgraph"},
					IsNull:      true,
				},
				{
					NamedType:   "Input",
					Path:        []string{"Input"},
					SubgraphIDs: []string{"test-subgraph"},
					IsNull:      false,
				},
			},
			description: "Explicit null at nested level - chain ends at Input.a",
		},
		{
			name:      "input.a empty object - implicit null doubly nested field",
			variables: `{"input": {"a": {}}}`,
			expectedUsage: []graphqlmetricsv1.InputUsageInfo{
				{
					NamedType:   "SuperNestedInput",
					TypeName:    "NestedInput",
					Path:        []string{"NestedInput", "a"},
					SubgraphIDs: []string{"test-subgraph"},
					IsNull:      true,
				},
				{
					NamedType:   "NestedInput",
					TypeName:    "Input",
					Path:        []string{"Input", "a"},
					SubgraphIDs: []string{"test-subgraph"},
					IsNull:      false,
				},
				{
					NamedType:   "Input",
					Path:        []string{"Input"},
					SubgraphIDs: []string{"test-subgraph"},
					IsNull:      false,
				},
			},
			description: "Empty nested object means doubly nested field 'a' is implicitly null and should be tracked",
		},
		{
			name:      "input.a.a null - explicitly",
			variables: `{"input": {"a": {"a": null}}}`,
			expectedUsage: []graphqlmetricsv1.InputUsageInfo{
				{
					NamedType:   "SuperNestedInput",
					TypeName:    "NestedInput",
					Path:        []string{"NestedInput", "a"},
					SubgraphIDs: []string{"test-subgraph"},
					IsNull:      true,
				},
				{
					NamedType:   "NestedInput",
					TypeName:    "Input",
					Path:        []string{"Input", "a"},
					SubgraphIDs: []string{"test-subgraph"},
					IsNull:      false,
				},
				{
					NamedType:   "Input",
					Path:        []string{"Input"},
					SubgraphIDs: []string{"test-subgraph"},
					IsNull:      false,
				},
			},
			description: "Explicit null at doubly nested level - chain ends at NestedInput.a",
		},
		{
			name:      "input.a.a empty object - implicit null triply nested field",
			variables: `{"input": {"a": {"a": {}}}}`,
			expectedUsage: []graphqlmetricsv1.InputUsageInfo{
				{
					NamedType:   "ID",
					TypeName:    "SuperNestedInput",
					Path:        []string{"SuperNestedInput", "a"},
					SubgraphIDs: []string{"test-subgraph"},
					IsNull:      true,
				},
				{
					NamedType:   "SuperNestedInput",
					TypeName:    "NestedInput",
					Path:        []string{"NestedInput", "a"},
					SubgraphIDs: []string{"test-subgraph"},
					IsNull:      false,
				},
				{
					NamedType:   "NestedInput",
					TypeName:    "Input",
					Path:        []string{"Input", "a"},
					SubgraphIDs: []string{"test-subgraph"},
					IsNull:      false,
				},
				{
					NamedType:   "Input",
					Path:        []string{"Input"},
					SubgraphIDs: []string{"test-subgraph"},
					IsNull:      false,
				},
			},
			description: "Empty doubly nested object means triply nested field 'a' is implicitly null and should be tracked",
		},
		{
			name:      "input.a.a.a null - explicitly",
			variables: `{"input": {"a": {"a": {"a": null}}}}`,
			expectedUsage: []graphqlmetricsv1.InputUsageInfo{
				{
					NamedType:   "ID",
					TypeName:    "SuperNestedInput",
					Path:        []string{"SuperNestedInput", "a"},
					SubgraphIDs: []string{"test-subgraph"},
					IsNull:      true,
				},
				{
					NamedType:   "SuperNestedInput",
					TypeName:    "NestedInput",
					Path:        []string{"NestedInput", "a"},
					SubgraphIDs: []string{"test-subgraph"},
					IsNull:      false,
				},
				{
					NamedType:   "NestedInput",
					TypeName:    "Input",
					Path:        []string{"Input", "a"},
					SubgraphIDs: []string{"test-subgraph"},
					IsNull:      false,
				},
				{
					NamedType:   "Input",
					Path:        []string{"Input"},
					SubgraphIDs: []string{"test-subgraph"},
					IsNull:      false,
				},
			},
			description: "Explicit null at leaf level - full chain is tracked with leaf as null",
		},
		{
			name:      "input.a.a.a with value - no nulls",
			variables: `{"input": {"a": {"a": {"a": "123"}}}}`,
			expectedUsage: []graphqlmetricsv1.InputUsageInfo{
				{
					NamedType:   "ID",
					TypeName:    "SuperNestedInput",
					Path:        []string{"SuperNestedInput", "a"},
					SubgraphIDs: []string{"test-subgraph"},
					IsNull:      false,
				},
				{
					NamedType:   "SuperNestedInput",
					TypeName:    "NestedInput",
					Path:        []string{"NestedInput", "a"},
					SubgraphIDs: []string{"test-subgraph"},
					IsNull:      false,
				},
				{
					NamedType:   "NestedInput",
					TypeName:    "Input",
					Path:        []string{"Input", "a"},
					SubgraphIDs: []string{"test-subgraph"},
					IsNull:      false,
				},
				{
					NamedType:   "Input",
					Path:        []string{"Input"},
					SubgraphIDs: []string{"test-subgraph"},
					IsNull:      false,
				},
			},
			description: "Full chain with actual value - no nulls in the chain",
		},
	}

	operation := `
		query TestQuery($input: Input) {
			a(input: $input)
		}
	`

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
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
				"test-subgraph",
				&FakeFactory[any]{upstreamSchema: &def},
				&plan.DataSourceMetadata{
					RootNodes: []plan.TypeField{
						{TypeName: "Query", FieldNames: []string{"a"}},
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

			generatedPlan := planner.Plan(&op, &def, "TestQuery", report)
			require.False(t, report.HasErrors())

			vars, err := astjson.Parse(tt.variables)
			require.NoError(t, err)

			inputUsageInfo, err := GetInputUsageInfo(&op, &def, vars, generatedPlan, nil)
			require.NoError(t, err)

			assert.Len(t, inputUsageInfo, len(tt.expectedUsage), tt.description)
			for i := range tt.expectedUsage {
				assert.JSONEq(t, prettyJSON(t, &tt.expectedUsage[i]), prettyJSON(t, inputUsageInfo[i]),
					"inputUsageInfo[%d] - %s", i, tt.description)
			}
		})
	}
}

// TestArgumentUsageWithNullArgument verifies that null argument values are tracked with IsNull flag
func TestArgumentUsageWithNullArgument(t *testing.T) {
	schema := `
		schema {
			query: Query
		}
		
		type Query {
			findEmployees(criteria: SearchInput): [Employee!]!
		}
		
		type Employee {
			id: ID!
			details: EmployeeDetails
		}
		
		type EmployeeDetails {
			forename: String
		}
		
		input SearchInput {
			department: String
			minAge: Int
		}
	`

	operation := `
		query FindEmployeesWithVariable($criteria: SearchInput) {
			findEmployees(criteria: $criteria) {
				id
				details {
					forename
				}
			}
		}
	`

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
				{TypeName: "Employee", FieldNames: []string{"id", "details"}},
				{TypeName: "EmployeeDetails", FieldNames: []string{"forename"}},
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

	vars := astjson.MustParse(`{"criteria": null}`)
	argumentUsageInfo, err := GetArgumentUsageInfo(&op, &def, vars, generatedPlan, nil)
	require.NoError(t, err)

	// Should track the null argument with IsNull=true
	expectedUsage := []*graphqlmetricsv1.ArgumentUsageInfo{
		{
			TypeName:    "Query",
			NamedType:   "SearchInput",
			Path:        []string{"findEmployees", "criteria"},
			SubgraphIDs: []string{"employees-subgraph"},
			IsNull:      true,
		},
	}

	assert.Len(t, argumentUsageInfo, len(expectedUsage), "Null argument should be tracked with IsNull=true")
	for i := range expectedUsage {
		assert.JSONEq(t, prettyJSON(t, expectedUsage[i]), prettyJSON(t, argumentUsageInfo[i]), "argumentUsageInfo[%d]", i)
	}
}

// TestVariableRemapping verifies that variable name remapping works correctly after normalization.
// This tests the real-world scenario where operations are normalized/minified and variable names
// change (e.g., $criteria → $a), requiring remapping to find variable values in the JSON.
func TestVariableRemapping(t *testing.T) {
	schema := `
		schema {
			query: Query
		}
		
		type Query {
			findEmployees(criteria: SearchInput, status: String): [Employee!]!
		}
		
		type Employee {
			id: ID!
			details: EmployeeDetails
		}
		
		type EmployeeDetails {
			forename: String
			surname: String
		}
		
		input SearchInput {
			department: String
			minAge: Int
			active: Boolean
		}
	`

	// Original operation with descriptive variable names
	operation := `
		query FindEmployeesQuery($searchCriteria: SearchInput, $employeeStatus: String) {
			findEmployees(criteria: $searchCriteria, status: $employeeStatus) {
				id
				details {
					forename
					surname
				}
			}
		}
	`

	// Variables use original names
	variables := `{
		"searchCriteria": {
			"department": "Engineering",
			"minAge": 25,
			"active": true
		},
		"employeeStatus": null
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

	// Use the actual variables remapper to generate the remapping
	// This simulates what happens in the router during operation processing
	remapper := astnormalization.NewVariablesMapper()
	op.Input.Variables = []byte(variables)
	remapReport := &operationreport.Report{}
	variablesMap := remapper.NormalizeOperation(&op, &def, remapReport)
	require.False(t, remapReport.HasErrors())
	require.NotEmpty(t, variablesMap, "Variables should be remapped after normalization")

	// variablesMap maps normalized names (e.g., "a", "b") to original names (e.g., "searchCriteria", "employeeStatus")
	t.Logf("Variable remapping: %+v", variablesMap)

	dsCfg, err := plan.NewDataSourceConfiguration[any](
		"employees-subgraph",
		&FakeFactory[any]{upstreamSchema: &def},
		&plan.DataSourceMetadata{
			RootNodes: []plan.TypeField{
				{TypeName: "Query", FieldNames: []string{"findEmployees"}},
			},
			ChildNodes: []plan.TypeField{
				{TypeName: "Employee", FieldNames: []string{"id", "details"}},
				{TypeName: "EmployeeDetails", FieldNames: []string{"forename", "surname"}},
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

	generatedPlan := planner.Plan(&op, &def, "FindEmployeesQuery", report)
	require.False(t, report.HasErrors())

	vars, err := astjson.Parse(variables)
	require.NoError(t, err)

	// Test with remapping - should correctly find variables and track usage
	argumentUsageInfo, err := GetArgumentUsageInfo(&op, &def, vars, generatedPlan, variablesMap)
	require.NoError(t, err)
	inputUsageInfo, err := GetInputUsageInfo(&op, &def, vars, generatedPlan, variablesMap)
	require.NoError(t, err)

	// Verify argument usage tracks both arguments
	// One should be null (employeeStatus), one should be non-null (searchCriteria)
	require.Len(t, argumentUsageInfo, 2, "Should track both arguments")

	var criteriaArg, statusArg *graphqlmetricsv1.ArgumentUsageInfo
	for _, arg := range argumentUsageInfo {
		switch arg.NamedType {
		case "SearchInput":
			criteriaArg = arg
		case "String":
			statusArg = arg
		}
	}

	require.NotNil(t, criteriaArg, "Should find criteria argument")
	require.NotNil(t, statusArg, "Should find status argument")

	// Verify criteria argument (non-null input object)
	assert.Equal(t, "Query", criteriaArg.TypeName)
	assert.Equal(t, "SearchInput", criteriaArg.NamedType)
	assert.Equal(t, []string{"findEmployees", "criteria"}, criteriaArg.Path)
	assert.False(t, criteriaArg.IsNull, "searchCriteria should not be null")

	// Verify status argument (null string)
	assert.Equal(t, "Query", statusArg.TypeName)
	assert.Equal(t, "String", statusArg.NamedType)
	assert.Equal(t, []string{"findEmployees", "status"}, statusArg.Path)
	assert.True(t, statusArg.IsNull, "employeeStatus should be null - this is the critical test for remapping!")

	// Verify input usage tracks the input object and its fields
	require.GreaterOrEqual(t, len(inputUsageInfo), 4, "Should track SearchInput and its fields")

	// Find the root SearchInput type
	var searchInputRoot *graphqlmetricsv1.InputUsageInfo
	for _, input := range inputUsageInfo {
		if input.NamedType == "SearchInput" && len(input.Path) == 1 {
			searchInputRoot = input
			break
		}
	}
	require.NotNil(t, searchInputRoot, "Should track root SearchInput type")
	assert.False(t, searchInputRoot.IsNull, "SearchInput should not be null")

	// Verify individual fields were tracked
	fieldMap := make(map[string]*graphqlmetricsv1.InputUsageInfo)
	for _, input := range inputUsageInfo {
		if input.TypeName == "SearchInput" && len(input.Path) == 2 {
			fieldMap[input.Path[1]] = input
		}
	}

	// All fields should be present and non-null
	assert.Contains(t, fieldMap, "department", "Should track department field")
	assert.Contains(t, fieldMap, "minAge", "Should track minAge field")
	assert.Contains(t, fieldMap, "active", "Should track active field")

	if departmentField, ok := fieldMap["department"]; ok {
		assert.Equal(t, "String", departmentField.NamedType)
		assert.False(t, departmentField.IsNull, "department has a value")
	}

	if minAgeField, ok := fieldMap["minAge"]; ok {
		assert.Equal(t, "Int", minAgeField.NamedType)
		assert.False(t, minAgeField.IsNull, "minAge has a value")
	}

	if activeField, ok := fieldMap["active"]; ok {
		assert.Equal(t, "Boolean", activeField.NamedType)
		assert.False(t, activeField.IsNull, "active has a value")
	}

	// Test without remapping - should fail to find variables correctly
	argumentUsageInfoNoRemap, err := GetArgumentUsageInfo(&op, &def, vars, generatedPlan, nil)
	require.NoError(t, err)

	// Without remapping, null detection for variable-based arguments won't work correctly
	// because the AST uses normalized names but variables JSON uses original names
	var statusArgNoRemap *graphqlmetricsv1.ArgumentUsageInfo
	for _, arg := range argumentUsageInfoNoRemap {
		if arg.NamedType == "String" {
			statusArgNoRemap = arg
			break
		}
	}

	// Without remapping, we can't correctly detect the null status because we can't find
	// the variable value (AST has normalized name, JSON has original name)
	// This demonstrates why remapping is critical
	if statusArgNoRemap != nil {
		// The behavior without remapping: can't find the variable, so defaults to false
		assert.False(t, statusArgNoRemap.IsNull, "Without remapping, can't correctly detect null status")
	}
}

// TestImplicitNullArguments verifies that arguments are tracked even when not provided in the operation.
// This is critical for breaking change detection - we need to know if optional arguments are being used.
func TestImplicitNullArguments(t *testing.T) {
	t.Run("no arguments provided", func(t *testing.T) {
		schema := `
			schema {
				query: Query
			}
			
			type Query {
				findEmployees(criteria: SearchInput, status: String, limit: Int): String
			}
			
			input SearchInput {
				department: String
			}
		`

		// Operation WITHOUT any arguments - all should be tracked as implicitly null
		operation := `
			query FindEmployees {
				findEmployees
			}
		`

		variables := `{}`

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

		argumentUsageInfo, err := GetArgumentUsageInfo(&op, &def, vars, generatedPlan, nil)
		require.NoError(t, err)

		// Should track ALL three arguments even though none were provided
		require.Len(t, argumentUsageInfo, 3, "Should track all 3 arguments (criteria, status, limit) even though none were provided")

		// Verify all arguments are tracked as implicitly null
		argumentMap := make(map[string]*graphqlmetricsv1.ArgumentUsageInfo)
		for _, arg := range argumentUsageInfo {
			if len(arg.Path) == 2 && arg.Path[0] == "findEmployees" {
				argumentMap[arg.Path[1]] = arg
			}
		}

		// Verify criteria argument (SearchInput)
		require.Contains(t, argumentMap, "criteria", "Should track criteria argument")
		criteriaArg := argumentMap["criteria"]
		assert.Equal(t, "Query", criteriaArg.TypeName)
		assert.Equal(t, "SearchInput", criteriaArg.NamedType)
		assert.Equal(t, []string{"findEmployees", "criteria"}, criteriaArg.Path)
		assert.True(t, criteriaArg.IsNull, "criteria should be implicitly null (not provided)")

		// Verify status argument (String)
		require.Contains(t, argumentMap, "status", "Should track status argument")
		statusArg := argumentMap["status"]
		assert.Equal(t, "Query", statusArg.TypeName)
		assert.Equal(t, "String", statusArg.NamedType)
		assert.Equal(t, []string{"findEmployees", "status"}, statusArg.Path)
		assert.True(t, statusArg.IsNull, "status should be implicitly null (not provided)")

		// Verify limit argument (Int)
		require.Contains(t, argumentMap, "limit", "Should track limit argument")
		limitArg := argumentMap["limit"]
		assert.Equal(t, "Query", limitArg.TypeName)
		assert.Equal(t, "Int", limitArg.NamedType)
		assert.Equal(t, []string{"findEmployees", "limit"}, limitArg.Path)
		assert.True(t, limitArg.IsNull, "limit should be implicitly null (not provided)")
	})

	t.Run("mixed - some arguments provided, some not", func(t *testing.T) {
		schema := `
			schema {
				query: Query
			}
			
			type Query {
				findEmployees(criteria: SearchInput, status: String, limit: Int): String
			}
			
			input SearchInput {
				department: String
			}
		`

		// Operation with only 'status' argument - criteria and limit should be tracked as implicit nulls
		operation := `
			query FindEmployees {
				findEmployees(status: "active")
			}
		`

		variables := `{}`

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

		argumentUsageInfo, err := GetArgumentUsageInfo(&op, &def, vars, generatedPlan, nil)
		require.NoError(t, err)

		// Should track ALL three arguments: status (explicit), criteria & limit (implicit)
		require.Len(t, argumentUsageInfo, 3, "Should track all 3 arguments")

		// Verify argument tracking
		argumentMap := make(map[string]*graphqlmetricsv1.ArgumentUsageInfo)
		for _, arg := range argumentUsageInfo {
			if len(arg.Path) == 2 && arg.Path[0] == "findEmployees" {
				argumentMap[arg.Path[1]] = arg
			}
		}

		// Verify status argument (provided explicitly with value)
		require.Contains(t, argumentMap, "status")
		statusArg := argumentMap["status"]
		assert.Equal(t, "String", statusArg.NamedType)
		assert.False(t, statusArg.IsNull, "status was provided with value")

		// Verify criteria argument (not provided - implicit null)
		require.Contains(t, argumentMap, "criteria")
		criteriaArg := argumentMap["criteria"]
		assert.Equal(t, "SearchInput", criteriaArg.NamedType)
		assert.True(t, criteriaArg.IsNull, "criteria should be implicitly null (not provided)")

		// Verify limit argument (not provided - implicit null)
		require.Contains(t, argumentMap, "limit")
		limitArg := argumentMap["limit"]
		assert.Equal(t, "Int", limitArg.NamedType)
		assert.True(t, limitArg.IsNull, "limit should be implicitly null (not provided)")
	})
}

// TestImplicitInputTypeArgumentUsage verifies that when an input type argument is not provided,
// we track input usage for that type with IsNull: true for breaking change detection.
func TestImplicitInputTypeArgumentUsage(t *testing.T) {
	schema := `
		schema {
			query: Query
		}
		
		type Query {
			findEmployees(criteria: SearchInput, status: String, limit: Int): [Employee!]!
		}
		
		type Employee {
			id: ID!
			details: EmployeeDetails
		}
		
		type EmployeeDetails {
			forename: String
		}
		
		input SearchInput {
			department: String
			title: String
		}
	`

	// Operation without providing the SearchInput argument
	operation := `
		query FindEmployees {
			findEmployees {
				id
				details {
					forename
				}
			}
		}
	`

	variables := `{}`

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
				{TypeName: "Employee", FieldNames: []string{"id", "details"}},
				{TypeName: "EmployeeDetails", FieldNames: []string{"forename"}},
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

	// Get argument usage - should include implicit nulls for criteria, status, limit
	argumentUsageInfo, err := GetArgumentUsageInfo(&op, &def, vars, generatedPlan, nil)
	require.NoError(t, err)

	// Get input usage - should include SearchInput from the implicitly null criteria argument
	inputUsageInfo, err := GetInputUsageInfo(&op, &def, vars, generatedPlan, nil)
	require.NoError(t, err)

	// Verify argument usage includes all three arguments as implicitly null
	require.Len(t, argumentUsageInfo, 3, "Should track all 3 arguments (criteria, status, limit)")

	var criteriaArg *graphqlmetricsv1.ArgumentUsageInfo
	for _, arg := range argumentUsageInfo {
		if len(arg.Path) == 2 && arg.Path[0] == "findEmployees" && arg.Path[1] == "criteria" {
			criteriaArg = arg
			break
		}
	}
	require.NotNil(t, criteriaArg, "Should find criteria argument")
	assert.Equal(t, "SearchInput", criteriaArg.NamedType)
	assert.True(t, criteriaArg.IsNull, "criteria should be implicitly null")

	// CRITICAL: Verify input usage includes SearchInput from the implicitly null criteria argument
	var searchInputUsage *graphqlmetricsv1.InputUsageInfo
	for _, input := range inputUsageInfo {
		if input.NamedType == "SearchInput" && len(input.Path) == 1 && input.Path[0] == "SearchInput" {
			searchInputUsage = input
			break
		}
	}
	require.NotNil(t, searchInputUsage, "Should track input usage for SearchInput type even though argument wasn't provided")
	assert.Equal(t, "SearchInput", searchInputUsage.NamedType)
	assert.Equal(t, []string{"SearchInput"}, searchInputUsage.Path)
	assert.True(t, searchInputUsage.IsNull, "SearchInput should be marked as null since argument wasn't provided")
	assert.Equal(t, []string{"employees-subgraph"}, searchInputUsage.SubgraphIDs, "Should have correct subgraph ID")
}

// TestInputUsageWithEmptyVariables verifies that when a variable is defined and used in an argument,
// but the variables JSON is empty, we still track the input type usage with IsNull: true.
func TestInputUsageWithEmptyVariables(t *testing.T) {
	schema := `
		schema {
			query: Query
		}
		
		type Query {
			findEmployees(criteria: SearchInput): [Employee!]!
		}
		
		type Employee {
			id: ID!
			details: EmployeeDetails
		}
		
		type EmployeeDetails {
			forename: String
		}
		
		input SearchInput {
			department: String
			title: String
		}
	`

	// Operation with variable defined and used in argument, but variables JSON will be empty
	operation := `
		query FindEmployeesWithVariable($criteria: SearchInput) {
			findEmployees(criteria: $criteria) {
				id
				details {
					forename
				}
			}
		}
	`

	variables := `{}`

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
				{TypeName: "Employee", FieldNames: []string{"id", "details"}},
				{TypeName: "EmployeeDetails", FieldNames: []string{"forename"}},
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

	// Get input usage - should include SearchInput even though variable is not provided
	inputUsageInfo, err := GetInputUsageInfo(&op, &def, vars, generatedPlan, nil)
	require.NoError(t, err)

	// Verify input usage includes SearchInput from the variable definition
	var searchInputUsage *graphqlmetricsv1.InputUsageInfo
	for _, input := range inputUsageInfo {
		if input.NamedType == "SearchInput" && len(input.Path) == 1 && input.Path[0] == "SearchInput" {
			searchInputUsage = input
			break
		}
	}
	require.NotNil(t, searchInputUsage, "Should track input usage for SearchInput type even though variable is not provided in empty variables JSON")
	assert.Equal(t, "SearchInput", searchInputUsage.NamedType)
	assert.Equal(t, []string{"SearchInput"}, searchInputUsage.Path)
	assert.True(t, searchInputUsage.IsNull, "SearchInput should be marked as null since variable is not provided")
	assert.Equal(t, []string{"employees-subgraph"}, searchInputUsage.SubgraphIDs, "Should have correct subgraph ID")
}

// TestSharedInputObjectAcrossSubgraphs verifies that when an input object variable is used by
// multiple fields from different subgraphs, the input usage (including nested fields) is
// attributed to all subgraphs that use it (merged).
func TestSharedInputObjectAcrossSubgraphs(t *testing.T) {
	schema := `
		schema {
			query: Query
		}
		
		type Query {
			findUsers(criteria: SearchInput!): [User!]!
			findProducts(criteria: SearchInput!): [Product!]!
			findOrders(criteria: SearchInput!): [Order!]!
		}
		
		type User {
			id: ID!
			name: String!
		}
		
		type Product {
			id: ID!
			title: String!
		}
		
		type Order {
			id: ID!
			status: String!
		}
		
		input SearchInput {
			keyword: String
			category: String
			limit: Int
		}
	`

	// Single input object variable used by three fields from three different subgraphs
	operation := `
		query Search($criteria: SearchInput!) {
			findUsers(criteria: $criteria) {
				id
				name
			}
			findProducts(criteria: $criteria) {
				id
				title
			}
			findOrders(criteria: $criteria) {
				id
				status
			}
		}
	`

	variables := `{"criteria": {"keyword": "test", "category": "electronics"}}`

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

	// Create three subgraphs - each serving one root field
	usersSubgraph, err := plan.NewDataSourceConfiguration[any](
		"users-subgraph",
		&FakeFactory[any]{upstreamSchema: &def},
		&plan.DataSourceMetadata{
			RootNodes: []plan.TypeField{
				{TypeName: "Query", FieldNames: []string{"findUsers"}},
			},
			ChildNodes: []plan.TypeField{
				{TypeName: "User", FieldNames: []string{"id", "name"}},
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
				{TypeName: "Query", FieldNames: []string{"findProducts"}},
			},
			ChildNodes: []plan.TypeField{
				{TypeName: "Product", FieldNames: []string{"id", "title"}},
			},
		},
		nil,
	)
	require.NoError(t, err)

	ordersSubgraph, err := plan.NewDataSourceConfiguration[any](
		"orders-subgraph",
		&FakeFactory[any]{upstreamSchema: &def},
		&plan.DataSourceMetadata{
			RootNodes: []plan.TypeField{
				{TypeName: "Query", FieldNames: []string{"findOrders"}},
			},
			ChildNodes: []plan.TypeField{
				{TypeName: "Order", FieldNames: []string{"id", "status"}},
			},
		},
		nil,
	)
	require.NoError(t, err)

	planner, err := plan.NewPlanner(plan.Configuration{
		DisableResolveFieldPositions: true,
		DataSources:                  []plan.DataSource{usersSubgraph, productsSubgraph, ordersSubgraph},
	})
	require.NoError(t, err)

	generatedPlan := planner.Plan(&op, &def, "Search", report)
	require.False(t, report.HasErrors())

	vars, err := astjson.Parse(variables)
	require.NoError(t, err)

	argumentUsageInfo, err := GetArgumentUsageInfo(&op, &def, vars, generatedPlan, nil)
	require.NoError(t, err)
	inputUsageInfo, err := GetInputUsageInfo(&op, &def, vars, generatedPlan, nil)
	require.NoError(t, err)

	// The $criteria variable is used by findUsers, findProducts, and findOrders
	// Each from a different subgraph, so we expect THREE argument entries
	require.Len(t, argumentUsageInfo, 3, "Should have 3 argument usage entries")

	// Verify each argument has its own subgraph
	argumentsByField := make(map[string]*graphqlmetricsv1.ArgumentUsageInfo)
	for _, arg := range argumentUsageInfo {
		if len(arg.Path) == 2 && arg.Path[1] == "criteria" {
			argumentsByField[arg.Path[0]] = arg
		}
	}

	require.Contains(t, argumentsByField, "findUsers")
	require.Contains(t, argumentsByField, "findProducts")
	require.Contains(t, argumentsByField, "findOrders")

	assert.Equal(t, []string{"users-subgraph"}, argumentsByField["findUsers"].SubgraphIDs)
	assert.Equal(t, []string{"products-subgraph"}, argumentsByField["findProducts"].SubgraphIDs)
	assert.Equal(t, []string{"orders-subgraph"}, argumentsByField["findOrders"].SubgraphIDs)

	// CRITICAL: Input usage should merge all three subgraphs
	// We should have entries for:
	// 1. SearchInput (root) - merged subgraphs
	// 2. SearchInput.keyword - merged subgraphs
	// 3. SearchInput.category - merged subgraphs
	// 4. SearchInput.limit (implicit null) - merged subgraphs

	inputsByPath := make(map[string]*graphqlmetricsv1.InputUsageInfo)
	for _, input := range inputUsageInfo {
		pathKey := strings.Join(input.Path, ".")
		inputsByPath[pathKey] = input
	}

	// Verify root SearchInput has all three subgraphs merged
	require.Contains(t, inputsByPath, "SearchInput", "Should track root SearchInput")
	searchInputRoot := inputsByPath["SearchInput"]
	assert.Equal(t, "SearchInput", searchInputRoot.NamedType)
	assert.False(t, searchInputRoot.IsNull)
	assert.ElementsMatch(t, []string{"users-subgraph", "products-subgraph", "orders-subgraph"},
		searchInputRoot.SubgraphIDs, "Root SearchInput should have all three subgraphs merged")
	assert.Len(t, searchInputRoot.SubgraphIDs, 3, "Should have exactly 3 subgraphs (no duplicates)")

	// Verify keyword field has all three subgraphs merged
	require.Contains(t, inputsByPath, "SearchInput.keyword", "Should track SearchInput.keyword")
	keywordField := inputsByPath["SearchInput.keyword"]
	assert.Equal(t, "String", keywordField.NamedType)
	assert.False(t, keywordField.IsNull)
	assert.ElementsMatch(t, []string{"users-subgraph", "products-subgraph", "orders-subgraph"},
		keywordField.SubgraphIDs, "keyword field should have all three subgraphs merged")

	// Verify category field has all three subgraphs merged
	require.Contains(t, inputsByPath, "SearchInput.category", "Should track SearchInput.category")
	categoryField := inputsByPath["SearchInput.category"]
	assert.Equal(t, "String", categoryField.NamedType)
	assert.False(t, categoryField.IsNull)
	assert.ElementsMatch(t, []string{"users-subgraph", "products-subgraph", "orders-subgraph"},
		categoryField.SubgraphIDs, "category field should have all three subgraphs merged")

	// Verify implicit null field (limit) has all three subgraphs merged
	require.Contains(t, inputsByPath, "SearchInput.limit", "Should track implicitly null SearchInput.limit")
	limitField := inputsByPath["SearchInput.limit"]
	assert.Equal(t, "Int", limitField.NamedType)
	assert.True(t, limitField.IsNull, "limit should be implicitly null (not provided)")
	assert.ElementsMatch(t, []string{"users-subgraph", "products-subgraph", "orders-subgraph"},
		limitField.SubgraphIDs, "implicit null field should also have all three subgraphs merged")
}

// TestSharedVariableAcrossSubgraphs verifies that when a variable is used by multiple fields
// from different subgraphs, the variable's input usage is attributed to all subgraphs (merged).
func TestSharedVariableAcrossSubgraphs(t *testing.T) {
	schema := `
		schema {
			query: Query
		}
		
		type Query {
			user(id: ID!): User
			product(id: ID!): Product
			order(id: ID!): Order
		}
		
		type User {
			id: ID!
			name: String!
		}
		
		type Product {
			id: ID!
			title: String!
		}
		
		type Order {
			id: ID!
			status: String!
		}
	`

	// Single variable $sharedId is used by three fields from three different subgraphs
	operation := `
		query GetData($sharedId: ID!) {
			user(id: $sharedId) {
				id
				name
			}
			product(id: $sharedId) {
				id
				title
			}
			order(id: $sharedId) {
				id
				status
			}
		}
	`

	variables := `{"sharedId": "123"}`

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

	// Create three subgraphs - each serving one root field
	usersSubgraph, err := plan.NewDataSourceConfiguration[any](
		"users-subgraph",
		&FakeFactory[any]{upstreamSchema: &def},
		&plan.DataSourceMetadata{
			RootNodes: []plan.TypeField{
				{TypeName: "Query", FieldNames: []string{"user"}},
			},
			ChildNodes: []plan.TypeField{
				{TypeName: "User", FieldNames: []string{"id", "name"}},
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
				{TypeName: "Product", FieldNames: []string{"id", "title"}},
			},
		},
		nil,
	)
	require.NoError(t, err)

	ordersSubgraph, err := plan.NewDataSourceConfiguration[any](
		"orders-subgraph",
		&FakeFactory[any]{upstreamSchema: &def},
		&plan.DataSourceMetadata{
			RootNodes: []plan.TypeField{
				{TypeName: "Query", FieldNames: []string{"order"}},
			},
			ChildNodes: []plan.TypeField{
				{TypeName: "Order", FieldNames: []string{"id", "status"}},
			},
		},
		nil,
	)
	require.NoError(t, err)

	planner, err := plan.NewPlanner(plan.Configuration{
		DisableResolveFieldPositions: true,
		DataSources:                  []plan.DataSource{usersSubgraph, productsSubgraph, ordersSubgraph},
	})
	require.NoError(t, err)

	generatedPlan := planner.Plan(&op, &def, "GetData", report)
	require.False(t, report.HasErrors())

	vars, err := astjson.Parse(variables)
	require.NoError(t, err)

	argumentUsageInfo, err := GetArgumentUsageInfo(&op, &def, vars, generatedPlan, nil)
	require.NoError(t, err)
	inputUsageInfo, err := GetInputUsageInfo(&op, &def, vars, generatedPlan, nil)
	require.NoError(t, err)

	// The $sharedId variable is used by user(id:), product(id:), and order(id:)
	// Each from a different subgraph, so we expect THREE argument entries
	expectedArgumentUsageInfo := []*graphqlmetricsv1.ArgumentUsageInfo{
		{
			TypeName:    "Query",
			NamedType:   "ID",
			Path:        []string{"user", "id"},
			SubgraphIDs: []string{"users-subgraph"},
			IsNull:      false,
		},
		{
			TypeName:    "Query",
			NamedType:   "ID",
			Path:        []string{"product", "id"},
			SubgraphIDs: []string{"products-subgraph"},
			IsNull:      false,
		},
		{
			TypeName:    "Query",
			NamedType:   "ID",
			Path:        []string{"order", "id"},
			SubgraphIDs: []string{"orders-subgraph"},
			IsNull:      false,
		},
	}

	// The $sharedId variable's input usage should be attributed to ALL THREE subgraphs
	// This is the critical test: mergeSubgraphIDs should combine all three
	expectedInputUsageInfo := []graphqlmetricsv1.InputUsageInfo{
		{
			NamedType: "ID",
			Path:      []string{"ID"},
			// MERGED: All three subgraphs that use this variable
			SubgraphIDs: []string{"users-subgraph", "products-subgraph", "orders-subgraph"},
			IsNull:      false,
		},
	}

	// Verify argument usage
	assert.Len(t, argumentUsageInfo, len(expectedArgumentUsageInfo))
	for i := range expectedArgumentUsageInfo {
		assert.JSONEq(t, prettyJSON(t, expectedArgumentUsageInfo[i]), prettyJSON(t, argumentUsageInfo[i]),
			"argumentUsageInfo[%d]", i)
	}

	// Verify input usage - the critical assertion
	assert.Len(t, inputUsageInfo, len(expectedInputUsageInfo), "Should have one input usage entry for the shared variable")

	// The input usage should have all three subgraph IDs merged
	actualInput := inputUsageInfo[0]
	assert.Equal(t, "ID", actualInput.NamedType, "Input type should be ID")
	assert.Equal(t, []string{"ID"}, actualInput.Path, "Input path should be [ID]")
	assert.False(t, actualInput.IsNull, "Input should not be null")

	// Critical assertion: verify all three subgraphs are present (order-independent)
	assert.ElementsMatch(t, expectedInputUsageInfo[0].SubgraphIDs, actualInput.SubgraphIDs,
		"Input usage should be attributed to all three subgraphs that use the variable")

	// Verify we have exactly 3 subgraphs (no duplicates)
	assert.Len(t, actualInput.SubgraphIDs, 3, "Should have exactly 3 subgraph IDs (no duplicates)")
}

// TestNullListHandling verifies that null list values are properly tracked with IsNull flag.
// This is critical for breaking change detection when a nullable list type becomes non-nullable.
func TestNullListHandling(t *testing.T) {
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
			tags: [String]
			categories: [String]
			scores: [Int]
		}
	`

	tests := []struct {
		name          string
		variables     string
		expectedUsage []graphqlmetricsv1.InputUsageInfo
		description   string
	}{
		{
			name: "null list - tags is explicitly null",
			variables: `{
				"filter": {
					"tags": null,
					"categories": ["cat1", "cat2"]
				}
			}`,
			expectedUsage: []graphqlmetricsv1.InputUsageInfo{
				{
					NamedType:   "String",
					TypeName:    "SearchFilter",
					Path:        []string{"SearchFilter", "tags"},
					SubgraphIDs: []string{"search-subgraph"},
					IsNull:      true, // Null list should be marked as null
				},
				{
					NamedType:   "String",
					TypeName:    "SearchFilter",
					Path:        []string{"SearchFilter", "categories"},
					SubgraphIDs: []string{"search-subgraph"},
					IsNull:      false,
				},
				{
					NamedType:   "Int",
					TypeName:    "SearchFilter",
					Path:        []string{"SearchFilter", "scores"},
					SubgraphIDs: []string{"search-subgraph"},
					IsNull:      true, // Implicit null (missing)
				},
				{
					NamedType:   "SearchFilter",
					Path:        []string{"SearchFilter"},
					SubgraphIDs: []string{"search-subgraph"},
					IsNull:      false,
				},
			},
			description: "Explicit null list value should be tracked with IsNull=true, not skipped",
		},
		{
			name: "empty list - not null",
			variables: `{
				"filter": {
					"tags": [],
					"categories": ["cat1"]
				}
			}`,
			expectedUsage: []graphqlmetricsv1.InputUsageInfo{
				{
					NamedType:   "String",
					TypeName:    "SearchFilter",
					Path:        []string{"SearchFilter", "tags"},
					SubgraphIDs: []string{"search-subgraph"},
					IsNull:      false, // Empty list is not null, field is still used
				},
				{
					NamedType:   "String",
					TypeName:    "SearchFilter",
					Path:        []string{"SearchFilter", "categories"},
					SubgraphIDs: []string{"search-subgraph"},
					IsNull:      false,
				},
				{
					NamedType:   "Int",
					TypeName:    "SearchFilter",
					Path:        []string{"SearchFilter", "scores"},
					SubgraphIDs: []string{"search-subgraph"},
					IsNull:      true, // Implicit null (missing)
				},
				{
					NamedType:   "SearchFilter",
					Path:        []string{"SearchFilter"},
					SubgraphIDs: []string{"search-subgraph"},
					IsNull:      false,
				},
			},
			description: "Empty list should track field usage with IsNull=false (field is used, just no elements)",
		},
		{
			name: "all lists null",
			variables: `{
				"filter": {
					"tags": null,
					"categories": null,
					"scores": null
				}
			}`,
			expectedUsage: []graphqlmetricsv1.InputUsageInfo{
				{
					NamedType:   "String",
					TypeName:    "SearchFilter",
					Path:        []string{"SearchFilter", "tags"},
					SubgraphIDs: []string{"search-subgraph"},
					IsNull:      true,
				},
				{
					NamedType:   "String",
					TypeName:    "SearchFilter",
					Path:        []string{"SearchFilter", "categories"},
					SubgraphIDs: []string{"search-subgraph"},
					IsNull:      true,
				},
				{
					NamedType:   "Int",
					TypeName:    "SearchFilter",
					Path:        []string{"SearchFilter", "scores"},
					SubgraphIDs: []string{"search-subgraph"},
					IsNull:      true,
				},
				{
					NamedType:   "SearchFilter",
					Path:        []string{"SearchFilter"},
					SubgraphIDs: []string{"search-subgraph"},
					IsNull:      false,
				},
			},
			description: "All null lists should be tracked with IsNull=true",
		},
	}

	operation := `
		query SearchQuery($filter: SearchFilter!) {
			search(filter: $filter) {
				id
			}
		}
	`

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
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

			dsCfg, err := plan.NewDataSourceConfiguration(
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

			vars, err := astjson.Parse(tt.variables)
			require.NoError(t, err)

			inputUsageInfo, err := GetInputUsageInfo(&op, &def, vars, generatedPlan, nil)
			require.NoError(t, err)

			assert.Len(t, inputUsageInfo, len(tt.expectedUsage), tt.description)
			for i := range tt.expectedUsage {
				assert.JSONEq(t, prettyJSON(t, &tt.expectedUsage[i]), prettyJSON(t, inputUsageInfo[i]),
					"inputUsageInfo[%d] - %s", i, tt.description)
			}
		})
	}
}

// TestNestedFieldArguments verifies that arguments on nested fields (not just root Query fields)
// are tracked correctly with proper type names, paths, and subgraph IDs.
// This is critical for tracking schema usage on fields like User.friends(limit: Int) or
// Product.reviews(filter: ReviewFilter).
func TestNestedFieldArguments(t *testing.T) {
	schema := `
		schema {
			query: Query
		}
		
		type Query {
			user(id: ID!): User
			product(id: ID!): Product
		}
		
		type User {
			id: ID!
			name: String!
			friends(limit: Int, offset: Int, filter: FriendFilter): [User!]!
			posts(status: PostStatus, category: String): [Post!]!
		}
		
		type Post {
			id: ID!
			title: String!
			comments(first: Int!, after: String, includeReplies: Boolean): [Comment!]!
		}
		
		type Comment {
			id: ID!
			text: String!
			replies(maxDepth: Int): [Comment!]!
		}
		
		type Product {
			id: ID!
			name: String!
			reviews(filter: ReviewFilter!): [Review!]!
		}
		
		type Review {
			id: ID!
			rating: Int!
			author: User
		}
		
		input FriendFilter {
			minAge: Int
			maxAge: Int
		}
		
		input ReviewFilter {
			minRating: Int
			verified: Boolean
		}
		
		enum PostStatus {
			DRAFT
			PUBLISHED
			ARCHIVED
		}
	`

	t.Run("nested arguments at multiple levels", func(t *testing.T) {
		operation := `
			query GetUserContent($userId: ID!, $postStatus: PostStatus, $commentLimit: Int!, $includeReplies: Boolean) {
				user(id: $userId) {
					id
					name
					friends(limit: 10, offset: 0) {
						id
						name
					}
					posts(status: $postStatus, category: "tech") {
						id
						title
						comments(first: $commentLimit, includeReplies: $includeReplies) {
							id
							text
							replies(maxDepth: 3) {
								id
								text
							}
						}
					}
				}
			}
		`

		variables := `{
			"userId": "123",
			"postStatus": "PUBLISHED",
			"commentLimit": 20,
			"includeReplies": true
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
			"main-subgraph",
			&FakeFactory[any]{upstreamSchema: &def},
			&plan.DataSourceMetadata{
				RootNodes: []plan.TypeField{
					{TypeName: "Query", FieldNames: []string{"user", "product"}},
				},
				ChildNodes: []plan.TypeField{
					{TypeName: "User", FieldNames: []string{"id", "name", "friends", "posts"}},
					{TypeName: "Post", FieldNames: []string{"id", "title", "comments"}},
					{TypeName: "Comment", FieldNames: []string{"id", "text", "replies"}},
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

		generatedPlan := planner.Plan(&op, &def, "GetUserContent", report)
		require.False(t, report.HasErrors())

		vars, err := astjson.Parse(variables)
		require.NoError(t, err)

		argumentUsageInfo, err := GetArgumentUsageInfo(&op, &def, vars, generatedPlan, nil)
		require.NoError(t, err)

		// Build a map for easier assertion
		argumentMap := make(map[string]*graphqlmetricsv1.ArgumentUsageInfo)
		for _, arg := range argumentUsageInfo {
			key := strings.Join(arg.Path, ".")
			argumentMap[key] = arg
		}

		// Verify root level argument (Query.user.id)
		require.Contains(t, argumentMap, "user.id", "Should track root level argument")
		assert.Equal(t, "Query", argumentMap["user.id"].TypeName)
		assert.Equal(t, "ID", argumentMap["user.id"].NamedType)
		assert.False(t, argumentMap["user.id"].IsNull)

		// Verify nested level 1 argument (User.friends.limit)
		require.Contains(t, argumentMap, "friends.limit", "Should track nested field argument")
		assert.Equal(t, "User", argumentMap["friends.limit"].TypeName)
		assert.Equal(t, "Int", argumentMap["friends.limit"].NamedType)
		assert.False(t, argumentMap["friends.limit"].IsNull)

		// Verify nested level 1 argument (User.friends.offset)
		require.Contains(t, argumentMap, "friends.offset", "Should track nested field argument")
		assert.Equal(t, "User", argumentMap["friends.offset"].TypeName)
		assert.Equal(t, "Int", argumentMap["friends.offset"].NamedType)
		assert.False(t, argumentMap["friends.offset"].IsNull)

		// Verify nested level 1 implicit null argument (User.friends.filter)
		require.Contains(t, argumentMap, "friends.filter", "Should track implicit null nested field argument")
		assert.Equal(t, "User", argumentMap["friends.filter"].TypeName)
		assert.Equal(t, "FriendFilter", argumentMap["friends.filter"].NamedType)
		assert.True(t, argumentMap["friends.filter"].IsNull, "filter was not provided, should be implicitly null")

		// Verify nested level 1 argument (User.posts.status)
		require.Contains(t, argumentMap, "posts.status", "Should track nested field argument with variable")
		assert.Equal(t, "User", argumentMap["posts.status"].TypeName)
		assert.Equal(t, "PostStatus", argumentMap["posts.status"].NamedType)
		assert.False(t, argumentMap["posts.status"].IsNull)

		// Verify nested level 1 argument (User.posts.category)
		require.Contains(t, argumentMap, "posts.category", "Should track nested field argument with inline value")
		assert.Equal(t, "User", argumentMap["posts.category"].TypeName)
		assert.Equal(t, "String", argumentMap["posts.category"].NamedType)
		assert.False(t, argumentMap["posts.category"].IsNull)

		// Verify nested level 2 argument (Post.comments.first)
		require.Contains(t, argumentMap, "comments.first", "Should track doubly nested field argument")
		assert.Equal(t, "Post", argumentMap["comments.first"].TypeName)
		assert.Equal(t, "Int", argumentMap["comments.first"].NamedType)
		assert.False(t, argumentMap["comments.first"].IsNull)

		// Verify nested level 2 argument (Post.comments.includeReplies)
		require.Contains(t, argumentMap, "comments.includeReplies", "Should track doubly nested field argument")
		assert.Equal(t, "Post", argumentMap["comments.includeReplies"].TypeName)
		assert.Equal(t, "Boolean", argumentMap["comments.includeReplies"].NamedType)
		assert.False(t, argumentMap["comments.includeReplies"].IsNull)

		// Verify nested level 2 implicit null argument (Post.comments.after)
		require.Contains(t, argumentMap, "comments.after", "Should track implicit null doubly nested argument")
		assert.Equal(t, "Post", argumentMap["comments.after"].TypeName)
		assert.Equal(t, "String", argumentMap["comments.after"].NamedType)
		assert.True(t, argumentMap["comments.after"].IsNull, "after was not provided, should be implicitly null")

		// Verify nested level 3 argument (Comment.replies.maxDepth)
		require.Contains(t, argumentMap, "replies.maxDepth", "Should track triply nested field argument")
		assert.Equal(t, "Comment", argumentMap["replies.maxDepth"].TypeName)
		assert.Equal(t, "Int", argumentMap["replies.maxDepth"].NamedType)
		assert.False(t, argumentMap["replies.maxDepth"].IsNull)

		// Verify all arguments have correct subgraph IDs
		for key, arg := range argumentMap {
			assert.Equal(t, []string{"main-subgraph"}, arg.SubgraphIDs, "Argument %s should have main-subgraph", key)
		}
	})

	t.Run("nested arguments with input object types", func(t *testing.T) {
		operation := `
			query GetUserFriends($userId: ID!, $friendFilter: FriendFilter) {
				user(id: $userId) {
					id
					friends(filter: $friendFilter, limit: 5) {
						id
						name
					}
				}
			}
		`

		variables := `{
			"userId": "123",
			"friendFilter": {
				"minAge": 18,
				"maxAge": 65
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
			"main-subgraph",
			&FakeFactory[any]{upstreamSchema: &def},
			&plan.DataSourceMetadata{
				RootNodes: []plan.TypeField{
					{TypeName: "Query", FieldNames: []string{"user"}},
				},
				ChildNodes: []plan.TypeField{
					{TypeName: "User", FieldNames: []string{"id", "name", "friends"}},
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

		generatedPlan := planner.Plan(&op, &def, "GetUserFriends", report)
		require.False(t, report.HasErrors())

		vars, err := astjson.Parse(variables)
		require.NoError(t, err)

		argumentUsageInfo, err := GetArgumentUsageInfo(&op, &def, vars, generatedPlan, nil)
		require.NoError(t, err)
		inputUsageInfo, err := GetInputUsageInfo(&op, &def, vars, generatedPlan, nil)
		require.NoError(t, err)

		// Build maps for easier assertion
		argumentMap := make(map[string]*graphqlmetricsv1.ArgumentUsageInfo)
		for _, arg := range argumentUsageInfo {
			key := strings.Join(arg.Path, ".")
			argumentMap[key] = arg
		}

		inputMap := make(map[string]*graphqlmetricsv1.InputUsageInfo)
		for _, input := range inputUsageInfo {
			key := strings.Join(input.Path, ".")
			inputMap[key] = input
		}

		// Verify nested argument with input object type
		require.Contains(t, argumentMap, "friends.filter", "Should track nested argument with input type")
		filterArg := argumentMap["friends.filter"]
		assert.Equal(t, "User", filterArg.TypeName)
		assert.Equal(t, "FriendFilter", filterArg.NamedType)
		assert.False(t, filterArg.IsNull)

		// Verify nested argument with scalar type
		require.Contains(t, argumentMap, "friends.limit", "Should track nested argument with scalar type")
		limitArg := argumentMap["friends.limit"]
		assert.Equal(t, "User", limitArg.TypeName)
		assert.Equal(t, "Int", limitArg.NamedType)
		assert.False(t, limitArg.IsNull)

		// Verify implicit null for missing offset argument
		require.Contains(t, argumentMap, "friends.offset", "Should track implicit null for nested argument")
		offsetArg := argumentMap["friends.offset"]
		assert.Equal(t, "User", offsetArg.TypeName)
		assert.Equal(t, "Int", offsetArg.NamedType)
		assert.True(t, offsetArg.IsNull, "offset was not provided, should be implicitly null")

		// Verify input usage for the filter input object
		require.Contains(t, inputMap, "FriendFilter", "Should track FriendFilter input type")
		assert.Equal(t, "FriendFilter", inputMap["FriendFilter"].NamedType)
		assert.False(t, inputMap["FriendFilter"].IsNull)

		// Verify input fields
		require.Contains(t, inputMap, "FriendFilter.minAge", "Should track FriendFilter.minAge field")
		assert.Equal(t, "Int", inputMap["FriendFilter.minAge"].NamedType)
		assert.Equal(t, "FriendFilter", inputMap["FriendFilter.minAge"].TypeName)
		assert.False(t, inputMap["FriendFilter.minAge"].IsNull)

		require.Contains(t, inputMap, "FriendFilter.maxAge", "Should track FriendFilter.maxAge field")
		assert.Equal(t, "Int", inputMap["FriendFilter.maxAge"].NamedType)
		assert.Equal(t, "FriendFilter", inputMap["FriendFilter.maxAge"].TypeName)
		assert.False(t, inputMap["FriendFilter.maxAge"].IsNull)
	})

	t.Run("nested arguments with null input object", func(t *testing.T) {
		operation := `
			query GetUserFriends($userId: ID!, $friendFilter: FriendFilter) {
				user(id: $userId) {
					id
					friends(filter: $friendFilter) {
						id
						name
					}
				}
			}
		`

		variables := `{
			"userId": "123",
			"friendFilter": null
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
			"main-subgraph",
			&FakeFactory[any]{upstreamSchema: &def},
			&plan.DataSourceMetadata{
				RootNodes: []plan.TypeField{
					{TypeName: "Query", FieldNames: []string{"user"}},
				},
				ChildNodes: []plan.TypeField{
					{TypeName: "User", FieldNames: []string{"id", "name", "friends"}},
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

		generatedPlan := planner.Plan(&op, &def, "GetUserFriends", report)
		require.False(t, report.HasErrors())

		vars, err := astjson.Parse(variables)
		require.NoError(t, err)

		argumentUsageInfo, err := GetArgumentUsageInfo(&op, &def, vars, generatedPlan, nil)
		require.NoError(t, err)
		inputUsageInfo, err := GetInputUsageInfo(&op, &def, vars, generatedPlan, nil)
		require.NoError(t, err)

		// Build map for argument assertion
		argumentMap := make(map[string]*graphqlmetricsv1.ArgumentUsageInfo)
		for _, arg := range argumentUsageInfo {
			key := strings.Join(arg.Path, ".")
			argumentMap[key] = arg
		}

		// Verify nested argument with null input object
		require.Contains(t, argumentMap, "friends.filter", "Should track nested argument even when null")
		filterArg := argumentMap["friends.filter"]
		assert.Equal(t, "User", filterArg.TypeName)
		assert.Equal(t, "FriendFilter", filterArg.NamedType)
		assert.True(t, filterArg.IsNull, "filter variable is explicitly null")

		// Verify input usage tracks the null FriendFilter
		var friendFilterUsage *graphqlmetricsv1.InputUsageInfo
		for _, input := range inputUsageInfo {
			if input.NamedType == "FriendFilter" && len(input.Path) == 1 {
				friendFilterUsage = input
				break
			}
		}
		require.NotNil(t, friendFilterUsage, "Should track FriendFilter input type even when null")
		assert.Equal(t, "FriendFilter", friendFilterUsage.NamedType)
		assert.True(t, friendFilterUsage.IsNull, "FriendFilter should be tracked as null")
	})

	t.Run("nested arguments across multiple subgraphs", func(t *testing.T) {
		// Enhanced schema with more types that span multiple subgraphs
		multiSubgraphSchema := `
			schema {
				query: Query
			}
			
			type Query {
				user(id: ID!): User
				product(id: ID!): Product
				order(id: ID!): Order
			}
			
			type User {
				id: ID!
				name: String!
				friends(limit: Int, filter: UserFilter): [User!]!
				orders(status: OrderStatus, limit: Int): [Order!]!
			}
			
			type Product {
				id: ID!
				name: String!
				reviews(filter: ReviewFilter!, limit: Int): [Review!]!
			}
			
			type Review {
				id: ID!
				rating: Int!
				author: User
				comments(first: Int, sortBy: String): [ReviewComment!]!
			}
			
			type ReviewComment {
				id: ID!
				text: String!
			}
			
			type Order {
				id: ID!
				status: OrderStatus!
				items(category: String): [OrderItem!]!
				customer: User
			}
			
			type OrderItem {
				id: ID!
				product: Product
				quantity: Int!
			}
			
			input UserFilter {
				minAge: Int
				verified: Boolean
			}
			
			input ReviewFilter {
				minRating: Int
				verified: Boolean
			}
			
			enum OrderStatus {
				PENDING
				SHIPPED
				DELIVERED
			}
		`

		operation := `
			query GetUserDataAcrossSubgraphs($userId: ID!, $userFilter: UserFilter, $reviewFilter: ReviewFilter!, $orderStatus: OrderStatus) {
				user(id: $userId) {
					id
					name
					friends(limit: 10, filter: $userFilter) {
						id
						name
					}
					orders(status: $orderStatus, limit: 5) {
						id
						status
						items(category: "electronics") {
							id
							quantity
							product {
								id
								name
								reviews(filter: $reviewFilter, limit: 3) {
									id
									rating
									comments(first: 5, sortBy: "date") {
										id
										text
									}
								}
							}
						}
					}
				}
			}
		`

		variables := `{
			"userId": "user-123",
			"userFilter": {
				"minAge": 18,
				"verified": true
			},
			"reviewFilter": {
				"minRating": 4,
				"verified": true
			},
			"orderStatus": "SHIPPED"
		}`

		def, rep := astparser.ParseGraphqlDocumentString(multiSubgraphSchema)
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

		// Create THREE subgraphs - users, products, and orders come from different sources
		usersSubgraph, err := plan.NewDataSourceConfiguration[any](
			"users-subgraph",
			&FakeFactory[any]{upstreamSchema: &def},
			&plan.DataSourceMetadata{
				RootNodes: []plan.TypeField{
					{TypeName: "Query", FieldNames: []string{"user"}},
				},
				ChildNodes: []plan.TypeField{
					{TypeName: "User", FieldNames: []string{"id", "name", "friends", "orders"}},
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
					{TypeName: "Product", FieldNames: []string{"id", "name", "reviews"}},
				},
				ChildNodes: []plan.TypeField{
					{TypeName: "Product", FieldNames: []string{"id", "name", "reviews"}},
					{TypeName: "Review", FieldNames: []string{"id", "rating", "author", "comments"}},
					{TypeName: "ReviewComment", FieldNames: []string{"id", "text"}},
				},
			},
			nil,
		)
		require.NoError(t, err)

		ordersSubgraph, err := plan.NewDataSourceConfiguration[any](
			"orders-subgraph",
			&FakeFactory[any]{upstreamSchema: &def},
			&plan.DataSourceMetadata{
				RootNodes: []plan.TypeField{
					{TypeName: "Query", FieldNames: []string{"order"}},
					{TypeName: "Order", FieldNames: []string{"id", "status", "items", "customer"}},
				},
				ChildNodes: []plan.TypeField{
					{TypeName: "Order", FieldNames: []string{"id", "status", "items", "customer"}},
					{TypeName: "OrderItem", FieldNames: []string{"id", "product", "quantity"}},
				},
			},
			nil,
		)
		require.NoError(t, err)

		planner, err := plan.NewPlanner(plan.Configuration{
			DisableResolveFieldPositions: true,
			DataSources:                  []plan.DataSource{usersSubgraph, productsSubgraph, ordersSubgraph},
		})
		require.NoError(t, err)

		generatedPlan := planner.Plan(&op, &def, "GetUserDataAcrossSubgraphs", report)
		require.False(t, report.HasErrors())

		vars, err := astjson.Parse(variables)
		require.NoError(t, err)

		argumentUsageInfo, err := GetArgumentUsageInfo(&op, &def, vars, generatedPlan, nil)
		require.NoError(t, err)
		inputUsageInfo, err := GetInputUsageInfo(&op, &def, vars, generatedPlan, nil)
		require.NoError(t, err)

		// Build map for argument assertion
		argumentMap := make(map[string]*graphqlmetricsv1.ArgumentUsageInfo)
		for _, arg := range argumentUsageInfo {
			key := strings.Join(arg.Path, ".")
			argumentMap[key] = arg
		}

		// Build map for input assertion
		inputMap := make(map[string]*graphqlmetricsv1.InputUsageInfo)
		for _, input := range inputUsageInfo {
			key := strings.Join(input.Path, ".")
			inputMap[key] = input
		}

		// ========================================
		// Verify USERS SUBGRAPH arguments
		// ========================================

		// Root level: Query.user(id:) -> users-subgraph
		require.Contains(t, argumentMap, "user.id", "Should track Query.user(id:)")
		assert.Equal(t, "Query", argumentMap["user.id"].TypeName)
		assert.Equal(t, "ID", argumentMap["user.id"].NamedType)
		assert.Equal(t, []string{"users-subgraph"}, argumentMap["user.id"].SubgraphIDs,
			"Query.user argument should be attributed to users-subgraph")
		assert.False(t, argumentMap["user.id"].IsNull)

		// Nested level 1: User.friends(limit:) -> users-subgraph
		require.Contains(t, argumentMap, "friends.limit", "Should track User.friends(limit:)")
		assert.Equal(t, "User", argumentMap["friends.limit"].TypeName)
		assert.Equal(t, "Int", argumentMap["friends.limit"].NamedType)
		assert.Equal(t, []string{"users-subgraph"}, argumentMap["friends.limit"].SubgraphIDs,
			"User.friends.limit argument should be attributed to users-subgraph")
		assert.False(t, argumentMap["friends.limit"].IsNull)

		// Nested level 1: User.friends(filter:) -> users-subgraph (input object type)
		require.Contains(t, argumentMap, "friends.filter", "Should track User.friends(filter:)")
		assert.Equal(t, "User", argumentMap["friends.filter"].TypeName)
		assert.Equal(t, "UserFilter", argumentMap["friends.filter"].NamedType)
		assert.Equal(t, []string{"users-subgraph"}, argumentMap["friends.filter"].SubgraphIDs,
			"User.friends.filter argument should be attributed to users-subgraph")
		assert.False(t, argumentMap["friends.filter"].IsNull)

		// Nested level 1: User.orders(status:) -> users-subgraph
		require.Contains(t, argumentMap, "orders.status", "Should track User.orders(status:)")
		assert.Equal(t, "User", argumentMap["orders.status"].TypeName)
		assert.Equal(t, "OrderStatus", argumentMap["orders.status"].NamedType)
		assert.Equal(t, []string{"users-subgraph"}, argumentMap["orders.status"].SubgraphIDs,
			"User.orders.status argument should be attributed to users-subgraph")
		assert.False(t, argumentMap["orders.status"].IsNull)

		// Nested level 1: User.orders(limit:) -> users-subgraph
		require.Contains(t, argumentMap, "orders.limit", "Should track User.orders(limit:)")
		assert.Equal(t, "User", argumentMap["orders.limit"].TypeName)
		assert.Equal(t, "Int", argumentMap["orders.limit"].NamedType)
		assert.Equal(t, []string{"users-subgraph"}, argumentMap["orders.limit"].SubgraphIDs,
			"User.orders.limit argument should be attributed to users-subgraph")
		assert.False(t, argumentMap["orders.limit"].IsNull)

		// ========================================
		// Verify ORDERS SUBGRAPH arguments
		// ========================================

		// Nested level 2: Order.items(category:) -> orders-subgraph
		require.Contains(t, argumentMap, "items.category", "Should track Order.items(category:)")
		assert.Equal(t, "Order", argumentMap["items.category"].TypeName)
		assert.Equal(t, "String", argumentMap["items.category"].NamedType)
		assert.Equal(t, []string{"orders-subgraph"}, argumentMap["items.category"].SubgraphIDs,
			"Order.items.category argument should be attributed to orders-subgraph")
		assert.False(t, argumentMap["items.category"].IsNull)

		// ========================================
		// Verify PRODUCTS SUBGRAPH arguments
		// ========================================

		// Nested level 4: Product.reviews(filter:) -> products-subgraph
		require.Contains(t, argumentMap, "reviews.filter", "Should track Product.reviews(filter:)")
		assert.Equal(t, "Product", argumentMap["reviews.filter"].TypeName)
		assert.Equal(t, "ReviewFilter", argumentMap["reviews.filter"].NamedType)
		assert.Equal(t, []string{"products-subgraph"}, argumentMap["reviews.filter"].SubgraphIDs,
			"Product.reviews.filter argument should be attributed to products-subgraph")
		assert.False(t, argumentMap["reviews.filter"].IsNull)

		// Nested level 4: Product.reviews(limit:) -> products-subgraph
		require.Contains(t, argumentMap, "reviews.limit", "Should track Product.reviews(limit:)")
		assert.Equal(t, "Product", argumentMap["reviews.limit"].TypeName)
		assert.Equal(t, "Int", argumentMap["reviews.limit"].NamedType)
		assert.Equal(t, []string{"products-subgraph"}, argumentMap["reviews.limit"].SubgraphIDs,
			"Product.reviews.limit argument should be attributed to products-subgraph")
		assert.False(t, argumentMap["reviews.limit"].IsNull)

		// Nested level 5: Review.comments(first:) -> products-subgraph
		require.Contains(t, argumentMap, "comments.first", "Should track Review.comments(first:)")
		assert.Equal(t, "Review", argumentMap["comments.first"].TypeName)
		assert.Equal(t, "Int", argumentMap["comments.first"].NamedType)
		assert.Equal(t, []string{"products-subgraph"}, argumentMap["comments.first"].SubgraphIDs,
			"Review.comments.first argument should be attributed to products-subgraph")
		assert.False(t, argumentMap["comments.first"].IsNull)

		// Nested level 5: Review.comments(sortBy:) -> products-subgraph
		require.Contains(t, argumentMap, "comments.sortBy", "Should track Review.comments(sortBy:)")
		assert.Equal(t, "Review", argumentMap["comments.sortBy"].TypeName)
		assert.Equal(t, "String", argumentMap["comments.sortBy"].NamedType)
		assert.Equal(t, []string{"products-subgraph"}, argumentMap["comments.sortBy"].SubgraphIDs,
			"Review.comments.sortBy argument should be attributed to products-subgraph")
		assert.False(t, argumentMap["comments.sortBy"].IsNull)

		// ========================================
		// Verify INPUT TYPE subgraph attribution
		// ========================================

		// UserFilter should be attributed to users-subgraph (used by User.friends)
		require.Contains(t, inputMap, "UserFilter", "Should track UserFilter input type")
		assert.Equal(t, "UserFilter", inputMap["UserFilter"].NamedType)
		assert.Equal(t, []string{"users-subgraph"}, inputMap["UserFilter"].SubgraphIDs,
			"UserFilter should be attributed to users-subgraph")
		assert.False(t, inputMap["UserFilter"].IsNull)

		// UserFilter.minAge field
		require.Contains(t, inputMap, "UserFilter.minAge", "Should track UserFilter.minAge field")
		assert.Equal(t, "Int", inputMap["UserFilter.minAge"].NamedType)
		assert.Equal(t, "UserFilter", inputMap["UserFilter.minAge"].TypeName)
		assert.Equal(t, []string{"users-subgraph"}, inputMap["UserFilter.minAge"].SubgraphIDs,
			"UserFilter.minAge should be attributed to users-subgraph")

		// UserFilter.verified field
		require.Contains(t, inputMap, "UserFilter.verified", "Should track UserFilter.verified field")
		assert.Equal(t, "Boolean", inputMap["UserFilter.verified"].NamedType)
		assert.Equal(t, "UserFilter", inputMap["UserFilter.verified"].TypeName)
		assert.Equal(t, []string{"users-subgraph"}, inputMap["UserFilter.verified"].SubgraphIDs,
			"UserFilter.verified should be attributed to users-subgraph")

		// ReviewFilter should be attributed to products-subgraph (used by Product.reviews)
		require.Contains(t, inputMap, "ReviewFilter", "Should track ReviewFilter input type")
		assert.Equal(t, "ReviewFilter", inputMap["ReviewFilter"].NamedType)
		assert.Equal(t, []string{"products-subgraph"}, inputMap["ReviewFilter"].SubgraphIDs,
			"ReviewFilter should be attributed to products-subgraph")
		assert.False(t, inputMap["ReviewFilter"].IsNull)

		// ReviewFilter.minRating field
		require.Contains(t, inputMap, "ReviewFilter.minRating", "Should track ReviewFilter.minRating field")
		assert.Equal(t, "Int", inputMap["ReviewFilter.minRating"].NamedType)
		assert.Equal(t, "ReviewFilter", inputMap["ReviewFilter.minRating"].TypeName)
		assert.Equal(t, []string{"products-subgraph"}, inputMap["ReviewFilter.minRating"].SubgraphIDs,
			"ReviewFilter.minRating should be attributed to products-subgraph")

		// ReviewFilter.verified field
		require.Contains(t, inputMap, "ReviewFilter.verified", "Should track ReviewFilter.verified field")
		assert.Equal(t, "Boolean", inputMap["ReviewFilter.verified"].NamedType)
		assert.Equal(t, "ReviewFilter", inputMap["ReviewFilter.verified"].TypeName)
		assert.Equal(t, []string{"products-subgraph"}, inputMap["ReviewFilter.verified"].SubgraphIDs,
			"ReviewFilter.verified should be attributed to products-subgraph")

		// ========================================
		// Verify ENUM usage subgraph attribution
		// ========================================

		// OrderStatus enum used by User.orders should be attributed to users-subgraph
		var orderStatusUsage *graphqlmetricsv1.InputUsageInfo
		for _, input := range inputUsageInfo {
			if input.NamedType == "OrderStatus" && len(input.EnumValues) > 0 {
				orderStatusUsage = input
				break
			}
		}
		require.NotNil(t, orderStatusUsage, "Should track OrderStatus enum usage")
		assert.Equal(t, []string{"users-subgraph"}, orderStatusUsage.SubgraphIDs,
			"OrderStatus enum should be attributed to users-subgraph (used by User.orders)")
		assert.Contains(t, orderStatusUsage.EnumValues, "SHIPPED")

		// ========================================
		// Verify NO CROSS-CONTAMINATION
		// ========================================

		// Ensure users-subgraph arguments don't have products-subgraph or orders-subgraph
		for key, arg := range argumentMap {
			if arg.TypeName == "User" {
				assert.NotContains(t, arg.SubgraphIDs, "products-subgraph",
					"User field argument %s should not have products-subgraph", key)
				assert.NotContains(t, arg.SubgraphIDs, "orders-subgraph",
					"User field argument %s should not have orders-subgraph", key)
			}
			if arg.TypeName == "Product" || arg.TypeName == "Review" {
				assert.NotContains(t, arg.SubgraphIDs, "users-subgraph",
					"Product/Review field argument %s should not have users-subgraph", key)
				assert.NotContains(t, arg.SubgraphIDs, "orders-subgraph",
					"Product/Review field argument %s should not have orders-subgraph", key)
			}
			if arg.TypeName == "Order" || arg.TypeName == "OrderItem" {
				assert.NotContains(t, arg.SubgraphIDs, "users-subgraph",
					"Order/OrderItem field argument %s should not have users-subgraph", key)
				assert.NotContains(t, arg.SubgraphIDs, "products-subgraph",
					"Order/OrderItem field argument %s should not have products-subgraph", key)
			}
		}
	})
}

// TestNilVariablesHandling verifies that nil variables are handled gracefully without panicking.
// This is a defensive test to ensure the API doesn't crash when callers pass nil for variables.
func TestNilVariablesHandling(t *testing.T) {
	schema := `
		schema {
			query: Query
		}
		
		type Query {
			findEmployees(criteria: SearchInput): [Employee!]!
		}
		
		type Employee {
			id: ID!
		}
		
		input SearchInput {
			department: String
			minAge: Int
		}
	`

	operation := `
		query FindEmployees($criteria: SearchInput) {
			findEmployees(criteria: $criteria) {
				id
			}
		}
	`

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

	dsCfg, err := plan.NewDataSourceConfiguration(
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

	// Test with nil variables - should not panic
	t.Run("nil variables for GetInputUsageInfo", func(t *testing.T) {
		inputUsageInfo, err := GetInputUsageInfo(&op, &def, nil, generatedPlan, nil)
		require.NoError(t, err)

		// Should track SearchInput as implicitly null since variable not provided
		var searchInputUsage *graphqlmetricsv1.InputUsageInfo
		for _, input := range inputUsageInfo {
			if input.NamedType == "SearchInput" && len(input.Path) == 1 {
				searchInputUsage = input
				break
			}
		}

		require.NotNil(t, searchInputUsage, "Should track SearchInput even with nil variables")
		assert.Equal(t, "SearchInput", searchInputUsage.NamedType)
		assert.True(t, searchInputUsage.IsNull, "SearchInput should be null when variables is nil")
		assert.Equal(t, []string{"employees-subgraph"}, searchInputUsage.SubgraphIDs)
	})

	t.Run("nil variables for GetArgumentUsageInfo", func(t *testing.T) {
		// Should not panic
		argumentUsageInfo, err := GetArgumentUsageInfo(&op, &def, nil, generatedPlan, nil)
		require.NoError(t, err)

		// Should track the criteria argument
		require.Len(t, argumentUsageInfo, 1)
		assert.Equal(t, "SearchInput", argumentUsageInfo[0].NamedType)
		assert.Equal(t, []string{"findEmployees", "criteria"}, argumentUsageInfo[0].Path)
		// With nil variables, we can't determine if the variable value is null
		// so IsNull will be false (default behavior when variable can't be resolved)
		assert.False(t, argumentUsageInfo[0].IsNull)
	})
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
