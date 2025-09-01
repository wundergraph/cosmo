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
	m.lock.Lock()
	defer m.lock.Unlock()

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

	// First validate and add expressions for base retry options if needed
	if len(defaultSgNames) > 0 && baseRetryOptions.Enabled {
		if baseRetryOptions.Algorithm != BackoffJitter {
			joinErr = errors.Join(joinErr, fmt.Errorf("unsupported retry algorithm: %s", baseRetryOptions.Algorithm))
		} else {
			err := m.exprManager.AddExpression(baseRetryOptions.Expression)
			if err != nil {
				joinErr = errors.Join(joinErr, fmt.Errorf("failed to add base retry expression: %w", err))
			} else {
				// Only assign default options if validation succeeds
				for _, sgName := range defaultSgNames {
					opts := baseRetryOptions
					m.retries[sgName] = &opts
				}
			}
		}
	}

	// Process custom retry options
	for _, sgName := range customSgNames {
		entry, ok := subgraphRetryOptions[sgName]
		if !ok {
			joinErr = errors.Join(joinErr, errors.New("retry config not found for subgraph "+sgName))
			continue
		}

		if entry.Algorithm != BackoffJitter {
			joinErr = errors.Join(joinErr, fmt.Errorf("unsupported retry algorithm: %s", entry.Algorithm))
			continue
		}

		// Validate expression before assigning options
		err := m.exprManager.AddExpression(entry.Expression)
		if err != nil {
			joinErr = errors.Join(joinErr, fmt.Errorf("failed to add retry expression for subgraph %s: %w", sgName, err))
			continue
		}

		// Create a new copy of the options
		opts := entry
		m.retries[sgName] = &opts
	}

	return joinErr
}

func (m *Manager) GetSubgraphOptions(name string) *RetryOptions {
	if m == nil {
		return nil
	}

	m.lock.RLock()
	defer m.lock.RUnlock()

	if circuitBreaker, ok := m.retries[name]; ok {
		return circuitBreaker
	}
	return nil
}

func (m *Manager) IsEnabled() bool {
	if m == nil {
		return false
	}

	m.lock.RLock()
	defer m.lock.RUnlock()

	return len(m.retries) > 0
}

func (m *Manager) Retry(err error, req *http.Request, resp *http.Response, exprString string) bool {
	if m.retryFunc == nil {
		return false
	}
	return m.retryFunc(err, req, resp, exprString)
}
