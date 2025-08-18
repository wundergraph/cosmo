//go:build windows

package grpccommon

import (
	"os/exec"
	"syscall"
)

// PrepareCommand adds OS-specific options to the command.
func PrepareCommandForOS(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP,
	}
}
