package profiler

import (
	"github.com/grafana/pyroscope-go"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func StartProfiler(config config.Config) (func() error, error) {
	if !config.Profiling.Enabled {
		return func() error { return nil }, nil
	}

	profiler, err := pyroscope.Start(pyroscope.Config{
		ApplicationName:   config.Profiling.ServiceName,
		ServerAddress:     config.Profiling.ServerAddress,
		ProfileTypes:      config.Profiling.ProfileTypes,
		Tags:              config.Profiling.Tags,
		BasicAuthUser:     config.Profiling.BasicAuthUser,
		BasicAuthPassword: config.Profiling.BasicAuthPassword,
	})

	if err != nil {
		return nil, err
	}

	return func() error {
		return profiler.Stop()
	}, nil
}
