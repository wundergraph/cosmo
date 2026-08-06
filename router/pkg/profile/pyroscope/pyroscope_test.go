package pyroscope

import (
	"testing"

	"github.com/grafana/pyroscope-go"
	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

func TestProfileTypesToPyroscopeProfileTypes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		profileTypes []string
		want         []pyroscope.ProfileType
		wantWarnings int
	}{
		{
			name:         "nil falls back to defaults",
			profileTypes: nil,
			want:         pyroscope.DefaultProfileTypes,
		},
		{
			name:         "empty falls back to defaults",
			profileTypes: []string{},
			want:         pyroscope.DefaultProfileTypes,
		},
		{
			name:         "single valid type",
			profileTypes: []string{"cpu"},
			want:         []pyroscope.ProfileType{pyroscope.ProfileCPU},
		},
		{
			name:         "all valid types",
			profileTypes: []string{"cpu", "alloc_objects", "inuse_objects", "alloc_space", "inuse_space", "goroutines", "mutex_count", "mutex_duration", "block_count", "block_duration", "goroutine_leak"},
			want: []pyroscope.ProfileType{
				pyroscope.ProfileCPU,
				pyroscope.ProfileAllocObjects,
				pyroscope.ProfileInuseObjects,
				pyroscope.ProfileAllocSpace,
				pyroscope.ProfileInuseSpace,
				pyroscope.ProfileGoroutines,
				pyroscope.ProfileMutexCount,
				pyroscope.ProfileMutexDuration,
				pyroscope.ProfileBlockCount,
				pyroscope.ProfileBlockDuration,
				pyroscope.ProfileGoroutineLeak,
			},
		},
		{
			name:         "preserves input order",
			profileTypes: []string{"goroutines", "cpu"},
			want:         []pyroscope.ProfileType{pyroscope.ProfileGoroutines, pyroscope.ProfileCPU},
		},
		{
			name:         "invalid type is dropped with a warning",
			profileTypes: []string{"cpu", "bogus"},
			want:         []pyroscope.ProfileType{pyroscope.ProfileCPU},
			wantWarnings: 1,
		},
		{
			name:         "all invalid falls back to defaults with warnings",
			profileTypes: []string{"bogus", "nonsense"},
			want:         pyroscope.DefaultProfileTypes,
			wantWarnings: 3, // one per invalid value + one fallback warning
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			core, logs := observer.New(zap.WarnLevel)
			logger := zap.New(core)

			got := profileTypesToPyroscopeProfileTypes(logger, tt.profileTypes)

			assert.Equal(t, tt.want, got)
			assert.Equal(t, tt.wantWarnings, logs.Len())
		})
	}
}
