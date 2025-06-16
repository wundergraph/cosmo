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

	// If there is no circuit defined for this subgraph
	circuit := rt.circuitBreaker.Circuit(subgraph)
	if circuit == nil {
		return rt.roundTripper.RoundTrip(req)
	}

	err = circuit.Execute(context.Background(), func(ctx context.Context) error {
		resp, err = rt.roundTripper.RoundTrip(req)
		return err
	}, nil)

	fmt.Println("Error", err)
	return resp, err
}
