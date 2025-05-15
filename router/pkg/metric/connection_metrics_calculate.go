package metric

import (
	"context"
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
	for _, trace := range fromTrace.ClientTraces {
		totalDuration := 0.0
		host := ""

		if trace.ConnectionGet != nil {
			host = trace.ConnectionGet.HostPort
		}

		if trace.ConnectionAcquired != nil {
			store.MeasureConnections(ctx, trace.ConnectionAcquired.Reused, rotel.WgHost.String(host))
		}

		// We skip if ConnectionAcquired was not recorded
		if trace.ConnectionGet != nil && trace.ConnectionAcquired != nil {
			connAcquireTime := trace.ConnectionAcquired.Time.Sub(trace.ConnectionGet.Time).Seconds()
			store.MeasureConnectionAcquireDuration(ctx, connAcquireTime, rotel.WgHost.String(host))
		}

		// Dns Lookup can be cached
		dnsLookupOccurred := trace.DNSStart != nil || trace.DNSDone != nil

		// Measure DNS duration for both success and error cases
		// We skip if DNSDone was not recorded
		if trace.DNSStart != nil && trace.DNSDone != nil {
			sub := trace.DNSDone.Time.Sub(trace.DNSStart.Time).Seconds()
			totalDuration += sub
			store.MeasureDNSDuration(ctx, sub, rotel.WgHost.String(host), rotel.WgDnsHost.String(trace.DNSStart.Host))
		}

		// Tls Handshake can be cached
		tlsHandshakeOccurred := trace.TLSStart != nil || trace.TLSDone != nil

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

		// In case of no dials, we dont record 0 which will be a false positive
		if totalDuration != 0.0 {
			store.MeasureTotalConnectionDuration(ctx, totalDuration,
				// Dns Lookup and Tls Handshake could be skipped because of internal caching
				// so we use these attributes as dimensions
				rotel.WgHost.String(host),
				rotel.WgDnsLookup.Bool(dnsLookupOccurred),
				rotel.WgTlsHandshake.Bool(tlsHandshakeOccurred),
			)
		}
	}

}
