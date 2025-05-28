//go:build linux
// +build linux

package routerplugin

import (
	"os/exec"
	"syscall"
)

func newPluginCommand(filePath string) *exec.Cmd {
	cmd := exec.Command(filePath)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid:   true,
		Pdeathsig: syscall.SIGTERM,
	}
	return cmd
}
