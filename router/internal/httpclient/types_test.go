package httpclient

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestGetGroupedDials(t *testing.T) {

	t.Run("single successful dial", func(t *testing.T) {
		startTime := time.Now()
		dialDone := startTime.Add(100 * time.Millisecond)

		trace := ClientTrace{
			DialStart: []DialStart{
				{
					Time:    startTime,
					Network: "tcp",
					Address: "example.com:443",
				},
			},
			DialDone: []DialDone{
				{
					Time:    dialDone,
					Network: "tcp",
					Address: "example.com:443",
				},
			},
		}

		result := trace.GetGroupedDials()
		require.Len(t, result, 1)
		require.Equal(t, "tcp", result[0].Network)
		require.Equal(t, "example.com:443", result[0].Address)
		require.Equal(t, startTime, result[0].DialStartTime)
		require.Equal(t, startTime.Add(100*time.Millisecond), *result[0].DialDoneTime)
		require.Nil(t, result[0].Error)
	})

	t.Run("multiple dials with one successful", func(t *testing.T) {
		startTime := time.Now()
		trace := ClientTrace{
			DialStart: []DialStart{
				{
					Time:    startTime,
					Network: "tcp",
					Address: "1.com:443",
				},
				{
					Time:    startTime.Add(50 * time.Millisecond),
					Network: "tcp",
					Address: "2.com:443",
				},
			},
			DialDone: []DialDone{
				{
					Time:    startTime.Add(100 * time.Millisecond),
					Network: "tcp",
					Address: "1.com:443",
					Error:   fmt.Errorf("first attempt failed"),
				},
				{
					Time:    startTime.Add(200 * time.Millisecond),
					Network: "tcp",
					Address: "2.com:443",
				},
			},
		}

		result := trace.GetGroupedDials()
		require.Len(t, result, 2)
		require.Equal(t, "tcp", result[0].Network)
		require.Equal(t, "2.com:443", result[0].Address)
		require.Equal(t, startTime.Add(50*time.Millisecond), result[0].DialStartTime)
		require.Equal(t, startTime.Add(200*time.Millisecond), *result[0].DialDoneTime)
		require.Nil(t, result[0].Error)
	})

	t.Run("same addresses with different networks", func(t *testing.T) {
		startTime := time.Now()
		trace := ClientTrace{
			DialStart: []DialStart{
				{
					Time:    startTime,
					Network: "tcp",
					Address: "example.com:443",
				},
				{
					Time:    startTime.Add(10 * time.Millisecond),
					Network: "udp",
					Address: "example.com:443",
				},
			},
			DialDone: []DialDone{
				{
					Time:    startTime.Add(100 * time.Millisecond),
					Network: "tcp",
					Address: "example.com:443",
				},
				{
					Time:    startTime.Add(50 * time.Millisecond),
					Network: "udp",
					Address: "example.com:443",
				},
			},
		}

		result := trace.GetGroupedDials()
		require.Len(t, result, 2)

		// UDP should be first as it completed earlier
		require.Equal(t, "udp", result[0].Network)
		require.Equal(t, "example.com:443", result[0].Address)
		require.Equal(t, startTime.Add(10*time.Millisecond), result[0].DialStartTime)
		require.Equal(t, startTime.Add(50*time.Millisecond), *result[0].DialDoneTime)

		require.Equal(t, "tcp", result[1].Network)
		require.Equal(t, "example.com:443", result[1].Address)
		require.Equal(t, startTime, result[1].DialStartTime)
		require.Equal(t, startTime.Add(100*time.Millisecond), *result[1].DialDoneTime)
	})

	t.Run("incomplete dials", func(t *testing.T) {
		startTime := time.Now()
		trace := ClientTrace{
			DialStart: []DialStart{
				{
					Time:    startTime,
					Network: "tcp",
					Address: "example.com:443",
				},
				{
					Time:    startTime.Add(10 * time.Millisecond),
					Network: "tcp",
					Address: "example.com:80",
				},
			},
			DialDone: []DialDone{
				{
					Time:    startTime.Add(100 * time.Millisecond),
					Network: "tcp",
					Address: "example.com:443",
				},
			},
		}

		result := trace.GetGroupedDials()
		require.Len(t, result, 2)

		require.Equal(t, "tcp", result[0].Network)
		require.Equal(t, "example.com:443", result[0].Address)
		require.NotNil(t, result[0].DialDoneTime)
		require.Equal(t, "tcp", result[1].Network)
		require.Equal(t, "example.com:80", result[1].Address)
		require.Nil(t, result[1].DialDoneTime)
	})

	t.Run("all failed dials", func(t *testing.T) {
		startTime := time.Now()
		trace := ClientTrace{
			DialStart: []DialStart{
				{
					Time:    startTime,
					Network: "tcp",
					Address: "1.com:443",
				},
				{
					Time:    startTime.Add(10 * time.Millisecond),
					Network: "tcp",
					Address: "2.com:443",
				},
			},
			DialDone: []DialDone{
				{
					Time:    startTime.Add(100 * time.Millisecond),
					Network: "tcp",
					Address: "1.com:443",
					Error:   fmt.Errorf("first attempt failed"),
				},
				{
					Time:    startTime.Add(50 * time.Millisecond),
					Network: "tcp",
					Address: "2.com:443",
					Error:   fmt.Errorf("second attempt failed"),
				},
			},
		}

		result := trace.GetGroupedDials()
		require.Len(t, result, 2)
		require.Equal(t, "tcp", result[0].Network)
		require.Equal(t, "2.com:443", result[0].Address)
		require.Equal(t, "tcp", result[1].Network)
		require.Equal(t, "1.com:443", result[1].Address)
		require.Equal(t, startTime.Add(10*time.Millisecond), result[0].DialStartTime)
		require.Equal(t, startTime.Add(50*time.Millisecond), *result[0].DialDoneTime)
		require.Equal(t, startTime, result[1].DialStartTime)
		require.Equal(t, startTime.Add(100*time.Millisecond), *result[1].DialDoneTime)
		require.NotNil(t, result[0].Error)
	})

	t.Run("mismatched dial starts and completes", func(t *testing.T) {
		startTime := time.Now()
		trace := ClientTrace{
			DialStart: []DialStart{
				{
					Time:    startTime,
					Network: "tcp",
					Address: "1.com:443",
				},
			},
			DialDone: []DialDone{
				{
					Time:    startTime.Add(100 * time.Millisecond),
					Network: "tcp",
					Address: "2.com:80", // Different address
				},
			},
		}

		result := trace.GetGroupedDials()
		require.Len(t, result, 1)
		require.Equal(t, "tcp", result[0].Network)
		require.Equal(t, "1.com:443", result[0].Address)
		require.Equal(t, startTime, result[0].DialStartTime)
		require.Nil(t, result[0].DialDoneTime)
	})
}
