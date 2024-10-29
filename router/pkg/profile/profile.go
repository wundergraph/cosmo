// Package profile implements functions for profiling the router

package profile

import (
	"errors"
	"fmt"
	"go.uber.org/zap"
	"net/http"
	"net/http/pprof"
	"os"
	rPProf "runtime/pprof"
	"strconv"
)

type Profiler interface {
	Finish()
}

type Server interface {
	Listen()
	Close()
}

type server struct {
	port   int
	logger *zap.Logger
	server *http.Server
}

type profiler struct {
	cpuProfileFile string
	memProfileFile string
	logger         *zap.Logger
}

// NewServer creates a new pprof server
func NewServer(port int, log *zap.Logger) Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/debug/pprof/", pprof.Index)
	mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
	mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	mux.HandleFunc("/debug/pprof/trace", pprof.Trace)

	svr := &http.Server{
		Addr: ":" + strconv.Itoa(port),
	}

	log.Info("pprof server started", zap.String("address", svr.Addr))

	return &server{
		port:   port,
		logger: log.With(zap.String("component", "pprof-server")),
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
	if p.cpuProfileFile != "" {
		rPProf.StopCPUProfile()
		p.logger.Info("Wrote CPU profile", zap.String("path", p.cpuProfileFile))
	}

	if p.memProfileFile != "" {
		if err := writeMemProfile(p.memProfileFile); err != nil {
			p.logger.Error("Could not write memory profile", zap.Error(err))
		}
		p.logger.Info("Wrote memory profile", zap.String("path", p.memProfileFile))
	}
}

// Start starts profiling and returns a Profiler that must be finished with
// Finish() (usually via defer) to write the profiles. If both paths are empty,
// Start() and Finish() are no-ops.
func Start(log *zap.Logger, cpuProfilePath, memProfilePath string) Profiler {
	if cpuProfilePath != "" {
		log.Info("Starting CPU profile", zap.String("path", cpuProfilePath))
		if err := startCpuProfile(cpuProfilePath); err != nil {
			log.Fatal("Could not start CPU profile", zap.Error(err))
		}
	}

	return &profiler{
		cpuProfileFile: cpuProfilePath,
		memProfileFile: memProfilePath,
		logger:         log.With(zap.String("component", "profiler")),
	}
}

func startCpuProfile(path string) error {
	var err error
	cpuProfileFile, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("could not create CPU profile: %w", err)
	}
	if err := rPProf.StartCPUProfile(cpuProfileFile); err != nil {
		return fmt.Errorf("could not start CPU profile: %w", err)
	}
	return nil
}

func writeMemProfile(path string) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("could not create memory profile: %w", err)
	}
	defer f.Close()

	if err := rPProf.WriteHeapProfile(f); err != nil {
		return fmt.Errorf("could not write memory profile: %w", err)
	}
	return nil
}
