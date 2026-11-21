package planworker

import (
	"errors"
	"fmt"
	"io"
	"os"
)

// Handler does the work of a worker.
type Handler interface {
	// Configure makes a configuration available to subsequent calls of Plan.
	Configure(config *Config) error
	// Release drops a configuration that is no longer needed.
	Release(configID string)
	// Plan plans a single operation. Planning problems are reported in the result.
	Plan(request *Request) *Result
}

// ServeOptions describe the worker to the router.
type ServeOptions struct {
	// Version is the version of the router the worker was built from.
	Version string
	// PlanFormat identifies the encoding of the plans the handler returns.
	PlanFormat string
	// Disconnected is called as soon as the router is gone, even while the handler
	// is still busy. A worker process uses it to exit instead of finishing work
	// nobody is waiting for.
	Disconnected func()
}

// Serve handles the requests arriving on r and writes the results to w. It processes
// one request at a time and returns nil once the router closes the stream.
func Serve(r io.Reader, w io.Writer, handler Handler, opts ServeOptions) error {
	err := writeFrame(w, messageHello, &Hello{
		ProtocolVersion: ProtocolVersion,
		Version:         opts.Version,
		PlanFormat:      opts.PlanFormat,
		PID:             os.Getpid(),
	}, nil)
	if err != nil {
		return fmt.Errorf("failed to send hello: %w", err)
	}

	// Reading happens on its own goroutine, so that we notice the router going away
	// while a request is being handled.
	type incoming struct {
		frame *frame
		err   error
	}
	frames := make(chan incoming)
	done := make(chan struct{})
	defer close(done)
	go func() {
		for {
			f, err := readFrame(r)
			if err != nil && opts.Disconnected != nil {
				opts.Disconnected()
			}
			select {
			case frames <- incoming{frame: f, err: err}:
			case <-done:
				return
			}
			if err != nil {
				return
			}
		}
	}()

	for in := range frames {
		if in.err != nil {
			if errors.Is(in.err, io.EOF) {
				return nil
			}
			return fmt.Errorf("failed to read request: %w", in.err)
		}
		switch in.frame.typ {
		case messageConfigure:
			var header configureHeader
			if err := in.frame.decode(messageConfigure, &header); err != nil {
				return err
			}
			var result configureResultHeader
			if err := handler.Configure(&Config{ID: header.ID, Payload: in.frame.blob}); err != nil {
				result.Error = err.Error()
			}
			if err := writeFrame(w, messageConfigureResult, &result, nil); err != nil {
				return fmt.Errorf("failed to send configure result: %w", err)
			}
		case messageRelease:
			var header configureHeader
			if err := in.frame.decode(messageRelease, &header); err != nil {
				return err
			}
			handler.Release(header.ID)
		case messagePlan:
			var request Request
			if err := in.frame.decode(messagePlan, &request); err != nil {
				return err
			}
			result := handler.Plan(&request)
			if err := writeFrame(w, messagePlanResult, result, result.Plan); err != nil {
				return fmt.Errorf("failed to send plan result: %w", err)
			}
		default:
			return fmt.Errorf("unexpected message type %d", in.frame.typ)
		}
	}
	return nil
}
