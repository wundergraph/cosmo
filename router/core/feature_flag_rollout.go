package core

import (
	mathrand "math/rand/v2"
	"net/http"
	"sort"

	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
)

const rolloutBucketScale = 10000 // basis points: 100% == 10000

// rolloutRule is a resolved per-flag percentage range in basis points.
// A request whose bucket falls in [lo, hi) is routed to flagName.
type rolloutRule struct {
	flagName string
	lo, hi   uint32
}

// rolloutSelector picks a feature flag for an unpinned request based on the
// per-flag traffic_percentage shipped in the execution config. Bucketing is
// uniformly random per request — there is no per-user stickiness.
type rolloutSelector struct {
	rules        []rolloutRule
	rolloutFlags map[string]struct{}
}

// newRolloutSelector resolves the proto traffic_percentage for every flag in
// ffConfigs into a single ordered list of buckets. Returns nil (no rollout)
// when the feature is disabled, no flag carries a percentage, or the
// cumulative percentage exceeds 100 (we fail closed to base rather than
// route partial traffic).
func newRolloutSelector(
	cfg *config.FeatureFlagRollouts,
	ffConfigs map[string]*nodev1.FeatureFlagRouterExecutionConfig,
	_ string, // versionSeed: unused; bucketing is per-request random
	logger *zap.Logger,
) (*rolloutSelector, error) {
	if cfg == nil || !cfg.Enabled {
		return nil, nil
	}

	// Pure proto-driven: every flag whose execution config carries a
	// traffic_percentage participates. Sort by name for stable ordering
	// across reloads.
	var names []string
	for name, ec := range ffConfigs {
		if ec.TrafficPercentage == nil {
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)

	// First pass: drop any flag whose own pct is over 100. This is always an
	// operator typo — a single rollout slice can never exceed the whole graph.
	accepted := names[:0]
	for _, name := range names {
		pct := ffConfigs[name].GetTrafficPercentage()
		if pct > 100 {
			logger.Error("feature_flag_rollouts: flag percentage exceeds 100; flag dropped, traffic falls through to base for it",
				zap.String("flag", name), zap.Uint32("percentage", pct))
			continue
		}
		accepted = append(accepted, name)
	}

	// Second pass: greedy fit under the 100% budget, alphabetical order.
	// If the next flag would push cumulative over 100 it is dropped (logged)
	// and we keep filling with the remaining flags. Earlier choice: returning
	// nil here disabled every rollout flag on the graph and silently restored
	// header/cookie pinnability — a single typo blew up the entire rollout.
	// Drop-the-offender preserves siblings; the operator sees an explicit
	// error in the log and the dropped flag's traffic falls through to base.
	var sum uint64
	var cursor uint32
	rules := make([]rolloutRule, 0, len(accepted))
	rolloutFlags := make(map[string]struct{}, len(accepted))
	for _, name := range accepted {
		pct := ffConfigs[name].GetTrafficPercentage()
		if sum+uint64(pct) > 100 {
			logger.Error("feature_flag_rollouts: flag would push cumulative percentage over 100; flag dropped, traffic falls through to base for it",
				zap.String("flag", name),
				zap.Uint32("percentage", pct),
				zap.Uint64("cumulative_so_far", sum))
			continue
		}
		sum += uint64(pct)
		rolloutFlags[name] = struct{}{}
		if pct == 0 {
			logger.Warn("feature_flag_rollouts: flag has percentage 0 (degenerate); flag will not be reachable",
				zap.String("flag", name))
			continue
		}
		span := pct * (rolloutBucketScale / 100)
		rules = append(rules, rolloutRule{flagName: name, lo: cursor, hi: cursor + span})
		cursor += span
	}

	// In case all ffs had 0 percentage (or every flag was dropped above).
	if len(rules) == 0 && len(rolloutFlags) == 0 {
		logger.Warn("feature_flag_rollouts: no usable flags; selector disabled")
		return nil, nil
	}

	logRolloutFlagSummary(logger, ffConfigs, rolloutFlags, rules)

	return &rolloutSelector{
		rules:        rules,
		rolloutFlags: rolloutFlags,
	}, nil
}

// isRolloutFlag reports whether name is a rollout flag. The request handler
// uses this to decide whether a header/cookie pin should be ignored — rollout
// flags are never client-steerable.
func (s *rolloutSelector) isRolloutFlag(name string) bool {
	if s == nil {
		return false
	}
	_, ok := s.rolloutFlags[name]
	return ok
}

// pick chooses a rollout flag for an unpinned request. Each request is
// bucketed independently with crypto/rand so distribution holds in aggregate;
// individual clients may flicker between variants across requests.
func (s *rolloutSelector) pick(_ http.ResponseWriter, _ *http.Request) (flag, source string, ok bool) {
	if s == nil || len(s.rules) == 0 {
		return "", "", false
	}
	bucket := randomBucket()
	for _, rule := range s.rules {
		if bucket >= rule.lo && bucket < rule.hi {
			return rule.flagName, "random", true
		}
	}
	// Bucket landed outside any rule's range — request falls through to base.
	return "", "random", false
}

// randomBucket returns a uniform basis-point bucket in [0, rolloutBucketScale).
//
// math/rand/v2.Uint32N is lock-free per goroutine, ~5 ns, no syscall, and
// rejection-samples to remove the modulo bias `crypto/rand % N` would have.
// Traffic bucketing has no security requirement; predictability of the
// per-request bucket would not let a client influence the gate (the bucket
// itself is not visible to the client and is not derived from request
// content under the current "no stickiness" design).
func randomBucket() uint32 {
	return mathrand.Uint32N(rolloutBucketScale)
}

// logRolloutFlagSummary emits one line per feature flag at config load so
// operators can confirm reachability at a glance.
func logRolloutFlagSummary(
	logger *zap.Logger,
	ffConfigs map[string]*nodev1.FeatureFlagRouterExecutionConfig,
	rolloutFlags map[string]struct{},
	rules []rolloutRule,
) {
	if logger == nil || len(ffConfigs) == 0 {
		return
	}
	pctByFlag := make(map[string]uint32, len(rules))
	for _, r := range rules {
		pctByFlag[r.flagName] = (r.hi - r.lo) / (rolloutBucketScale / 100)
	}
	names := make([]string, 0, len(ffConfigs))
	for n := range ffConfigs {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, name := range names {
		if _, isRollout := rolloutFlags[name]; isRollout {
			pct := pctByFlag[name]
			if pct == 0 {
				logger.Warn("feature flag has percentage=0 — unreachable",
					zap.String("flag", name), zap.String("mode", "rollout"))
				continue
			}
			logger.Info("feature flag registered",
				zap.String("flag", name),
				zap.String("mode", "rollout"),
				zap.Uint32("percentage", pct))
		} else {
			logger.Info("feature flag registered",
				zap.String("flag", name),
				zap.String("mode", "preview"),
				zap.Strings("reachable_via", []string{"header", "cookie"}))
		}
	}
}
