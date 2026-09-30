package core

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/apq"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/pqlmanifest"
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
	tests := []struct {
		name          string
		id            string
		validHash     bool
		validCustomID bool
	}{
		{name: "custom ID", id: "get_employee-v1", validCustomID: true},
		{name: "SHA256", id: strings.Repeat("a", 64), validHash: true, validCustomID: true},
		{name: "maximum length", id: strings.Repeat("z", 250), validCustomID: true},
		{name: "empty", id: ""},
		{name: "path traversal", id: "../operation"},
		{name: "space", id: "a b"},
		{name: "non-ASCII", id: "ä"},
		{name: "too long", id: strings.Repeat("z", 251)},
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

					body := fmt.Sprintf(
						`{"extensions":{"persistedQuery":{"version":1,"sha256Hash":%q}}}`,
						tt.id,
					)
					err = kit.UnmarshalOperationFromBody([]byte(body))
					valid := tt.validHash
					if mode.allowCustomIDs {
						valid = tt.validCustomID
					}
					if valid {
						require.NoError(t, err)
					} else {
						require.Error(t, err)
					}
				})
			}
		})
	}
}

type persistedOperationCacheKeyInput struct {
	manifest      *pqlmanifest.Manifest
	id            string
	clientName    string
	operationName string
}

func TestPersistedOperationCacheKey(t *testing.T) {
	t.Parallel()

	revisionOne := &pqlmanifest.Manifest{Revision: "one"}
	revisionTwo := &pqlmanifest.Manifest{Revision: "two"}

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
			name: "manifest revision and ID boundary",
			a:    persistedOperationCacheKeyInput{manifest: &pqlmanifest.Manifest{Revision: "r1"}, id: "x"},
			b:    persistedOperationCacheKeyInput{manifest: &pqlmanifest.Manifest{Revision: "r"}, id: "1x"},
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
				require.Equal(t, a, b)
			} else {
				require.NotEqual(t, a, b)
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
	return kit.generatePersistedOperationCacheKey(input.clientName, nil, input.operationName != "")
}
