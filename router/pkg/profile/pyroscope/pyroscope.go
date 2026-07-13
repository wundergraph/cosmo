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
		ProfileTypes:      profileTypesToPyroscopeProfileTypes(config.ProfileTypes),
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

func profileTypesToPyroscopeProfileTypes(profileTypes []string) []pyroscope.ProfileType {
	if len(profileTypes) == 0 {
		return pyroscope.DefaultProfileTypes
	}

	result := make([]pyroscope.ProfileType, 0, len(profileTypes))
	for _, profileType := range profileTypes {
		switch profileType {
		case "cpu":
			result = append(result, pyroscope.ProfileCPU)
		case "alloc_objects":
			result = append(result, pyroscope.ProfileAllocObjects)
		case "inuse_objects":
			result = append(result, pyroscope.ProfileInuseObjects)
		case "alloc_space":
			result = append(result, pyroscope.ProfileAllocSpace)
		case "inuse_space":
			result = append(result, pyroscope.ProfileInuseSpace)
		case "goroutines":
			result = append(result, pyroscope.ProfileGoroutines)
		case "mutex_count":
			result = append(result, pyroscope.ProfileMutexCount)
		case "mutex_duration":
			result = append(result, pyroscope.ProfileMutexDuration)
		case "block_count":
			result = append(result, pyroscope.ProfileBlockCount)
		case "block_duration":
			result = append(result, pyroscope.ProfileBlockDuration)
		case "goroutine_leak":
			result = append(result, pyroscope.ProfileGoroutineLeak)
		}
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
