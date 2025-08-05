//go:build !linux
// +build !linux

package grpccommon

import (
	"os/exec"
)

// PrepareCommandForLinux adds Linux-specific options to the command.
func PrepareCommandForLinux(cmd *exec.Cmd) {

}
