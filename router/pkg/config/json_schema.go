package config

import (
	_ "embed"
	"errors"
	"github.com/dustin/go-humanize"
	"github.com/goccy/go-yaml"
	"github.com/santhosh-tekuri/jsonschema/v5"
	"io/fs"
	"log"
	"net"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	hostnameRegexStringRFC1123 = `^([a-zA-Z0-9]{1}[a-zA-Z0-9-]{0,62}){1}(\.[a-zA-Z0-9]{1}[a-zA-Z0-9-]{0,62})*?$` // accepts hostname starting with a digit https://tools.ietf.org/html/rfc1123
)

var (
	//go:embed config.schema.json
	JSONSchema string

	hostnameRegexRFC1123 = regexp.MustCompile(hostnameRegexStringRFC1123)

	goDurationSchema = jsonschema.MustCompileString("goDuration.json", `{
	"properties" : {
		"duration": {
			"type": "object",
			"additionalProperties": false,
			"properties": {
				"minimum": {
					"type": "string"
				},	
				"minimum": {
					"type": "string"
				}
			}
		}
	}
}`)

	humanBytesSchema = jsonschema.MustCompileString("humanBytes.json", `{
	"properties" : {
		"bytes": {
			"type": "object",
			"additionalProperties": false,
			"properties": {
				"minimum": {
					"type": "number"
				},	
				"minimum": {
					"type": "number"
				}
			}
		}
	}
}`)
)

type humanBytes struct {
	min uint64
	max uint64
}

func (d humanBytes) Validate(ctx jsonschema.ValidationContext, v interface{}) error {

	val, ok := v.(string)
	if !ok {
		return ctx.Error("bytes", "invalid bytes, given %s", v)
	}

	bytes, err := humanize.ParseBytes(val)
	if err != nil {
		return ctx.Error("bytes", "invalid bytes, given %s", val)
	}

	if d.min > 0 {
		if bytes < d.min {
			return ctx.Error("bytes", "must be greater or equal than %s, given %s", humanize.Bytes(d.min), val)
		}
	}

	if d.max > 0 {
		if bytes > d.max {
			return ctx.Error("bytes", "must be less oe equal than %s, given %s", humanize.Bytes(d.max), val)
		}

	}

	return nil
}

type humanBytesCompiler struct{}

func (humanBytesCompiler) Compile(ctx jsonschema.CompilerContext, m map[string]interface{}) (jsonschema.ExtSchema, error) {
	if val, ok := m["bytes"]; ok {

		if mapVal, ok := val.(map[string]interface{}); ok {
			var minBytes, maxBytes uint64
			var err error

			minBytesString, ok := mapVal["minimum"].(string)
			if ok {
				minBytes, err = humanize.ParseBytes(minBytesString)
				if err != nil {
					return nil, err
				}
			}
			maxBytesString, ok := mapVal["maximum"].(string)
			if ok {
				maxBytes, err = humanize.ParseBytes(maxBytesString)
				if err != nil {
					return nil, err
				}
			}
			return humanBytes{
				min: minBytes,
				max: maxBytes,
			}, nil
		}

		return duration{}, nil
	}

	// nothing to compile, return nil
	return nil, nil
}

type duration struct {
	min time.Duration
	max time.Duration
}

func (d duration) Validate(ctx jsonschema.ValidationContext, v interface{}) error {
	// is within bounds
	val, ok := v.(string)
	if !ok {
		return ctx.Error("duration", "invalid duration, given %s", v)
	}

	duration, err := time.ParseDuration(val)
	if err != nil {
		return ctx.Error("duration", "invalid duration, given %s", val)
	}

	if d.min > 0 {
		if duration < d.min {
			return ctx.Error("duration", "must be greater or equal than %s, given %s", d.min, val)
		}
	}

	if d.max > 0 {
		if duration > d.max {
			return ctx.Error("duration", "must be less oe equal than %s, given %s", d.max, val)
		}

	}

	return nil
}

type durationCompiler struct{}

func (durationCompiler) Compile(ctx jsonschema.CompilerContext, m map[string]interface{}) (jsonschema.ExtSchema, error) {
	if val, ok := m["duration"]; ok {

		if mapVal, ok := val.(map[string]interface{}); ok {
			var minDuration, maxDuration time.Duration
			var err error

			minDurationString, ok := mapVal["minimum"].(string)
			if ok {
				minDuration, err = time.ParseDuration(minDurationString)
				if err != nil {
					return nil, err
				}
			}
			maxDurationString, ok := mapVal["maximum"].(string)
			if ok {
				maxDuration, err = time.ParseDuration(maxDurationString)
				if err != nil {
					return nil, err
				}
			}
			return duration{
				min: minDuration,
				max: maxDuration,
			}, nil
		}

		return duration{}, nil
	}
	// nothing to compile, return nil
	return nil, nil
}

func ValidateMarshalConfig(yamlData []byte, schema string) (*Config, error) {
	var v interface{}
	if err := yaml.Unmarshal(yamlData, &v); err != nil {
		log.Fatal(err)
	}

	c := jsonschema.NewCompiler()
	c.Formats["go-duration"] = isGoDuration
	c.Formats["bytes-string"] = isBytesString
	c.Formats["url"] = isURL
	c.Formats["http-url"] = isHttpURL
	c.Formats["file-path"] = isFilePath
	c.Formats["x-uri"] = isURI
	c.Formats["hostname-port"] = isHostnamePort

	c.RegisterExtension("duration", goDurationSchema, durationCompiler{})
	c.RegisterExtension("bytes", humanBytesSchema, humanBytesCompiler{})

	err := c.AddResource("config.schema.json", strings.NewReader(schema))
	if err != nil {
		return nil, err
	}

	sch, err := c.Compile("config.schema.json")
	if err != nil {
		return nil, err
	}

	err = sch.Validate(v)
	if err != nil {
		return nil, err
	}

	var config Config
	if err := yaml.Unmarshal(yamlData, &config); err != nil {
		return nil, err
	}

	return &config, nil
}

// isGoDuration is the validation function for validating if the current field's value is a valid Go duration.
func isGoDuration(s any) bool {
	val, ok := s.(string)
	if !ok {
		return false
	}
	_, err := time.ParseDuration(val)
	return err == nil
}

// isBytesString is the validation function for validating if the current field's value is a valid bytes string.
func isBytesString(s any) bool {
	val, ok := s.(string)
	if !ok {
		return false
	}
	_, err := humanize.ParseBytes(val)
	return err == nil
}

// isFileURL is the helper function for validating if the `path` valid file URL as per RFC8089
func isFileURL(path string) bool {
	if !strings.HasPrefix(path, "file:/") {
		return false
	}
	_, err := url.ParseRequestURI(path)
	return err == nil
}

// isURL is the validation function for validating if the current field's value is a valid URL.
func isURL(a any) bool {
	val, ok := a.(string)
	if !ok {
		return false
	}
	s := strings.ToLower(val)

	if len(s) == 0 {
		return false
	}

	if isFileURL(s) {
		return true
	}

	u, err := url.Parse(s)
	if err != nil || u.Scheme == "" {
		return false
	}

	if u.Host == "" && u.Fragment == "" && u.Opaque == "" {
		return false
	}

	return true
}

// isHttpURL is the validation function for validating if the current field's value is a valid HTTP(s) URL.
func isHttpURL(a any) bool {
	val, ok := a.(string)
	if !ok {
		return false
	}

	if !isURL(val) {
		return false
	}

	s := strings.ToLower(val)

	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		return false
	}

	return u.Scheme == "http" || u.Scheme == "https"
}

// isDir is the validation function for validating if the current field's value is a valid existing directory.
func isDir(s string) bool {
	fileInfo, err := os.Stat(s)
	if err != nil {
		return false
	}

	return fileInfo.IsDir()
}

// isFile is the validation function for validating if the current field's value is a valid existing file path.
func isFile(s string) bool {
	fileInfo, err := os.Stat(s)
	if err != nil {
		return false
	}

	return !fileInfo.IsDir()
}

// isFilePath is the validation function for validating if the current field's value is a valid file path.
func isFilePath(a any) bool {
	val, ok := a.(string)
	if !ok {
		return false
	}

	var exists bool

	// Not valid if it is a directory.
	if isDir(val) {
		return false
	}
	// If it exists, it obviously is valid.
	// This is done first to avoid code duplication and unnecessary additional logic.
	if exists = isFile(val); exists {
		return true
	}

	// Every OS allows for whitespace, but none
	// let you use a file with no filename (to my knowledge).
	// Unless you're dealing with raw inodes, but I digress.
	if strings.TrimSpace(val) == "" {
		return false
	}

	// We make sure it isn't a directory.
	if strings.HasSuffix(val, string(os.PathSeparator)) {
		return false
	}

	if _, err := os.Stat(val); err != nil {
		var t *fs.PathError
		switch {
		case errors.As(err, &t):
			if errors.Is(t.Err, syscall.EINVAL) {
				// It's definitely an invalid character in the filepath.
				return false
			}
			// It could be a permission error, a does-not-exist error, etc.
			// Out-of-scope for this validation, though.
			return true
		default:
			// Something went *seriously* wrong.
			/*
				Per https://pkg.go.dev/os#Stat:
					"If there is an error, it will be of type *PathError."
			*/
			panic(err)
		}
	}

	return false
}

// isURI is the validation function for validating if the current field's value is a valid URI.
func isURI(a any) bool {
	val, ok := a.(string)
	if !ok {
		return false
	}

	// checks needed as of Go 1.6 because of change https://github.com/golang/go/commit/617c93ce740c3c3cc28cdd1a0d712be183d0b328#diff-6c2d018290e298803c0c9419d8739885L195
	// emulate browser and strip the '#' suffix prior to validation. see issue-#237
	if i := strings.Index(val, "#"); i > -1 {
		val = val[:i]
	}

	if len(val) == 0 {
		return false
	}

	_, err := url.ParseRequestURI(val)

	return err == nil
}

// isHostnamePort validates a <dns>:<port> combination for fields typically used for socket address.
func isHostnamePort(a any) bool {
	val, ok := a.(string)
	if !ok {
		return false
	}

	host, port, err := net.SplitHostPort(val)
	if err != nil {
		return false
	}
	// Port must be an iny <= 65535.
	if portNum, err := strconv.ParseInt(
		port, 10, 32,
	); err != nil || portNum > 65535 || portNum < 1 {
		return false
	}

	// If host is specified, it should match a DNS name
	if host != "" {
		return hostnameRegexRFC1123.MatchString(host)
	}
	return true
}
