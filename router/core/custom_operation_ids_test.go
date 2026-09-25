package core

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestCustomPersistedIDValidation(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name, id, query string
		enabled, valid  bool
	}{
		{name: "default rejects custom", id: "get_typename_v1"},
		{name: "custom", id: "get_typename_v1", enabled: true, valid: true},
		{name: "maximum length", id: strings.Repeat("x", 250), enabled: true, valid: true},
		{name: "too long", id: strings.Repeat("x", 251), enabled: true},
		{name: "empty", enabled: true},
		{name: "path", id: "../test", enabled: true},
		{name: "space", id: "a b", enabled: true},
		{name: "unicode", id: "ä", enabled: true},
		{name: "body", id: "get_typename_v1", query: "{ __typename }", enabled: true},
		{name: "sha default", id: strings.Repeat("a", 64), valid: true},
		{name: "sha enabled", id: strings.Repeat("a", 64), enabled: true, valid: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			processor := NewOperationProcessor(OperationProcessorOptions{Executor: &Executor{}, MaxOperationSizeInBytes: 1024, ParseKitPoolSize: 1, AllowCustomPersistedOperationIDs: tc.enabled})
			kit, err := processor.NewKit()
			require.NoError(t, err)
			defer kit.Free()
			body, err := json.Marshal(map[string]any{"query": tc.query, "extensions": map[string]any{"persistedQuery": map[string]any{"version": 1, "sha256Hash": tc.id}}})
			require.NoError(t, err)
			err = kit.UnmarshalOperationFromBody(body)
			if tc.valid {
				assert.NoError(t, err)
			} else {
				assert.Error(t, err)
			}
		})
	}
}

func TestCustomPersistedIDConfiguration(t *testing.T) {
	t.Parallel()

	for _, manifest := range []bool{false, true} {
		_, err := NewRouter(t.Context(), WithPersistedOperationsConfig(config.PersistedOperationsConfig{AllowCustomIDs: true, Manifest: config.PQLManifestConfig{Enabled: manifest}}), WithAutomatedPersistedQueriesConfig(config.AutomaticPersistedQueriesConfig{Enabled: true}))
		assert.ErrorContains(t, err, "custom persisted operation IDs require APQ to be disabled")
	}
}
