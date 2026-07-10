package subgraph

import (
	"context"
	"errors"
	"testing"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/deferdemo"
)

func TestStorefrontPropagatesCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	resolver := &queryResolver{Resolver: &Resolver{Latencies: deferdemo.Latencies{}}}

	got, err := resolver.Storefront(ctx)

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Storefront() error = %v, want %v", err, context.Canceled)
	}
	if got != nil {
		t.Fatalf("Storefront() = %#v, want nil", got)
	}
}
