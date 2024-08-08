package integration

import (
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/common"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/execution_config"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRouterConfigParsing(t *testing.T) {
	t.Parallel()
	routerConfig, err := execution_config.FromFile("./testdata/routerConfig.json")
	require.NoError(t, err)

	assert.Equal(t, routerConfig.Version, "96f0fab1-d0a4-4fc1-801d-59f684f8315d")

	assert.NotNil(t, routerConfig.EngineConfig)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations[0].Id)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations[0].Kind)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations[0].RootNodes)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations[0].ChildNodes)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations[0].OverrideFieldPathFromAlias)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations[0].RequestTimeoutSeconds)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations[0].Keys)

	assert.Equal(t, routerConfig.EngineConfig.DefaultFlushInterval, int64(500))
	assert.Equal(t, len(routerConfig.EngineConfig.DatasourceConfigurations), 4)
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].Id, "280b1517-6a51-40d7-b930-456a97db0e93")
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].Kind, nodev1.DataSourceKind(1))
	assert.Equal(t, len(routerConfig.EngineConfig.DatasourceConfigurations[0].RootNodes), 7)
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].RootNodes[0].TypeName, "Query")
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].RootNodes[0].FieldNames, []string{"employee", "employees", "products", "teammates"})
	assert.Equal(t, len(routerConfig.EngineConfig.DatasourceConfigurations[0].ChildNodes), 8)
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].ChildNodes[0].TypeName, "RoleType")
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].ChildNodes[0].FieldNames, []string{"departments", "title"})
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].OverrideFieldPathFromAlias, true)
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.Fetch.Url.StaticVariableContent, "http://localhost:4001/graphql")
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.Fetch.Method, nodev1.HTTPMethod(1))
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.Subscription.Enabled, true)
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.Subscription.GetProtocol(), common.GraphQLSubscriptionProtocol(0))
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.Federation.ServiceSdl, "type Query {\n  employee(id: Int!): Employee\n  employees: [Employee!]!\n  products: [Products!]!\n  teammates(team: Department!): [Employee!]!\n}\n\ntype Mutation {\n  updateEmployeeTag(id: Int!, tag: String!): Employee\n}\n\ntype Subscription {\n  \"\"\"\n  `currentTime` will return a stream of `Time` objects.\n  \"\"\"\n  currentTime: Time!\n}\n\nenum Department {\n  ENGINEERING\n  MARKETING\n  OPERATIONS\n}\n\ninterface RoleType {\n  departments: [Department!]!\n  title: [String!]!\n}\n\nenum EngineerType {\n  BACKEND\n  FRONTEND\n  FULLSTACK\n}\n\ninterface Identifiable {\n  id: Int!\n}\n\ntype Engineer implements RoleType {\n  departments: [Department!]!\n  engineerType: EngineerType!\n  title: [String!]!\n}\n\ntype Marketer implements RoleType{\n  departments: [Department!]!\n  title: [String!]!\n}\n\nenum OperationType {\n  FINANCE\n  HUMAN_RESOURCES\n}\n\ntype Operator implements RoleType {\n  departments: [Department!]!\n  operatorType: [OperationType!]!\n  title: [String!]!\n}\n\nenum Country {\n  AMERICA\n  ENGLAND\n  GERMANY\n  INDIA\n  NETHERLANDS\n  PORTUGAL\n  SPAIN\n  UKRAINE\n}\n\ntype Details @shareable {\n  forename: String!\n  location: Country!\n  surname: String!\n}\n\ntype Employee implements Identifiable @key(fields: \"id\") {\n  details: Details! @shareable\n  id: Int!\n  tag: String!\n  role: RoleType!\n  notes: String\n  updatedAt: String!\n}\n\ntype Time {\n  unixTime: Int!\n  timeStamp: String!\n}\n\nunion Products = Consultancy | Cosmo | SDK\n\ninterface IProduct {\n  upc: ID!\n  engineers: [Employee!]!\n}\n\ntype Consultancy @key(fields: \"upc\") {\n  upc: ID!\n  lead: Employee!\n}\n\ntype Cosmo implements IProduct @key(fields: \"upc\") {\n  upc: ID!\n  engineers: [Employee!]!\n  lead: Employee!\n}\n\ntype SDK implements IProduct @key(fields: \"upc\") {\n  upc: ID!\n  engineers: [Employee!]!\n  owner: Employee!\n}\n")
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.Federation.Enabled, true)
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.UpstreamSchema.Key, "3ff225598d21485cbe809f9a750b57bdfcaf5010")
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].RequestTimeoutSeconds, int64(10))
	assert.Equal(t, len(routerConfig.EngineConfig.DatasourceConfigurations[0].Keys), 4)
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].Keys[0].SelectionSet, "id")
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].Keys[0].TypeName, "Employee")

	assert.NotNil(t, routerConfig.EngineConfig.FieldConfigurations)
	assert.NotNil(t, routerConfig.EngineConfig.FieldConfigurations[0].TypeName)
	assert.NotNil(t, routerConfig.EngineConfig.FieldConfigurations[0].FieldName)
	assert.NotNil(t, routerConfig.EngineConfig.FieldConfigurations[0].ArgumentsConfiguration)

	assert.Equal(t, len(routerConfig.EngineConfig.FieldConfigurations), 6)
	assert.Equal(t, routerConfig.EngineConfig.FieldConfigurations[0].TypeName, "Query")
	assert.Equal(t, routerConfig.EngineConfig.FieldConfigurations[0].FieldName, "employee")
	assert.Equal(t, len(routerConfig.EngineConfig.FieldConfigurations[0].ArgumentsConfiguration), 1)
	assert.Equal(t, routerConfig.EngineConfig.FieldConfigurations[0].ArgumentsConfiguration[0].Name, "id")
	assert.Equal(t, routerConfig.EngineConfig.FieldConfigurations[0].ArgumentsConfiguration[0].SourceType, nodev1.ArgumentSource(1))

	assert.NotNil(t, routerConfig.EngineConfig.StringStorage)
	assert.Equal(t, routerConfig.EngineConfig.StringStorage["3ff225598d21485cbe809f9a750b57bdfcaf5010"], "schema {\n  query: Query\n  mutation: Mutation\n  subscription: Subscription\n}\n\ndirective @composeDirective(name: String!) repeatable on SCHEMA\n\ndirective @eventsPublish(sourceName: String! = \"default\", topic: String!) on FIELD_DEFINITION\n\ndirective @eventsRequest(sourceName: String! = \"default\", topic: String!) on FIELD_DEFINITION\n\ndirective @eventsSubscribe(sourceName: String! = \"default\", topic: String!) on FIELD_DEFINITION\n\ndirective @extends on INTERFACE | OBJECT\n\ndirective @external on FIELD_DEFINITION | OBJECT\n\ndirective @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION\n\ndirective @interfaceObject on OBJECT\n\ndirective @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT\n\ndirective @link(as: String, for: String, import: [String], url: String!) repeatable on SCHEMA\n\ndirective @override(from: String!) on FIELD_DEFINITION\n\ndirective @provides(fields: openfed__FieldSet!) on FIELD_DEFINITION\n\ndirective @requires(fields: openfed__FieldSet!) on FIELD_DEFINITION\n\ndirective @shareable on FIELD_DEFINITION | OBJECT\n\ndirective @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION\n\ntype Consultancy @key(fields: \"upc\") {\n  lead: Employee!\n  upc: ID!\n}\n\ntype Cosmo implements IProduct @key(fields: \"upc\") {\n  engineers: [Employee!]!\n  lead: Employee!\n  upc: ID!\n}\n\nenum Country {\n  AMERICA\n  ENGLAND\n  GERMANY\n  INDIA\n  NETHERLANDS\n  PORTUGAL\n  SPAIN\n  UKRAINE\n}\n\nenum Department {\n  ENGINEERING\n  MARKETING\n  OPERATIONS\n}\n\ntype Details @shareable {\n  forename: String!\n  location: Country!\n  surname: String!\n}\n\ntype Employee implements Identifiable @key(fields: \"id\") {\n  details: Details! @shareable\n  id: Int!\n  notes: String\n  role: RoleType!\n  tag: String!\n  updatedAt: String!\n}\n\ntype Engineer implements RoleType {\n  departments: [Department!]!\n  engineerType: EngineerType!\n  title: [String!]!\n}\n\nenum EngineerType {\n  BACKEND\n  FRONTEND\n  FULLSTACK\n}\n\ninterface IProduct {\n  engineers: [Employee!]!\n  upc: ID!\n}\n\ninterface Identifiable {\n  id: Int!\n}\n\ntype Marketer implements RoleType {\n  departments: [Department!]!\n  title: [String!]!\n}\n\ntype Mutation {\n  updateEmployeeTag(id: Int!, tag: String!): Employee\n}\n\nenum OperationType {\n  FINANCE\n  HUMAN_RESOURCES\n}\n\ntype Operator implements RoleType {\n  departments: [Department!]!\n  operatorType: [OperationType!]!\n  title: [String!]!\n}\n\nunion Products = Consultancy | Cosmo | SDK\n\ntype Query {\n  employee(id: Int!): Employee\n  employees: [Employee!]!\n  products: [Products!]!\n  teammates(team: Department!): [Employee!]!\n}\n\ninterface RoleType {\n  departments: [Department!]!\n  title: [String!]!\n}\n\ntype SDK implements IProduct @key(fields: \"upc\") {\n  engineers: [Employee!]!\n  owner: Employee!\n  upc: ID!\n}\n\ntype Subscription {\n  \"\"\"`currentTime` will return a stream of `Time` objects.\"\"\"\n  currentTime: Time!\n}\n\ntype Time {\n  timeStamp: String!\n  unixTime: Int!\n}\n\nscalar openfed__FieldSet")

	assert.NotNil(t, routerConfig.EngineConfig.GraphqlSchema)
	assert.NotEqual(t, routerConfig.EngineConfig.FieldConfigurations, "")

	assert.NotNil(t, routerConfig.Subgraphs)
	assert.Equal(t, len(routerConfig.Subgraphs), 4)
	assert.NotNil(t, routerConfig.Subgraphs[0].Id)
	assert.NotNil(t, routerConfig.Subgraphs[0].Name)
	assert.NotNil(t, routerConfig.Subgraphs[0].RoutingUrl)
	assert.Equal(t, routerConfig.Subgraphs[0].Name, "employees")
	assert.Equal(t, routerConfig.Subgraphs[0].Id, "280b1517-6a51-40d7-b930-456a97db0e93")
	assert.Equal(t, routerConfig.Subgraphs[0].RoutingUrl, "http://localhost:4001/graphql")
}

func TestRouterConfigParsingOfUnknownProperties(t *testing.T) {
	t.Parallel()
	routerConfig, err := execution_config.FromFile("./testdata/routerConfigWithUnknownProperties.json")
	require.NoError(t, err)

	assert.Equal(t, routerConfig.Version, "96f0fab1-d0a4-4fc1-801d-59f684f8315d")

	assert.NotNil(t, routerConfig.EngineConfig)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations[0].Id)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations[0].Kind)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations[0].RootNodes)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations[0].ChildNodes)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations[0].OverrideFieldPathFromAlias)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations[0].RequestTimeoutSeconds)
	assert.NotNil(t, routerConfig.EngineConfig.DatasourceConfigurations[0].Keys)

	assert.Equal(t, routerConfig.EngineConfig.DefaultFlushInterval, int64(500))
	assert.Equal(t, len(routerConfig.EngineConfig.DatasourceConfigurations), 4)
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].Id, "280b1517-6a51-40d7-b930-456a97db0e93")
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].Kind, nodev1.DataSourceKind(1))
	assert.Equal(t, len(routerConfig.EngineConfig.DatasourceConfigurations[0].RootNodes), 7)
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].RootNodes[0].TypeName, "Query")
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].RootNodes[0].FieldNames, []string{"employee", "employees", "products", "teammates"})
	assert.Equal(t, len(routerConfig.EngineConfig.DatasourceConfigurations[0].ChildNodes), 8)
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].ChildNodes[0].TypeName, "RoleType")
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].ChildNodes[0].FieldNames, []string{"departments", "title"})
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].OverrideFieldPathFromAlias, true)
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.Fetch.Url.StaticVariableContent, "http://localhost:4001/graphql")
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.Fetch.Method, nodev1.HTTPMethod(1))
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.Subscription.Enabled, true)
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.Subscription.GetProtocol(), common.GraphQLSubscriptionProtocol(0))
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.Federation.ServiceSdl, "type Query {\n  employee(id: Int!): Employee\n  employees: [Employee!]!\n  products: [Products!]!\n  teammates(team: Department!): [Employee!]!\n}\n\ntype Mutation {\n  updateEmployeeTag(id: Int!, tag: String!): Employee\n}\n\ntype Subscription {\n  \"\"\"\n  `currentTime` will return a stream of `Time` objects.\n  \"\"\"\n  currentTime: Time!\n}\n\nenum Department {\n  ENGINEERING\n  MARKETING\n  OPERATIONS\n}\n\ninterface RoleType {\n  departments: [Department!]!\n  title: [String!]!\n}\n\nenum EngineerType {\n  BACKEND\n  FRONTEND\n  FULLSTACK\n}\n\ninterface Identifiable {\n  id: Int!\n}\n\ntype Engineer implements RoleType {\n  departments: [Department!]!\n  engineerType: EngineerType!\n  title: [String!]!\n}\n\ntype Marketer implements RoleType{\n  departments: [Department!]!\n  title: [String!]!\n}\n\nenum OperationType {\n  FINANCE\n  HUMAN_RESOURCES\n}\n\ntype Operator implements RoleType {\n  departments: [Department!]!\n  operatorType: [OperationType!]!\n  title: [String!]!\n}\n\nenum Country {\n  AMERICA\n  ENGLAND\n  GERMANY\n  INDIA\n  NETHERLANDS\n  PORTUGAL\n  SPAIN\n  UKRAINE\n}\n\ntype Details @shareable {\n  forename: String!\n  location: Country!\n  surname: String!\n}\n\ntype Employee implements Identifiable @key(fields: \"id\") {\n  details: Details! @shareable\n  id: Int!\n  tag: String!\n  role: RoleType!\n  notes: String\n  updatedAt: String!\n}\n\ntype Time {\n  unixTime: Int!\n  timeStamp: String!\n}\n\nunion Products = Consultancy | Cosmo | SDK\n\ninterface IProduct {\n  upc: ID!\n  engineers: [Employee!]!\n}\n\ntype Consultancy @key(fields: \"upc\") {\n  upc: ID!\n  lead: Employee!\n}\n\ntype Cosmo implements IProduct @key(fields: \"upc\") {\n  upc: ID!\n  engineers: [Employee!]!\n  lead: Employee!\n}\n\ntype SDK implements IProduct @key(fields: \"upc\") {\n  upc: ID!\n  engineers: [Employee!]!\n  owner: Employee!\n}\n")
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.Federation.Enabled, true)
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].CustomGraphql.UpstreamSchema.Key, "3ff225598d21485cbe809f9a750b57bdfcaf5010")
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].RequestTimeoutSeconds, int64(10))
	assert.Equal(t, len(routerConfig.EngineConfig.DatasourceConfigurations[0].Keys), 4)
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].Keys[0].SelectionSet, "id")
	assert.Equal(t, routerConfig.EngineConfig.DatasourceConfigurations[0].Keys[0].TypeName, "Employee")

	assert.NotNil(t, routerConfig.EngineConfig.FieldConfigurations)
	assert.NotNil(t, routerConfig.EngineConfig.FieldConfigurations[0].TypeName)
	assert.NotNil(t, routerConfig.EngineConfig.FieldConfigurations[0].FieldName)
	assert.NotNil(t, routerConfig.EngineConfig.FieldConfigurations[0].ArgumentsConfiguration)

	assert.Equal(t, len(routerConfig.EngineConfig.FieldConfigurations), 6)
	assert.Equal(t, routerConfig.EngineConfig.FieldConfigurations[0].TypeName, "Query")
	assert.Equal(t, routerConfig.EngineConfig.FieldConfigurations[0].FieldName, "employee")
	assert.Equal(t, len(routerConfig.EngineConfig.FieldConfigurations[0].ArgumentsConfiguration), 1)
	assert.Equal(t, routerConfig.EngineConfig.FieldConfigurations[0].ArgumentsConfiguration[0].Name, "id")
	assert.Equal(t, routerConfig.EngineConfig.FieldConfigurations[0].ArgumentsConfiguration[0].SourceType, nodev1.ArgumentSource(1))

	assert.NotNil(t, routerConfig.EngineConfig.StringStorage)
	assert.Equal(t, routerConfig.EngineConfig.StringStorage["3ff225598d21485cbe809f9a750b57bdfcaf5010"], "schema {\n  query: Query\n  mutation: Mutation\n  subscription: Subscription\n}\n\ndirective @composeDirective(name: String!) repeatable on SCHEMA\n\ndirective @eventsPublish(sourceName: String! = \"default\", topic: String!) on FIELD_DEFINITION\n\ndirective @eventsRequest(sourceName: String! = \"default\", topic: String!) on FIELD_DEFINITION\n\ndirective @eventsSubscribe(sourceName: String! = \"default\", topic: String!) on FIELD_DEFINITION\n\ndirective @extends on INTERFACE | OBJECT\n\ndirective @external on FIELD_DEFINITION | OBJECT\n\ndirective @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION\n\ndirective @interfaceObject on OBJECT\n\ndirective @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT\n\ndirective @link(as: String, for: String, import: [String], url: String!) repeatable on SCHEMA\n\ndirective @override(from: String!) on FIELD_DEFINITION\n\ndirective @provides(fields: openfed__FieldSet!) on FIELD_DEFINITION\n\ndirective @requires(fields: openfed__FieldSet!) on FIELD_DEFINITION\n\ndirective @shareable on FIELD_DEFINITION | OBJECT\n\ndirective @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION\n\ntype Consultancy @key(fields: \"upc\") {\n  lead: Employee!\n  upc: ID!\n}\n\ntype Cosmo implements IProduct @key(fields: \"upc\") {\n  engineers: [Employee!]!\n  lead: Employee!\n  upc: ID!\n}\n\nenum Country {\n  AMERICA\n  ENGLAND\n  GERMANY\n  INDIA\n  NETHERLANDS\n  PORTUGAL\n  SPAIN\n  UKRAINE\n}\n\nenum Department {\n  ENGINEERING\n  MARKETING\n  OPERATIONS\n}\n\ntype Details @shareable {\n  forename: String!\n  location: Country!\n  surname: String!\n}\n\ntype Employee implements Identifiable @key(fields: \"id\") {\n  details: Details! @shareable\n  id: Int!\n  notes: String\n  role: RoleType!\n  tag: String!\n  updatedAt: String!\n}\n\ntype Engineer implements RoleType {\n  departments: [Department!]!\n  engineerType: EngineerType!\n  title: [String!]!\n}\n\nenum EngineerType {\n  BACKEND\n  FRONTEND\n  FULLSTACK\n}\n\ninterface IProduct {\n  engineers: [Employee!]!\n  upc: ID!\n}\n\ninterface Identifiable {\n  id: Int!\n}\n\ntype Marketer implements RoleType {\n  departments: [Department!]!\n  title: [String!]!\n}\n\ntype Mutation {\n  updateEmployeeTag(id: Int!, tag: String!): Employee\n}\n\nenum OperationType {\n  FINANCE\n  HUMAN_RESOURCES\n}\n\ntype Operator implements RoleType {\n  departments: [Department!]!\n  operatorType: [OperationType!]!\n  title: [String!]!\n}\n\nunion Products = Consultancy | Cosmo | SDK\n\ntype Query {\n  employee(id: Int!): Employee\n  employees: [Employee!]!\n  products: [Products!]!\n  teammates(team: Department!): [Employee!]!\n}\n\ninterface RoleType {\n  departments: [Department!]!\n  title: [String!]!\n}\n\ntype SDK implements IProduct @key(fields: \"upc\") {\n  engineers: [Employee!]!\n  owner: Employee!\n  upc: ID!\n}\n\ntype Subscription {\n  \"\"\"`currentTime` will return a stream of `Time` objects.\"\"\"\n  currentTime: Time!\n}\n\ntype Time {\n  timeStamp: String!\n  unixTime: Int!\n}\n\nscalar openfed__FieldSet")

	assert.NotNil(t, routerConfig.EngineConfig.GraphqlSchema)
	assert.NotEqual(t, routerConfig.EngineConfig.FieldConfigurations, "")

	assert.NotNil(t, routerConfig.Subgraphs)
	assert.Equal(t, len(routerConfig.Subgraphs), 4)
	assert.NotNil(t, routerConfig.Subgraphs[0].Id)
	assert.NotNil(t, routerConfig.Subgraphs[0].Name)
	assert.NotNil(t, routerConfig.Subgraphs[0].RoutingUrl)
	assert.Equal(t, routerConfig.Subgraphs[0].Name, "employees")
	assert.Equal(t, routerConfig.Subgraphs[0].Id, "280b1517-6a51-40d7-b930-456a97db0e93")
	assert.Equal(t, routerConfig.Subgraphs[0].RoutingUrl, "http://localhost:4001/graphql")
}
