// Package profile implements functions for profiling the router
//
// This package automatically registers pprof handlers if the build tag "pprof".
// Additionally, the following flags are available:
// -cpuprofile: write cpu profile to file
// -memprofile: write memory profile to this file
// -pprof-port: port for pprof server, set to zero to disable (only with pprof build tag)
//
// Note that exposing pprof handlers in production is a security risk.
package profile

import (
	"flag"
	"log"
	"os"
	"runtime/pprof"
)

var (
	memprofile = flag.String("memprofile", "", "Write memory profile to this file")
	cpuprofile = flag.String("cpuprofile", "", "Write cpu profile to file")
)

type Profiler interface {
	Finish()
}

type profiler struct {
	cpuProfileFile *os.File
}

// Finish termines profiling and writes the CPU and memory profiles if needed
// If anything goes wrong, this function will exit via log.Fatal
func (p *profiler) Finish() {
	if p.cpuProfileFile != nil {
		pprof.StopCPUProfile()
		p.cpuProfileFile.Close()
		log.Println("CPU profile written to", p.cpuProfileFile.Name())
		p.cpuProfileFile = nil
	}
	createMemprofileIfNeeded()
}

// Start starts profiling and returns a Profiler that must be finished with
// Finish() (usually via defer)
func Start() Profiler {

	initPprofHandlers()

	var cpuProfileFile *os.File
	if *cpuprofile != "" {
		var err error
		cpuProfileFile, err = os.Create(*cpuprofile)
		if err != nil {
			log.Fatal("Could not create CPU profile", err)
		}
		if err := pprof.StartCPUProfile(cpuProfileFile); err != nil {
			log.Fatal("Could not start CPU profile", err)
		}
	}

	return &profiler{
		cpuProfileFile: cpuProfileFile,
	}
}

func createMemprofileIfNeeded() {
	if *memprofile != "" {
		f, err := os.Create(*memprofile)
		if err != nil {
			log.Fatal("error creating file for heap profile", err)
		}
		defer f.Close()
		if err := pprof.WriteHeapProfile(f); err != nil {
			log.Fatal("error writing heap profile", err)
		}
		log.Println("heap profile written to", f.Name())
	}
}
