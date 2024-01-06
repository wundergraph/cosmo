package runner

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/phayes/freeport"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs"
	"golang.org/x/sync/errgroup"
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
	return r.subgraphs.ListenAndServe(ctx)
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
		Ports: *ports,
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
		Employees:    4001,
		Family:       4002,
		Hobbies:      4003,
		Products:     4004,
		Test1:        4006,
		Availability: 4007,
		Mood:         4008,
	}
}

func NewExternalSubgraphsRunner() (SubgraphsRunner, error) {
	return externalSubgraphsRunner{}, nil
}

func Wait(ctx context.Context, r SubgraphsRunner) error {
	subgraphPorts := r.Ports()
	ports := subgraphPorts.AsArray()

	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	g, ctx := errgroup.WithContext(ctx)
	for _, port := range ports {
		port := port
		g.Go(func() error {
			for {
				select {
				case <-ctx.Done():
					return ctx.Err()
				default:
					req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d", port), nil)
					if err != nil {
						return err
					}
					res, err := http.DefaultClient.Do(req)
					if err == nil {
						_ = res.Body.Close()
						fmt.Printf("Subgraph %d is ready\n", port)
						return nil
					}
					fmt.Printf("retrying subgraph %d\n", port)
				}
			}
		})
	}
	err := g.Wait()
	if err != nil {
		return err
	}
	return nil
}

func randomFreePorts() *subgraphs.Ports {
	ports, err := freeport.GetFreePorts(7)
	if err != nil {
		panic(err)
	}
	return &subgraphs.Ports{
		Employees:    ports[0],
		Family:       ports[1],
		Hobbies:      ports[2],
		Products:     ports[3],
		Test1:        ports[4],
		Availability: ports[5],
		Mood:         ports[6],
	}
}
