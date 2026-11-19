package routerconfig_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
)

func TestExecutionConfigSnapshotIsolation(t *testing.T) {
	sg := routerconfig.Subgraph{Name: "greetings"}
	subgraphs := []routerconfig.Subgraph{sg}
	cfg := routerconfig.NewExecutionConfig("v1", "", "", subgraphs)
	other := routerconfig.NewExecutionConfig("v1", "", "", subgraphs)
	if cfg == other {
		t.Fatal("independently built graphs must have distinct cache keys")
	}

	subgraphs[0].Name = "changed by producer"
	cfg.Subgraphs()[0].Name = "changed by consumer"
	require.Equal(t, []routerconfig.Subgraph{sg}, cfg.Subgraphs())
}
