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
	ExecutionTimeout           time.Duration
	MaxConcurrentRequests      int64
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
		circuitManager.DefaultCircuitProperties = []circuit.CommandPropertiesConstructor{
			createConfiguration(baseConfig),
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
	AllGroupings            map[string]map[string]bool
}

func (c *Manager) Initialize(opts ManagerOpts) error {
	var joinErr error

	for routingUrl, sgNames := range opts.AllGroupings {
		defaultSgNames := make([]string, 0, len(sgNames))
		customSgNames := make([]string, 0, len(sgNames))

		for sgName := range sgNames {
			entry, ok := opts.SubgraphCircuitBreakers[sgName]
			if !ok {
				defaultSgNames = append(defaultSgNames, sgName)
			} else if entry.Enabled {
				// This will cover the case of if a subgraph is explicitly disabled
				customSgNames = append(customSgNames, sgName)
			}
		}

		if len(defaultSgNames) > 0 && c.isBaseConfigEnabled {
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

		if len(customSgNames) > 0 {
			for _, sgName := range customSgNames {
				configs := make([]circuit.Config, 0, 1)
				if opts.UseMetrics {
					configs = append(configs, metric.NewCircuitBreakerMetricsConfig([]string{sgName}, opts.MetricStore, opts.BaseOtelAttributes))
				}

				newConfig := createConfiguration(opts.SubgraphCircuitBreakers[sgName])
				configs = append(configs, newConfig(sgName))

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

func createConfiguration(opts CircuitBreakerConfig) circuit.CommandPropertiesConstructor {
	return func(name string) circuit.Config {
		return circuit.Config{
			General: circuit.GeneralConfig{
				OpenToClosedFactory: hystrix.CloserFactory(hystrix.ConfigureCloser{
					SleepWindow:                  opts.SleepWindow,
					HalfOpenAttempts:             opts.HalfOpenAttempts,
					RequiredConcurrentSuccessful: opts.RequiredSuccessfulAttempts,
				}),
				ClosedToOpenFactory: hystrix.OpenerFactory(hystrix.ConfigureOpener{
					ErrorThresholdPercentage: opts.ErrorThresholdPercentage,
					RequestVolumeThreshold:   opts.RequestThreshold,
					RollingDuration:          opts.RollingDuration,
					NumBuckets:               opts.NumBuckets,
				}),
			},
			Execution: circuit.ExecutionConfig{
				Timeout:               opts.ExecutionTimeout,
				MaxConcurrentRequests: opts.MaxConcurrentRequests,
			},
		}
	}
}
