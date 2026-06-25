package profile

import (
	"os"
	"strings"

	"github.com/wundergraph/cosmo/router/pkg/mondaytweaks"
)

const (
	DefaultPyroscopeApplicationName = "wundergraph.cosmo.router"

	EnvPyroscopeApplicationName = "PYROSCOPE_APPLICATION_NAME"
	EnvPyroscopeTags            = "PYROSCOPE_TAGS"
)

// PyroscopeApplicationName resolves the Pyroscope application name.
// When mondaytweaks.ResolvePyroscopeNameAndTagsFromEnv is enabled, precedence is:
// PYROSCOPE_APPLICATION_NAME > telemetryServiceName > default.
// Otherwise returns the upstream hardcoded default.
func PyroscopeApplicationName(telemetryServiceName string) string {
	if !mondaytweaks.ResolvePyroscopeNameAndTagsFromEnv {
		return DefaultPyroscopeApplicationName
	}

	if name := os.Getenv(EnvPyroscopeApplicationName); name != "" {
		return name
	}
	if telemetryServiceName != "" {
		return telemetryServiceName
	}
	return DefaultPyroscopeApplicationName
}

// PyroscopeTags builds Pyroscope tags for the running process.
// When mondaytweaks.ResolvePyroscopeNameAndTagsFromEnv is enabled, PYROSCOPE_TAGS
// (comma-separated key=value pairs) is merged with HOSTNAME. Custom tags override
// built-in tags on key collision. Otherwise returns hostname-only tags.
func PyroscopeTags() map[string]string {
	if !mondaytweaks.ResolvePyroscopeNameAndTagsFromEnv {
		return pyroscopeHostnameTag()
	}

	tags := pyroscopeHostnameTag()
	for key, value := range ParseKeyValueEnv(os.Getenv(EnvPyroscopeTags)) {
		tags[key] = value
	}
	return tags
}

func pyroscopeHostnameTag() map[string]string {
	tags := map[string]string{}
	if hostname := os.Getenv("HOSTNAME"); hostname != "" {
		tags["hostname"] = hostname
	}
	return tags
}

// ParseKeyValueEnv parses comma-separated key=value pairs.
func ParseKeyValueEnv(raw string) map[string]string {
	tags := map[string]string{}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return tags
	}

	for part := range strings.SplitSeq(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		key, value, ok := strings.Cut(part, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key == "" || value == "" {
			continue
		}
		tags[key] = value
	}
	return tags
}
