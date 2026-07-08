package main

import (
	"maps"
	"regexp"
	"sort"
	"strings"
)

// strip characters that would break the labelset grammar (or inject extra labels)
var badValueRE = regexp.MustCompile(`[{}=,\s]`)

func sanitizeValue(s string) string { return badValueRE.ReplaceAllString(s, "_") }

// rewriteName injects labels into a pyroscope application name
// ("app{k=v,k2=v2}", sorted). Injected labels override any client-supplied
// values so clients can't spoof claim-derived labels.
func rewriteName(raw string, inject map[string]string) string {
	app, labels := parseName(raw)
	maps.Copy(labels, inject)
	return buildName(app, labels)
}

func parseName(s string) (string, map[string]string) {
	labels := map[string]string{}
	app, rest, ok := strings.Cut(s, "{")
	if !ok {
		return s, labels
	}
	body := strings.TrimSuffix(rest, "}")
	for pair := range strings.SplitSeq(body, ",") {
		if pair == "" {
			continue
		}
		if k, v, ok := strings.Cut(pair, "="); ok {
			labels[strings.TrimSpace(k)] = strings.TrimSpace(v)
		}
	}
	return app, labels
}

func buildName(app string, labels map[string]string) string {
	keys := make([]string, 0, len(labels))
	for k := range labels {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	b.WriteString(app)
	b.WriteByte('{')
	for i, k := range keys {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(labels[k])
	}
	b.WriteByte('}')
	return b.String()
}
