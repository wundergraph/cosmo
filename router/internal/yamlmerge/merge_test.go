// Based on https://github.com/uber-go/config/blob/master/internal/merge/merge_test.go
// Copyright (c) 2018 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

package yamlmerge

import (
	"bytes"
	"os"
	"strings"
	"testing"

	"github.com/goccy/go-yaml"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func mustRead(tb testing.TB, fname string) []byte {
	contents, err := os.ReadFile(fname)
	require.NoError(tb, err, "failed to read file: %s", fname)
	return contents
}

func dump(tb testing.TB, actual, expected string) {
	// It's impossible to debug YAML if the actual and expected values are
	// printed on a single line.
	tb.Logf("Actual:\n\n%s\n\n", actual)
	tb.Logf("Expected:\n\n%s\n\n", expected)
}

func strip(s string) string {
	// It's difficult to write string constants that are valid YAML. Normalize
	// strings for ease of testing.
	s = strings.TrimSpace(s)
	s = strings.Replace(s, "\t", "  ", -1)
	return s
}

func canonicalize(tb testing.TB, s string) string {
	// round-trip to canonicalize formatting
	var i interface{}
	require.NoError(tb,
		yaml.Unmarshal([]byte(strip(s)), &i),
		"canonicalize: couldn't unmarshal YAML",
	)
	formatted, err := yaml.Marshal(i)
	require.NoError(tb, err, "canonicalize: couldn't marshal YAML")
	return string(bytes.TrimSpace(formatted))
}

func unmarshal(tb testing.TB, s string) interface{} {
	var i interface{}
	require.NoError(tb, yaml.Unmarshal([]byte(strip(s)), &i), "unmarshaling failed")
	return i
}

func succeeds(tb testing.TB, strict bool, left, right, expect string) {
	l, r := unmarshal(tb, left), unmarshal(tb, right)
	m, err := merge(l, r, strict)
	require.NoError(tb, err, "merge failed")

	actualBytes, err := yaml.Marshal(m)
	require.NoError(tb, err, "couldn't marshal merged structure")
	actual := canonicalize(tb, string(actualBytes))
	expect = canonicalize(tb, expect)
	if !assert.Equal(tb, expect, actual) {
		dump(tb, actual, expect)
	}
}

func fails(tb testing.TB, strict bool, left, right string) {
	_, err := merge(unmarshal(tb, left), unmarshal(tb, right), strict)
	require.Error(tb, err, "merge succeeded")
}

func TestIntegration(t *testing.T) {
	t.Parallel()

	base := mustRead(t, "testdata/base.yaml")
	prod := mustRead(t, "testdata/production.yaml")
	expect := mustRead(t, "testdata/expect.yaml")

	merged, err := YAMLMerge([][]byte{base, prod}, true /* strict */)
	require.NoError(t, err, "merge failed")

	if !assert.Equal(t, string(expect), string(merged), "unexpected contents") {
		dump(t, string(merged), string(expect))
	}
}

func TestEmpty(t *testing.T) {
	t.Parallel()

	full := []byte("foo: bar\n")
	null := []byte("~")
	_ = null

	tests := []struct {
		desc    string
		sources [][]byte
		expect  string
	}{
		{"empty base", [][]byte{nil, full}, string(full)},
		{"empty override", [][]byte{full, nil}, "null\n"},
		{"both empty", [][]byte{nil, nil}, "null\n"},
		{"null base", [][]byte{null, full}, string(full)},
		{"null override", [][]byte{full, null}, "null\n"},
		{"empty base and null override", [][]byte{nil, null}, "null\n"},
		{"null base and empty override", [][]byte{null, nil}, "null\n"},
	}

	for _, tt := range tests {
		t.Run(tt.desc, func(t *testing.T) {
			t.Parallel()

			merged, err := YAMLMerge(tt.sources, true /* strict */)
			require.NoError(t, err, "merge failed")
			require.Equal(t, tt.expect, string(merged), "wrong contents after merge")
		})
	}
}

func TestSuccess(t *testing.T) {
	t.Parallel()

	left := `
fun: [maserati, porsche]
practical: {toyota: camry, honda: accord}
occupants:
  honda: {driver: jane, backseat: [nate]}
	`
	right := `
fun: [lamborghini, porsche]
practical: {honda: civic, nissan: altima}
occupants:
  honda: {passenger: arthur, backseat: [nora]}
	`
	expect := `
fun: [lamborghini, porsche]
practical: {toyota: camry, honda: civic, nissan: altima}
occupants:
  honda: {passenger: arthur, driver: jane, backseat: [nora]}
  `
	succeeds(t, true, left, right, expect)
	succeeds(t, false, left, right, expect)
}

func TestErrors(t *testing.T) {
	t.Parallel()

	check := func(_ testing.TB, strict bool, sources ...[]byte) error {
		_, err := YAMLMerge(sources, strict)
		return err
	}
	t.Run("tabs in source", func(t *testing.T) {
		t.Parallel()

		src := []byte("foo:\n\tbar:baz")
		require.Error(t, check(t, false, src), "expected error in permissive mode")
		require.Error(t, check(t, true, src), "expected error in strict mode")
	})

	t.Run("duplicated keys", func(t *testing.T) {
		t.Parallel()

		src := []byte("{foo: bar, foo: baz}")
		require.Error(t, check(t, false, src), "expected error in permissive mode")
		require.Error(t, check(t, true, src), "expected error in strict mode")
	})

	t.Run("merge error", func(t *testing.T) {
		t.Parallel()

		left := []byte("foo: [1, 2]")
		right := []byte("foo: {bar: baz}")
		require.NoError(t, check(t, false, left, right), "expected success in permissive mode")
		require.Error(t, check(t, true, left, right), "expected error in strict mode")
	})
}

func TestMismatchedTypes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		desc        string
		left, right string
	}{
		{"sequence and mapping", "[one, two]", "{foo: bar}"},
		{"sequence and scalar", "[one, two]", "foo"},
		{"mapping and scalar", "{foo: bar}", "foo"},
		{"nested", "{foo: [one, two]}", "{foo: bar}"},
	}

	for _, tt := range tests {
		t.Run(tt.desc+" strict", func(t *testing.T) {
			t.Parallel()

			fails(t, true, tt.left, tt.right)
		})
		t.Run(tt.desc+" permissive", func(t *testing.T) {
			t.Parallel()
			// prefer the higher-priority value
			succeeds(t, false, tt.left, tt.right, tt.right)
		})
	}
}

// Note that this test is skipped as we do not interpret booleans this
// even though the base library did
func TestBooleans(t *testing.T) {
	t.Skip()
	t.Parallel()

	// YAML helpfully interprets many strings as Booleans.
	tests := []struct {
		in, out string
	}{
		{"yes", "true"},
		{"YES", "true"},
		{"on", "true"},
		{"ON", "true"},
		{"no", "false"},
		{"NO", "false"},
		{"off", "false"},
		{"OFF", "false"},
	}

	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			t.Parallel()

			succeeds(t, true, "", tt.in, tt.out)
			succeeds(t, false, "", tt.in, tt.out)
		})
	}
}

func TestExplicitNil(t *testing.T) {
	t.Parallel()

	base := `foo: {one: two}`
	override := `foo: ~`
	expect := `foo: ~`
	succeeds(t, true, base, override, expect)
	succeeds(t, false, base, override, expect)
}
