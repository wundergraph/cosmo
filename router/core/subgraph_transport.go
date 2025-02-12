package core

import (
	"net/http"

	"go.uber.org/zap"
)

type SubgraphTransport struct {
	defaultTransport http.RoundTripper
	logger           *zap.Logger
	subgraphTrippers map[string]*http.Transport
	opts             *SubgraphTransportOptions
}

func NewSubgraphTransport(transportOpts *SubgraphTransportOptions, roundTripper http.RoundTripper, logger *zap.Logger, proxy ProxyFunc) *SubgraphTransport {
	tt := &SubgraphTransport{
		defaultTransport: roundTripper,
		logger:           logger,
		subgraphTrippers: map[string]*http.Transport{},
		opts:             transportOpts,
	}

	for subgraph, subgraphOpts := range transportOpts.SubgraphMap {
		if subgraphOpts != nil {
			tt.subgraphTrippers[subgraph] = newHTTPTransport(subgraphOpts, proxy)
		}
	}

	return tt
}

func (tt *SubgraphTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req == nil {
		return nil, nil
	}

	rq := getRequestContext(req.Context())
	if rq == nil {
		return nil, nil
	}
	subgraph := rq.ActiveSubgraph(req)

	if subgraph != nil && subgraph.Name != "" && tt.subgraphTrippers[subgraph.Name] != nil {
		return tt.subgraphTrippers[subgraph.Name].RoundTrip(req)
	}

	return tt.defaultTransport.RoundTrip(req)
}
