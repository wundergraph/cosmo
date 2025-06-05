package routerplugin

import (
	"context"
	"errors"
	"fmt"
	"sync"
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

	if _, ok := h.pluginMap[subgraphName]; ok {
		return fmt.Errorf("plugin %s already registered", subgraphName)
	}

	h.pluginMap[subgraphName] = plugin
	return nil
}

func (h *Host) GetPlugin(subgraphName string) (Plugin, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	plugin, ok := h.pluginMap[subgraphName]
	if !ok {
		return nil, false
	}

	return plugin, true
}

func (h *Host) StopAllPlugins() error {
	var resErr error

	h.mu.Lock()
	defer h.mu.Unlock()

	for name := range h.pluginMap {
		if err := h.stopPlugin(name); err != nil {
			resErr = errors.Join(resErr, err)
		}
	}

	h.pluginMap = make(map[string]Plugin)
	return resErr
}

func (h *Host) stopPlugin(pluginName string) error {

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

func (h *Host) RunPluginHost(ctx context.Context) error {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, plugin := range h.pluginMap {
		err := plugin.Start(ctx)
		if err != nil {
			return fmt.Errorf("failed to start plugin %s: %w", plugin.Name(), err)
		}
	}

	return nil
}
