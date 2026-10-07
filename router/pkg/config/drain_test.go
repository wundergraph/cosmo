package config

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestDrainPeriodConfig(t *testing.T) {
	for _, tc := range []struct{ name, drain, grace, shutdown, wantErr string }{
		{"disabled keeps existing budgets", "0s", "30s", "15s", ""},
		{"valid", "5s", "30s", "40s", ""},
		{"exact budget", "5s", "30s", "35s", ""},
		{"negative", "-1s", "30s", "60s", "drain_period must not be negative"},
		{"exhausts budget", "60s", "30s", "60s", "shutdown_delay"},
		{"insufficient grace", "31s", "30s", "60s", "shutdown_delay"},
		{"no grace limit", "5s", "0s", "60s", ""},
		{"no time left", "60s", "0s", "60s", "shutdown_delay"},
		{"negative grace", "5s", "-1s", "60s", "grace_period"},
		{"overflow", "2000000h", "2000000h", "2000001h", "shutdown_delay"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := createTempFileFromFixture(t, fmt.Sprintf("version: '1'\ndrain_period: %s\ngrace_period: %s\nshutdown_delay: %s\n", tc.drain, tc.grace, tc.shutdown))
			cfg, err := LoadConfig([]string{f})
			if tc.wantErr != "" {
				require.ErrorContains(t, err, tc.wantErr)
				return
			}
			require.NoError(t, err)
			want, err := time.ParseDuration(tc.drain)
			require.NoError(t, err)
			require.Equal(t, want, cfg.Config.DrainPeriod)
		})
	}
}

func TestDrainPeriodEnvironment(t *testing.T) {
	t.Setenv("DRAIN_PERIOD", "5s")
	f := createTempFileFromFixture(t, "version: '1'\n")
	cfg, err := LoadConfig([]string{f})
	require.NoError(t, err)
	require.Equal(t, 5*time.Second, cfg.Config.DrainPeriod)
	t.Setenv("DRAIN_PERIOD", "-1s")
	_, err = LoadConfig([]string{f})
	require.ErrorContains(t, err, "drain_period must not be negative")
}
