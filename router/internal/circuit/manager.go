package circuit

import (
	"fmt"
	"github.com/cep21/circuit/v4"
	"github.com/cep21/circuit/v4/closers/hystrix"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	"go.opentelemetry.io/otel/attribute"
)

type Manager struct {
	// We maintain separate circuit breakers for each subgraph
	circuits map[string]*circuit.Circuit
}

func (c *Manager) GetCircuitBreaker(name string) *circuit.Circuit {
	if c == nil {
		return nil
	}

	// Since we should not ever write into a map
	// after the first setup we don't use any read locks
	if circuitBreaker, ok := c.circuits[name]; ok {
		return circuitBreaker
	}
	return nil
}

func (c *Manager) IsEnabled() bool {
	return c != nil && len(c.circuits) > 0
}

type ManagerOpts struct {
	BaseConfig              *config.CircuitBreaker
	SubgraphCircuitBreakers map[string]*config.CircuitBreaker
	Subgraphs               []*nodev1.Subgraph
	FeatureFlagName         string
	MetricStore             metric.Store
	UseMetrics              bool
	BaseOtelAttributes      []attribute.KeyValue
}

func NewManager(opts ManagerOpts) *Manager {
	circuitManager := circuit.Manager{}

	if opts.SubgraphCircuitBreakers == nil {
		return &Manager{}
	}

	isBaseEnabled := opts.BaseConfig != nil && opts.BaseConfig.Enabled
	if isBaseEnabled {
		configuration := createConfiguration(opts.BaseConfig)
		circuitManager.DefaultCircuitProperties = []circuit.CommandPropertiesConstructor{
			configuration.Configure,
		}
	}

	circuits := make(map[string]*circuit.Circuit, len(opts.Subgraphs))
	for _, sg := range opts.Subgraphs {
		// Base graph will start with "::"
		sgCbName := fmt.Sprintf("%s::%s", opts.FeatureFlagName, sg.Name)

		// Set metrics wrapper
		configs := make([]circuit.Config, 0, 1)
		if opts.UseMetrics {
			configs = append(configs, metric.NewCircuitBreakerMetricsConfig(sg.Name, opts.MetricStore, opts.BaseOtelAttributes))
		}

		sgOptions, ok := opts.SubgraphCircuitBreakers[sg.Name]
		if !ok {
			// If we have an all option set we can create a circuit breaker for everyone
			if isBaseEnabled {
				circuits[sgCbName] = circuitManager.MustCreateCircuit(sgCbName, configs...)
			}
			continue
		}

		newConfig := createConfiguration(sgOptions)
		configs = append(configs, newConfig.Configure(sgCbName))
		circuits[sgCbName] = circuitManager.MustCreateCircuit(sgCbName, configs...)
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
			RollingDuration:          opts.RollingDuration,
			NumBuckets:               opts.NumBuckets,
		},
		ConfigureCloser: hystrix.ConfigureCloser{
			SleepWindow:                  opts.SleepWindow,
			HalfOpenAttempts:             opts.HalfOpenAttempts,
			RequiredConcurrentSuccessful: opts.RequiredSuccessfulAttempts,
		},
	}
	return configuration
}
