package routerplugin

import (
	"context"
	"fmt"
	"sync"

	"go.uber.org/zap"
)

type PluginConfig struct {
	SubgraphName  string
	PluginName    string
	PluginCommand []string
}

type HostConfig struct {
	PluginConfigs []PluginConfig
}

type Host[T any] struct {
	mu        sync.RWMutex
	pluginMap map[string]Plugin[T]
}

func NewHost[T any](config HostConfig) (*Host[T], error) {
	return &Host[T]{
		pluginMap: make(map[string]Plugin[T]),
	}, nil
}

func (h *Host[T]) RegisterPlugin(pluginName string, plugin Plugin[T]) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.pluginMap[pluginName] = plugin
	return nil
}

func (h *Host[T]) GetPlugin(pluginName string) (Plugin[T], error) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	plugin, ok := h.pluginMap[pluginName]
	if !ok {
		return nil, fmt.Errorf("plugin %s not found", pluginName)
	}

	return plugin, nil
}

func (h *Host[T]) StopPlugin(pluginName string) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	plugin, ok := h.pluginMap[pluginName]
	if !ok {
		return fmt.Errorf("plugin %s not found", pluginName)
	}

	plugin.Stop()

	delete(h.pluginMap, pluginName)
	return nil
}

func (h *Host[T]) RunPluginHost(ctx context.Context, logger *zap.Logger) error {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, plugin := range h.pluginMap {
		err := plugin.Start(ctx, logger)
		if err != nil {
			return fmt.Errorf("failed to start plugin %s: %w", plugin.Name(), err)
		}
	}

	return nil
}
