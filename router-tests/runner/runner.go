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
	Ports() subgraphs.Ports
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

func (r *inProcessSubgraphsRunner) Ports() subgraphs.Ports {
	return r.subgraphs.Ports()
}

func NewInProcessSubgraphsRunner(ports *subgraphs.Ports) (SubgraphsRunner, error) {
	if ports == nil {
		ports = randomFreePorts()
	}
	sg, err := subgraphs.New(&subgraphs.Config{
		Ports: subgraphs.Ports{
			Employees: ports.Employees,
			Family:    ports.Family,
			Hobbies:   ports.Hobbies,
			Products:  ports.Products,
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

func (r externalSubgraphsRunner) Ports() subgraphs.Ports {
	// External subgraphs runner always uses the default ports
	return subgraphs.Ports{
		Employees: 4001,
		Family:    4002,
		Hobbies:   4003,
		Products:  4004,
	}
}

func NewExternalSubgraphsRunner() (SubgraphsRunner, error) {
	return externalSubgraphsRunner{}, nil
}

func Wait(ctx context.Context, r SubgraphsRunner) error {
	pp := r.Ports()
	ports := []int{
		pp.Employees,
		pp.Family,
		pp.Hobbies,
		pp.Products,
	}
	for _, port := range ports {
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

func randomFreePorts() *subgraphs.Ports {
	ports := make([]int, 4)
	for ii := range ports {
		listener, err := net.Listen("tcp", ":0")
		if err != nil {
			panic(err)
		}
		ports[ii] = listener.Addr().(*net.TCPAddr).Port
		listener.Close()

	}
	return &subgraphs.Ports{
		Employees: ports[0],
		Family:    ports[1],
		Hobbies:   ports[2],
		Products:  ports[3],
	}
}
