package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
)

// newCursors builds what data sources need to issue cursors from the config.
// Without keys cursors are disabled.
func newCursors(cfg config.CursorResumeConfiguration, logger *zap.Logger) (datasource.Cursors, error) {
	if len(cfg.Keys) == 0 {
		return datasource.Cursors{}, nil
	}

	keys := make([]datasource.CursorKey, 0, len(cfg.Keys))
	for _, k := range cfg.Keys {
		keys = append(keys, datasource.CursorKey{
			ID:        k.ID,
			Secret:    []byte(k.Secret),
			ExpiresAt: k.ExpiresAt,
		})
	}
	codec, err := datasource.NewCursorCodec(keys, cfg.MaxResumeWindow)
	if err != nil {
		return datasource.Cursors{}, fmt.Errorf("invalid cursor keys: %w", err)
	}

	return datasource.Cursors{
		Codec:             codec,
		SubscriberBinding: newSubscriberBindingFunc(cfg.IdentityClaim, logger),
	}, nil
}

type missingIdentityClaimError struct {
	claim string
}

func (e *missingIdentityClaimError) Error() string {
	return fmt.Sprintf("authenticated request has no %q claim", e.claim)
}

// newSubscriberBindingFunc returns the function that binds the cursors of a subscriber
// to its client identity.
func newSubscriberBindingFunc(identityClaim string, logger *zap.Logger) datasource.SubscriberBindingFunc {
	return func(ctx context.Context) (datasource.ClientIdentity, error) {
		reqCtx := getRequestContext(ctx)
		if reqCtx == nil {
			return datasource.ClientIdentity{}, errors.New("request context is missing")
		}

		auth := reqCtx.Authentication()
		identity, err := cursorClientIdentity(auth, identityClaim)
		if err != nil {
			if _, ok := errors.AsType[*missingIdentityClaimError](err); !ok {
				return datasource.ClientIdentity{}, err
			}
			// Never log claim values, they may contain personal data.
			logger.Warn("Cursors can't be bound to an authenticated request without the identity claim",
				zap.String("authenticator", auth.Authenticator()),
				zap.String("identity_claim", identityClaim),
			)
			return datasource.ClientIdentity{}, &datasource.DeliveryGuaranteeError{
				Code:    datasource.DeliveryGuaranteeErrorCodeUnsatisfiable,
				Message: fmt.Sprintf("The requested delivery guarantee can't be satisfied: the authenticated request has no %q claim", identityClaim),
			}
		}

		return identity, nil
	}
}

// cursorClientIdentity extracts the identity a cursor is bound to from the authentication of a request.
// A request without authentication information is anonymous.
func cursorClientIdentity(auth authentication.Authentication, identityClaim string) (datasource.ClientIdentity, error) {
	if auth == nil {
		return datasource.ClientIdentity{}, nil
	}
	claims := auth.Claims()
	// Custom modules setting scopes on an anonymous request create an empty authentication.
	if auth.Authenticator() == "" && len(claims) == 0 {
		return datasource.ClientIdentity{}, nil
	}

	subject, ok := claims[identityClaim]
	if !ok || subject == nil {
		return datasource.ClientIdentity{}, &missingIdentityClaimError{claim: identityClaim}
	}

	return datasource.ClientIdentity{
		Authenticated: true,
		Authenticator: auth.Authenticator(),
		Issuer:        claimString(claims["iss"]),
		Audience:      claimStrings(claims["aud"]),
		Subject:       claimString(subject),
	}, nil
}

// claimString returns string claims as they are and JSON-encodes all other claims.
func claimString(v any) string {
	switch v := v.(type) {
	case nil:
		return ""
	case string:
		return v
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return fmt.Sprint(v)
		}
		return string(b)
	}
}

// claimStrings returns a list claim like aud as strings. A single value is a list of one.
func claimStrings(v any) []string {
	switch v := v.(type) {
	case nil:
		return nil
	case []string:
		return v
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			out = append(out, claimString(item))
		}
		return out
	default:
		return []string{claimString(v)}
	}
}
