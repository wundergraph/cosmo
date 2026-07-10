package core

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func advisorDeferDataSegment(at time.Duration, first bool, payload string) loopbackSegment {
	header := deferNextPartHeader
	if first {
		header = deferFirstPartHeader
	}
	return loopbackSegment{body: []byte(header + payload + deferPartSuffix), at: at}
}

func advisorDeferCloseSegment(at time.Duration) loopbackSegment {
	return loopbackSegment{body: []byte(deferClose), at: at}
}

func TestParseAdvisorDeferSegmentsTracksNestedCompletions(t *testing.T) {
	t.Parallel()

	segments := []loopbackSegment{
		advisorDeferDataSegment(10*time.Millisecond, true, `{"data":{"fast":true},"pending":[{"id":"1","path":["storefront"],"label":"outer"}],"hasNext":true}`),
		advisorDeferDataSegment(40*time.Millisecond, false, `{"incremental":[{"id":"1","data":{"slow":1}}],"pending":[{"id":"2","path":["storefront","details"],"label":"inner"}],"completed":[{"id":"1"}],"hasNext":true}`),
		advisorDeferDataSegment(70*time.Millisecond, false, `{"incremental":[{"id":"2","data":{"deep":1}}],"completed":[{"id":"2"}],"hasNext":false}`),
		advisorDeferCloseSegment(71 * time.Millisecond),
	}

	run, err := parseAdvisorDeferSegments(segments)
	require.NoError(t, err)
	assert.Equal(t, 10*time.Millisecond, run.initialAt)
	assert.Equal(t, 70*time.Millisecond, run.terminalAt)
	assert.Equal(t, 71*time.Millisecond, run.closedAt)
	assert.Equal(t, map[string]time.Duration{
		"outer": 40 * time.Millisecond,
		"inner": 70 * time.Millisecond,
	}, run.arrivals)
}

func TestParseAdvisorDeferSegmentsAggregatesRepeatedLabelsByLatestCompletion(t *testing.T) {
	t.Parallel()

	run, err := parseAdvisorDeferSegments([]loopbackSegment{
		advisorDeferDataSegment(10*time.Millisecond, true, `{"data":{"products":[{},{}]},"pending":[{"id":"1","path":["products",0],"label":"details"},{"id":"2","path":["products",1],"label":"details"}],"hasNext":true}`),
		advisorDeferDataSegment(30*time.Millisecond, false, `{"incremental":[{"id":"1","data":{"price":1}}],"completed":[{"id":"1"}],"hasNext":true}`),
		advisorDeferDataSegment(50*time.Millisecond, false, `{"incremental":[{"id":"2","data":{"price":2}}],"completed":[{"id":"2"}],"hasNext":false}`),
		advisorDeferCloseSegment(51 * time.Millisecond),
	})

	require.NoError(t, err)
	assert.Equal(t, map[string]time.Duration{"details": 50 * time.Millisecond}, run.arrivals)
}

func TestParseAdvisorDeferSegmentsAcceptsMultipleListPatchesForOneID(t *testing.T) {
	t.Parallel()

	run, err := parseAdvisorDeferSegments([]loopbackSegment{
		advisorDeferDataSegment(10*time.Millisecond, true, `{"data":{"items":[{},{}]},"pending":[{"id":"1","path":["items"],"label":"details"}],"hasNext":true}`),
		advisorDeferDataSegment(40*time.Millisecond, false, `{"incremental":[{"id":"1","subPath":[0,"subItems",0],"data":{"price":1}},{"id":"1","subPath":[1,"subItems",0],"data":{"price":2}}],"completed":[{"id":"1"}],"hasNext":false}`),
		advisorDeferCloseSegment(41 * time.Millisecond),
	})

	require.NoError(t, err)
	assert.Equal(t, map[string]time.Duration{"details": 40 * time.Millisecond}, run.arrivals)
}

func TestParseAdvisorDeferSegmentsAcceptsACompleteInitialPart(t *testing.T) {
	t.Parallel()

	run, err := parseAdvisorDeferSegments([]loopbackSegment{
		advisorDeferDataSegment(10*time.Millisecond, true, `{"data":{"fast":true},"hasNext":false}`),
		advisorDeferCloseSegment(10 * time.Millisecond),
	})

	require.NoError(t, err)
	assert.Equal(t, 10*time.Millisecond, run.initialAt)
	assert.Equal(t, 10*time.Millisecond, run.terminalAt)
	assert.Equal(t, 10*time.Millisecond, run.closedAt)
	assert.Empty(t, run.arrivals)
}

func TestParseAdvisorDeferSegmentsIgnoresExtensionsInEveryPart(t *testing.T) {
	t.Parallel()

	run, err := parseAdvisorDeferSegments([]loopbackSegment{
		advisorDeferDataSegment(10*time.Millisecond, true, `{"data":{},"pending":[{"id":"1","path":[],"label":"details"}],"extensions":{"trace":{"version":"1"}},"hasNext":true}`),
		advisorDeferDataSegment(30*time.Millisecond, false, `{"incremental":[{"id":"1","data":{}}],"completed":[{"id":"1"}],"extensions":{"trace":{"version":"1"}},"hasNext":false}`),
		advisorDeferCloseSegment(31 * time.Millisecond),
	})

	require.NoError(t, err)
	assert.Equal(t, map[string]time.Duration{"details": 30 * time.Millisecond}, run.arrivals)
}

func TestParseAdvisorDeferSegmentsRejectsMalformedState(t *testing.T) {
	t.Parallel()

	validInitial := advisorDeferDataSegment(10*time.Millisecond, true, `{"data":null,"pending":[{"id":"1","path":[],"label":"slow"}],"hasNext":true}`)
	validTerminal := advisorDeferDataSegment(20*time.Millisecond, false, `{"incremental":[{"id":"1","data":null}],"completed":[{"id":"1"}],"hasNext":false}`)
	closeSegment := advisorDeferCloseSegment(21 * time.Millisecond)

	tests := []struct {
		name     string
		segments []loopbackSegment
		err      string
	}{
		{name: "empty", err: "defer advisor stream has no data parts"},
		{name: "close only", segments: []loopbackSegment{closeSegment}, err: "defer advisor stream has no data parts"},
		{
			name:     "missing close",
			segments: []loopbackSegment{validInitial, validTerminal},
			err:      "defer advisor stream is missing its close-only segment",
		},
		{
			name: "first part uses continuation header",
			segments: []loopbackSegment{
				advisorDeferDataSegment(10*time.Millisecond, false, `{"data":null,"hasNext":false}`),
				closeSegment,
			},
			err: "defer advisor first data segment has no opening boundary",
		},
		{
			name: "later part repeats opening boundary",
			segments: []loopbackSegment{
				validInitial,
				advisorDeferDataSegment(20*time.Millisecond, true, `{"incremental":[{"id":"1","data":null}],"completed":[{"id":"1"}],"hasNext":false}`),
				closeSegment,
			},
			err: "defer advisor data segment 2 repeats the opening boundary",
		},
		{
			name:     "close before data",
			segments: []loopbackSegment{closeSegment, validInitial, validTerminal},
			err:      "defer advisor close-only segment must be last",
		},
		{
			name: "missing has next",
			segments: []loopbackSegment{
				advisorDeferDataSegment(10*time.Millisecond, true, `{"data":null}`),
				closeSegment,
			},
			err: "defer advisor multipart part 1 has no hasNext value",
		},
		{
			name: "data after terminal",
			segments: []loopbackSegment{
				advisorDeferDataSegment(10*time.Millisecond, true, `{"data":null,"hasNext":false}`),
				advisorDeferDataSegment(20*time.Millisecond, false, `{"hasNext":false}`),
				closeSegment,
			},
			err: "defer advisor multipart part 2 appears after hasNext false",
		},
		{
			name: "missing initial data",
			segments: []loopbackSegment{
				advisorDeferDataSegment(10*time.Millisecond, true, `{"hasNext":false}`),
				closeSegment,
			},
			err: "defer advisor multipart part 1 has no data value",
		},
		{
			name: "invalid initial data shape",
			segments: []loopbackSegment{
				advisorDeferDataSegment(10*time.Millisecond, true, `{"data":[],"hasNext":false}`),
				closeSegment,
			},
			err: "defer advisor multipart part 1 data must be an object or null",
		},
		{
			name: "subsequent top-level data",
			segments: []loopbackSegment{
				validInitial,
				advisorDeferDataSegment(20*time.Millisecond, false, `{"data":null,"incremental":[{"id":"1","data":null}],"completed":[{"id":"1"}],"hasNext":false}`),
				closeSegment,
			},
			err: "defer advisor multipart part 2 repeats the top-level data value",
		},
		{
			name: "initial incremental lifecycle",
			segments: []loopbackSegment{
				advisorDeferDataSegment(10*time.Millisecond, true, `{"data":{},"pending":[{"id":"1","path":[],"label":"slow"}],"incremental":[{"id":"1","data":{}}],"completed":[{"id":"1"}],"hasNext":false}`),
				closeSegment,
			},
			err: "defer advisor multipart part 1 contains incremental lifecycle entries",
		},
		{
			name: "duplicate pending id",
			segments: []loopbackSegment{
				advisorDeferDataSegment(10*time.Millisecond, true, `{"data":null,"pending":[{"id":"1","path":["one"],"label":"one"},{"id":"1","path":["two"],"label":"two"}],"hasNext":true}`),
				validTerminal,
				closeSegment,
			},
			err: `defer advisor multipart part 1 repeats pending id "1"`,
		},
		{
			name: "duplicate label and path",
			segments: []loopbackSegment{
				advisorDeferDataSegment(10*time.Millisecond, true, `{"data":null,"pending":[{"id":"1","path":["items",0],"label":"slow"},{"id":"2","path":["items",0],"label":"slow"}],"hasNext":true}`),
				closeSegment,
			},
			err: `defer advisor multipart part 1 repeats pending label "slow" at path ["items",0]`,
		},
		{
			name: "empty pending id",
			segments: []loopbackSegment{
				advisorDeferDataSegment(10*time.Millisecond, true, `{"data":null,"pending":[{"id":"","path":[],"label":"slow"}],"hasNext":true}`),
				closeSegment,
			},
			err: "defer advisor multipart part 1 has an empty pending id",
		},
		{
			name: "empty pending label",
			segments: []loopbackSegment{
				advisorDeferDataSegment(10*time.Millisecond, true, `{"data":null,"pending":[{"id":"1","path":[],"label":""}],"hasNext":true}`),
				closeSegment,
			},
			err: "defer advisor multipart part 1 pending id \"1\" has no label",
		},
		{
			name: "missing pending path",
			segments: []loopbackSegment{
				advisorDeferDataSegment(10*time.Millisecond, true, `{"data":null,"pending":[{"id":"1","label":"slow"}],"hasNext":true}`),
				closeSegment,
			},
			err: "defer advisor multipart part 1 pending id \"1\" has no path",
		},
		{
			name: "null pending path",
			segments: []loopbackSegment{
				advisorDeferDataSegment(10*time.Millisecond, true, `{"data":null,"pending":[{"id":"1","path":null,"label":"slow"}],"hasNext":true}`),
				closeSegment,
			},
			err: "defer advisor multipart part 1 pending id \"1\" path must be an array",
		},
		{
			name: "invalid pending path element",
			segments: []loopbackSegment{
				advisorDeferDataSegment(10*time.Millisecond, true, `{"data":null,"pending":[{"id":"1","path":["items",true],"label":"slow"}],"hasNext":true}`),
				closeSegment,
			},
			err: "defer advisor multipart part 1 pending id \"1\" path element 2 must be a string or non-negative integer",
		},
		{
			name: "unknown incremental id",
			segments: []loopbackSegment{
				validInitial,
				advisorDeferDataSegment(20*time.Millisecond, false, `{"incremental":[{"id":"9","data":null}],"hasNext":true}`),
				closeSegment,
			},
			err: `defer advisor multipart part 2 patches unknown pending id "9"`,
		},
		{
			name: "incremental item has no data",
			segments: []loopbackSegment{
				validInitial,
				advisorDeferDataSegment(20*time.Millisecond, false, `{"incremental":[{"id":"1"}],"completed":[{"id":"1"}],"hasNext":false}`),
				closeSegment,
			},
			err: "defer advisor multipart part 2 incremental item 1 has no data value",
		},
		{
			name: "invalid incremental subpath",
			segments: []loopbackSegment{
				validInitial,
				advisorDeferDataSegment(20*time.Millisecond, false, `{"incremental":[{"id":"1","subPath":[-1],"data":null}],"completed":[{"id":"1"}],"hasNext":false}`),
				closeSegment,
			},
			err: "defer advisor multipart part 2 incremental item 1 has invalid subPath: path element 1 must be a string or non-negative integer",
		},
		{
			name: "unknown completion",
			segments: []loopbackSegment{
				validInitial,
				advisorDeferDataSegment(20*time.Millisecond, false, `{"completed":[{"id":"9"}],"hasNext":true}`),
				closeSegment,
			},
			err: `defer advisor multipart part 2 completes unknown pending id "9"`,
		},
		{
			name: "completion without delivery",
			segments: []loopbackSegment{
				validInitial,
				advisorDeferDataSegment(20*time.Millisecond, false, `{"completed":[{"id":"1"}],"hasNext":false}`),
				closeSegment,
			},
			err: `defer advisor multipart part 2 completes pending id "1" before delivering data`,
		},
		{
			name: "duplicate completion",
			segments: []loopbackSegment{
				validInitial,
				advisorDeferDataSegment(20*time.Millisecond, false, `{"incremental":[{"id":"1","data":null}],"completed":[{"id":"1"},{"id":"1"}],"hasNext":false}`),
				closeSegment,
			},
			err: `defer advisor multipart part 2 completes pending id "1" more than once`,
		},
		{
			name: "patch after completion",
			segments: []loopbackSegment{
				advisorDeferDataSegment(10*time.Millisecond, true, `{"data":null,"pending":[{"id":"1","path":["items",0],"label":"slow"},{"id":"2","path":["items",1],"label":"slow"}],"hasNext":true}`),
				advisorDeferDataSegment(20*time.Millisecond, false, `{"incremental":[{"id":"1","data":null}],"completed":[{"id":"1"}],"hasNext":true}`),
				advisorDeferDataSegment(30*time.Millisecond, false, `{"incremental":[{"id":"1","data":null},{"id":"2","data":null}],"completed":[{"id":"2"}],"hasNext":false}`),
				advisorDeferCloseSegment(31 * time.Millisecond),
			},
			err: `defer advisor multipart part 3 patches completed pending id "1"`,
		},
		{
			name: "has next true without outstanding ids",
			segments: []loopbackSegment{
				advisorDeferDataSegment(10*time.Millisecond, true, `{"data":null,"hasNext":true}`),
				advisorDeferDataSegment(20*time.Millisecond, false, `{"hasNext":false}`),
				closeSegment,
			},
			err: "defer advisor multipart part 1 hasNext true with 0 pending ids outstanding",
		},
		{
			name: "has next false with outstanding id",
			segments: []loopbackSegment{
				validInitial,
				advisorDeferDataSegment(20*time.Millisecond, false, `{"hasNext":false}`),
				closeSegment,
			},
			err: "defer advisor multipart part 2 hasNext false with 1 pending id outstanding",
		},
		{
			name: "missing terminal part",
			segments: []loopbackSegment{
				validInitial,
				advisorDeferCloseSegment(11 * time.Millisecond),
			},
			err: "defer advisor stream has no hasNext false terminal part",
		},
		{
			name: "initial errors",
			segments: []loopbackSegment{
				advisorDeferDataSegment(10*time.Millisecond, true, `{"data":null,"errors":[{"message":"failed"}],"hasNext":false}`),
				closeSegment,
			},
			err: "defer advisor multipart part 1 contains GraphQL errors",
		},
		{
			name: "null errors",
			segments: []loopbackSegment{
				advisorDeferDataSegment(10*time.Millisecond, true, `{"data":null,"errors":null,"hasNext":false}`),
				closeSegment,
			},
			err: "defer advisor multipart part 1 has invalid errors: errors must be a non-empty array when present",
		},
		{
			name: "empty errors",
			segments: []loopbackSegment{
				advisorDeferDataSegment(10*time.Millisecond, true, `{"data":null,"errors":[],"hasNext":false}`),
				closeSegment,
			},
			err: "defer advisor multipart part 1 has invalid errors: errors must be a non-empty array when present",
		},
		{
			name: "incremental errors",
			segments: []loopbackSegment{
				validInitial,
				advisorDeferDataSegment(20*time.Millisecond, false, `{"incremental":[{"id":"1","data":null,"errors":[{"message":"failed"}]}],"completed":[{"id":"1"}],"hasNext":false}`),
				closeSegment,
			},
			err: "defer advisor multipart part 2 incremental item 1 contains GraphQL errors",
		},
		{
			name: "completion errors",
			segments: []loopbackSegment{
				validInitial,
				advisorDeferDataSegment(20*time.Millisecond, false, `{"completed":[{"id":"1","errors":[{"message":"failed"}]}],"hasNext":false}`),
				closeSegment,
			},
			err: "defer advisor multipart part 2 completion 1 contains GraphQL errors",
		},
		{
			name: "negative timestamp",
			segments: []loopbackSegment{
				advisorDeferDataSegment(-time.Millisecond, true, `{"data":null,"hasNext":false}`),
				advisorDeferCloseSegment(0),
			},
			err: "defer advisor multipart segment timestamps must not be negative",
		},
		{
			name: "timestamps go backwards",
			segments: []loopbackSegment{
				validInitial,
				advisorDeferDataSegment(5*time.Millisecond, false, `{"incremental":[{"id":"1","data":null}],"completed":[{"id":"1"}],"hasNext":false}`),
				closeSegment,
			},
			err: "defer advisor multipart segment timestamps are not monotonic",
		},
		{
			name: "malformed JSON",
			segments: []loopbackSegment{
				advisorDeferDataSegment(10*time.Millisecond, true, `{"data":null,"hasNext":false`),
				closeSegment,
			},
			err: "defer advisor failed to parse multipart part 1: unexpected end of JSON input",
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			run, err := parseAdvisorDeferSegments(test.segments)

			assert.Nil(t, run)
			require.EqualError(t, err, test.err)
		})
	}
}
