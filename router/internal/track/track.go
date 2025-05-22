package track

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/posthog/posthog-go"
	"github.com/wundergraph/cosmo/router/internal/jwt"
	"go.uber.org/zap"
)

type UsageTracker struct {
	log    *zap.Logger
	client posthog.Client

	start            time.Time
	uid              string
	organizationID   string
	federatedGraphID string
	distinctID       string
}

func (u *UsageTracker) baseProperties() posthog.Properties {
	props := posthog.NewProperties().
		Set("$process_person_profile", false)

	if u.organizationID != "" {
		props.Set("$organization_id", u.organizationID)
	}
	if u.federatedGraphID != "" {
		props.Set("$federated_graph_id", u.federatedGraphID)
	}

	return props
}

func (u *UsageTracker) TrackExecutionConfigUsage(usage map[string]any) {
	props := u.baseProperties()
	for k, v := range usage {
		props.Set(fmt.Sprintf("execution_config_%s", k), v)
	}

	err := u.client.Enqueue(posthog.Capture{
		Event:      "execution_config_usage",
		Properties: props,
		DistinctId: u.distinctID,
	})
	if err != nil {
		u.log.Error("failed to track event", zap.Error(err))
	}
}

func (u *UsageTracker) TrackRouterConfigUsage(usage map[string]any) {
	props := u.baseProperties()
	for k, v := range usage {
		props.Set(fmt.Sprintf("router_config_%s", k), v)
	}
	err := u.client.Enqueue(posthog.Capture{
		Event:      "router_config_usage",
		Uuid:       u.uid,
		DistinctId: u.distinctID,
		Properties: props,
	})
	if err != nil {
		u.log.Error("failed to track event", zap.Error(err))
	}
}

func NewUsageTracker(log *zap.Logger, graphApiToken string) (*UsageTracker, error) {
	uid, err := uuid.NewUUID()
	if err != nil {
		log.Error("failed to create uuid", zap.Error(err))
		return nil, err
	}
	tracker := &UsageTracker{
		log: log,
		uid: uid.String(),
	}
	hostName, err := os.Hostname()
	if err != nil {
		hostName = "unknown"
	}
	if graphApiToken != "" {
		claims, err := jwt.ExtractFederatedGraphTokenClaims(graphApiToken)
		if err != nil {
			log.Error("failed to extract claims from graph api token", zap.Error(err))
			return nil, err
		}
		tracker.organizationID = claims.OrganizationID
		tracker.federatedGraphID = claims.FederatedGraphID
		tracker.distinctID = fmt.Sprintf("%s:%s:%s", tracker.organizationID, tracker.federatedGraphID, hostName)
	} else {
		id, err := uuid.NewUUID()
		if err != nil {
			log.Error("failed to create uuid", zap.Error(err))
			return nil, err
		}
		tracker.distinctID = fmt.Sprintf("%s:%s", hostName, id.String())
	}
	cfg := posthog.Config{
		Logger:   tracker.posthogLogger(),
		Endpoint: "https://eu.i.posthog.com",
	}
	tracker.client, err = posthog.NewWithConfig("phc_h2Efq192t8Jz2eW14BDRt3I8Vrs2WMd3oQ4KOpMu3xT", cfg)
	if err != nil {
		log.Error("failed to create posthog client", zap.Error(err))
		return nil, err
	}
	return tracker, nil
}

type hogLog struct {
	log *zap.Logger
}

func (p *hogLog) Logf(format string, args ...interface{}) {
	p.log.Debug(fmt.Sprintf(format, args...))
}

func (p *hogLog) Errorf(format string, args ...interface{}) {
	p.log.Error(fmt.Sprintf(format, args...))
}

func (u *UsageTracker) posthogLogger() posthog.Logger {
	return &hogLog{
		log: u.log.With(zap.String("component", "posthog_client")),
	}
}

func (u *UsageTracker) Close() {
	_ = u.trackRouterUptime(uptimeOptions{closed: true})
	_ = u.client.Close()
}

func (u *UsageTracker) TrackUptime(ctx context.Context) {
	var err error

	u.start = time.Now()

	tick := time.NewTicker(time.Minute)
	defer tick.Stop()

	err = u.trackRouterUptime(uptimeOptions{})
	if err != nil {
		u.log.Error("failed to track event", zap.Error(err))
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			err = u.trackRouterUptime(uptimeOptions{})
			if err != nil {
				u.log.Error("failed to track event", zap.Error(err))
			}
		}
	}
}

type uptimeOptions struct {
	closed bool
}

func (u *UsageTracker) trackRouterUptime(options uptimeOptions) error {
	props := posthog.NewProperties().
		Set("uptime_seconds", time.Since(u.start).Seconds()).
		Set("$process_person_profile", false)

	if options.closed {
		props.Set("closed", true)
	}

	return u.client.Enqueue(posthog.Capture{
		Event:      "router_uptime",
		Uuid:       u.uid,
		DistinctId: u.distinctID,
		Properties: props,
	})
}
