//go:build windows

package runner

import (
	"errors"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs"
)

func NewSubprocessSubgraphsRunner(ports *subgraphs.Ports) (SubgraphsRunner, error) {
	return nil, errors.New("this subgraphs runner is not supported on Windows, use in-process or external instead")
}
