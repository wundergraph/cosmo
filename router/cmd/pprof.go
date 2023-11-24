//go:build pprof

package cmd

// importing net/http/pprof unconditionally registers global handlers for serving
// profiling data. Although we don't use the default serve mux from net/http, it
// might be accidentally used by other packages. To avoid this, we guard pprof
// support behind a build tag. See no_pprof.go

import (
	"flag"
	"net/http"
	"net/http/pprof"
	"strconv"

	"go.uber.org/zap"
)

var (
	pprofPort = flag.Int("pprof-port", 6060, "Port for pprof server, set to zero to disable")
)

func initPprofHandlers(logger *zap.Logger) {
	// Allow compiling in pprof but still disabling it at runtime
	if *pprofPort == 0 {
		return
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/debug/pprof/", pprof.Index)
	mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
	mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	mux.HandleFunc("/debug/pprof/trace", pprof.Trace)

	server := &http.Server{
		Addr: ":" + strconv.Itoa(*pprofPort),
	}
	logger.Info("starting pprof server", zap.Int("port", *pprofPort))
	go func() {
		if err := server.ListenAndServe(); err != nil {
			logger.Fatal("error starting pprof server", zap.Error(err))
		}
	}()
}
