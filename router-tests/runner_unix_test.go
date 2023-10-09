//go:build !windows

package integration_test

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

type subprocessSubgraphsRunner struct {
	cmd *exec.Cmd
}

func (r *subprocessSubgraphsRunner) Start(ctx context.Context) error {
	return r.cmd.Run()
}

func (r *subprocessSubgraphsRunner) Stop(ctx context.Context) error {
	pgid, err := syscall.Getpgid(r.cmd.Process.Pid)
	if err != nil {
		return err
	}
	if err := syscall.Kill(-pgid, syscall.SIGTERM); err != nil {
		return err
	}
	r.cmd.Wait()
	return nil
}

func (r *subprocessSubgraphsRunner) Ports() []int {
	return []int{4001, 4002, 4003, 4004}
}

func NewSubprocessSubgraphsRunner() (SubgraphsRunner, error) {
	programPath := filepath.Join("..", "demo", "cmd", "all", "main.go")
	cmd := exec.Command("go", "run", programPath)
	// Create a process group ID so we can kill the process and all its children
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Stdout = os.Stdout
	cmd.Stdin = os.Stdin
	return &subprocessSubgraphsRunner{
		cmd: cmd,
	}, nil
}
