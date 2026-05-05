package config

func ValidateMCPCodeMode(cfg *MCPCodeModeConfiguration, sessionStateless bool) error {
	if !cfg.Enabled {
		return nil
	}

	if !cfg.NamedOps.Enabled {
		return nil
	}

	// Storage backend selection: when ProviderID is set, the router resolves it
	// against the central storage_providers registry (Redis backend). Otherwise
	// the in-memory backend is used. The provider lookup error (unknown id) is
	// emitted by the router at startup, not here.

	// Named ops require stateful MCP sessions to work, but this intentionally
	// does not fail boot. The Code Mode runtime emits the warn log on first
	// reload so deployments can enable Code Mode before flipping session mode.
	_ = sessionStateless

	return nil
}
