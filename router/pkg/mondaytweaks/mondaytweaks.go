// Package mondaytweaks defines compile-time feature flags for monday.com-specific
// behavioural overrides in the cosmo router. All monday-specific toggles live in
// one place so they are easy to audit and remove when upstreamed.
package mondaytweaks

const (
	// RereadProfilingEnvAfterFlagParse re-reads PPROF_ADDR/PYROSCOPE_ADDR after flag.Parse
	// so platform-api-cosmo-router embed main() can Setenv before routercmd.Main().
	RereadProfilingEnvAfterFlagParse = true

	// ResolvePyroscopeNameAndTagsFromEnv reads PYROSCOPE_APPLICATION_NAME and
	// PYROSCOPE_TAGS when starting the Pyroscope client. When disabled, uses the
	// upstream hardcoded application name and hostname-only tags.
	ResolvePyroscopeNameAndTagsFromEnv = true
)
