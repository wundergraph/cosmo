package subgraphs

import (
	"net/http"
	"testing"
	"time"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/deferdemo"
)

func TestDeferDemoHandlersAreNilOptionsSafe(t *testing.T) {
	handlers := []struct {
		name string
		new  func(*SubgraphOptions) http.Handler
	}{
		{name: "catalog", new: CatalogHandler},
		{name: "pricing", new: PricingHandler},
		{name: "reviews", new: ReviewsHandler},
	}

	for _, handler := range handlers {
		t.Run(handler.name, func(t *testing.T) {
			if got := handler.new(nil); got == nil {
				t.Fatal("handler = nil")
			}
			if got := handler.new(&SubgraphOptions{DeferDemoLatencies: deferdemo.Latencies{}}); got == nil {
				t.Fatal("handler with latency snapshot = nil")
			}
		})
	}
}

func TestDeferDemoLatenciesUsesOptionsSnapshot(t *testing.T) {
	t.Setenv("DEFER_DEMO_BASE_LATENCY_MS", "25")
	latencies, err := deferdemo.NewLatenciesFromEnv()
	if err != nil {
		t.Fatal(err)
	}

	got, err := deferDemoLatencies(&SubgraphOptions{DeferDemoLatencies: latencies}).Duration(deferdemo.FieldCatalogStorefront)
	if err != nil {
		t.Fatal(err)
	}
	if want := 35 * time.Millisecond; got != want {
		t.Fatalf("options latency = %v, want %v", got, want)
	}
}
