package sdk

// LogLevel is the severity of a guest log message. It maps to the router's
// logger levels on the host side.
type LogLevel int

const (
	LogError LogLevel = iota
	LogWarn
	LogInfo
	LogDebug
	LogTrace
)
