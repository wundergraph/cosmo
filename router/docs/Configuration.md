# Router Configuration Conventions

This document outlines the conventions used in Cosmo's configuration schema.

## General Structure

- Configuration is defined in a JSON Schema format
- All configuration options have specific types with validation constraints
- Properties use `snake_case` naming convention
- Nested objects are used to group related configuration options

## Validation Rules

- Required fields are explicitly marked with `required` arrays
- `additionalProperties: false` ensures no unknown properties are allowed
- Minimum/maximum constraints are specified where applicable
- Enums are used for properties with a fixed set of allowed values

## Common Patterns

### `enabled`/`disabled` sub-options

When creating a new feature or configuration section, instead of directly making an option like `option_enabled` or `option_disabled`, use an `enabled` or `disabled` sub-option. This leaves room for future sub-options pertaining to the same feature.

#### Good

```yaml
feature:
  enabled: true
```

#### Bad

```yaml
feature_enabled: true
```

```yaml
enable_feature: true
```

### Experimental options

When introducing an option that is not stable, use a prefix like this:

```yaml
feature:
  experiment_some_option: 3000
  
# or
  
experiment_feature:
  some_option: 3000
```

When it has become stable, remove the prefix.

## Guidelines for types and names

- Property names use nouns or configurations, **not** verb-prefixed names (use `storage` not `get_storage` or `use_storage`)
- Every configurable component uses an `enabled` or `disabled` boolean property to toggle features without removing them from the configuration
  - Select either `enabled` or `disabled` based on the feature's default state, if it is opt-out, use `disabled`, and if opt-in, use `enabled`.
  - This helps both semantic readability with an implied default and allows the Go zero value for booleans to be used as the default.
- Default values are specified in `pkg/config/config.go` via struct tags.
  - It is usually best to try and make boolean properties default to `false`, this simplifies handling of the zero value, and generally means the least intrusive changes to the codebase
  - As with `enabled`/`disabled`, you can use antonyms like `include`/`exclude`, `allow`/`deny`, etc. to indicate the default behavior.
- URLs follow the format `scheme://host:port`
- File paths use the `format: file-path` validator
- Sizes are specified using string format with units (e.g., "100MB")
- Time durations use string format with units (e.g., "1s", "1m", "1h")
- Take care that when you define a default value on a value in a slice or map, the `envDefault` will only be populated if the index/key comes from an environment variable, not from YAML configuration

### Configuration Merge

The router supports merging multiple configuration files during startup. When multiple files are provided, their contents are merged based on their keys:

- **Keyed objects** (e.g., maps) are merged by key, allowing overrides and partial updates.
- **Lists** are **not merged**; that is, the entire list is replaced if overridden instead of having elements from both lists merged.

It's recommended to model lists as **maps of structs** (e.g., `{ "serviceA": {...}, "serviceB": {...} }`) when possible. This allows fine-grained overrides and avoids unintentionally replacing the full list.

## Documentation

- Every property includes a `description` field explaining its purpose and usage
- Deprecated properties are marked with `deprecated` and should include a reason for deprecation

# Contributing New Configuration Options

To add a new configuration option, you need to update two files:

## 1. Update `pkg/config/config.go`

First, add the new option to the appropriate struct in `pkg/config/config.go`:

```go
type YourFeatureConfig struct {
    Enabled bool   `yaml:"enabled" envDefault:"false" env:"ENABLED"`
    Timeout string `yaml:"timeout" envDefault:"30s" env:"TIMEOUT"`
}

type Config struct {
    // ... existing fields
    YourFeature YourFeatureConfig `yaml:"your_feature,omitempty" envPrefix:"YOUR_FEATURE_"`
}
```

The struct field tags define:

- `yaml:_`: The field name in YAML configuration
- `yaml:omitempty`: Omits the field from Marshalling if it is the type's zero value
- `env`: Environment variable name for this option
- `envDefault`: Default value for the field
- `envPrefix`: Sets a prefix for all `env` tags on children, only works on structs, slices, etc

For more details and full tags reference, see the documentation for [caarlos0/env](https://github.com/caarlos0/env/?tab=readme-ov-file#tags) and `[goccy/go-yaml](https://github.com/goccy/go-yaml?tab=readme-ov-file#synopsis)

## 2. Update `pkg/config/config.schema.json`

Then, add the corresponding schema definition to `pkg/config/config.schema.json`:

```json
{
  "properties": {
    "your_feature": {
      "type": "object",
      "additionalProperties": false,
      "description": "Configuration for your feature",
      "properties": {
        "enabled": {
          "type": "boolean",
          "description": "Enable your feature",
          "default": false
        },
        "timeout": {
          "type": "string",
          "description": "Timeout for your feature. Specified as a string with a duration unit (e.g. '30s')",
          "default": "30s"
        }
      }
    }
  }
}
```

Make sure that:

1. The property names match between `pkg/config/config.go` and `pkg/config/config.schema.json`
2. You provide descriptive comments/descriptions for each field
3. Default values are added in the `pkg/config/config.go` struct env tags
4. Follow the existing conventions for similar configuration options
5. Add your config option to `fixtures/full.yaml`, if possible

## 3. Writing Tests

If applicable, write tests [here](../pkg/config/) to ensure the new configuration option behaves as expected. This may include unit tests or integration tests depending on the feature.

## 4. Documentation

Update the [documentation](https://github.com/wundergraph/cosmo-docs/docs) to include the new configuration option.
