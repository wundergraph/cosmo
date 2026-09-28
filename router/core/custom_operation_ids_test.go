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

	for _, client := range []*persistedoperation.Client{nil, {}, apqClient} {
		processor := NewOperationProcessor(OperationProcessorOptions{Executor: &Executor{}, PersistedOperationClient: client})
		for _, id := range []string{"get_employee-v1", strings.Repeat("a", 64), strings.Repeat("z", 250), "", "../operation", "a b", "ä", strings.Repeat("z", 251)} {
			kit, err := processor.NewKit()
			require.NoError(t, err)
			err = kit.UnmarshalOperationFromBody([]byte(fmt.Sprintf(`{"extensions":{"persistedQuery":{"version":1,"sha256Hash":%q}}}`, id)))
			valid := id == strings.Repeat("a", 64) || client != nil && !client.APQEnabled() && (id == "get_employee-v1" || len(id) == 250)
			require.Equal(t, valid, err == nil, "ID %q, client %v", id, client)
			kit.Free()
		}
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
