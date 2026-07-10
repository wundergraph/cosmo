package deferdemo

import (
	"context"
	"fmt"
	"math"
	"os"
	"strconv"
	"time"
)

const baseLatencyEnv = "DEFER_DEMO_BASE_LATENCY_MS"

// Field identifies a resolver field whose latency is part of the defer demo.
type Field string

const (
	FieldCatalogStorefront           Field = "catalog.Query.storefront"
	FieldPricingProductPrice         Field = "pricing.Product.price"
	FieldPricingProductPriceHistory  Field = "pricing.Product.priceHistory"
	FieldReviewsProductReviews       Field = "reviews.Product.reviews"
	FieldReviewsProductRatingSummary Field = "reviews.Product.ratingSummary"
)

const maxFieldLatency = 700 * time.Millisecond

// Latencies is an immutable snapshot of the defer demo's latency settings. Its
// zero value uses the documented per-field defaults with no additional base
// latency.
type Latencies struct {
	base time.Duration
}

// NewLatenciesFromEnv snapshots the optional base latency from
// DEFER_DEMO_BASE_LATENCY_MS. The base is added to every field latency.
func NewLatenciesFromEnv() (Latencies, error) {
	raw, ok := os.LookupEnv(baseLatencyEnv)
	if !ok {
		return Latencies{}, nil
	}

	milliseconds, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return Latencies{}, fmt.Errorf("deferdemo: parse %s: %w", baseLatencyEnv, err)
	}
	if milliseconds < 0 {
		return Latencies{}, fmt.Errorf("deferdemo: %s must not be negative", baseLatencyEnv)
	}

	maxBaseMilliseconds := (int64(math.MaxInt64) - int64(maxFieldLatency)) / int64(time.Millisecond)
	if milliseconds > maxBaseMilliseconds {
		return Latencies{}, fmt.Errorf("deferdemo: %s overflows time.Duration", baseLatencyEnv)
	}

	return Latencies{base: time.Duration(milliseconds) * time.Millisecond}, nil
}

// Duration returns the configured delay for field.
func (l Latencies) Duration(field Field) (time.Duration, error) {
	var fieldLatency time.Duration
	switch field {
	case FieldCatalogStorefront:
		fieldLatency = 10 * time.Millisecond
	case FieldPricingProductPrice:
		fieldLatency = 30 * time.Millisecond
	case FieldPricingProductPriceHistory:
		fieldLatency = 700 * time.Millisecond
	case FieldReviewsProductReviews:
		fieldLatency = 250 * time.Millisecond
	case FieldReviewsProductRatingSummary:
		fieldLatency = 40 * time.Millisecond
	default:
		return 0, fmt.Errorf("deferdemo: unknown latency field %q", field)
	}

	return l.base + fieldLatency, nil
}

// Wait delays the resolver for field or returns the context error when the
// request is canceled.
func (l Latencies) Wait(ctx context.Context, field Field) error {
	delay, err := l.Duration(field)
	if err != nil {
		return err
	}

	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
