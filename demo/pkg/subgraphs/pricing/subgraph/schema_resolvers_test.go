package subgraph

import (
	"context"
	"errors"
	"testing"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/deferdemo"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/pricing/subgraph/model"
)

func TestPriceResolversPropagateCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	resolver := &productResolver{Resolver: &Resolver{Latencies: deferdemo.Latencies{}}}
	product := &model.Product{ID: "1"}

	t.Run("price", func(t *testing.T) {
		got, err := resolver.Price(ctx, product)
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("Price() error = %v, want %v", err, context.Canceled)
		}
		if got != 0 {
			t.Fatalf("Price() = %v, want 0", got)
		}
	})

	t.Run("price history", func(t *testing.T) {
		got, err := resolver.PriceHistory(ctx, product)
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("PriceHistory() error = %v, want %v", err, context.Canceled)
		}
		if got != nil {
			t.Fatalf("PriceHistory() = %#v, want nil", got)
		}
	})
}

func TestPriceByProductID(t *testing.T) {
	t.Run("returns stored price", func(t *testing.T) {
		got, err := priceByProductID("2")
		if err != nil {
			t.Fatalf("priceByProductID() error = %v", err)
		}
		if want := 299.0; got != want {
			t.Fatalf("priceByProductID() = %v, want %v", got, want)
		}
	})

	t.Run("rejects missing product", func(t *testing.T) {
		got, err := priceByProductID("missing")
		if err == nil {
			t.Fatal("priceByProductID() error = nil, want error")
		}
		if got != 0 {
			t.Fatalf("priceByProductID() = %v, want 0", got)
		}
	})
}
