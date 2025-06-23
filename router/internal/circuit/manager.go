package circuit

import (
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/cep21/circuit/v4"
	"github.com/cep21/circuit/v4/closers/hystrix"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	"go.opentelemetry.io/otel/attribute"
)

// CircuitBreakerConfig defines the configuration for circuit breaker
// This decouples the circuit package from the config package
type CircuitBreakerConfig struct {
	Enabled                    bool
	ErrorThresholdPercentage   int64
	RequestThreshold           int64
	SleepWindow                time.Duration
	HalfOpenAttempts           int64
	RequiredSuccessfulAttempts int64
	RollingDuration            time.Duration
	NumBuckets                 int
}

type Manager struct {
	// We maintain separate circuit breakers for each subgraph
	circuits map[string]*circuit.Circuit
	lock     sync.RWMutex
}

func (c *Manager) GetCircuitBreaker(name string) *circuit.Circuit {
	if c == nil {
		return nil
	}

	c.lock.RLock()
	defer c.lock.RUnlock()

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
	BaseConfig              CircuitBreakerConfig
	SubgraphCircuitBreakers map[string]CircuitBreakerConfig
	Subgraphs               []*nodev1.Subgraph
	FeatureFlagName         string
	MetricStore             metric.CircuitMetricStore
	UseMetrics              bool
	BaseOtelAttributes      []attribute.KeyValue
}

func NewManager(opts ManagerOpts) (*Manager, error) {
	circuitManager := circuit.Manager{}

	if opts.SubgraphCircuitBreakers == nil {
		return &Manager{}, nil
	}

	isBaseEnabled := opts.BaseConfig.Enabled
	if isBaseEnabled {
		configuration := createConfiguration(opts.BaseConfig)
		circuitManager.DefaultCircuitProperties = []circuit.CommandPropertiesConstructor{
			configuration.Configure,
		}
	}

	var joinErr error

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
				createCircuit, err := circuitManager.CreateCircuit(sgCbName, configs...)
				if err != nil {
					joinErr = errors.Join(joinErr, err)
					continue
				}
				circuits[sgCbName] = createCircuit
			}
			continue
		}

		// This will cover the case of if a subgraph is explicitly disabled
		if sgOptions.Enabled {
			newConfig := createConfiguration(sgOptions)
			configs = append(configs, newConfig.Configure(sgCbName))
			createCircuit, err := circuitManager.CreateCircuit(sgCbName, configs...)
			if err != nil {
				joinErr = errors.Join(joinErr, err)
				continue
			}
			circuits[sgCbName] = createCircuit
		}
	}

	if joinErr != nil {
		return nil, joinErr
	}

	v := &Manager{
		circuits: circuits,
	}

	return v, nil
}

func createConfiguration(opts CircuitBreakerConfig) hystrix.Factory {
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
