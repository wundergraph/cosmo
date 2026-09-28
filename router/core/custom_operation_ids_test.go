package core

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/apq"
)

func TestPersistedOperationIDValidation(t *testing.T) {
	store, err := apq.NewMemoryStore(1024, time.Minute)
	require.NoError(t, err)
	apqClient, err := persistedoperation.NewClient(&persistedoperation.Options{APQStore: store})
	require.NoError(t, err)
	defer apqClient.Close()

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
			processor := NewOperationProcessor(OperationProcessorOptions{
				Executor:                 &Executor{},
				PersistedOperationClient: mode.client,
			})
			for _, tt := range tests {
				t.Run(tt.name, func(t *testing.T) {
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

func TestPersistedOperationCacheKeyBoundaries(t *testing.T) {
	processor := NewOperationProcessor(OperationProcessorOptions{Executor: &Executor{}})
	kit, err := processor.NewKit()
	require.NoError(t, err)
	defer kit.Free()
	key := func(id, client, name string) uint64 {
		kit.parsedOperation.GraphQLRequestExtensions.PersistedQuery = &GraphQLRequestExtensionsPersistedQuery{Sha256Hash: id}
		kit.parsedOperation.Request.OperationName = name
		return kit.generatePersistedOperationCacheKey(client, nil, name != "")
	}
	require.NotEqual(t, key("a", "bc", ""), key("ab", "c", ""))
	require.NotEqual(t, key("id", "web", "a"), key("ida", "web", ""))
	require.NotEqual(t, key("shared", "web", ""), key("shared", "mobile", ""))
}
