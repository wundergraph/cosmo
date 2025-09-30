package grpcconnector

import (
	"context"
	"errors"
	"fmt"
	"sync"
)

type Connector struct {
	mu        sync.RWMutex
	clientMap map[string]ClientProvider
}

func NewConnector() *Connector {
	return &Connector{
		clientMap: make(map[string]ClientProvider),
	}
}

func (h *Connector) RegisterClientProvider(subgraphName string, provider ClientProvider) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	if _, ok := h.clientMap[subgraphName]; ok {
		return fmt.Errorf("plugin %s already registered", subgraphName)
	}

	h.clientMap[subgraphName] = provider
	return nil
}

func (h *Connector) GetClientProvider(subgraphName string) (ClientProvider, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	plugin, ok := h.clientMap[subgraphName]
	if !ok {
		return nil, false
	}

	return plugin, true
}

func (h *Connector) StopAllProviders() error {
	var resErr error

	h.mu.Lock()
	defer h.mu.Unlock()

	for name := range h.clientMap {
		if err := h.stopProvider(name); err != nil {
			resErr = errors.Join(resErr, err)
		}
	}

	h.clientMap = make(map[string]ClientProvider)
	return resErr
}

func (h *Connector) stopProvider(providerName string) error {

	provider, ok := h.clientMap[providerName]
	if !ok {
		return fmt.Errorf("plugin %s not found", providerName)
	}

	if err := provider.Stop(); err != nil {
		return fmt.Errorf("failed to stop plugin %s: %w", providerName, err)
	}

	delete(h.clientMap, providerName)
	return nil
}

func (h *Connector) Run(ctx context.Context) error {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, provider := range h.clientMap {
		err := provider.Start(ctx)
		if err != nil {
			return fmt.Errorf("failed to start plugin %s: %w", provider.Name(), err)
		}
	}

	return nil
}
