package tsgen

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/buger/jsonparser"
)

// RequiredFieldNullError is returned when a required path resolves to a null
// or absent value at runtime. The Code/Path fields mirror the agent-facing
// `RequiredFieldNullError` shape from §4.4.5.
type RequiredFieldNullError struct {
	Code            string
	Path            string
	Hash            string
	Message         string
	UpstreamErrors  []byte
}

func (e *RequiredFieldNullError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Path)
}

// EnforceRequiredPaths walks `paths` against `responseData` (raw JSON) and
// returns a *RequiredFieldNullError at the first path that resolves to null,
// undefined, or an empty list (when `[]` semantics demand non-empty).
//
// `responseData` should be the data payload of the GraphQL response, not the
// full envelope. The path syntax matches §4.4.3:
//
//   - `a.b.c`        — every segment present and non-null
//   - `a.b[]`        — list non-null and non-empty; every element non-null
//   - `a.b[].c`      — every element's `c` non-null
//   - `a.b[]?.c`     — empty list allowed; when present, every element's `c`
//                      must be non-null
//   - `a.b[N].c`     — only the N-th element's `c` is required
func EnforceRequiredPaths(responseData []byte, paths []string, hash string) error {
	for _, path := range paths {
		segments, err := parsePath(path)
		if err != nil {
			return fmt.Errorf("tsgen: invalid required path %q: %w", path, err)
		}
		if err := enforceSegments(responseData, segments, path, hash); err != nil {
			return err
		}
	}
	return nil
}

type pathSegment struct {
	// kind: "key", "list", "listOptional", "listIndex"
	kind  string
	key   string
	index int
}

func parsePath(path string) ([]pathSegment, error) {
	if path == "" {
		return nil, errors.New("empty path")
	}
	var out []pathSegment
	parts := splitTopLevel(path, '.')
	for _, p := range parts {
		if p == "" {
			return nil, fmt.Errorf("empty segment in %q", path)
		}
		// Handle list markers possibly attached to a key, e.g. orders[], orders[]?, orders[0].
		// Strip the key, then process trailing list markers.
		key := p
		var listMarkers string
		if idx := strings.Index(p, "["); idx >= 0 {
			key = p[:idx]
			listMarkers = p[idx:]
		}
		if key != "" {
			out = append(out, pathSegment{kind: "key", key: key})
		}
		for listMarkers != "" {
			switch {
			case strings.HasPrefix(listMarkers, "[]?"):
				out = append(out, pathSegment{kind: "listOptional"})
				listMarkers = listMarkers[3:]
			case strings.HasPrefix(listMarkers, "[]"):
				out = append(out, pathSegment{kind: "list"})
				listMarkers = listMarkers[2:]
			case strings.HasPrefix(listMarkers, "["):
				end := strings.Index(listMarkers, "]")
				if end < 0 {
					return nil, fmt.Errorf("unterminated [ in %q", path)
				}
				idxStr := listMarkers[1:end]
				n, err := strconv.Atoi(idxStr)
				if err != nil {
					return nil, fmt.Errorf("invalid list index %q in %q", idxStr, path)
				}
				out = append(out, pathSegment{kind: "listIndex", index: n})
				listMarkers = listMarkers[end+1:]
			default:
				return nil, fmt.Errorf("unexpected %q in %q", listMarkers, path)
			}
		}
	}
	return out, nil
}

// enforceSegments recursively walks the segments against the JSON data.
// `pathStr` is the full original path (used for error reporting).
func enforceSegments(data []byte, segments []pathSegment, pathStr, hash string) error {
	if len(segments) == 0 {
		// Reached the end of the path; the value itself must be non-null.
		if isNullOrAbsent(data) {
			return &RequiredFieldNullError{
				Code:    "REQUIRED_FIELD_NULL",
				Path:    pathStr,
				Hash:    hash,
				Message: fmt.Sprintf("required field %q is null", pathStr),
			}
		}
		return nil
	}

	seg := segments[0]
	rest := segments[1:]

	switch seg.kind {
	case "key":
		v, dt, _, err := jsonparser.Get(data, seg.key)
		if err != nil || dt == jsonparser.NotExist || dt == jsonparser.Null {
			return &RequiredFieldNullError{
				Code:    "REQUIRED_FIELD_NULL",
				Path:    pathStr,
				Hash:    hash,
				Message: fmt.Sprintf("required field %q is null", pathStr),
			}
		}
		return enforceSegments(v, rest, pathStr, hash)

	case "list":
		if isNullOrAbsent(data) {
			return &RequiredFieldNullError{Code: "REQUIRED_FIELD_NULL", Path: pathStr, Hash: hash}
		}
		count := 0
		var iterErr error
		_, err := jsonparser.ArrayEach(data, func(value []byte, dt jsonparser.ValueType, _ int, _ error) {
			count++
			if iterErr != nil {
				return
			}
			if dt == jsonparser.Null {
				iterErr = &RequiredFieldNullError{Code: "REQUIRED_FIELD_NULL", Path: pathStr, Hash: hash}
				return
			}
			if err := enforceSegments(value, rest, pathStr, hash); err != nil {
				iterErr = err
			}
		})
		if err != nil {
			return fmt.Errorf("tsgen: required path %q: %w", pathStr, err)
		}
		if iterErr != nil {
			return iterErr
		}
		if count == 0 {
			return &RequiredFieldNullError{
				Code:    "REQUIRED_FIELD_NULL",
				Path:    pathStr,
				Hash:    hash,
				Message: fmt.Sprintf("required list %q is empty", pathStr),
			}
		}
		return nil

	case "listOptional":
		if isNullOrAbsent(data) {
			return nil
		}
		var iterErr error
		_, err := jsonparser.ArrayEach(data, func(value []byte, dt jsonparser.ValueType, _ int, _ error) {
			if iterErr != nil {
				return
			}
			if dt == jsonparser.Null {
				iterErr = &RequiredFieldNullError{Code: "REQUIRED_FIELD_NULL", Path: pathStr, Hash: hash}
				return
			}
			if err := enforceSegments(value, rest, pathStr, hash); err != nil {
				iterErr = err
			}
		})
		if err != nil {
			return fmt.Errorf("tsgen: required path %q: %w", pathStr, err)
		}
		return iterErr

	case "listIndex":
		i := 0
		var elemValue []byte
		var elemType jsonparser.ValueType
		found := false
		_, err := jsonparser.ArrayEach(data, func(value []byte, dt jsonparser.ValueType, _ int, _ error) {
			if i == seg.index {
				elemValue = value
				elemType = dt
				found = true
			}
			i++
		})
		if err != nil {
			return fmt.Errorf("tsgen: required path %q: %w", pathStr, err)
		}
		if !found || elemType == jsonparser.Null {
			return &RequiredFieldNullError{
				Code: "REQUIRED_FIELD_NULL", Path: pathStr, Hash: hash,
			}
		}
		return enforceSegments(elemValue, rest, pathStr, hash)
	}
	return fmt.Errorf("tsgen: unknown path segment kind %q", seg.kind)
}

func isNullOrAbsent(data []byte) bool {
	if len(data) == 0 {
		return true
	}
	t := strings.TrimSpace(string(data))
	return t == "null"
}
