//go:build darwin
// +build darwin

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

}
