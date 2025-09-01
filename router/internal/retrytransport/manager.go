package retrytransport

import (
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"go.uber.org/zap"
)

type (
	ShouldRetryFunc     func(err error, req *http.Request, resp *http.Response, exprString string) bool
	OnRetryFunc         func(count int, req *http.Request, resp *http.Response, sleepDuration time.Duration, err error)
	requestLoggerGetter func(req *http.Request) *zap.Logger
)

const (
	BackoffJitter = "backoff_jitter"
)

type RetryOptions struct {
	Enabled       bool
	Algorithm     string
	MaxRetryCount int
	Interval      time.Duration
	MaxDuration   time.Duration
	Expression    string
}

type Manager struct {
	retries     map[string]*RetryOptions
	lock        sync.RWMutex
	exprManager *expr.RetryExpressionManager
	retryFunc   ShouldRetryFunc
	OnRetry     OnRetryFunc
}

func NewManager(exprManager *expr.RetryExpressionManager, retryFunc ShouldRetryFunc, onRetryFunc OnRetryFunc) *Manager {
	return &Manager{
		retries:     make(map[string]*RetryOptions),
		exprManager: exprManager,
		retryFunc:   retryFunc,
		OnRetry:     onRetryFunc,
	}
}

func (m *Manager) Initialize(
	baseRetryOptions RetryOptions,
	subgraphRetryOptions map[string]RetryOptions,
	subgraphs []*nodev1.Subgraph,
) error {
	var joinErr error

	defaultSgNames := make([]string, 0, len(subgraphs))
	customSgNames := make([]string, 0, len(subgraphs))

	for _, subgraph := range subgraphs {
		entry, ok := subgraphRetryOptions[subgraph.Name]
		if !ok {
			defaultSgNames = append(defaultSgNames, subgraph.Name)
		} else if entry.Enabled {
			// This will cover the case of if a subgraph is explicitly disabled
			customSgNames = append(customSgNames, subgraph.Name)
		}
	}

	if len(defaultSgNames) > 0 && baseRetryOptions.Enabled {
		if baseRetryOptions.Algorithm != BackoffJitter {
			joinErr = errors.Join(joinErr, fmt.Errorf("unsupported retry algorithm: %s", baseRetryOptions.Algorithm))
		} else {
			err := m.exprManager.AddExpression(baseRetryOptions.Expression)
			if err != nil {
				joinErr = errors.Join(joinErr, fmt.Errorf("failed to add base retry expression: %w", err))
			}
		}
	}

	for _, sgName := range defaultSgNames {
		m.retries[sgName] = &baseRetryOptions
	}

	for _, sgName := range customSgNames {
		entry, ok := subgraphRetryOptions[sgName]
		if !ok {
			joinErr = errors.Join(joinErr, errors.New("retry config not found for subgraph "+sgName))
			continue
		}

		if entry.Algorithm != BackoffJitter {
			joinErr = errors.Join(joinErr, fmt.Errorf("unsupported retry algorithm: %s", baseRetryOptions.Algorithm))
			continue
		}

		m.retries[sgName] = &entry

		err := m.exprManager.AddExpression(entry.Expression)
		if err != nil {
			joinErr = errors.Join(joinErr, errors.New("retry expression did not get added "+sgName))
			continue
		}
	}

	return joinErr
}

func (c *Manager) GetSubgraphOptions(name string) *RetryOptions {
	if c == nil {
		return nil
	}

	c.lock.RLock()
	defer c.lock.RUnlock()

	if circuitBreaker, ok := c.retries[name]; ok {
		return circuitBreaker
	}
	return nil
}

func (c *Manager) IsEnabled() bool {
	if c == nil {
		return false
	}

	c.lock.RLock()
	defer c.lock.RUnlock()

	return len(c.retries) > 0
}

func (c *Manager) Retry(err error, req *http.Request, resp *http.Response, exprString string) bool {
	return c.retryFunc(err, req, resp, exprString)
}

// OnRetryHook triggers the configured OnRetry callback, if any.
func (c *Manager) OnRetryHook(count int, err error, req *http.Request, resp *http.Response, sleepDuration time.Duration) {
	if c.OnRetry != nil {
		c.OnRetry(count, req, resp, sleepDuration, err)
	}
}
