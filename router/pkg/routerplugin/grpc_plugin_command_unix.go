//go:build darwin || linux
// +build darwin linux

package routerplugin

import (
	"os/exec"
	"syscall"
)

func newPluginCommand(filePath string) *exec.Cmd {
	cmd := exec.Command(filePath)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid: true,
	}
	return cmd
}
