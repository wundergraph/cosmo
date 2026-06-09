package storage

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNormalizeName(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{name: "kebab case", raw: "get-user-by-id", want: "getUserById"},
		{name: "snake case", raw: "get_user_by_id", want: "getUserById"},
		{name: "space separated", raw: "Get User By ID", want: "getUserById"},
		{name: "mixed separators", raw: "get__user--by id", want: "getUserById"},
		{name: "already camel", raw: "getUserById", want: "getUserById"},
		{name: "leading digit", raw: "123foo", want: "_123foo"},
		{name: "leading digit with separators", raw: "123-foo-bar", want: "_123FooBar"},
		{name: "reserved word", raw: "delete", want: "op_delete"},
		{name: "reserved word after normalization", raw: "class", want: "op_class"},
		{name: "invalid punctuation", raw: "get$user#by%id", want: "getUserById"},
		{name: "empty input", raw: "", want: "operation"},
		{name: "only invalid input", raw: "$$$", want: "operation"},
		{name: "underscore output for reserved word is not rechecked", raw: "op-delete", want: "opDelete"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, NormalizeName(tt.raw))
		})
	}
}

func TestSuffixedName(t *testing.T) {
	tests := []struct {
		name  string
		base  string
		taken map[string]struct{}
		want  string
	}{
		{
			name:  "first use keeps base",
			base:  "getUser",
			taken: map[string]struct{}{},
			want:  "getUser",
		},
		{
			name: "first collision uses suffix two",
			base: "getUser",
			taken: map[string]struct{}{
				"getUser": {},
			},
			want: "getUser_2",
		},
		{
			name: "skips occupied suffixes",
			base: "getUser",
			taken: map[string]struct{}{
				"getUser":   {},
				"getUser_2": {},
				"getUser_3": {},
			},
			want: "getUser_4",
		},
		{
			name: "gap is reused",
			base: "getUser",
			taken: map[string]struct{}{
				"getUser":   {},
				"getUser_3": {},
			},
			want: "getUser_2",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, SuffixedName(tt.base, tt.taken))
		})
	}
}
