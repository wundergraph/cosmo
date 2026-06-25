package core

// DEFER-AUDIT SIMULATION — TEST-ONLY, NOT A FIX.
//
// This file injects, ONLY when a request carries the `x-defer-sim` header, the
// error conditions that the @defer conformance audit (PR #1464) identified but
// which are otherwise not reachable from the demo's HTTP path because the demo
// wires no authorizer / rate-limiter / custom field-renderer. It does NOT change
// the @defer engine; it only triggers the existing (buggy) engine code paths so
// the corresponding audit findings become live, runnable RED tests:
//
//   x-defer-sim: authz-prefetch     -> AuthorizePreFetch returns a hard error
//                                       (audit F03 group-fetch-error-no-termination)
//   x-defer-sim: authz-objectfield  -> AuthorizeObjectField returns a hard error
//                                       (audit F04 deferred-render-auth-error-no-termination)
//   x-defer-sim: authz-deny-ancestor-> AuthorizeObjectField returns a deny
//                                       (audit F15 duplicate-auth-error-two-pass)
//   x-defer-sim: render-error       -> a custom FieldValueRenderer fails on Review.body
//                                       (audit F05 render-phase-printerr-no-termination)
//
// Without the header, the sim authorizer ALLOWS the single auth-ruled demo field
// (User.reviews, see defer-demo/subgraphs/reviews/schema.graphqls), so normal demo
// traffic is unaffected.

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

const deferSimHeader = "x-defer-sim"

func deferSimMode(h http.Header) string {
	if h == nil {
		return ""
	}
	return h.Get(deferSimHeader)
}

// isDeferSimAuthMode reports whether the request asks for an authorizer-based
// simulation (so the handler installs the sim authorizer even if none is configured).
func isDeferSimAuthMode(h http.Header) bool {
	switch deferSimMode(h) {
	case "authz-prefetch", "authz-objectfield", "authz-deny-ancestor":
		return true
	}
	return false
}

// deferSimAuthorizer overrides the router authorizer for the simulated cases.
// The engine only invokes it for fields that carry an authorization rule; in the
// demo that is exactly User.reviews.
type deferSimAuthorizer struct {
	mode string
}

func newDeferSimAuthorizer(h http.Header) resolve.Authorizer {
	return &deferSimAuthorizer{mode: deferSimMode(h)}
}

// AuthorizePreFetch: a non-nil error is returned by the loader as a hard fetch
// error BEFORE the deferred group's `remaining` decrement -> audit F03.
func (a *deferSimAuthorizer) AuthorizePreFetch(ctx *resolve.Context, dataSourceID string, input json.RawMessage, coordinate resolve.GraphCoordinate) (*resolve.AuthorizationDeny, error) {
	if a.mode == "authz-prefetch" {
		return nil, fmt.Errorf("defer-sim: simulated pre-fetch authorization error on %s.%s", coordinate.TypeName, coordinate.FieldName)
	}
	return nil, nil // allow (do not enforce) for normal traffic and the other sim modes
}

// AuthorizeObjectField: a non-nil error propagates out of ResolveDeferBatch before
// the per-defer envelope is written -> audit F04. A non-nil deny (err==nil) on a
// pass-through ancestor reproduces the two-pass duplicated error -> audit F15.
func (a *deferSimAuthorizer) AuthorizeObjectField(ctx *resolve.Context, dataSourceID string, object json.RawMessage, coordinate resolve.GraphCoordinate) (*resolve.AuthorizationDeny, error) {
	switch a.mode {
	case "authz-objectfield":
		return nil, fmt.Errorf("defer-sim: simulated object-field authorization error on %s.%s", coordinate.TypeName, coordinate.FieldName)
	case "authz-deny-ancestor":
		return &resolve.AuthorizationDeny{Reason: "defer-sim: simulated deny on pass-through ancestor"}, nil
	}
	return nil, nil
}

func (a *deferSimAuthorizer) HasResponseExtensionData(ctx *resolve.Context) bool { return false }

func (a *deferSimAuthorizer) RenderResponseExtension(ctx *resolve.Context, out io.Writer) error {
	return nil
}

// deferSimRenderer fails RenderFieldValue on a target field, setting r.printErr
// during the deferred render pass -> audit F05. Every other field renders with its
// raw JSON bytes (correct for the demo's scalars), so only the deferred target frame
// is affected.
type deferSimRenderer struct {
	targetField  string
	targetParent string
}

func newDeferSimRenderer(h http.Header) resolve.FieldValueRenderer {
	if deferSimMode(h) != "render-error" {
		return nil
	}
	return &deferSimRenderer{targetField: "body", targetParent: "Review"}
}

func (r *deferSimRenderer) RenderFieldValue(ctx *resolve.Context, value resolve.FieldValue, out io.Writer) error {
	if value.Name == r.targetField && (r.targetParent == "" || value.ParentType == r.targetParent) {
		return fmt.Errorf("defer-sim: simulated custom field-renderer error on %s.%s", value.ParentType, value.Name)
	}
	_, err := out.Write(value.Data)
	return err
}
