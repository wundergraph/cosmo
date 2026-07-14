package subgraph

import (
	"context"
	"errors"
	"testing"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/deferdemo"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/reviews/subgraph/model"
)

func TestReviewResolversPropagateCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	resolver := &productResolver{Resolver: &Resolver{Latencies: deferdemo.Latencies{}}}
	product := &model.Product{ID: "1"}

	t.Run("reviews", func(t *testing.T) {
		got, err := resolver.Reviews(ctx, product)
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("Reviews() error = %v, want %v", err, context.Canceled)
		}
		if got != nil {
			t.Fatalf("Reviews() = %#v, want nil", got)
		}
	})

	t.Run("rating summary", func(t *testing.T) {
		got, err := resolver.RatingSummary(ctx, product)
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("RatingSummary() error = %v, want %v", err, context.Canceled)
		}
		if got != nil {
			t.Fatalf("RatingSummary() = %#v, want nil", got)
		}
	})
}

func TestReviewsByProductID(t *testing.T) {
	got := reviewsByProductID("product")
	if len(got) != 2 {
		t.Fatalf("reviewsByProductID() returned %d reviews, want 2", len(got))
	}
	if got[0].ID != "product-1" || got[0].Body != "Great" || got[0].Stars != 5 {
		t.Fatalf("reviewsByProductID()[0] = %#v", got[0])
	}
	if got[1].ID != "product-2" || got[1].Body != "Solid" || got[1].Stars != 4 {
		t.Fatalf("reviewsByProductID()[1] = %#v", got[1])
	}
}
