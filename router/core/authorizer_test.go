package core

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

// fieldConfig builds a FieldConfiguration for a coordinate whose authorization requires the given
// OR-of-ANDs scopes. Each inner slice is an AND group; the field is authorized if any group matches.
func fieldConfig(typeName, fieldName string, requiredOrScopes ...[]string) *nodev1.FieldConfiguration {
	orScopes := make([]*nodev1.Scopes, 0, len(requiredOrScopes))
	for _, and := range requiredOrScopes {
		orScopes = append(orScopes, &nodev1.Scopes{RequiredAndScopes: and})
	}
	return &nodev1.FieldConfiguration{
		TypeName:  typeName,
		FieldName: fieldName,
		AuthorizationConfiguration: &nodev1.AuthorizationConfiguration{
			RequiredOrScopes: orScopes,
		},
	}
}

// resolveContext builds a resolve.Context. When authenticated is true an authentication carrying the
// given scopes is attached; otherwise no authentication is present.
func resolveContext(authenticated bool, scopes ...string) *resolve.Context {
	ctx := context.Background()
	if authenticated {
		auth := authentication.NewEmptyAuthentication("scope")
		auth.SetScopes(scopes)
		ctx = authentication.NewContext(ctx, auth)
	}
	return resolve.NewContext(ctx)
}

func coordinate(typeName, fieldName string) resolve.GraphCoordinate {
	return resolve.GraphCoordinate{TypeName: typeName, FieldName: fieldName}
}

func TestCosmoAuthorizer_AuthorizeObjectField(t *testing.T) {
	t.Parallel()

	employeeName := fieldConfig("Employee", "name", []string{"read:employee"})

	t.Run("denies unauthenticated request", func(t *testing.T) {
		t.Parallel()
		a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{FieldConfigurations: []*nodev1.FieldConfiguration{employeeName}})
		deny, err := a.AuthorizeObjectField(resolveContext(false), "ds", nil, coordinate("Employee", "name"))
		require.NoError(t, err)
		require.NotNil(t, deny)
		assert.Equal(t, "not authenticated", deny.Reason)
	})

	t.Run("allows field without authorization config", func(t *testing.T) {
		t.Parallel()
		a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{FieldConfigurations: []*nodev1.FieldConfiguration{employeeName}})
		deny, err := a.AuthorizeObjectField(resolveContext(true), "ds", nil, coordinate("Employee", "id"))
		require.NoError(t, err)
		assert.Nil(t, deny)
	})

	t.Run("allows when required scopes are present", func(t *testing.T) {
		t.Parallel()
		a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{FieldConfigurations: []*nodev1.FieldConfiguration{employeeName}})
		deny, err := a.AuthorizeObjectField(resolveContext(true, "read:employee"), "ds", nil, coordinate("Employee", "name"))
		require.NoError(t, err)
		assert.Nil(t, deny)
	})

	t.Run("denies when a required scope is missing", func(t *testing.T) {
		t.Parallel()
		a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{FieldConfigurations: []*nodev1.FieldConfiguration{employeeName}})
		deny, err := a.AuthorizeObjectField(resolveContext(true, "read:other"), "ds", nil, coordinate("Employee", "name"))
		require.NoError(t, err)
		require.NotNil(t, deny)
		assert.Equal(t, "missing required scopes", deny.Reason)
	})

	t.Run("requires all scopes in an AND group", func(t *testing.T) {
		t.Parallel()
		cfg := fieldConfig("Employee", "salary", []string{"read:employee", "read:salary"})
		a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{FieldConfigurations: []*nodev1.FieldConfiguration{cfg}})

		deny, err := a.AuthorizeObjectField(resolveContext(true, "read:employee"), "ds", nil, coordinate("Employee", "salary"))
		require.NoError(t, err)
		require.NotNil(t, deny, "partial AND group must not authorize")

		deny, err = a.AuthorizeObjectField(resolveContext(true, "read:employee", "read:salary"), "ds", nil, coordinate("Employee", "salary"))
		require.NoError(t, err)
		assert.Nil(t, deny)
	})

	t.Run("allows when any OR group matches", func(t *testing.T) {
		t.Parallel()
		cfg := fieldConfig("Employee", "salary", []string{"admin"}, []string{"read:employee", "read:salary"})
		a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{FieldConfigurations: []*nodev1.FieldConfiguration{cfg}})
		deny, err := a.AuthorizeObjectField(resolveContext(true, "admin"), "ds", nil, coordinate("Employee", "salary"))
		require.NoError(t, err)
		assert.Nil(t, deny)
	})
}

func TestCosmoAuthorizer_RejectUnauthorized(t *testing.T) {
	t.Parallel()

	cfg := fieldConfig("Employee", "name", []string{"read:employee"})

	t.Run("returns ErrUnauthorized on deny when enabled", func(t *testing.T) {
		t.Parallel()
		a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{
			FieldConfigurations:           []*nodev1.FieldConfiguration{cfg},
			RejectOperationIfUnauthorized: true,
		})
		deny, err := a.AuthorizeObjectField(resolveContext(true, "read:other"), "ds", nil, coordinate("Employee", "name"))
		require.ErrorIs(t, err, ErrUnauthorized)
		assert.Nil(t, deny)
	})

	t.Run("returns deny without error when disabled", func(t *testing.T) {
		t.Parallel()
		a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{
			FieldConfigurations:           []*nodev1.FieldConfiguration{cfg},
			RejectOperationIfUnauthorized: false,
		})
		deny, err := a.AuthorizeObjectField(resolveContext(true, "read:other"), "ds", nil, coordinate("Employee", "name"))
		require.NoError(t, err)
		require.NotNil(t, deny)
	})
}

func TestCosmoAuthorizer_AuthorizeFields(t *testing.T) {
	t.Parallel()

	configs := []*nodev1.FieldConfiguration{
		fieldConfig("Query", "employees", []string{"read:employees"}),
		fieldConfig("Employee", "salary", []string{"read:salary"}),
	}

	t.Run("returns one decision per coordinate in order", func(t *testing.T) {
		t.Parallel()
		a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{FieldConfigurations: configs})
		coordinates := []resolve.GraphCoordinate{
			coordinate("Query", "employees"),
			coordinate("Employee", "salary"),
			coordinate("Employee", "id"), // no authorization config
		}
		decisions, err := a.AuthorizeFields(resolveContext(true, "read:employees"), coordinates)
		require.NoError(t, err)
		require.Len(t, decisions, len(coordinates))

		assert.True(t, decisions[0].Allowed)
		assert.False(t, decisions[1].Allowed)
		assert.Equal(t, "missing required scopes", decisions[1].Reason)
		assert.True(t, decisions[2].Allowed, "field without authorization config is allowed")
	})

	t.Run("denies every coordinate when unauthenticated", func(t *testing.T) {
		t.Parallel()
		a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{FieldConfigurations: configs})
		coordinates := []resolve.GraphCoordinate{
			coordinate("Query", "employees"),
			coordinate("Employee", "salary"),
		}
		decisions, err := a.AuthorizeFields(resolveContext(false), coordinates)
		require.NoError(t, err)
		require.Len(t, decisions, len(coordinates))
		for _, d := range decisions {
			assert.False(t, d.Allowed)
			assert.Equal(t, "not authenticated", d.Reason)
		}
	})

	t.Run("returns error on first deny when reject is enabled", func(t *testing.T) {
		t.Parallel()
		a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{
			FieldConfigurations:           configs,
			RejectOperationIfUnauthorized: true,
		})
		coordinates := []resolve.GraphCoordinate{coordinate("Employee", "salary")}
		decisions, err := a.AuthorizeFields(resolveContext(true, "read:employees"), coordinates)
		require.ErrorIs(t, err, ErrUnauthorized)
		assert.Nil(t, decisions)
	})

	t.Run("returns empty slice for no coordinates", func(t *testing.T) {
		t.Parallel()
		a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{FieldConfigurations: configs})
		decisions, err := a.AuthorizeFields(resolveContext(true), nil)
		require.NoError(t, err)
		assert.Empty(t, decisions)
	})
}

func TestCosmoAuthorizer_ResponseExtension(t *testing.T) {
	t.Parallel()

	cfg := fieldConfig("Employee", "name", []string{"read:employee"})

	t.Run("no extension data without a deny", func(t *testing.T) {
		t.Parallel()
		a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{FieldConfigurations: []*nodev1.FieldConfiguration{cfg}})
		ctx := WithAuthorizationExtension(resolveContext(true, "read:employee"))
		_, err := a.AuthorizeObjectField(ctx, "ds", nil, coordinate("Employee", "name"))
		require.NoError(t, err)
		assert.False(t, a.HasResponseExtensionData(ctx))
	})

	t.Run("collects and renders missing scopes on deny", func(t *testing.T) {
		t.Parallel()
		a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{FieldConfigurations: []*nodev1.FieldConfiguration{cfg}})
		ctx := WithAuthorizationExtension(resolveContext(true, "read:other"))

		deny, err := a.AuthorizeObjectField(ctx, "ds", nil, coordinate("Employee", "name"))
		require.NoError(t, err)
		require.NotNil(t, deny)
		require.True(t, a.HasResponseExtensionData(ctx))

		var buf bytes.Buffer
		require.NoError(t, a.RenderResponseExtension(ctx, &buf))

		var ext AuthorizationExtension
		require.NoError(t, json.Unmarshal(buf.Bytes(), &ext))
		require.Len(t, ext.MissingScopes, 1)
		assert.Equal(t, "Employee", ext.MissingScopes[0].Coordinate.TypeName)
		assert.Equal(t, "name", ext.MissingScopes[0].Coordinate.FieldName)
		assert.Equal(t, [][]string{{"read:employee"}}, ext.MissingScopes[0].RequiredOrScopes)
		assert.Equal(t, []string{"read:other"}, ext.ActualScopes)
	})

	t.Run("deduplicates repeated coordinates", func(t *testing.T) {
		t.Parallel()
		a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{FieldConfigurations: []*nodev1.FieldConfiguration{cfg}})
		ctx := WithAuthorizationExtension(resolveContext(true, "read:other"))

		for i := 0; i < 3; i++ {
			_, err := a.AuthorizeObjectField(ctx, "ds", nil, coordinate("Employee", "name"))
			require.NoError(t, err)
		}

		var buf bytes.Buffer
		require.NoError(t, a.RenderResponseExtension(ctx, &buf))
		var ext AuthorizationExtension
		require.NoError(t, json.Unmarshal(buf.Bytes(), &ext))
		assert.Len(t, ext.MissingScopes, 1)
	})

	t.Run("render writes nothing without extension context", func(t *testing.T) {
		t.Parallel()
		a := NewCosmoAuthorizer(&CosmoAuthorizerOptions{FieldConfigurations: []*nodev1.FieldConfiguration{cfg}})
		var buf bytes.Buffer
		require.NoError(t, a.RenderResponseExtension(resolveContext(true), &buf))
		assert.Zero(t, buf.Len())
	})
}

func TestCosmoAuthorizer_IsPreFetchFieldAuthorizationEnabled(t *testing.T) {
	t.Parallel()
	enabled := NewCosmoAuthorizer(&CosmoAuthorizerOptions{EnablePreFetchFieldAuthorization: true})
	assert.True(t, enabled.IsPreFetchFieldAuthorizationEnabled())

	disabled := NewCosmoAuthorizer(&CosmoAuthorizerOptions{})
	assert.False(t, disabled.IsPreFetchFieldAuthorizationEnabled())
}
