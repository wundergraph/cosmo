package metric

import (
	"context"
	"net"

	"github.com/wundergraph/cosmo/router/internal/httpclient"
	rotel "github.com/wundergraph/cosmo/router/pkg/otel"
	"go.uber.org/zap"
)

func CalculateConnectionMetrics(ctx context.Context, logger *zap.Logger, store ConnectionMetricStore) {
	if store == nil {
		return
	}

	fromTrace := httpclient.GetClientTraceFromContext(ctx)

	// We calculate the rates separately per retry
	// if in case of non retries we have 1 entry always
	for i, trace := range fromTrace.ClientTraces {
		totalDuration := 0.0

		// In case for some reason the connection get hook is not called we default to unknown
		host := "unknown"

		if trace.ConnectionAcquired != nil {
			if trace.ConnectionGet != nil {
				splitHost, _, err := net.SplitHostPort(trace.ConnectionGet.HostPort)
				if err != nil {
					logger.Error("failed to split host port", zap.Error(err))
				} else {
					// If there is no error we set the connection host
					host = splitHost
				}

				connAcquireTime := trace.ConnectionAcquired.Time.Sub(trace.ConnectionGet.Time).Seconds()
				store.MeasureConnectionAcquireDuration(ctx, connAcquireTime, rotel.WgHost.String(host))
			}
			store.MeasureConnections(ctx, trace.ConnectionAcquired.Reused, rotel.WgHost.String(host))
		}

		// Measure DNS duration for both success and error cases
		// We skip if DNSDone was not recorded
		if trace.DNSStart != nil && trace.DNSDone != nil {
			sub := trace.DNSDone.Time.Sub(trace.DNSStart.Time).Seconds()
			totalDuration += sub
			store.MeasureDNSDuration(ctx, sub, rotel.WgHost.String(trace.DNSStart.Host))
		}

		// Measure TLS duration for both success and error cases
		// We skip if TLSDone was not recorded
		if trace.TLSStart != nil && trace.TLSDone != nil {
			sub := trace.TLSDone.Time.Sub(trace.TLSStart.Time).Seconds()
			totalDuration += sub
			store.MeasureTLSHandshakeDuration(ctx, sub, rotel.WgHost.String(host))
		}

		dials := trace.GetGroupedDials()
		if len(dials) > 0 {
			// Since the dials are sorted by error and address
			firstCompletionDial := dials[0]
			if firstCompletionDial.Error == nil && firstCompletionDial.DialDoneTime != nil {
				dialSeconds := firstCompletionDial.DialDoneTime.Sub(firstCompletionDial.DialStartTime).Seconds()
				totalDuration += dialSeconds
				store.MeasureDialDuration(ctx, dialSeconds, rotel.WgHost.String(host))
			}
		}

		// If it's the second index (index 1) onwards we know that we have a retry
		if i >= 1 {
			store.MeasureConnectionRetries(ctx, rotel.WgHost.String(host))
		}

		// In case of no dials, we dont record 0 which will be a false positive
		if totalDuration != 0.0 {
			store.MeasureTotalConnectionDuration(ctx, totalDuration, rotel.WgHost.String(host))
		}
	}

}
