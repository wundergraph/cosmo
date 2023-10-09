package main

import (
	"context"
	"github.com/bufbuild/connect-go"
	coveragev1 "github.com/wundergraph/cosmo/rstatscollector/gen/proto/wg/cosmo/coverage/v1"
	"github.com/wundergraph/cosmo/rstatscollector/gen/proto/wg/cosmo/coverage/v1/coveragev1connect"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
)

type CoverageServer struct{}

func (s *CoverageServer) PublishOperationCoverageReport(
	ctx context.Context,
	req *connect.Request[coveragev1.PublishOperationCoverageReportRequest],
) (*connect.Response[coveragev1.PublishOperationCoverageReportResponse], error) {
	res := connect.NewResponse(&coveragev1.PublishOperationCoverageReportResponse{})
	res.Header().Set("statscollector-Version", "v1")
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

	coverageServer := &CoverageServer{}
	mux := http.NewServeMux()
	path, handler := coveragev1connect.NewCoverageServiceHandler(coverageServer)
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
