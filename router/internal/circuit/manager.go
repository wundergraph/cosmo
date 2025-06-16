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

func NewManager(all *config.CircuitBreaker, subgraphCircuitBreakers map[string]*config.CircuitBreaker, subgraphs []*nodev1.Subgraph) *Manager {
	circuitManager := circuit.Manager{}

	isBaseEnabled := all != nil && all.Enabled
	if isBaseEnabled {
		configuration := createConfiguration(all)
		circuitManager.DefaultCircuitProperties = []circuit.CommandPropertiesConstructor{
			configuration.Configure,
		}
	}

	circuits := make(map[string]*circuit.Circuit, len(subgraphs))
	for _, sg := range subgraphs {
		sgOptions, ok := subgraphCircuitBreakers[sg.Name]
		if !ok && sgOptions != nil {
			// If we have an all option set we can create a circuit breaker for everyone
			if isBaseEnabled {
				circuits[sg.Name] = circuitManager.MustCreateCircuit(sg.Name)
			}
			continue
		}
		config := createConfiguration(sgOptions)
		circuits[sg.Name] = circuitManager.MustCreateCircuit(sg.Name, config.Configure(sg.Name))
	}

	return &Manager{
		circuits: circuits,
	}
}

func createConfiguration(opts *config.CircuitBreaker) hystrix.Factory {
	var configuration = hystrix.Factory{
		ConfigureOpener: hystrix.ConfigureOpener{
			ErrorThresholdPercentage: opts.ErrorThresholdPercentage,
			RequestVolumeThreshold:   opts.RequestThreshold,
		},
		ConfigureCloser: hystrix.ConfigureCloser{},
	}
	return configuration
}
