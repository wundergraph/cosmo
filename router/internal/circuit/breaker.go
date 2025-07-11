package circuit

import (
	"context"
	"net/http"

	rcontext "github.com/wundergraph/cosmo/router/internal/context"
	"go.uber.org/zap"
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
	subgraphCtxVal := ctx.Value(rcontext.CurrentSubgraphContextKey{})
	if subgraphCtxVal != nil {
		if sg, ok := subgraphCtxVal.(string); ok {
			subgraph = sg
		}
	}

	// If there is no circuit defined for this subgraph
	circuit := rt.circuitBreaker.GetCircuitBreaker(subgraph)
	if circuit == nil {
		return rt.roundTripper.RoundTrip(req)
	}

	preRunStatus := circuit.IsOpen()

	err = circuit.Run(req.Context(), func(_ context.Context) error {
		resp, err = rt.roundTripper.RoundTrip(req)
		return err
	})

	postRunStatus := circuit.IsOpen()

	logger := rt.loggerFunc(req)
	if preRunStatus != postRunStatus {
		logger.Debug("Circuit breaker status changed", zap.String("subgraph_name", subgraph), zap.Bool("is_open", postRunStatus))
	} else if preRunStatus {
		logger.Debug("Circuit breaker open, request callback did not execute", zap.String("subgraph_name", subgraph))
	}

	return resp, err
}
