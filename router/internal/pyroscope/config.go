package pyroscope

import (
	"github.com/caarlos0/env/v11"
	"github.com/grafana/pyroscope-go"
	"github.com/joho/godotenv"
	"go.uber.org/zap"
)

type Profiling struct {
	Enabled           bool                    `envDefault:"false" env:"PYROSCOPE_ENABLED"`
	ServiceName       string                  `envDefault:"cosmo-router" env:"PYROSCOPE_SERVICE_NAME"`
	ServerAddress     string                  `envDefault:"http://localhost:4040" env:"PYROSCOPE_SERVER_ADDRESS"`
	ProfileTypes      []pyroscope.ProfileType `envDefault:"[cpu,alloc_objects,alloc_space,inuse_objects,inuse_space]" env:"PYROSCOPE_PROFILE_TYPES"`
	Tags              map[string]string       `env:"PYROSCOPE_TAGS" envSeparator:","`
	BasicAuthUser     string                  `env:"PYROSCOPE_BASIC_AUTH_USER"`
	BasicAuthPassword string                  `env:"PYROSCOPE_BASIC_AUTH_PASSWORD"`
}

func SetupPyroscope(logger *zap.Logger) (func() error, error) {
	_ = godotenv.Load(".env.local")
	_ = godotenv.Load()

	cfg, err := env.ParseAs[Profiling]()
	if err != nil {
		logger.Error("failed to parse pyroscope config", zap.Error(err))
		return nil, err
	}

	if !cfg.Enabled {
		return func() error { return nil }, nil
	}

	profiler, err := pyroscope.Start(pyroscope.Config{
		ApplicationName:   cfg.ServiceName,
		ServerAddress:     cfg.ServerAddress,
		ProfileTypes:      cfg.ProfileTypes,
		Tags:              cfg.Tags,
		BasicAuthUser:     cfg.BasicAuthUser,
		BasicAuthPassword: cfg.BasicAuthPassword,
	})

	if err != nil {
		return nil, err
	}

	return func() error {
		return profiler.Stop()
	}, nil

}
