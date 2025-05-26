//go:build windows
// +build windows

package routerplugin

import (
	"os/exec"
	"strings"
)

func newPluginCommand(filePath string) *exec.Cmd {
	if !strings.HasSuffix(filePath, ".exe") {
		filePath = filePath + ".exe"
	}

	cmd := exec.Command(filePath)

	return cmd

	// TODO: create job object and set it as parent for the plugin process

	// handle, err := windows.CreateJobObject(nil, nil)
	// if err != nil {
	// 	return
	// }

}
