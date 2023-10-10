package main

import (
	"context"
	"github.com/bufbuild/connect-go"
	coveragev1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1"
	graphqlmetricsv1 "github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/graphqlmetrics/gen/proto/wg/cosmo/graphqlmetrics/v1/graphqlmetricsv1connect"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
)

type GraphQlMetricsServer struct{}

func (s *GraphQlMetricsServer) PublishGraphQLMetrics(
	ctx context.Context,
	req *connect.Request[graphqlmetricsv1.PublishGraphQLRequestMetricsRequest],
) (*connect.Response[coveragev1.PublishOperationCoverageReportResponse], error) {
	res := connect.NewResponse(&coveragev1.PublishOperationCoverageReportResponse{})
	res.Header().Set("GraphQL-Metrics-Version", "v1")
	return res, nil
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt,
		syscall.SIGHUP,  // process is detached from terminal
		syscall.SIGTERM, // default for kill
		syscall.SIGKILL,
		syscall.SIGQUIT, // ctrl + \
		syscall.SIGINT,  // ctrl+c
	)
	defer stop()

	gqls := &GraphQlMetricsServer{}
	mux := http.NewServeMux()
	path, handler := graphqlmetricsv1connect.NewGraphQLMetricsServiceHandler(gqls)
	mux.Handle(path, handler)

	go func() {
		if err := http.ListenAndServe(
			"localhost:4005",
			// Use h2c so we can serve HTTP/2 without TLS.
			h2c.NewHandler(mux, &http2.Server{}),
		); err != nil {
			log.Fatal(err)
		}
	}()

	log.Println("Server started on localhost:4005")

	<-ctx.Done()

	log.Println("Shutting down")
}
