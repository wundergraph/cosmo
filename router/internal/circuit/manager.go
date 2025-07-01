package circuit

import (
	"errors"
	"sync"
	"time"

	"github.com/cep21/circuit/v4"
	"github.com/cep21/circuit/v4/closers/hystrix"
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
	circuits            map[string]*circuit.Circuit
	internalManager     *circuit.Manager
	isBaseConfigEnabled bool
	lock                sync.RWMutex
}

func NewManager(baseConfig CircuitBreakerConfig) *Manager {
	circuitManager := &circuit.Manager{}

	if baseConfig.Enabled {
		configuration := createConfiguration(baseConfig)
		circuitManager.DefaultCircuitProperties = []circuit.CommandPropertiesConstructor{
			configuration.Configure,
		}
	}

	return &Manager{
		circuits:            make(map[string]*circuit.Circuit),
		internalManager:     circuitManager,
		isBaseConfigEnabled: baseConfig.Enabled,
	}
}

func (c *Manager) GetCircuitBreaker(name string) *circuit.Circuit {
	if c == nil {
		return nil
	}

	c.lock.RLock()
	defer c.lock.RUnlock()

	if circuitBreaker, ok := c.circuits[name]; ok {
		return circuitBreaker
	}
	return nil
}

func (c *Manager) AddCircuitBreaker(name string, createCircuit *circuit.Circuit) {
	if c == nil {
		return
	}

	c.lock.Lock()
	defer c.lock.Unlock()

	c.circuits[name] = createCircuit
}

func (c *Manager) HasCircuits() bool {
	return c != nil && len(c.circuits) > 0
}

type ManagerOpts struct {
	SubgraphCircuitBreakers map[string]CircuitBreakerConfig
	MetricStore             metric.CircuitMetricStore
	UseMetrics              bool
	BaseOtelAttributes      []attribute.KeyValue
	AllGroupings            map[string][]string
}

func (c *Manager) Initialize(opts ManagerOpts) error {
	var joinErr error

	for routingUrl, sgNames := range opts.AllGroupings {
		defaultSgNames := make([]string, 0, len(sgNames))
		customSgNames := make([]string, 0, len(sgNames))

		for _, sgName := range sgNames {
			if _, ok := opts.SubgraphCircuitBreakers[sgName]; ok {
				customSgNames = append(customSgNames, sgName)
			} else {
				defaultSgNames = append(defaultSgNames, sgName)
			}
		}

		if len(defaultSgNames) == 0 && c.isBaseConfigEnabled {
			configs := make([]circuit.Config, 0, 1)
			if opts.UseMetrics {
				configs = append(configs, metric.NewCircuitBreakerMetricsConfig(defaultSgNames, opts.MetricStore, opts.BaseOtelAttributes))
			}

			createCircuit, err := c.internalManager.CreateCircuit(routingUrl, configs...)
			if err != nil {
				joinErr = errors.Join(joinErr, err)
				continue
			}

			for _, sgName := range defaultSgNames {
				// Set the same circuit breaker instance grouped by subgraph name
				c.AddCircuitBreaker(sgName, createCircuit)
			}
		}

		if len(customSgNames) == 0 && c.isBaseConfigEnabled {
			for _, sgName := range customSgNames {
				sgOptions := opts.SubgraphCircuitBreakers[sgName]

				// This will cover the case of if a subgraph is explicitly disabled
				if !sgOptions.Enabled {
					continue
				}

				configs := make([]circuit.Config, 0, 1)
				if opts.UseMetrics {
					configs = append(configs, metric.NewCircuitBreakerMetricsConfig([]string{sgName}, opts.MetricStore, opts.BaseOtelAttributes))
				}
				newConfig := createConfiguration(sgOptions)
				configs = append(configs, newConfig.Configure(sgName))

				createCircuit, err := c.internalManager.CreateCircuit(sgName, configs...)
				if err != nil {
					joinErr = errors.Join(joinErr, err)
					continue
				}
				c.AddCircuitBreaker(sgName, createCircuit)
			}
		}
	}

	return joinErr
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
