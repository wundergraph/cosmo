package main

import (
	"fmt"
	"runtime"
	"time"

	routercmd "github.com/wundergraph/cosmo/router/cmd"
)

func printMemUsage() {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	// For info on each, see: https://golang.org/pkg/runtime/#MemStats
	fmt.Printf("Alloc = %v MiB", bToMb(m.Alloc))
	fmt.Printf("\tTotalAlloc = %v MiB", bToMb(m.TotalAlloc))
	fmt.Printf("\tSys = %v MiB", bToMb(m.Sys))
	fmt.Printf("\tNumGC = %v\n", m.NumGC)
}

func bToMb(b uint64) uint64 {
	return b / 1024 / 1024
}

func continuouslyPrintMemUsage() {
	for {
		time.Sleep(10 * time.Second)
		runtime.GC()
		printMemUsage()
	}
}

func main() {
	go continuouslyPrintMemUsage()
	routercmd.Main()
}
