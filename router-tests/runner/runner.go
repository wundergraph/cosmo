package runner

import (
	"context"
	"net"
	"net/http"
	"strconv"
	"time"

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

func Wait(ctx context.Context, r SubgraphsRunner) error {
	for _, port := range r.Ports() {
		for {
			_, err := net.Dial("tcp", "127.0.0.1:"+strconv.Itoa(port))
			if err == nil {
				break
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}
			time.Sleep(100 * time.Millisecond)
		}
	}
	return nil
}
