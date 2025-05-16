package track

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/posthog/posthog-go"
	"go.uber.org/zap"
)

type UsageTracker struct {
	log    *zap.Logger
	client posthog.Client

	start time.Time
	uid   string
}

func NewUsageTracker(log *zap.Logger) (*UsageTracker, error) {
	uid, err := uuid.NewUUID()
	if err != nil {
		log.Error("failed to create uuid", zap.Error(err))
		return nil, err
	}
	client, err := posthog.NewWithConfig("phc_h2Efq192t8Jz2eW14BDRt3I8Vrs2WMd3oQ4KOpMu3xT", posthog.Config{Endpoint: "https://eu.i.posthog.com"})
	if err != nil {
		log.Error("failed to create posthog client", zap.Error(err))
		return nil, err
	}
	return &UsageTracker{
		log:    log,
		client: client,
		uid:    uid.String(),
	}, nil
}

func (u *UsageTracker) Close() {
	_ = u.trackRouterUptime(uptimeOptions{closed: true})
	_ = u.client.Close()
}

func (u *UsageTracker) TrackUptime(ctx context.Context) {
	var err error

	u.start = time.Now()

	tick := time.NewTicker(time.Second * 10)
	defer tick.Stop()

	err = u.trackRouterUptime(uptimeOptions{})

	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			// Simulate some work
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
		DistinctId: "router",
		Properties: props,
	})
}
