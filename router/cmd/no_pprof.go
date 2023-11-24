//go:build !pprof

package cmd

import "go.uber.org/zap"

// This is a dummy function to disable pprof handlers
// at compile time. See pprof.go
func initPprofHandlers(logger *zap.Logger) {}
