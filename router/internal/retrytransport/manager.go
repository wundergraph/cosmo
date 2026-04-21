package retrytransport

import (
	"fmt"
	"net/http"
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
	exprManager *expr.RetryExpressionManager
	retryFunc   ShouldRetryFunc
	onRetry     OnRetryFunc
	logger      *zap.Logger
}

func NewManager(exprManager *expr.RetryExpressionManager, retryFunc ShouldRetryFunc, onRetryFunc OnRetryFunc, logger *zap.Logger) *Manager {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &Manager{
		retries:     make(map[string]*RetryOptions),
		exprManager: exprManager,
		retryFunc:   retryFunc,
		onRetry:     onRetryFunc,
		logger:      logger,
	}
}

func (m *Manager) Initialize(baseRetryOptions RetryOptions, subgraphRetryOptions map[string]RetryOptions, routerConfig *nodev1.RouterConfig) error {
	// Get the list of all subgraph AND feature subgraphs
	subgraphNameSet := make(map[string]bool, len(routerConfig.Subgraphs))
	for _, subgraph := range routerConfig.GetSubgraphs() {
		subgraphNameSet[subgraph.Name] = true
	}
	if routerConfig.FeatureFlagConfigs != nil {
		for _, ffConfig := range routerConfig.FeatureFlagConfigs.ConfigByFeatureFlagName {
			for _, subgraph := range ffConfig.GetSubgraphs() {
				subgraphNameSet[subgraph.Name] = true
			}
		}
	}

	// Warn on retry configs pointing at subgraphs that don't exist in the
	// router config — likely a typo that would otherwise silently disable
	// the override.
	for sgName := range subgraphRetryOptions {
		if !subgraphNameSet[sgName] {
			m.logger.Warn("Retry config references unknown subgraph; override will be ignored",
				zap.String("subgraph_name", sgName),
			)
		}
	}

	defaultSgNames := make([]string, 0, len(subgraphNameSet))
	customSgNames := make([]string, 0, len(subgraphNameSet))

	for subgraphName := range subgraphNameSet {
		entry, ok := subgraphRetryOptions[subgraphName]
		if !ok {
			defaultSgNames = append(defaultSgNames, subgraphName)
		} else if entry.Enabled {
			// This will cover the case of if a subgraph is explicitly disabled
			customSgNames = append(customSgNames, subgraphName)
		}
	}

	// First validate and add expressions for base retry options if needed
	if len(defaultSgNames) > 0 && baseRetryOptions.Enabled {
		if baseRetryOptions.Algorithm != BackoffJitter {
			return fmt.Errorf("unsupported retry algorithm: %s", baseRetryOptions.Algorithm)
		}

		// There is a chance that this is not evaluated if all defaultSgNames == 0, and only will
		// then error out when its > 0 there
		err := m.exprManager.AddExpression(baseRetryOptions.Expression)
		if err != nil {
			return fmt.Errorf("failed to add base retry expression: %w", err)
		}
		// Only assign default options if validation succeeds
		for _, sgName := range defaultSgNames {
			opts := baseRetryOptions
			m.retries[sgName] = &opts
		}
	}

	// Process custom retry options
	for _, sgName := range customSgNames {
		entry, ok := subgraphRetryOptions[sgName]
		if !ok {
			return fmt.Errorf("failed to get subgraphRetryOptions: %s", sgName)
		}

		if entry.Algorithm != BackoffJitter {
			return fmt.Errorf("unsupported retry algorithm for subgraph %s: %s", sgName, entry.Algorithm)
		}

		// Validate expression before assigning options
		err := m.exprManager.AddExpression(entry.Expression)
		if err != nil {
			return fmt.Errorf("failed to add retry expression for subgraph %s: %w", sgName, err)
		}

		// Create a new copy of the options
		opts := entry
		m.retries[sgName] = &opts
	}

	return nil
}

func (m *Manager) GetSubgraphOptions(name string) *RetryOptions {
	if m == nil {
		return nil
	}
	return m.retries[name]
}

func (m *Manager) IsEnabled() bool {
	if m == nil {
		return false
	}
	return len(m.retries) > 0
}

func (m *Manager) Retry(err error, req *http.Request, resp *http.Response, exprString string) bool {
	if m.retryFunc == nil {
		return false
	}
	return m.retryFunc(err, req, resp, exprString)
}
