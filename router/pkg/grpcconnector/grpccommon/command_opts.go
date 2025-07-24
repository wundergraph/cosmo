//go:build !linux
// +build !linux

package grpccommon

import (
	"os/exec"
)

func PrepareCommand(cmd *exec.Cmd) {}
