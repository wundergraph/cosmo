package versioninfo

import (
	"fmt"
	"runtime"
	"runtime/debug"
	"strings"
	"time"
)

var dependencies = []string{
	"github.com/wundergraph/graphql-go-tools/v2",
	"github.com/wundergraph/astjson",
}

// ModuleVersion represents a module's path and version.
type ModuleVersion struct {
	Path    string
	Version string
}

// VersionInfo contains build-related information.
type VersionInfo struct {
	GoVersion    string
	AppVersion   string
	OS           string
	Arch         string
	VCSRevision  string
	BuildDate    time.Time
	Dependencies []ModuleVersion
}

// New creates a new VersionInfo instance with the provided version and dependencies.
func New(version, commit, date string) VersionInfo {
	var buildInfo VersionInfo

	if commit != "" {
		buildInfo.VCSRevision = commit
	}

	if date != "" {
		if t, err := time.Parse(time.RFC3339, date); err == nil {
			buildInfo.BuildDate = t
		}
	}

	if info, ok := debug.ReadBuildInfo(); ok {
		// Collect dependencies
		depMap := make(map[string]bool)
		for _, dep := range dependencies {
			depMap[dep] = true
		}
		for _, m := range info.Deps {
			if depMap[m.Path] {
				mv := ModuleVersion{
					Path:    m.Path,
					Version: m.Version,
				}
				if m.Replace != nil {
					mv.Path = m.Replace.Path
					mv.Version = m.Replace.Version
				}
				buildInfo.Dependencies = append(buildInfo.Dependencies, mv)
			}
		}
	}

	buildInfo.GoVersion = runtime.Version()
	buildInfo.AppVersion = version
	buildInfo.OS = runtime.GOOS
	buildInfo.Arch = runtime.GOARCH

	return buildInfo
}

// String returns a formatted string of the build information.
func (b VersionInfo) String() string {
	var sb strings.Builder

	sb.WriteString("Router:\n")
	fmt.Fprintf(&sb, "  Version: %s\n", b.AppVersion)
	fmt.Fprintf(&sb, "  Go version: %s\n", b.GoVersion)
	fmt.Fprintf(&sb, "  OS: %s\n", b.OS)
	fmt.Fprintf(&sb, "  Arch: %s\n", b.Arch)

	if !b.BuildDate.IsZero() {
		fmt.Fprintf(&sb, "  Built: %s\n", b.BuildDate.Format(time.RFC3339))
	}

	if b.VCSRevision != "" {
		fmt.Fprintf(&sb, "  VCS Revision: %s\n", b.VCSRevision)
	}

	if len(b.Dependencies) > 0 {
		sb.WriteString("  Dependencies:\n")
		for _, dep := range b.Dependencies {
			fmt.Fprintf(&sb, "    %s %s\n", dep.Path, dep.Version)
		}
	}

	return sb.String()
}
