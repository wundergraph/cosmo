package subgraph

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/cachegraph/subgraph/model"
)

// TestArticleStoreNoRace hammers an articleStore with concurrent readers,
// writers, and deletions for ~100ms. Run with `go test -race` to catch any
// unsynchronized access. Failure with -race manifests as a runtime "DATA RACE"
// report, not a test-level assertion.
func TestArticleStoreNoRace(t *testing.T) {
	t.Parallel()

	store := newArticleStore()
	deadline := time.Now().Add(100 * time.Millisecond)

	var wg sync.WaitGroup
	for w := range 4 {
		wg.Go(func() {
			for i := 0; time.Now().Before(deadline); i++ {
				_ = store.create(
					fmt.Sprintf("writer-%d-%d", w, i),
					"body",
					"author",
				)
			}
		})
	}

	for range 4 {
		wg.Go(func() {
			for time.Now().Before(deadline) {
				_ = store.all()
				_ = store.find("1")
				_ = store.byIDs([]string{"1", "2", "3"})
				_ = store.recommendedForViewer("v1")
			}
		})
	}

	for range 2 {
		wg.Go(func() {
			for time.Now().Before(deadline) {
				_ = store.update("1", "updated-title")
			}
		})
	}

	wg.Wait()
}

// TestListingStoreNoRace hammers a single listingStore with concurrent
// readers and deletions for ~100ms. Run with `go test -race` to catch any
// unsynchronized access.
func TestListingStoreNoRace(t *testing.T) {
	t.Parallel()

	store := newListingStore()
	deadline := time.Now().Add(100 * time.Millisecond)

	var wg sync.WaitGroup
	for range 4 {
		wg.Go(func() {
			for time.Now().Before(deadline) {
				_ = store.all()
				_ = store.get("s1", "WIDGET-01")
				_ = store.get("s2", "GIZMO-01")
			}
		})
	}

	// Writers: attempt to delete the same keys repeatedly on the shared store.
	// Delete is idempotent once the key is gone, so the read paths still see a
	// shrinking-then-empty map while concurrent iteration happens in all().
	for range 2 {
		wg.Go(func() {
			for time.Now().Before(deadline) {
				_ = store.delete("s1", "WIDGET-01")
				_ = store.delete("s1", "GADGET-02")
				_ = store.delete("s2", "GIZMO-01")
				_ = store.delete("s2", "THING-03")
			}
		})
	}

	wg.Wait()
}

// TestResolverPathNoRace drives concurrent read + write traffic through the
// generated gqlgen resolver layer (mutationResolver / queryResolver /
// viewerResolver) for ~100ms. This guards against regressions where a resolver
// bypasses the mutex-guarded stores (e.g. by reintroducing a package-level
// global). Run with `go test -race` to catch any unsynchronized access.
func TestResolverPathNoRace(t *testing.T) {
	t.Parallel()

	root := NewResolver()
	mut := &mutationResolver{root}
	qry := &queryResolver{root}
	vwr := &viewerResolver{root}
	ctx := context.Background()
	deadline := time.Now().Add(100 * time.Millisecond)

	var wg sync.WaitGroup

	// Writers: exercise every mutation resolver.
	for w := range 4 {
		wg.Go(func() {
			for i := 0; time.Now().Before(deadline); i++ {
				_, _ = mut.CreateArticle(
					ctx,
					fmt.Sprintf("resolver-writer-%d-%d", w, i),
					"body",
					"author",
				)
				_, _ = mut.UpdateArticle(ctx, "1", fmt.Sprintf("updated-%d-%d", w, i))
				_, _ = mut.DeleteListing(ctx, model.ListingKey{SellerID: "s1", Sku: "WIDGET-01"})
			}
		})
	}

	// Readers: exercise every query resolver plus the viewer field resolver.
	viewer := &model.Viewer{ID: "v1"}
	for range 8 {
		wg.Go(func() {
			for time.Now().Before(deadline) {
				_, _ = qry.Article(ctx, "1")
				_, _ = qry.Articles(ctx)
				_, _ = qry.ArticlesByIds(ctx, []string{"1", "2", "3"})
				_, _ = qry.Listing(ctx, model.ListingKey{SellerID: "s1", Sku: "WIDGET-01"})
				_, _ = qry.Listings(ctx)
				_, _ = vwr.RecommendedArticles(ctx, viewer)
			}
		})
	}

	wg.Wait()
}
