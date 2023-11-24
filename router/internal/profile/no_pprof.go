//go:build !pprof

package profile

// This is a dummy function to disable pprof handlers
// at compile time. See pprof.go
func initPprofHandlers() {}
