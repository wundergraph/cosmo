//go:build darwin
// +build darwin

package routerplugin

import (
	"os/exec"
)

func newPluginCommand(filePath string) *exec.Cmd {
	cmd := exec.Command(filePath)

	return cmd

}
