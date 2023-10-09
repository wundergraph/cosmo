//go:build windows

package runner

import "errors"

func NewSubprocessSubgraphsRunner() (SubgraphsRunner, error) {
	return nil, errors.New("this subgraphs runner is not supported on Windows, use in-process or external instead")
}
