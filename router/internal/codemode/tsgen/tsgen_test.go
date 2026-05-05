package tsgen

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/codemode/storage"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
)

const testSchemaSDL = `
schema {
	query: Query
	mutation: Mutation
}

type Query {
	health: String!
	node(id: ID!): User
	search(cursor: String): SearchConnection!
	tagged(tags: [String!]!): [User!]!
	byStatus(status: Status!): [User!]!
	filterUsers(filter: UserFilter): [User!]!
	viewer: User
	animal: Animal
	pet: Pet
	pets: [Pet!]!
	maybePet: Pet
	maybePets: [Pet]
	requiredPets: [Pet!]!
	searchResult: SearchResult
	outsider: Outsider
}

type Mutation {
	renameUser(id: ID!, name: String!): User!
}

type User {
	id: ID!
	name: String!
	friend: User
	tags: [String!]!
}

type SearchConnection {
	nodes: [User]!
	nextCursor: String
}

interface Animal {
	id: ID!
}

type Cat implements Animal & Pet & Friendly {
	id: ID!
	name: String!
	friendliness: Int!
	companion: Animal
}

type Dog implements Pet & Friendly {
	id: ID!
	bark: String!
	friendliness: Int!
}

type Mouse implements Pet {
	id: ID!
	squeak: Boolean!
}

interface Pet {
	id: ID!
}

interface Friendly {
	friendliness: Int!
}

interface Unrelated {
	unrelated: String!
}

type Outsider implements Unrelated {
	id: ID!
	unrelated: String!
}

union SearchResult = User | Cat

enum Status {
	OPEN
	CLOSED
}

input UserFilter {
	status: Status
	tags: [String!]
	limit: Int!
}
`

func testSchema(t *testing.T) *ast.Document {
	t.Helper()

	doc, report := astparser.ParseGraphqlDocumentString(testSchemaSDL)
	require.False(t, report.HasErrors(), report.Error())
	require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&doc))

	return &doc
}

func TestNewOpsFragmentSignatures(t *testing.T) {
	schema := testSchema(t)

	tests := []struct {
		name string
		op   storage.SessionOp
		want string
	}{
		{
			name: "var-less query",
			op: storage.SessionOp{
				Name:        "health",
				Body:        `query Health { health }`,
				Kind:        storage.OperationKindQuery,
				Description: "Checks router health.",
			},
			want: "/** Checks router health. */\nhealth(): R<{ health: string }>;",
		},
		{
			name: "required scalar var",
			op: storage.SessionOp{
				Name:        "getNode",
				Body:        `query GetNode($id: ID!) { node(id: $id) { id } }`,
				Kind:        storage.OperationKindQuery,
				Description: "Fetches a node.",
			},
			want: "/** Fetches a node. */\ngetNode(vars: { id: string }): R<{ node: { id: string } | null }>;",
		},
		{
			name: "optional nullable var",
			op: storage.SessionOp{
				Name:        "search",
				Body:        `query Search($cursor: String) { search(cursor: $cursor) { nextCursor } }`,
				Kind:        storage.OperationKindQuery,
				Description: "Searches users.",
			},
			want: "/** Searches users. */\nsearch(vars?: { cursor?: string | null }): R<{ search: { nextCursor: string | null } }>;",
		},
		{
			name: "list non-null var",
			op: storage.SessionOp{
				Name:        "tagged",
				Body:        `query Tagged($tags: [String!]!) { tagged(tags: $tags) { id } }`,
				Kind:        storage.OperationKindQuery,
				Description: "Fetches users by tag.",
			},
			want: "/** Fetches users by tag. */\ntagged(vars: { tags: string[] }): R<{ tagged: { id: string }[] }>;",
		},
		{
			name: "enum var",
			op: storage.SessionOp{
				Name:        "byStatus",
				Body:        `query ByStatus($status: Status!) { byStatus(status: $status) { id } }`,
				Kind:        storage.OperationKindQuery,
				Description: "Fetches users by status.",
			},
			want: "/** Fetches users by status. */\nbyStatus(vars: { status: \"OPEN\" | \"CLOSED\" }): R<{ byStatus: { id: string }[] }>;",
		},
		{
			name: "input object var",
			op: storage.SessionOp{
				Name:        "filterUsers",
				Body:        `query FilterUsers($filter: UserFilter) { filterUsers(filter: $filter) { id } }`,
				Kind:        storage.OperationKindQuery,
				Description: "Filters users.",
			},
			want: "/** Filters users. */\nfilterUsers(vars?: { filter?: { status?: \"OPEN\" | \"CLOSED\" | null; tags?: string[] | null; limit: number } | null }): R<{ filterUsers: { id: string }[] }>;",
		},
		{
			name: "nested object",
			op: storage.SessionOp{
				Name:        "viewer",
				Body:        `query Viewer { viewer { id friend { name } } }`,
				Kind:        storage.OperationKindQuery,
				Description: "Fetches viewer.",
			},
			want: "/** Fetches viewer. */\nviewer(): R<{ viewer: { id: string; friend: { name: string } | null } | null }>;",
		},
		{
			name: "aliased field",
			op: storage.SessionOp{
				Name:        "viewerAlias",
				Body:        `query ViewerAlias { me: viewer { id } }`,
				Kind:        storage.OperationKindQuery,
				Description: "Fetches viewer with alias.",
			},
			want: "/** Fetches viewer with alias. */\nviewerAlias(): R<{ me: { id: string } | null }>;",
		},
		{
			name: "inline fragment",
			op: storage.SessionOp{
				Name:        "viewerFragment",
				Body:        `query ViewerFragment { viewer { id ... on User { name } } }`,
				Kind:        storage.OperationKindQuery,
				Description: "Fetches viewer fields.",
			},
			want: "/** Fetches viewer fields. */\nviewerFragment(): R<{ viewer: { id: string; name: string } | null }>;",
		},
		{
			name: "union or interface output",
			op: storage.SessionOp{
				Name:        "animal",
				Body:        `query Animal { animal { id } }`,
				Kind:        storage.OperationKindQuery,
				Description: "Fetches animal.",
			},
			want: "/** Fetches animal. */\nanimal(): R<{ animal: { id: string } | null }>;",
		},
		{
			name: "mutation kind",
			op: storage.SessionOp{
				Name:        "renameUser",
				Body:        `mutation RenameUser($id: ID!, $name: String!) { renameUser(id: $id, name: $name) { id name } }`,
				Kind:        storage.OperationKindMutation,
				Description: "Renames a user.",
			},
			want: "/** Renames a user. */\nrenameUser(vars: { id: string; name: string }): R<{ renameUser: { id: string; name: string } }>;",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NewOpsFragment([]storage.SessionOp{tt.op}, schema)
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestNewOpsFragmentAbstractSelections(t *testing.T) {
	schema := testSchema(t)

	tests := []struct {
		name    string
		op      storage.SessionOp
		want    string
		wantErr string
	}{
		{
			name: "interface, only __typename",
			op: storage.SessionOp{
				Name:        "petKind",
				Body:        `query PetKind { pet { __typename } }`,
				Kind:        storage.OperationKindQuery,
				Description: "Pet kind.",
			},
			want: "/** Pet kind. */\npetKind(): R<{ pet: { __typename: \"Cat\" } | { __typename: \"Dog\" } | { __typename: \"Mouse\" } | null }>;",
		},
		{
			name: "interface, bare field + one concrete fragment",
			op: storage.SessionOp{
				Name:        "petWithCatName",
				Body:        `query PetWithCatName { pet { id ... on Cat { name } } }`,
				Kind:        storage.OperationKindQuery,
				Description: "Pet with cat name.",
			},
			want: "/** Pet with cat name. */\npetWithCatName(): R<{ pet: { id: string; name: string } | { id: string } | { id: string } | null }>;",
		},
		{
			name: "interface, fragment on the same interface",
			op: storage.SessionOp{
				Name:        "petSameInterface",
				Body:        `query PetSameInterface { pet { ... on Pet { id } } }`,
				Kind:        storage.OperationKindQuery,
				Description: "Pet same interface.",
			},
			want: "/** Pet same interface. */\npetSameInterface(): R<{ pet: { id: string } | null }>;",
		},
		{
			name: "interface, fragment on an unrelated abstract",
			op: storage.SessionOp{
				Name:        "petUnrelated",
				Body:        `query PetUnrelated { pet { id ... on Unrelated { unrelated } } }`,
				Kind:        storage.OperationKindQuery,
				Description: "Pet unrelated.",
			},
			want: "/** Pet unrelated. */\npetUnrelated(): R<{ pet: { id: string } | null }>;",
		},
		{
			name: "interface, fragment on a related abstract",
			op: storage.SessionOp{
				Name:        "petFriendly",
				Body:        `query PetFriendly { pet { id ... on Friendly { friendliness } } }`,
				Kind:        storage.OperationKindQuery,
				Description: "Pet friendly.",
			},
			want: "/** Pet friendly. */\npetFriendly(): R<{ pet: { id: string; friendliness: number } | { id: string; friendliness: number } | { id: string } | null }>;",
		},
		{
			name: "concrete fragment on a non-implementor type",
			op: storage.SessionOp{
				Name:        "petBadFragment",
				Body:        `query PetBadFragment { pet { ... on User { name } } }`,
				Kind:        storage.OperationKindQuery,
				Description: "Pet with non-implementor fragment.",
			},
			wantErr: `render op "petBadFragment": type "User" is not a possible type of "Pet"`,
		},
		{
			name: "union, __typename-only selection",
			op: storage.SessionOp{
				Name:        "searchKind",
				Body:        `query SearchKind { searchResult { __typename } }`,
				Kind:        storage.OperationKindQuery,
				Description: "Search kind.",
			},
			want: "/** Search kind. */\nsearchKind(): R<{ searchResult: { __typename: \"User\" } | { __typename: \"Cat\" } | null }>;",
		},
		{
			name: "union with ... on Member for a subset",
			op: storage.SessionOp{
				Name:        "searchSubset",
				Body:        `query SearchSubset { searchResult { __typename ... on Cat { name } } }`,
				Kind:        storage.OperationKindQuery,
				Description: "Search subset.",
			},
			want: "/** Search subset. */\nsearchSubset(): R<{ searchResult: { __typename: \"User\" } | { __typename: \"Cat\"; name: string } | null }>;",
		},
		{
			name: "named fragment spread on abstract field",
			op: storage.SessionOp{
				Name:        "petSpread",
				Body:        `query PetSpread { pet { ...Bits } } fragment Bits on Pet { id }`,
				Kind:        storage.OperationKindQuery,
				Description: "Pet spread.",
			},
			want: "/** Pet spread. */\npetSpread(): R<{ pet: { id: string } | null }>;",
		},
		{
			name: "aliased __typename",
			op: storage.SessionOp{
				Name:        "petAliasedKind",
				Body:        `query PetAliasedKind { pet { kind: __typename } }`,
				Kind:        storage.OperationKindQuery,
				Description: "Pet aliased kind.",
			},
			want: "/** Pet aliased kind. */\npetAliasedKind(): R<{ pet: { kind: string } | null }>;",
		},
		{
			name: "duplicate response keys, identical",
			op: storage.SessionOp{
				Name:        "petDupIdentical",
				Body:        `query PetDupIdentical { pet { id id } }`,
				Kind:        storage.OperationKindQuery,
				Description: "Pet dup identical.",
			},
			// merging is out of scope for this PR; pin duplicates as duplicates
			want: "/** Pet dup identical. */\npetDupIdentical(): R<{ pet: { id: string; id: string } | null }>;",
		},
		{
			name: "duplicate response keys, conflicting",
			op: storage.SessionOp{
				Name:        "petDupConflict",
				Body:        `query PetDupConflict { pet { id ... on Cat { id: name } } }`,
				Kind:        storage.OperationKindQuery,
				Description: "Pet dup conflict.",
			},
			// merging is out of scope; conflicting duplicates are emitted as-is
			// instead of erroring (mirrors current object-selection behavior).
			want: "/** Pet dup conflict. */\npetDupConflict(): R<{ pet: { id: string; id: string } | { id: string } | { id: string } | null }>;",
		},
		{
			name: "nested abstract inside an inline fragment",
			op: storage.SessionOp{
				Name:        "petCompanion",
				Body:        `query PetCompanion { pet { ... on Cat { companion { __typename } } } }`,
				Kind:        storage.OperationKindQuery,
				Description: "Pet companion.",
			},
			want: "/** Pet companion. */\npetCompanion(): R<{ pet: { companion: { __typename: \"Cat\" } | null } | null }>;",
		},
		{
			name: "list / nullable / non-nullable wrapping",
			op: storage.SessionOp{
				Name:        "petsWrappers",
				Body:        `query PetsWrappers { pets { id } maybePet { id } maybePets { id } requiredPets { id } }`,
				Kind:        storage.OperationKindQuery,
				Description: "Pets wrappers.",
			},
			want: "/** Pets wrappers. */\npetsWrappers(): R<{ pets: { id: string }[]; maybePet: { id: string } | null; maybePets: ({ id: string } | null)[] | null; requiredPets: { id: string }[] }>;",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NewOpsFragment([]storage.SessionOp{tt.op}, schema)
			if tt.wantErr != "" {
				require.EqualError(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}
