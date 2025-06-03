package circuit

import (
	"github.com/cep21/circuit/v4"
	"github.com/cep21/circuit/v4/closers/hystrix"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

type Manager struct {
	// We maintain separate circuit breakers for each subgraph
	circuits map[string]*circuit.Circuit
}

func (c *Manager) Circuit(name string) *circuit.Circuit {
	if c == nil {
		return nil
	}
	
	// Since we should not ever write into a map
	// after the first setup we don't use any read locks
	if circuit, ok := c.circuits[name]; ok {
		return circuit
	}
	return nil
}

func (c *Manager) IsEnabled() bool {
	return c != nil && len(c.circuits) > 0
}

func NewManager(options *config.TrafficShapingRules, subgraphs []*nodev1.Subgraph) *Manager {
	isBaseEnabled := options.All.CircuitBreaker.Enabled

	configuration := createConfiguration(options.All.CircuitBreaker)
	circuits := make(map[string]*circuit.Circuit, len(subgraphs))

	var circuitManager = circuit.Manager{
		DefaultCircuitProperties: []circuit.CommandPropertiesConstructor{configuration.Configure},
	}

	for _, sg := range subgraphs {
		sgOptions, ok := options.Subgraphs[sg.Name]
		if !ok {
			if isBaseEnabled {
				circuits[sg.Name] = circuitManager.MustCreateCircuit(sg.Name)
			}
			continue
		}
		config := createConfiguration(sgOptions.CircuitBreaker)
		circuits[sg.Name] = circuitManager.MustCreateCircuit(sg.Name, config.Configure(sg.Name))
	}

	return &Manager{
		circuits: circuits,
	}
}

func createConfiguration(opts config.CircuitBreaker) hystrix.Factory {
	var configuration = hystrix.Factory{
		ConfigureOpener: hystrix.ConfigureOpener{
			RequestVolumeThreshold: int64(opts.Threshold),
		},
		ConfigureCloser: hystrix.ConfigureCloser{},
	}
	return configuration
}
