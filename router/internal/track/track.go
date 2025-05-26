package track

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"time"

	"github.com/google/uuid"
	"github.com/posthog/posthog-go"
	"github.com/wundergraph/cosmo/router/internal/jwt"
	"go.uber.org/zap"
)

type UsageTrackerConfig struct {
	GraphApiToken           string
	ClusterName, InstanceID string
	Version, Commit, Date   string
}

func NewUsageTracker(log *zap.Logger, config UsageTrackerConfig) (*UsageTracker, error) {
	uid, err := uuid.NewUUID()
	if err != nil {
		log.Error("failed to create uuid", zap.Error(err))
		return nil, err
	}
	tracker := &UsageTracker{
		log:     log,
		uid:     uid.String(),
		version: config.Version,
		commit:  config.Commit,
		date:    config.Date,
	}
	tracker.findRepositoryURL()
	hostName, err := os.Hostname()
	if err != nil {
		tracker.hostName = "unknown"
	} else {
		tracker.hostName = hostName
	}
	if config.ClusterName != "" {
		tracker.clusterName = config.ClusterName
	} else {
		tracker.clusterName = "unknown"
	}
	tracker.distinctID = config.InstanceID
	if config.GraphApiToken != "" {
		claims, err := jwt.ExtractFederatedGraphTokenClaims(config.GraphApiToken)
		if err != nil {
			log.Error("failed to extract claims from graph api token", zap.Error(err))
			return nil, err
		}
		tracker.organizationID = claims.OrganizationID
		tracker.federatedGraphID = claims.FederatedGraphID
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

type UsageTracker struct {
	log    *zap.Logger
	client posthog.Client

	start            time.Time
	uid              string
	organizationID   string
	federatedGraphID string
	distinctID       string
	clusterName      string
	instanceID       string
	repositoryURL    string
	version          string
	commit           string
	date             string
	hostName         string
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
	if u.clusterName != "" {
		props.Set("$cluster_name", u.clusterName)
	}
	if u.instanceID != "" {
		props.Set("$instance_id", u.instanceID)
	}
	if u.repositoryURL != "" {
		props.Set("$repository_url", u.repositoryURL)
	}
	if u.version != "" {
		props.Set("$router_build_version", u.version)
	}
	if u.commit != "" {
		props.Set("$router_build_commit", u.commit)
	}
	if u.date != "" {
		props.Set("$router_build_date", u.date)
	}
	if u.hostName != "" {
		props.Set("$router_host_name", u.hostName)
	}
	return props
}

func (u *UsageTracker) findRepositoryURL() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", "remote", "get-url", "origin")
	out, err := cmd.Output()
	if err != nil {
		ctx, cancel = context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		cmd = exec.CommandContext(ctx, "git", "config", "--get", "remote.origin.url")
		out, err = cmd.Output()
		if err != nil {
			u.repositoryURL = "unknown"
			return
		}
	}
	if len(out) == 0 {
		u.repositoryURL = "unknown"
		return
	}
	u.repositoryURL = string(bytes.TrimSpace(out))
}

func (u *UsageTracker) TrackExecutionConfigUsage(usage map[string]any) {
	props := u.baseProperties()
	for k, v := range usage {
		props.Set(fmt.Sprintf("execution_config_%s", k), v)
	}

	err := u.client.Enqueue(posthog.Capture{
		Event:      "router_execution_config",
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
		Event:      "router_base_config",
		Uuid:       u.uid,
		DistinctId: u.distinctID,
		Properties: props,
	})
	if err != nil {
		u.log.Error("failed to track event", zap.Error(err))
	}
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
		Event:      "cosmo_router_uptime",
		Uuid:       u.uid,
		DistinctId: u.distinctID,
		Properties: props,
	})
}
