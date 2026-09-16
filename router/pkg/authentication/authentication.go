package authentication

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

type Claims map[string]any

const DefaultScopeClaim = "scope"

// Provider is an interface that represents entities that might provide
// authentication information. If no authentication information is available,
// the AuthenticationHeaders method should return nil.
type Provider interface {
	AuthenticationHeaders() http.Header
}

// Authenticator represents types that given a Provider, can authenticate it.
// If no authentication information is available, the Authenticate method
// should return nil without any errors.
type Authenticator interface {
	Name() string
	Authenticate(ctx context.Context, p Provider) (Claims, error)
}

type Authentication interface {
	// Authenticator returns the name of the Authenticator that authenticated
	// the request.
	Authenticator() string
	// Claims returns the claims of the authenticated request, as returned by
	// the Authenticator.
	Claims() Claims
	// SetScopes sets the scopes of the authenticated request. It will replace the scopes already parsed from the claims.
	// If users desire to append the scopes, they can first run `Scopes` to get the current scopes, and then append the new scopes
	SetScopes(scopes []string)
	// Scopes returns the scopes of the authenticated request, as returned by
	// the Authenticator.
	Scopes() []string
}

type authentication struct {
	authenticator string
	claims        Claims
	scopeClaim    string
}

func (a *authentication) Authenticator() string {
	return a.authenticator
}

func (a *authentication) Claims() Claims {
	if a == nil {
		return nil
	}
	return a.claims
}

func (a *authentication) SetScopes(scopes []string) {
	if a == nil {
		return
	}
	if a.claims == nil {
		a.claims = make(Claims)
	}
	// per https://datatracker.ietf.org/doc/html/rfc8693#section-2.1-4.8, scopes should be space separated
	a.claims[a.scopeClaim] = strings.Join(scopes, " ")
}

// Scopes returns the scopes of the request, or nil if the scope claim could not be read. Callers
// that need to tell an unreadable claim from an absent one should use [ScopesFromClaims].
func (a *authentication) Scopes() []string {
	if a == nil {
		return nil
	}
	scopes, err := ScopesFromClaims(a.claims, a.scopeClaim)
	if err != nil {
		return nil
	}
	return scopes
}

// ErrInvalidScopeClaim is returned when the scope claim is present but not in a readable encoding.
var ErrInvalidScopeClaim = errors.New("invalid scope claim")

// ScopesFromClaims reads the scope claim. RFC 8693 defines it as a space delimited string, but
// some IdPs (Duende IdentityServer and others in the .NET ecosystem) emit a JSON array instead,
// so both encodings are accepted. An absent claim yields no scopes and no error; a claim in any
// other encoding, including an array holding a non-string member, is rejected rather than read
// partially, since silently dropping a scope grants less access than the token was issued for.
func ScopesFromClaims(claims Claims, scopeClaim string) ([]string, error) {
	if scopeClaim == "" {
		scopeClaim = DefaultScopeClaim
	}
	switch v := claims[scopeClaim].(type) {
	case nil:
		return nil, nil
	case string:
		return strings.Fields(v), nil
	case []string:
		return v, nil
	case []any:
		scopes := make([]string, 0, len(v))
		for i, scope := range v {
			s, ok := scope.(string)
			if !ok {
				return nil, fmt.Errorf("%w: member %d has type %T, expected string", ErrInvalidScopeClaim, i, scope)
			}
			scopes = append(scopes, s)
		}
		return scopes, nil
	default:
		return nil, fmt.Errorf("%w: claim has type %T, expected string or array", ErrInvalidScopeClaim, v)
	}
}

var errUnacceptableAud = errors.New("audience match not found")

// Authenticate tries to authenticate the given Provider using the given authenticators. If any of
// the authenticators succeeds, the Authentication result is returned with no error. If the Provider
// has no authentication information, the Authentication result is nil with no error. If the authentication
// information is present but some or all of the authenticators fail to validate it, then a non-nil error
// will be produced.
func Authenticate(ctx context.Context, authenticators []Authenticator, p Provider, scopeClaim string) (Authentication, error) {
	if scopeClaim == "" {
		scopeClaim = DefaultScopeClaim
	}
	var joinedErrors error
	for _, auth := range authenticators {
		claims, err := auth.Authenticate(ctx, p)
		if err != nil {
			// If authentication fails for one provider, we try the
			// rest before returning an error.
			joinedErrors = errors.Join(joinedErrors, err)
			continue
		}

		// Claims is nil when no authentication information matched the authenticator.
		// In that case, we continue to the next authenticator.
		if claims == nil {
			continue
		}

		// If authentication succeeds, we return the authentication for the first provider.
		return &authentication{
			authenticator: auth.Name(),
			claims:        claims,
			scopeClaim:    scopeClaim,
		}, nil
	}
	// If no authentication failed error will be nil here,
	// even if to claims were found.
	return nil, joinedErrors
}

func NewEmptyAuthentication(scopeClaim string) Authentication {
	return &authentication{
		scopeClaim: scopeClaim,
	}
}
