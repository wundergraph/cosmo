package versioninfo

import (
	"runtime"
	"testing"
	"time"
)

func TestNew_BuildDateParsing(t *testing.T) {
	version := "1.0.0"
	commit := "abcdef"
	date := "2023-10-01T12:34:56Z"

	vi := New(version, commit, date)

	expectedDate, _ := time.Parse(time.RFC3339, date)
	if !vi.BuildDate.Equal(expectedDate) {
		t.Errorf("BuildDate: got %v, want %v", vi.BuildDate, expectedDate)
	}
}

func TestNew_InvalidBuildDate(t *testing.T) {
	version := "1.0.0"
	commit := "abcdef"
	date := "invalid-date"

	vi := New(version, commit, date)

	if !vi.BuildDate.IsZero() {
		t.Errorf("Expected BuildDate to be zero, got %v", vi.BuildDate)
	}
}

func TestNew_VCSRevision(t *testing.T) {
	version := "1.0.0"
	commit := "abcdef"
	date := ""

	vi := New(version, commit, date)

	if vi.VCSRevision != commit {
		t.Errorf("VCSRevision: got %v, want %v", vi.VCSRevision, commit)
	}
}

func TestNew_AppVersion(t *testing.T) {
	version := "1.0.0"
	commit := ""
	date := ""

	vi := New(version, commit, date)

	if vi.AppVersion != version {
		t.Errorf("AppVersion: got %v, want %v", vi.AppVersion, version)
	}
}

func TestNew_Defaults(t *testing.T) {
	version := ""
	commit := ""
	date := ""

	vi := New(version, commit, date)

	if vi.GoVersion != runtime.Version() {
		t.Errorf("GoVersion: got %v, want %v", vi.GoVersion, runtime.Version())
	}

	if vi.OS != runtime.GOOS {
		t.Errorf("OS: got %v, want %v", vi.OS, runtime.GOOS)
	}

	if vi.Arch != runtime.GOARCH {
		t.Errorf("Arch: got %v, want %v", vi.Arch, runtime.GOARCH)
	}
}

func TestVersionInfo_String(t *testing.T) {
	tests := []struct {
		name string
		vi   VersionInfo
		want string
	}{
		{
			name: "Complete Info",
			vi: VersionInfo{
				AppVersion:  "1.0.0",
				GoVersion:   "go1.20",
				OS:          "linux",
				Arch:        "amd64",
				VCSRevision: "abcdef",
				BuildDate:   time.Date(2023, 10, 1, 12, 34, 56, 0, time.UTC),
				Dependencies: []ModuleVersion{
					{Path: "github.com/wundergraph/graphql-go-tools/v2", Version: "v2.0.0"},
					{Path: "github.com/wundergraph/astjson", Version: "v1.2.3"},
				},
			},
			want: `Router:
  Version: 1.0.0
  Go version: go1.20
  OS: linux
  Arch: amd64
  Built: 2023-10-01T12:34:56Z
  VCS Revision: abcdef
  Dependencies:
    github.com/wundergraph/graphql-go-tools/v2 v2.0.0
    github.com/wundergraph/astjson v1.2.3
`,
		},
		{
			name: "No Dependencies",
			vi: VersionInfo{
				AppVersion:  "1.0.0",
				GoVersion:   "go1.20",
				OS:          "linux",
				Arch:        "amd64",
				VCSRevision: "abcdef",
				BuildDate:   time.Date(2023, 10, 1, 12, 34, 56, 0, time.UTC),
			},
			want: `Router:
  Version: 1.0.0
  Go version: go1.20
  OS: linux
  Arch: amd64
  Built: 2023-10-01T12:34:56Z
  VCS Revision: abcdef
`,
		},
		{
			name: "No BuildDate and VCSRevision",
			vi: VersionInfo{
				AppVersion: "1.0.0",
				GoVersion:  "go1.20",
				OS:         "linux",
				Arch:       "amd64",
				Dependencies: []ModuleVersion{
					{Path: "github.com/wundergraph/graphql-go-tools/v2", Version: "v2.0.0"},
				},
			},
			want: `Router:
  Version: 1.0.0
  Go version: go1.20
  OS: linux
  Arch: amd64
  Dependencies:
    github.com/wundergraph/graphql-go-tools/v2 v2.0.0
`,
		},
		{
			name: "Minimal Info",
			vi: VersionInfo{
				AppVersion: "1.0.0",
				GoVersion:  "go1.20",
				OS:         "linux",
				Arch:       "amd64",
			},
			want: `Router:
  Version: 1.0.0
  Go version: go1.20
  OS: linux
  Arch: amd64
`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.vi.String()
			if got != tt.want {
				t.Errorf("VersionInfo.String() = %q, want %q", got, tt.want)
			}
		})
	}
}
