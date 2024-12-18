package core

import (
	"context"
	"go.uber.org/zap"
	"net/http"
)

type TimeoutTransport struct {
	defaultTransport http.RoundTripper
	logger           *zap.Logger
	subgraphTrippers map[string]*http.Transport
	opts             *SubgraphTransportOptions
}

func NewTimeoutTransport(transportOpts *SubgraphTransportOptions, roundTripper http.RoundTripper, logger *zap.Logger, proxy ProxyFunc) *TimeoutTransport {
	tt := &TimeoutTransport{
		defaultTransport: roundTripper,
		logger:           logger,
		subgraphTrippers: map[string]*http.Transport{},
		opts:             transportOpts,
	}

	for subgraph, subgraphOpts := range transportOpts.SubgraphMap {
		if subgraphOpts != nil {
			tt.subgraphTrippers[subgraph] = newHTTPTransport(*subgraphOpts, proxy)
		}
	}

	return tt
}

func (tt *TimeoutTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req == nil {
		return nil, nil
	}

	rq := getRequestContext(req.Context())
	if rq == nil {
		return nil, nil
	}
	subgraph := rq.ActiveSubgraph(req)
	if subgraph != nil && subgraph.Name != "" && tt.subgraphTrippers[subgraph.Name] != nil {
		timeout := tt.opts.SubgraphMap[subgraph.Name].RequestTimeout
		if timeout > 0 {
			ctx, cancel := context.WithTimeout(req.Context(), timeout)
			defer cancel()
			return tt.subgraphTrippers[subgraph.Name].RoundTrip(req.WithContext(ctx))
		}
		return tt.subgraphTrippers[subgraph.Name].RoundTrip(req)
	}
	return tt.defaultTransport.RoundTrip(req)
}
