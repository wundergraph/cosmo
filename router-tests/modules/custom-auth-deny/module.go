package custom_auth_deny

import (
	"net/http"

	"github.com/wundergraph/cosmo/router/core"
)

type MockHttpError struct {
	MessageText        string
	Code               int
	ExtensionCodeValue string
}

func (e *MockHttpError) Error() string {
	return e.MessageText
}

func (e *MockHttpError) StatusCode() int {
	return e.Code
}

func (e *MockHttpError) Message() string {
	return e.MessageText
}

func (e *MockHttpError) ExtensionCode() string {
	return e.ExtensionCodeValue
}

const myModuleID = "authDenyModule"

type AuthDenyModule struct{}

func (m *AuthDenyModule) Middleware(ctx core.RequestContext, next http.Handler) {
	if ctx.Request().Header.Get("foo-header") == "" {
		err := &MockHttpError{
			MessageText:        "Missing Authorization header",
			Code:               http.StatusUnauthorized,
			ExtensionCodeValue: "UNAUTHORIZED",
		}
		core.WriteResponseError(ctx, err)
		return
	}

	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

func (m *AuthDenyModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       myModuleID,
		Priority: 1,
		New: func() core.Module {
			return &AuthDenyModule{}
		},
	}
}

// Interface guard
var _ core.RouterMiddlewareHandler = (*AuthDenyModule)(nil)
