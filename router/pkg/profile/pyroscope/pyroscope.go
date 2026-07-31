package pyroscope

import (
	"errors"
	"fmt"
	"runtime"
	"time"

	"github.com/grafana/pyroscope-go"
	"github.com/wundergraph/cosmo/router/internal/versioninfo"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
)

// Profiler is a wrapper around the pyroscope profiler
type Profiler struct {
	pyroscope *pyroscope.Profiler
}

func NewProfiler(logger *zap.Logger, config *config.Pyroscope) (*Profiler, error) {
	if config.ServerAddress == "" {
		return nil, errors.New("pyroscope server_address must be set when pyroscope is enabled")
	}

	runtime.SetMutexProfileFraction(config.MutexProfileFraction)
	runtime.SetBlockProfileRate(config.BlockProfileRate)

	profiler, err := pyroscope.Start(pyroscope.Config{
		ApplicationName:   config.ApplicationName,
		ServerAddress:     config.ServerAddress,
		Logger:            logger.Sugar(),
		Tags:              config.Tags,
		ProfileTypes:      profileTypesToPyroscopeProfileTypes(logger, config.ProfileTypes),
		DisableGCRuns:     config.DisableGCRuns,
		BasicAuthUser:     config.BasicAuth.Username,
		BasicAuthPassword: config.BasicAuth.Password,
		UploadRate:        config.UploadRate,
		HTTPHeaders:       config.Headers,
	})

	if err != nil {
		return nil, fmt.Errorf("failed to start pyroscope profiler: %w", err)
	}

	return &Profiler{
		pyroscope: profiler,
	}, nil

}

var validProfileTypes = map[pyroscope.ProfileType]struct{}{
	pyroscope.ProfileCPU:           {},
	pyroscope.ProfileAllocObjects:  {},
	pyroscope.ProfileInuseObjects:  {},
	pyroscope.ProfileAllocSpace:    {},
	pyroscope.ProfileInuseSpace:    {},
	pyroscope.ProfileGoroutines:    {},
	pyroscope.ProfileMutexCount:    {},
	pyroscope.ProfileMutexDuration: {},
	pyroscope.ProfileBlockCount:    {},
	pyroscope.ProfileBlockDuration: {},
	pyroscope.ProfileGoroutineLeak: {},
}

func profileTypesToPyroscopeProfileTypes(logger *zap.Logger, profileTypes []string) []pyroscope.ProfileType {
	if len(profileTypes) == 0 {
		return pyroscope.DefaultProfileTypes
	}

	result := make([]pyroscope.ProfileType, 0, len(profileTypes))
	for _, profileType := range profileTypes {
		pt := pyroscope.ProfileType(profileType)
		if _, ok := validProfileTypes[pt]; !ok {
			logger.Warn("ignoring unrecognized pyroscope profile type", zap.String("profile_type", profileType))
			continue
		}
		result = append(result, pt)
	}

	if len(result) == 0 {
		logger.Warn("no recognized pyroscope profile types configured, falling back to defaults")
		return pyroscope.DefaultProfileTypes
	}

	return result
}

func (p *Profiler) Stop() error {
	return p.pyroscope.Stop()
}

func RouterVersionTags(versionInfo versioninfo.VersionInfo) map[string]string {
	return map[string]string{
		"router_version":    versionInfo.AppVersion,
		"router_commit":     versionInfo.VCSRevision,
		"router_build_date": versionInfo.BuildDate.Format(time.RFC3339),
	}
}
