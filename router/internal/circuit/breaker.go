package circuit

import (
	"context"
	"fmt"
	"github.com/wundergraph/cosmo/router/internal/traceclient"
	"go.uber.org/zap"
	"net/http"
)

type Breaker struct {
	roundTripper   http.RoundTripper
	loggerFunc     func(req *http.Request) *zap.Logger
	circuitBreaker *Manager
}

func NewCircuitTripper(roundTripper http.RoundTripper, breaker *Manager, logger func(req *http.Request) *zap.Logger) *Breaker {
	return &Breaker{
		circuitBreaker: breaker,
		loggerFunc:     logger,
		roundTripper:   roundTripper,
	}
}

func (rt *Breaker) RoundTrip(req *http.Request) (resp *http.Response, err error) {
	ctx := req.Context()

	var subgraph string
	subgraphCtxVal := ctx.Value(traceclient.CurrentSubgraphContextKey{})
	if subgraphCtxVal != nil {
		subgraph = subgraphCtxVal.(string)
	}

	var prefix string
	prefixCtxVal := ctx.Value(traceclient.CurrentFeatureFlagContextKey{})
	if prefixCtxVal != nil {
		prefix = prefixCtxVal.(string)
	}

	cbKey := fmt.Sprintf("%s::%s", prefix, subgraph)

	// If there is no circuit defined for this subgraph
	circuit := rt.circuitBreaker.GetCircuitBreaker(cbKey)
	if circuit == nil {
		return rt.roundTripper.RoundTrip(req)
	}

	preRunStatus := circuit.IsOpen()

	err = circuit.Run(context.Background(), func(ctx context.Context) error {
		resp, err = rt.roundTripper.RoundTrip(req)
		return err
	})

	postRunStatus := circuit.IsOpen()

	logger := rt.loggerFunc(req)
	if preRunStatus != postRunStatus {
		logger.Debug("Circuit breaker status changed", zap.String("subgraph", subgraph), zap.Bool("isOpen", postRunStatus))
	} else if preRunStatus {
		logger.Debug("Circuit breaker open, request callback did not execute", zap.String("subgraph", subgraph))
	}

	return resp, err
}
