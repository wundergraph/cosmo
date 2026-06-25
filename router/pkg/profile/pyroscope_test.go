package profile

import (
	"testing"
)

func TestPyroscopeApplicationName(t *testing.T) {
	tests := []struct {
		name                 string
		pyroscopeAppName     string
		telemetryServiceName string
		want                 string
	}{
		{
			name:             "PYROSCOPE_APPLICATION_NAME wins",
			pyroscopeAppName: "custom-service",
			want:             "custom-service",
		},
		{
			name:                 "telemetry service name is second",
			telemetryServiceName: "platform-api-cosmo-router",
			want:                 "platform-api-cosmo-router",
		},
		{
			name: "default when unset",
			want: DefaultPyroscopeApplicationName,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(EnvPyroscopeApplicationName, tc.pyroscopeAppName)

			if got := PyroscopeApplicationName(tc.telemetryServiceName); got != tc.want {
				t.Fatalf("PyroscopeApplicationName() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestPyroscopeTags(t *testing.T) {
	t.Setenv("HOSTNAME", "pod-123")
	t.Setenv(EnvPyroscopeTags, "region=us-east-1, team=platform")

	got := PyroscopeTags()
	if got["hostname"] != "pod-123" {
		t.Fatalf("hostname tag = %q, want %q", got["hostname"], "pod-123")
	}
	if got["region"] != "us-east-1" {
		t.Fatalf("region tag = %q, want %q", got["region"], "us-east-1")
	}
	if got["team"] != "platform" {
		t.Fatalf("team tag = %q, want %q", got["team"], "platform")
	}
}

func TestPyroscopeTags_CustomOverridesBuiltIn(t *testing.T) {
	t.Setenv("HOSTNAME", "pod-123")
	t.Setenv(EnvPyroscopeTags, "hostname=override-host")

	got := PyroscopeTags()
	if got["hostname"] != "override-host" {
		t.Fatalf("hostname tag = %q, want override from PYROSCOPE_TAGS", got["hostname"])
	}
}

func TestParseKeyValueEnv(t *testing.T) {
	got := ParseKeyValueEnv(" region=us-east-1 ,team=platform,invalid,=bad,key=")
	if len(got) != 2 {
		t.Fatalf("ParseKeyValueEnv() len = %d, want 2 (%v)", len(got), got)
	}
	if got["region"] != "us-east-1" || got["team"] != "platform" {
		t.Fatalf("ParseKeyValueEnv() = %v", got)
	}
}
