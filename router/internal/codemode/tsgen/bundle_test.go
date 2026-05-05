package tsgen

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/codemode/storage"
)

func TestRenderBundleEmptyOps(t *testing.T) {
	got, err := RenderBundle(nil, testSchema(t), 0)
	require.NoError(t, err)

	want := "type GraphQLError = { message: string; path?: (string | number)[]; extensions?: Record<string, unknown> };\n" +
		"type R<T> = Promise<{ data: T | null; errors?: GraphQLError[] }>;\n" +
		"\n" +
		"declare const tools: {};\n" +
		"\n" +
		"declare function notNull<T>(value: T | null | undefined, message?: string): T;\n" +
		"declare function compact<T>(value: T): T;"

	assert.Equal(t, want, got)
}

func TestRenderBundleThreeOpsNoTruncation(t *testing.T) {
	ops := []storage.SessionOp{
		{Name: "health", Body: `query Health { health }`, Kind: storage.OperationKindQuery, Description: "Checks router health."},
		{Name: "viewer", Body: `query Viewer { viewer { id name } }`, Kind: storage.OperationKindQuery, Description: "Fetches viewer."},
		{Name: "renameUser", Body: `mutation RenameUser($id: ID!, $name: String!) { renameUser(id: $id, name: $name) { id } }`, Kind: storage.OperationKindMutation, Description: "Renames a user."},
	}

	got, err := RenderBundle(ops, testSchema(t), 0)
	require.NoError(t, err)

	want := "type GraphQLError = { message: string; path?: (string | number)[]; extensions?: Record<string, unknown> };\n" +
		"type R<T> = Promise<{ data: T | null; errors?: GraphQLError[] }>;\n" +
		"\n" +
		"declare const tools: {\n" +
		"  /** Checks router health. */\n" +
		"  health(): R<{ health: string }>;\n" +
		"\n" +
		"  /** Fetches viewer. */\n" +
		"  viewer(): R<{ viewer: { id: string; name: string } | null }>;\n" +
		"\n" +
		"  /** Renames a user. */\n" +
		"  renameUser(vars: { id: string; name: string }): R<{ renameUser: { id: string } }>;\n" +
		"};\n" +
		"\n" +
		"declare function notNull<T>(value: T | null | undefined, message?: string): T;\n" +
		"declare function compact<T>(value: T): T;"

	assert.Equal(t, want, got)
}

func TestRenderBundleTruncatesWholeOpsFromEnd(t *testing.T) {
	ops := []storage.SessionOp{
		{Name: "health", Body: `query Health { health }`, Kind: storage.OperationKindQuery, Description: "Checks router health."},
		{Name: "viewer", Body: `query Viewer { viewer { id name } }`, Kind: storage.OperationKindQuery, Description: "Fetches viewer."},
		{Name: "renameUser", Body: `mutation RenameUser($id: ID!, $name: String!) { renameUser(id: $id, name: $name) { id } }`, Kind: storage.OperationKindMutation, Description: "Renames a user."},
	}
	fullWithTwo := "type GraphQLError = { message: string; path?: (string | number)[]; extensions?: Record<string, unknown> };\n" +
		"type R<T> = Promise<{ data: T | null; errors?: GraphQLError[] }>;\n" +
		"\n" +
		"declare const tools: {\n" +
		"  /** Checks router health. */\n" +
		"  health(): R<{ health: string }>;\n" +
		"\n" +
		"  /** Fetches viewer. */\n" +
		"  viewer(): R<{ viewer: { id: string; name: string } | null }>;\n" +
		"};\n" +
		"\n" +
		"declare function notNull<T>(value: T | null | undefined, message?: string): T;\n" +
		"declare function compact<T>(value: T): T;\n" +
		"// truncated: 1 ops omitted"

	got, err := RenderBundle(ops, testSchema(t), len(fullWithTwo))
	require.NoError(t, err)

	assert.Equal(t, fullWithTwo, got)
}

func TestRenderBundleErrorsWhenPreludeCannotFit(t *testing.T) {
	_, err := RenderBundle(nil, testSchema(t), 12)
	require.Error(t, err)
}

func TestRenderBundleRoundTripsAbstractField(t *testing.T) {
	ops := []storage.SessionOp{
		{
			Name:        "petsList",
			Body:        `query PetsList { pets { __typename ... on Cat { name } ... on Dog { bark } } }`,
			Kind:        storage.OperationKindQuery,
			Description: "Lists pets.",
		},
	}

	got, err := RenderBundle(ops, testSchema(t), 0)
	require.NoError(t, err)

	want := "type GraphQLError = { message: string; path?: (string | number)[]; extensions?: Record<string, unknown> };\n" +
		"type R<T> = Promise<{ data: T | null; errors?: GraphQLError[] }>;\n" +
		"\n" +
		"declare const tools: {\n" +
		"  /** Lists pets. */\n" +
		"  petsList(): R<{ pets: ({ __typename: \"Cat\"; name: string } | { __typename: \"Dog\"; bark: string } | { __typename: \"Mouse\" })[] }>;\n" +
		"};\n" +
		"\n" +
		"declare function notNull<T>(value: T | null | undefined, message?: string): T;\n" +
		"declare function compact<T>(value: T): T;"

	assert.Equal(t, want, got)
}

func TestNewOpsFragmentReturnsOnlySignatures(t *testing.T) {
	ops := []storage.SessionOp{
		{Name: "health", Body: `query Health { health }`, Kind: storage.OperationKindQuery, Description: "Checks router health."},
		{Name: "viewer", Body: `query Viewer { viewer { id } }`, Kind: storage.OperationKindQuery, Description: "Fetches viewer."},
		{Name: "animal", Body: `query Animal { animal { id } }`, Kind: storage.OperationKindQuery, Description: "Fetches animal."},
	}

	got, err := NewOpsFragment(ops, testSchema(t))
	require.NoError(t, err)

	want := "/** Checks router health. */\n" +
		"health(): R<{ health: string }>;\n" +
		"\n" +
		"/** Fetches viewer. */\n" +
		"viewer(): R<{ viewer: { id: string } | null }>;\n" +
		"\n" +
		"/** Fetches animal. */\n" +
		"animal(): R<{ animal: { id: string } | null }>;"

	assert.Equal(t, want, got)
	assert.False(t, strings.Contains(got, "declare const tools"))
	assert.False(t, strings.Contains(got, "type R<T>"))
}
