package core

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/apq"
)

func TestCustomPersistedIDValidation(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name, id, query                 string
		apqEnabled, unconfigured, valid bool
	}{
		{name: "unconfigured rejects custom", id: "get_typename_v1", unconfigured: true},
		{name: "APQ rejects custom", id: "get_typename_v1", apqEnabled: true},
		{name: "custom", id: "get_typename_v1", valid: true},
		{name: "maximum length", id: strings.Repeat("x", 250), valid: true},
		{name: "too long", id: strings.Repeat("x", 251)},
		{name: "empty"},
		{name: "path", id: "../test"},
		{name: "space", id: "a b"},
		{name: "unicode", id: "ä"},
		{name: "body", id: "get_typename_v1", query: "{ __typename }"},
		{name: "sha without APQ", id: strings.Repeat("a", 64), valid: true},
		{name: "sha with APQ", apqEnabled: true, id: strings.Repeat("a", 64), valid: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			var client *persistedoperation.Client
			if !tc.unconfigured {
				opts := &persistedoperation.Options{}
				if tc.apqEnabled {
					store, err := apq.NewMemoryStore(1024*1024, time.Minute)
					require.NoError(t, err)
					opts.APQStore = store
				}
				var err error
				client, err = persistedoperation.NewClient(opts)
				require.NoError(t, err)
				defer client.Close()
			}
			processor := NewOperationProcessor(OperationProcessorOptions{Executor: &Executor{}, MaxOperationSizeInBytes: 1024, ParseKitPoolSize: 1, PersistedOperationClient: client})
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
