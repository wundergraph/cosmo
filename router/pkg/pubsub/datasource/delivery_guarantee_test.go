package datasource

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNegotiateDeliveryGuarantee(t *testing.T) {
	tests := []struct {
		name  string
		value string // raw JSON value; empty means the key is absent
		// expectations per mode
		off, cursor expectation
	}{
		{name: "missing", value: "", off: ok(DeliveryGuaranteeAtMostOnce), cursor: ok(DeliveryGuaranteeAtMostOnce)},
		{name: "null", value: `null`, off: ok(DeliveryGuaranteeAtMostOnce), cursor: ok(DeliveryGuaranteeAtMostOnce)},
		{name: "number", value: `42`, off: fail(DeliveryGuaranteeErrorCodeInvalid), cursor: fail(DeliveryGuaranteeErrorCodeInvalid)},
		{name: "array", value: `["cursor"]`, off: fail(DeliveryGuaranteeErrorCodeInvalid), cursor: fail(DeliveryGuaranteeErrorCodeInvalid)},
		{name: "empty string", value: `""`, off: fail(DeliveryGuaranteeErrorCodeInvalid), cursor: fail(DeliveryGuaranteeErrorCodeInvalid)},
		{name: "whitespace", value: `"  "`, off: fail(DeliveryGuaranteeErrorCodeInvalid), cursor: fail(DeliveryGuaranteeErrorCodeInvalid)},
		{name: "unknown", value: `"foo"`, off: fail(DeliveryGuaranteeErrorCodeUnsupported), cursor: fail(DeliveryGuaranteeErrorCodeUnsupported)},
		{name: "cursor", value: `"cursor"`, off: fail(DeliveryGuaranteeErrorCodeUnsupported), cursor: ok(DeliveryGuaranteeCursor)},
		{name: "at-most-once", value: `"at-most-once"`, off: ok(DeliveryGuaranteeAtMostOnce), cursor: ok(DeliveryGuaranteeAtMostOnce)},
		{name: "cursor then at-most-once", value: `"cursor, at-most-once"`, off: ok(DeliveryGuaranteeAtMostOnce), cursor: ok(DeliveryGuaranteeCursor)},
		{name: "at-most-once then cursor", value: `"at-most-once,cursor"`, off: ok(DeliveryGuaranteeAtMostOnce), cursor: ok(DeliveryGuaranteeAtMostOnce)},
		{name: "unknown then cursor", value: `"foo,cursor"`, off: fail(DeliveryGuaranteeErrorCodeUnsupported), cursor: ok(DeliveryGuaranteeCursor)},
		{name: "case sensitive", value: `"Cursor"`, off: fail(DeliveryGuaranteeErrorCodeUnsupported), cursor: fail(DeliveryGuaranteeErrorCodeUnsupported)},
	}

	for _, tt := range tests {
		input := []byte(`{"topics":["a"]}`)
		if tt.value != "" {
			input = []byte(`{"topics":["a"],"body":{"extensions":{"cosmoDeliveryGuarantee":` + tt.value + `}}}`)
		}
		for mode, exp := range map[DeliveryGuaranteeMode]expectation{
			DeliveryGuaranteeModeOff:    tt.off,
			DeliveryGuaranteeModeCursor: tt.cursor,
		} {
			t.Run(tt.name+"/"+string(mode), func(t *testing.T) {
				got, err := NegotiateDeliveryGuarantee(mode, input)
				if exp.code == "" {
					require.NoError(t, err)
					assert.Equal(t, exp.guarantee, got)
					return
				}
				var gErr *DeliveryGuaranteeError
				require.ErrorAs(t, err, &gErr)
				assert.Equal(t, exp.code, gErr.Code)
				assert.Equal(t, SupportedDeliveryGuarantees(mode), gErr.Supported)
				assert.NotEmpty(t, gErr.Message)
			})
		}
	}
}

type expectation struct {
	guarantee DeliveryGuarantee
	code      string
}

func ok(g DeliveryGuarantee) expectation { return expectation{guarantee: g} }
func fail(code string) expectation       { return expectation{code: code} }

func TestSupportedDeliveryGuarantees(t *testing.T) {
	assert.Equal(t, []DeliveryGuarantee{DeliveryGuaranteeAtMostOnce}, SupportedDeliveryGuarantees(DeliveryGuaranteeModeOff))
	assert.Equal(t, []DeliveryGuarantee{DeliveryGuaranteeCursor, DeliveryGuaranteeAtMostOnce}, SupportedDeliveryGuarantees(DeliveryGuaranteeModeCursor))
}
