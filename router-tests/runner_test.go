package integration_test

import (
	"context"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs"
)

type SubgraphsRunner interface {
	Start(ctx context.Context) error
	Stop(ctx context.Context) error
	Ports() []int
}

type inProcessSubgraphsRunner struct {
	subgraphs *subgraphs.Subgraphs
}

func (r *inProcessSubgraphsRunner) Start(ctx context.Context) error {
	err := r.subgraphs.ListenAndServe(ctx)
	if err == http.ErrServerClosed {
		err = nil
	}
	return err
}

func (r *inProcessSubgraphsRunner) Stop(ctx context.Context) error {
	return r.subgraphs.Shutdown(ctx)
}

func (r *inProcessSubgraphsRunner) Ports() []int {
	return []int{4001, 4002, 4003, 4004}
}

func NewInProcessSubgraphsRunner() (SubgraphsRunner, error) {
	sg, err := subgraphs.New(&subgraphs.Config{
		Ports: subgraphs.Ports{
			Employees: 4001,
			Family:    4002,
			Hobbies:   4003,
			Products:  4004,
		},
	})
	if err != nil {
		return nil, err
	}
	return &inProcessSubgraphsRunner{
		subgraphs: sg,
	}, nil
}

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

type externalSubgraphsRunner struct{}

func (r externalSubgraphsRunner) Start(ctx context.Context) error {
	return nil
}

func (r externalSubgraphsRunner) Stop(ctx context.Context) error {
	return nil
}

func (r externalSubgraphsRunner) Ports() []int {
	return []int{4001, 4002, 4003, 4004}
}

func NewExternalSubgraphsRunner() (SubgraphsRunner, error) {
	return externalSubgraphsRunner{}, nil
}
