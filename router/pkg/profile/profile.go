// Package profile implements functions for profiling the router

package profile

import (
	"errors"
	"net/http"
	"net/http/pprof"
	"os"
	runtimePprof "runtime/pprof"

	"go.uber.org/zap"
)

type Profiler interface {
	Finish()
}

type Server interface {
	Listen()
	Close()
}

type server struct {
	logger *zap.Logger
	server *http.Server
}

type profiler struct {
	cpuProfileFile     *os.File
	memProfileFilePath string
	logger             *zap.Logger
}

// NewServer creates a new pprof server
func NewServer(addr string, log *zap.Logger) Server {

	logger := log.With(zap.String("component", "pprof-server"))

	mux := http.NewServeMux()
	mux.HandleFunc("/debug/pprof/", pprof.Index)
	mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
	mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	mux.HandleFunc("/debug/pprof/trace", pprof.Trace)

	svr := &http.Server{
		Addr:     addr,
		ErrorLog: zap.NewStdLog(logger),
	}

	logger.Info("pprof server started", zap.String("address", svr.Addr))

	return &server{
		logger: logger,
		server: svr,
	}
}

// Listen starts the pprof server
func (p *server) Listen() {
	if err := p.server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		p.logger.Error("Could not start pprof server", zap.Error(err))
	}
}

// Close stops the pprof server
func (p *server) Close() {
	if err := p.server.Close(); err != nil {
		p.logger.Error("Could not close pprof server", zap.Error(err))
	}
}

// Finish terminates profiling and writes the CPU and memory profiles if needed
func (p *profiler) Finish() {
	if p.cpuProfileFile != nil {
		runtimePprof.StopCPUProfile()
		if err := p.cpuProfileFile.Close(); err != nil {
			p.logger.Error("Could not close CPU profile file", zap.Error(err))
			return
		}
		p.logger.Info("Wrote CPU profile", zap.String("path", p.cpuProfileFile.Name()))
	}

	if p.memProfileFilePath != "" {
		f, err := os.Create(p.memProfileFilePath)
		if err != nil {
			p.logger.Error("Could not create memory profile", zap.Error(err))
			return
		}
		defer func() {
			_ = f.Close()
		}()

		if err := runtimePprof.WriteHeapProfile(f); err != nil {
			p.logger.Error("Could not write memory profile", zap.Error(err))
			return
		}

		p.logger.Info("Wrote memory profile", zap.String("path", p.memProfileFilePath))
	}
}

// Start starts profiling and returns a Profiler that must be finished with
// Finish() (usually via defer) to write the profiles. If both paths are empty,
// Start() and Finish() are no-ops.
func Start(log *zap.Logger, cpuProfilePath, memProfilePath string) Profiler {
	p := &profiler{
		logger:             log.With(zap.String("component", "profiler")),
		memProfileFilePath: memProfilePath,
	}

	if cpuProfilePath != "" {
		log.Info("Starting CPU profile", zap.String("path", cpuProfilePath))
		f, err := os.Create(cpuProfilePath)
		if err != nil {
			log.Fatal("Could not create CPU profile", zap.Error(err))
		}
		if err := runtimePprof.StartCPUProfile(f); err != nil {
			log.Fatal("Could not start CPU profile", zap.Error(err))
		}
		p.cpuProfileFile = f
	}

	return p
}
