package graphqlmetrics

import (
	"context"
)

// Sink defines the interface for exporting batches of items to a destination.
// Implementations must be safe for concurrent use.
type Sink[T any] interface {
	// Export sends a batch of items to the sink destination.
	// It returns an error if the export fails.
	// The context can be used to cancel or timeout the export operation.
	Export(ctx context.Context, batch []T) error

	// Close performs any cleanup needed when shutting down the sink.
	// It should block until all cleanup is complete or the context is cancelled.
	Close(ctx context.Context) error
}

// SinkErrorHandler is called when a sink export fails.
// It receives the error and can inspect it to determine if retry should be attempted.
// Return true if the error is retryable, false otherwise.
type SinkErrorHandler func(error) (retryable bool)
