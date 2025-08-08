//go:build linux

package grpccommon

import (
	"os/exec"
	"syscall"
)

// PrepareCommand adds OS-specific options to the command.
func PrepareCommandForOS(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid:   true,
		Pdeathsig: syscall.SIGTERM,
	}
}
