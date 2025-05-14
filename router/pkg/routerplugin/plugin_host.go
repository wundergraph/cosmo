package routerplugin

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"go.uber.org/zap"
)

type PluginConfig struct {
	SubgraphName  string
	PluginName    string
	PluginVersion string
	PluginCommand []string
}

type HostConfig struct {
	PluginConfigs []PluginConfig
}

type Host struct {
	mu        sync.RWMutex
	pluginMap map[string]Plugin
}

func NewHost() *Host {
	return &Host{
		pluginMap: make(map[string]Plugin),
	}
}

func (h *Host) RegisterPlugin(subgraphName string, plugin Plugin) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.pluginMap[subgraphName] = plugin
	return nil
}

func (h *Host) GetPlugin(pluginName string) (Plugin, error) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	plugin, ok := h.pluginMap[pluginName]
	if !ok {
		return nil, fmt.Errorf("plugin %s not found", pluginName)
	}

	return plugin, nil
}

func (h *Host) GetAllPlugins() map[string]Plugin {
	h.mu.RLock()
	defer h.mu.RUnlock()

	return h.pluginMap
}

func (h *Host) StopAllPlugins() error {
	var resErr error

	for name := range h.pluginMap {
		if err := h.StopPlugin(name); err != nil {
			resErr = errors.Join(resErr, err)
		}
	}

	h.pluginMap = make(map[string]Plugin)
	return resErr
}

func (h *Host) StopPlugin(pluginName string) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	plugin, ok := h.pluginMap[pluginName]
	if !ok {
		return fmt.Errorf("plugin %s not found", pluginName)
	}

	if err := plugin.Stop(); err != nil {
		return fmt.Errorf("failed to stop plugin %s: %w", pluginName, err)
	}

	delete(h.pluginMap, pluginName)
	return nil
}

func (h *Host) RunPluginHost(ctx context.Context, logger *zap.Logger) error {
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
