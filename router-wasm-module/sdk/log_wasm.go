//go:build wasip1 || wasm

package sdk

import "github.com/extism/go-pdk"

// Log emits a log message through the Extism host, which the router forwards to
// its own logger (tagged with the module id).
func Log(level LogLevel, message string) {
	pdk.Log(pdkLevel(level), message)
}

func pdkLevel(level LogLevel) pdk.LogLevel {
	switch level {
	case LogError:
		return pdk.LogError
	case LogWarn:
		return pdk.LogWarn
	case LogInfo:
		return pdk.LogInfo
	case LogDebug:
		return pdk.LogDebug
	default:
		return pdk.LogTrace
	}
}
