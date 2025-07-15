//go:build linux
// +build linux

package grpccommon

import (
	"os/exec"
	"syscall"
)

// PrepareCommand adds Linux-specific options to the command.
func PrepareCommand(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid:   true,
		Pdeathsig: syscall.SIGTERM,
	}
}
