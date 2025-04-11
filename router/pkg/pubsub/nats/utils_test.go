package nats

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsValidNatsSubject(t *testing.T) {
	tests := []struct {
		name    string
		subject string
		want    bool
	}{
		{
			name:    "empty string",
			subject: "",
			want:    false,
		},
		{
			name:    "simple valid subject",
			subject: "test.subject",
			want:    true,
		},
		{
			name:    "valid subject with wildcard",
			subject: "test.>",
			want:    true,
		},
		{
			name:    "invalid with space",
			subject: "test subject",
			want:    false,
		},
		{
			name:    "invalid with tab",
			subject: "test\tsubject",
			want:    false,
		},
		{
			name:    "invalid with newline",
			subject: "test\nsubject",
			want:    false,
		},
		{
			name:    "invalid with empty token",
			subject: "test..subject",
			want:    false,
		},
		{
			name:    "wildcard not at end",
			subject: "test.>.subject",
			want:    false,
		},
		{
			name:    "contains a space",
			subject: " ",
			want:    false,
		},
		{
			name:    "contains a tab",
			subject: "\t",
			want:    false,
		},
		{
			name:    "contains a newline",
			subject: "\n",
			want:    false,
		},
		{
			name:    "contains a form feed",
			subject: "\f",
			want:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isValidNatsSubject(tt.subject)
			assert.Equal(t, tt.want, got)
		})
	}
}
