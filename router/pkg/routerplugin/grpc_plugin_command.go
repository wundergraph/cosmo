//go:build !linux
// +build !linux

package routerplugin

import (
	"os/exec"
)

func newPluginCommand(filePath string) *exec.Cmd {
	cmd := exec.Command(filePath)

	return cmd

}
