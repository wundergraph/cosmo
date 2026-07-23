//go:build !wasip1 && !wasm

package sdk

// Log is a no-op when the SDK is compiled outside a WASM target (e.g. for unit
// tests of module logic on the host platform).
func Log(level LogLevel, message string) {}
