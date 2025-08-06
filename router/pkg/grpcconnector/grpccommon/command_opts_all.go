//go:build !linux && !darwin && !windows

package grpccommon

import (
	"os/exec"
)

// PrepareCommandForLinux adds Linux-specific options to the command.
func PrepareCommandForOS(cmd *exec.Cmd) {

}
