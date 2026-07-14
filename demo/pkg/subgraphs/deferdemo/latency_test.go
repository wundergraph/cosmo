package deferdemo

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"
)

func TestLatenciesDefaultsAreZeroValueSafe(t *testing.T) {
	tests := []struct {
		name  string
		field Field
		want  time.Duration
	}{
		{name: "catalog storefront", field: FieldCatalogStorefront, want: 10 * time.Millisecond},
		{name: "product price", field: FieldPricingProductPrice, want: 30 * time.Millisecond},
		{name: "product price history", field: FieldPricingProductPriceHistory, want: 700 * time.Millisecond},
		{name: "product reviews", field: FieldReviewsProductReviews, want: 250 * time.Millisecond},
		{name: "product rating summary", field: FieldReviewsProductRatingSummary, want: 40 * time.Millisecond},
	}

	var latencies Latencies
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := latencies.Duration(tt.field)
			if err != nil {
				t.Fatalf("Duration() error = %v", err)
			}
			if got != tt.want {
				t.Fatalf("Duration() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNewLatenciesFromEnv(t *testing.T) {
	const envName = "DEFER_DEMO_BASE_LATENCY_MS"

	t.Run("absent uses defaults", func(t *testing.T) {
		t.Setenv(envName, "restore-me")
		if err := os.Unsetenv(envName); err != nil {
			t.Fatal(err)
		}

		latencies, err := NewLatenciesFromEnv()
		if err != nil {
			t.Fatalf("NewLatenciesFromEnv() error = %v", err)
		}
		got, err := latencies.Duration(FieldCatalogStorefront)
		if err != nil {
			t.Fatal(err)
		}
		if want := 10 * time.Millisecond; got != want {
			t.Fatalf("Duration() = %v, want %v", got, want)
		}
	})

	tests := []struct {
		name    string
		value   string
		want    time.Duration
		wantErr bool
	}{
		{name: "zero is accepted", value: "0", want: 10 * time.Millisecond},
		{name: "positive base is added", value: "25", want: 35 * time.Millisecond},
		{name: "largest safe base is accepted", value: "9223372036154", want: time.Duration(9223372036154)*time.Millisecond + 10*time.Millisecond},
		{name: "base plus longest field overflow is rejected", value: "9223372036155", wantErr: true},
		{name: "negative is rejected", value: "-1", wantErr: true},
		{name: "malformed is rejected", value: "not-a-number", wantErr: true},
		{name: "parse overflow is rejected", value: "9223372036854775808", wantErr: true},
		{name: "duration overflow is rejected", value: "9223372036854775807", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv(envName, tt.value)

			latencies, err := NewLatenciesFromEnv()
			if tt.wantErr {
				if err == nil {
					t.Fatal("NewLatenciesFromEnv() error = nil, want error")
				}
				return
			}
			if err != nil {
				t.Fatalf("NewLatenciesFromEnv() error = %v", err)
			}
			got, err := latencies.Duration(FieldCatalogStorefront)
			if err != nil {
				t.Fatal(err)
			}
			if got != tt.want {
				t.Fatalf("Duration() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNewLatenciesFromEnvAddsBaseToEveryField(t *testing.T) {
	t.Setenv("DEFER_DEMO_BASE_LATENCY_MS", "25")
	latencies, err := NewLatenciesFromEnv()
	if err != nil {
		t.Fatalf("NewLatenciesFromEnv() error = %v", err)
	}

	tests := []struct {
		field Field
		want  time.Duration
	}{
		{field: FieldCatalogStorefront, want: 35 * time.Millisecond},
		{field: FieldPricingProductPrice, want: 55 * time.Millisecond},
		{field: FieldPricingProductPriceHistory, want: 725 * time.Millisecond},
		{field: FieldReviewsProductReviews, want: 275 * time.Millisecond},
		{field: FieldReviewsProductRatingSummary, want: 65 * time.Millisecond},
	}

	for _, tt := range tests {
		got, err := latencies.Duration(tt.field)
		if err != nil {
			t.Fatalf("Duration(%q) error = %v", tt.field, err)
		}
		if got != tt.want {
			t.Errorf("Duration(%q) = %v, want %v", tt.field, got, tt.want)
		}
	}
}

func TestNewLatenciesFromEnvReturnsIndependentSnapshots(t *testing.T) {
	t.Setenv("DEFER_DEMO_BASE_LATENCY_MS", "10")
	first, err := NewLatenciesFromEnv()
	if err != nil {
		t.Fatal(err)
	}

	t.Setenv("DEFER_DEMO_BASE_LATENCY_MS", "20")
	second, err := NewLatenciesFromEnv()
	if err != nil {
		t.Fatal(err)
	}

	firstDuration, err := first.Duration(FieldCatalogStorefront)
	if err != nil {
		t.Fatal(err)
	}
	secondDuration, err := second.Duration(FieldCatalogStorefront)
	if err != nil {
		t.Fatal(err)
	}
	if firstDuration != 20*time.Millisecond {
		t.Fatalf("first snapshot duration = %v, want 20ms", firstDuration)
	}
	if secondDuration != 30*time.Millisecond {
		t.Fatalf("second snapshot duration = %v, want 30ms", secondDuration)
	}
}

func TestLatenciesRejectUnknownField(t *testing.T) {
	_, err := (Latencies{}).Duration(Field("unknown.field"))
	if err == nil {
		t.Fatal("Duration() error = nil, want error")
	}

	err = (Latencies{}).Wait(context.Background(), Field("unknown.field"))
	if err == nil {
		t.Fatal("Wait() error = nil, want error")
	}
}

func TestLatenciesWait(t *testing.T) {
	t.Run("completes after the field latency", func(t *testing.T) {
		if err := (Latencies{}).Wait(context.Background(), FieldCatalogStorefront); err != nil {
			t.Fatalf("Wait() error = %v", err)
		}
	})

	t.Run("returns context cancellation", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()

		done := make(chan error, 1)
		go func() {
			done <- (Latencies{}).Wait(ctx, FieldPricingProductPriceHistory)
		}()

		select {
		case err := <-done:
			if !errors.Is(err, context.Canceled) {
				t.Fatalf("Wait() error = %v, want %v", err, context.Canceled)
			}
		case <-time.After(100 * time.Millisecond):
			t.Fatal("Wait() did not return promptly after cancellation")
		}
	})

	t.Run("returns context deadline", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
		defer cancel()

		err := (Latencies{}).Wait(ctx, FieldPricingProductPriceHistory)
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("Wait() error = %v, want %v", err, context.DeadlineExceeded)
		}
	})
}
