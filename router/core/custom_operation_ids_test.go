package core

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	fastjson "github.com/wundergraph/astjson"
	"github.com/wundergraph/cosmo/router/internal/operationmanifest"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/apq"
)

func TestPersistedOperationIDValidation(t *testing.T) {
	t.Parallel()

	store, err := apq.NewMemoryStore(1024, time.Minute)
	require.NoError(t, err)
	apqClient, err := persistedoperation.NewClient(&persistedoperation.Options{APQStore: store})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, apqClient.Close()) })

	modes := []struct {
		name           string
		client         *persistedoperation.Client
		allowCustomIDs bool
	}{
		{name: "unconfigured"},
		{name: "published", client: &persistedoperation.Client{}, allowCustomIDs: true},
		{name: "APQ", client: apqClient},
	}
	const (
		invalidHash   = "persistedQuery does not have a valid sha256 hash"
		invalidLength = "persistedQuery id must be 1-250 characters long"
		invalidChars  = `persistedQuery id must use printable ASCII, without / or \`
	)
	tests := []struct {
		name string
		id   string
		// Expected errors when IDs must be SHA256 hashes and when custom IDs are
		// allowed. An empty string means the ID is valid.
		hashErr     string
		customIDErr string
	}{
		{name: "custom ID", id: "get_employee-v1", hashErr: invalidHash},
		{name: "SHA256", id: strings.Repeat("a", 64)},
		{name: "maximum length", id: strings.Repeat("z", 250), hashErr: invalidHash},
		{name: "empty", id: "", hashErr: invalidHash, customIDErr: invalidLength},
		{name: "path traversal", id: "../operation", hashErr: invalidHash, customIDErr: invalidChars},
		{name: "space", id: " a b ", hashErr: invalidHash},
		{name: "semver", id: "get_employee-1.2.3", hashErr: invalidHash},
		{name: "punctuation", id: " !\"#$%&'()*+,-.:;<=>?@[]^_{}|~", hashErr: invalidHash},
		{name: "encoded separator", id: "%2F", hashErr: invalidHash},
		{name: "dot", id: ".", hashErr: invalidHash},
		{name: "double dot", id: "..", hashErr: invalidHash},
		{name: "backslash", id: "a\\b", hashErr: invalidHash, customIDErr: invalidChars},
		{name: "DEL", id: "a\u007f", hashErr: invalidHash, customIDErr: invalidChars},
		{name: "control", id: "a\n", hashErr: invalidHash, customIDErr: invalidChars},
		{name: "NUL", id: "a\x00", hashErr: invalidHash, customIDErr: invalidChars},
		{name: "non-ASCII", id: "ä", hashErr: invalidHash, customIDErr: invalidChars},
		{name: "too long", id: strings.Repeat("z", 251), hashErr: invalidHash, customIDErr: invalidLength},
	}

	for _, mode := range modes {
		t.Run(mode.name, func(t *testing.T) {
			t.Parallel()

			processor := NewOperationProcessor(OperationProcessorOptions{
				Executor:                 &Executor{},
				PersistedOperationClient: mode.client,
			})
			for _, tt := range tests {
				t.Run(tt.name, func(t *testing.T) {
					t.Parallel()

					kit, err := processor.NewKit()
					require.NoError(t, err)
					defer kit.Free()

					idJSON, err := json.Marshal(tt.id)
					require.NoError(t, err)
					body := fmt.Sprintf(
						`{"extensions":{"persistedQuery":{"version":1,"sha256Hash":%s}}}`,
						idJSON,
					)
					err = kit.UnmarshalOperationFromBody([]byte(body))
					wantErr := tt.hashErr
					if mode.allowCustomIDs {
						wantErr = tt.customIDErr
					}
					if wantErr == "" {
						assert.NoError(t, err)
					} else {
						assert.EqualError(t, err, wantErr)
					}
				})
			}
		})
	}
}

type persistedOperationCacheKeyInput struct {
	manifest      *operationmanifest.Manifest
	id            string
	clientName    string
	operationName string
	// skipIncludeValues are the values of the @skip/@include variables, which the
	// key encodes as one byte each.
	skipIncludeValues []bool
}

func TestPersistedOperationCacheKey(t *testing.T) {
	t.Parallel()

	revisionOne := &operationmanifest.Manifest{Revision: "one"}
	revisionTwo := &operationmanifest.Manifest{Revision: "two"}

	tests := []struct {
		name  string
		a, b  persistedOperationCacheKeyInput
		equal bool
	}{
		// Variable-length key components are length-prefixed, so moving bytes
		// across a component boundary must produce a different key.
		{
			name: "client name and ID boundary",
			a:    persistedOperationCacheKeyInput{id: "a", clientName: "bc"},
			b:    persistedOperationCacheKeyInput{id: "ab", clientName: "c"},
		},
		{
			name: "ID and operation name boundary",
			a:    persistedOperationCacheKeyInput{id: "id", clientName: "web", operationName: "a"},
			b:    persistedOperationCacheKeyInput{id: "ida", clientName: "web"},
		},
		{
			name: "ID and operation name boundary with manifest",
			a:    persistedOperationCacheKeyInput{manifest: revisionOne, id: "id", operationName: "a"},
			b:    persistedOperationCacheKeyInput{manifest: revisionOne, id: "ida"},
		},
		{
			// "op2" + "0:" + 20 skip/include bytes vs "op" + "20:" + a 20-byte name.
			name: "manifest ID and skip/include values boundary",
			a:    persistedOperationCacheKeyInput{manifest: revisionOne, id: "op2", skipIncludeValues: slices.Repeat([]bool{true}, 20)},
			b:    persistedOperationCacheKeyInput{manifest: revisionOne, id: "op", operationName: strings.Repeat("t", 20)},
		},
		{
			name: "manifest revision and ID boundary",
			a:    persistedOperationCacheKeyInput{manifest: &operationmanifest.Manifest{Revision: "r1"}, id: "x"},
			b:    persistedOperationCacheKeyInput{manifest: &operationmanifest.Manifest{Revision: "r"}, id: "1x"},
		},
		// Without a manifest, operations are stored per client.
		{
			name: "clients are isolated without manifest",
			a:    persistedOperationCacheKeyInput{id: "shared", clientName: "web"},
			b:    persistedOperationCacheKeyInput{id: "shared", clientName: "mobile"},
		},
		// Manifest operations are graph-wide and scoped to the manifest revision.
		{
			name:  "clients share manifest operations",
			a:     persistedOperationCacheKeyInput{manifest: revisionOne, id: "shared", clientName: "web"},
			b:     persistedOperationCacheKeyInput{manifest: revisionOne, id: "shared", clientName: "mobile"},
			equal: true,
		},
		{
			name: "manifest and non-manifest operations are distinct",
			a:    persistedOperationCacheKeyInput{id: "shared"},
			b:    persistedOperationCacheKeyInput{manifest: revisionOne, id: "shared"},
		},
		{
			name: "manifest revision change invalidates key",
			a:    persistedOperationCacheKeyInput{manifest: revisionOne, id: "shared", clientName: "web"},
			b:    persistedOperationCacheKeyInput{manifest: revisionTwo, id: "shared", clientName: "web"},
		},
	}

	processor := NewOperationProcessor(OperationProcessorOptions{Executor: &Executor{}})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			a := persistedOperationCacheKey(t, processor, tt.a)
			b := persistedOperationCacheKey(t, processor, tt.b)
			if tt.equal {
				assert.Equal(t, a, b)
			} else {
				assert.NotEqual(t, a, b)
			}
		})
	}
}

func persistedOperationCacheKey(t *testing.T, processor *OperationProcessor, input persistedOperationCacheKeyInput) uint64 {
	t.Helper()

	kit, err := processor.NewKit()
	require.NoError(t, err)
	defer kit.Free()

	kit.persistedOperationManifest = input.manifest
	kit.parsedOperation.GraphQLRequestExtensions.PersistedQuery = &GraphQLRequestExtensionsPersistedQuery{Sha256Hash: input.id}
	kit.parsedOperation.Request.OperationName = input.operationName

	skipIncludeVariableNames := make([]string, len(input.skipIncludeValues))
	variables := make([]string, len(input.skipIncludeValues))
	for i, value := range input.skipIncludeValues {
		skipIncludeVariableNames[i] = fmt.Sprintf("v%d", i)
		variables[i] = fmt.Sprintf("%q:%t", skipIncludeVariableNames[i], value)
	}
	kit.parsedOperation.Variables = fastjson.MustParseBytes([]byte("{" + strings.Join(variables, ",") + "}")).GetObject()
	return kit.generatePersistedOperationCacheKey(input.clientName, skipIncludeVariableNames, input.operationName != "")
}
