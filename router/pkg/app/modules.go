package app

import (
	"fmt"
	"net/http"
	"sync"
)

type ModuleID string

type ModuleInfo struct {
	// Name is the name of the module
	ID ModuleID
	// New is the function that creates a new instance of the module
	New func() Module
}

type Module interface {
	Module() ModuleInfo
}

var (
	modules   = make(map[string]ModuleInfo)
	modulesMu sync.RWMutex
)

func RegisterModule(instance Module) {
	mod := instance.Module()

	if mod.ID == "" {
		panic("module ID missing")
	}
	if mod.ID == "wundergraph" {
		panic(fmt.Sprintf("module ID '%s' is reserved", mod.ID))
	}
	if val := mod.New(); val == nil {
		panic("ModuleInfo.New must return a non-nil module instance")
	}

	modulesMu.Lock()
	defer modulesMu.Unlock()

	if _, ok := modules[string(mod.ID)]; ok {
		panic(fmt.Sprintf("module already registered: %s", mod.ID))
	}
	modules[string(mod.ID)] = mod
}

// Module Interfaces

type MiddlewareHandler interface {
	ServeHTTP(http.ResponseWriter, *http.Request, http.Handler)
}
