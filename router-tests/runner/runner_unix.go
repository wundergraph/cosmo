//go:build !windows

package runner

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs"
)

type subprocessSubgraphsRunner struct {
	cmd   *exec.Cmd
	ports subgraphs.Ports
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

func (r *subprocessSubgraphsRunner) Ports() subgraphs.Ports {
	return r.ports
}

func NewSubprocessSubgraphsRunner(ports *subgraphs.Ports) (SubgraphsRunner, error) {
	if ports == nil {
		ports = randomFreePorts()
	}
	programPath := filepath.Join("..", "demo", "cmd", "all", "main.go")
	cmd := exec.Command("go", "run", programPath,
		"--employees", strconv.Itoa(ports.Employees),
		"--family", strconv.Itoa(ports.Family),
		"--hobbies", strconv.Itoa(ports.Hobbies),
		"--products", strconv.Itoa(ports.Products),
		"--test1", strconv.Itoa(ports.Test1),
		"--availability", strconv.Itoa(ports.Availability),
		"--mood", strconv.Itoa(ports.Mood))
	// Create a process group ID so we can kill the process and all its children
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Stdout = os.Stdout
	cmd.Stdin = os.Stdin
	return &subprocessSubgraphsRunner{
		cmd:   cmd,
		ports: *ports,
	}, nil
}
