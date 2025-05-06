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
	argumentUsageInfo, err := GetArgumentUsageInfo(&op, &def)
	assert.NoError(t, err)
	inputUsageInfo, err := GetInputUsageInfo(&op, &def, merged)
	assert.NoError(t, err)

	subscription := &plan.SubscriptionResponsePlan{
		Response: &resolve.GraphQLSubscription{
			Response: generatedPlan.(*plan.SynchronousResponsePlan).Response,
		},
	}

	subscriptionFieldUsageInfo := GetTypeFieldUsageInfo(subscription)
	subscriptionArgumentUsageInfo, err := GetArgumentUsageInfo(&op, &def)
	assert.NoError(t, err)
	subscriptionInputUsageInfo, err := GetInputUsageInfo(&op, &def, merged)
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
			TypeName:  "Query",
			NamedType: "String",
			Path:      []string{"searchResults", "name"},
		},
		{
			TypeName:  "Query",
			NamedType: "SearchFilter",
			Path:      []string{"searchResults", "filter"},
		},
		{
			TypeName:  "Query",
			NamedType: "SearchFilter",
			Path:      []string{"searchResults", "filter2"},
		},
		{
			TypeName:  "Query",
			NamedType: "Episode",
			Path:      []string{"searchResults", "enumValue"},
		},
		{
			TypeName:  "Query",
			NamedType: "Episode",
			Path:      []string{"searchResults", "enumList"},
		},
		{
			TypeName:  "Query",
			NamedType: "Episode",
			Path:      []string{"searchResults", "enumList2"},
		},
		{
			TypeName:  "Query",
			NamedType: "SearchFilter",
			Path:      []string{"searchResults", "filterList"},
		},
		{
			TypeName:  "Human",
			NamedType: "String",
			Path:      []string{"inlineName", "name"},
		},
	}

	expectedInputUsageInfo := []graphqlmetricsv1.InputUsageInfo{
		{
			NamedType: "String",
		},
		{
			NamedType:  "Episode",
			TypeName:   "SearchFilter",
			EnumValues: []string{"NEWHOPE"},
			Path:       []string{"SearchFilter", "enumField"},
		},
		{
			NamedType: "SearchFilter",
		},
		{
			NamedType:  "Episode",
			EnumValues: []string{"EMPIRE"},
		},
		{
			NamedType:  "Episode",
			EnumValues: []string{"JEDI", "EMPIRE", "NEWHOPE"},
		},
		{
			NamedType: "String",
			TypeName:  "SearchFilter",
			Path:      []string{"SearchFilter", "excludeName"},
		},
		{
			NamedType:  "Episode",
			TypeName:   "SearchFilter",
			EnumValues: []string{"JEDI"},
			Path:       []string{"SearchFilter", "enumField"},
		},
		{
			NamedType:  "Episode",
			EnumValues: []string{"JEDI", "EMPIRE"},
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
	argumentUsageInfo, err := GetArgumentUsageInfo(&op, &def)
	assert.NoError(t, err)
	inputUsageInfo, err := GetInputUsageInfo(&op, &def, astjson.MustParse(`{}`))
	assert.NoError(t, err)

	subscription := &plan.SubscriptionResponsePlan{
		Response: &resolve.GraphQLSubscription{
			Response: generatedPlan.(*plan.SynchronousResponsePlan).Response,
		},
	}

	subscriptionFieldUsageInfo := GetTypeFieldUsageInfo(subscription)
	subscriptionArgumentUsageInfo, err := GetArgumentUsageInfo(&op, &def)
	assert.NoError(t, err)
	subscriptionInputUsageInfo, err := GetInputUsageInfo(&op, &def, astjson.MustParse(`{}`))
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

func (f *FakeFactory[T]) UpstreamSchema(dataSourceConfig plan.DataSourceConfiguration[T]) (*ast.Document, bool) {
	return f.upstreamSchema, true
}

func (f *FakeFactory[T]) Planner(logger abstractlogger.Logger) plan.DataSourcePlanner[T] {
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

func (f *FakePlanner[T]) UpstreamSchema(dataSourceConfig plan.DataSourceConfiguration[T]) (*ast.Document, bool) {
	return f.upstreamSchema, true
}

func (f *FakePlanner[T]) EnterDocument(operation, definition *ast.Document) {

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

func (f *FakePlanner[T]) DataSourcePlanningBehavior() plan.DataSourcePlanningBehavior {
	return plan.DataSourcePlanningBehavior{
		MergeAliasedRootNodes:      false,
		OverrideFieldPathFromAlias: false,
	}
}

func (f *FakePlanner[T]) DownstreamResponseFieldAlias(downstreamFieldRef int) (alias string, exists bool) {
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
