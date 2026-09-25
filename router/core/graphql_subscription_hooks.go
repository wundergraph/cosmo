package core

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"github.com/wundergraph/astjson"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

// GraphQLSubscriptionHookContext describes one downstream GraphQL subscription.
// It is independent of the upstream trigger, which may be shared by subscribers.
// Request and Operation are read-only and must not be retained after the hook returns.
// Operation provides the operation name, type, hash, content, variables, and
// ClientInfo; Authentication provides the authenticated identity and claims.
type GraphQLSubscriptionHookContext interface {
	Request() *http.Request
	Logger() *zap.Logger
	Operation() OperationContext
	Authentication() authentication.Authentication
	// SubscriptionInstanceID is unique to this downstream subscriber and is
	// identical in its start and end hooks, across all supported transports.
	SubscriptionInstanceID() string
	// RootFieldName is the non-empty schema field name, even if the client selected an alias.
	RootFieldName() string
	// RootFieldArguments contains the resolved arguments of the selected root
	// field as a JSON object. It is computed once per subscriber, not per event.
	// Like Operation.Variables, it can contain sensitive client input.
	RootFieldArguments() json.RawMessage
}

// SubscriptionOperationStartHandler runs once for each downstream GraphQL
// subscription, before it is registered with the resolver. Returning an error
// rejects only this subscription.
type SubscriptionOperationStartHandler interface {
	OnSubscriptionOperationStart(ctx GraphQLSubscriptionHookContext) error
}

// SubscriptionOperationEndHandler runs once for each downstream GraphQL
// subscription after it is removed from the resolver. It also runs for a
// successful start that fails during subsequent setup.
type SubscriptionOperationEndHandler interface {
	OnSubscriptionOperationEnd(ctx GraphQLSubscriptionHookContext)
}

type graphqlSubscriptionLifecycleHandler struct {
	onStart func(GraphQLSubscriptionHookContext) error
	onEnd   func(GraphQLSubscriptionHookContext)
}

type graphqlSubscriptionHookContext struct {
	request            *http.Request
	logger             *zap.Logger
	operation          OperationContext
	authentication     authentication.Authentication
	instanceID         string
	rootFieldName      string
	rootFieldArguments json.RawMessage
}

func (c *graphqlSubscriptionHookContext) Request() *http.Request { return c.request }
func (c *graphqlSubscriptionHookContext) Logger() *zap.Logger    { return c.logger }
func (c *graphqlSubscriptionHookContext) Operation() OperationContext {
	return c.operation
}
func (c *graphqlSubscriptionHookContext) Authentication() authentication.Authentication {
	return c.authentication
}
func (c *graphqlSubscriptionHookContext) SubscriptionInstanceID() string { return c.instanceID }
func (c *graphqlSubscriptionHookContext) RootFieldName() string          { return c.rootFieldName }
func (c *graphqlSubscriptionHookContext) RootFieldArguments() json.RawMessage {
	return c.rootFieldArguments
}

func subscriptionRootFieldArguments(operation *operationContext, rootFieldName string) (json.RawMessage, error) {
	if operation == nil {
		return nil, fmt.Errorf("subscription operation is missing")
	}
	doc, report := astparser.ParseGraphqlDocumentString(operation.Content())
	if report.HasErrors() {
		return nil, fmt.Errorf("parse subscription arguments: %s", report.Error())
	}
	// The normalized operation uses remapped variable names, while the request
	// variable object retains its original names. Build the view expected by
	// ast.Document.ValueToJSON so nested input objects resolve correctly too.
	variables := make(map[string]json.RawMessage)
	if operation.variables != nil && operation.variables.GetObject() != nil {
		operation.variables.GetObject().Visit(func(key []byte, value *astjson.Value) {
			variables[string(key)] = value.MarshalTo(nil)
		})
	}
	for newName, oldName := range operation.remapVariables {
		if value, ok := variables[oldName]; ok {
			variables[newName] = value
		}
	}
	var err error
	doc.Input.Variables, err = json.Marshal(variables)
	if err != nil {
		return nil, err
	}
	for _, node := range doc.RootNodes {
		if node.Kind != ast.NodeKindOperationDefinition {
			continue
		}
		definition := doc.OperationDefinitions[node.Ref]
		if definition.OperationType != ast.OperationTypeSubscription {
			continue
		}
		for _, selectionRef := range doc.SelectionSets[definition.SelectionSet].SelectionRefs {
			selection := doc.Selections[selectionRef]
			if selection.Kind != ast.SelectionKindField || doc.FieldNameString(selection.Ref) != rootFieldName {
				continue
			}
			arguments := make(map[string]json.RawMessage)
			for _, argRef := range doc.FieldArguments(selection.Ref) {
				value, valueErr := doc.ValueToJSON(doc.ArgumentValue(argRef))
				if valueErr != nil {
					return nil, fmt.Errorf("resolve subscription argument %s: %w", doc.ArgumentNameString(argRef), valueErr)
				}
				arguments[doc.ArgumentNameString(argRef)] = value
			}
			return json.Marshal(arguments)
		}
	}
	return nil, fmt.Errorf("subscription root field %q not found in operation", rootFieldName)
}

func subscriptionRootFieldName(subscription *resolve.GraphQLSubscription) (string, error) {
	if subscription == nil || subscription.Response == nil || subscription.Response.Data == nil || len(subscription.Response.Data.Fields) == 0 {
		return "", fmt.Errorf("subscription plan has no root field")
	}
	field := subscription.Response.Data.Fields[0]
	if field == nil || field.Info == nil || field.Info.Name == "" {
		return "", fmt.Errorf("subscription plan has no root field name")
	}
	return field.Info.Name, nil
}

// startGraphQLSubscriptionHooks returns an exactly-once end function. The
// resolver calls it after removal; callers also call it on setup failure.
func startGraphQLSubscriptionHooks(handlers []graphqlSubscriptionLifecycleHandler, ctx GraphQLSubscriptionHookContext) (end func(), err error) {
	if len(handlers) == 0 {
		return nil, nil
	}

	completed := make([]func(GraphQLSubscriptionHookContext), 0, len(handlers))
	var once sync.Once
	end = func() {
		once.Do(func() {
			for i := len(completed) - 1; i >= 0; i-- {
				invokeGraphQLSubscriptionEnd(completed[i], ctx)
			}
		})
	}

	for _, handler := range handlers {
		if handler.onStart != nil {
			if err = invokeGraphQLSubscriptionStart(handler.onStart, ctx); err != nil {
				end()
				return nil, err
			}
		}
		if handler.onEnd != nil {
			completed = append(completed, handler.onEnd)
		}
	}

	return end, nil
}

func invokeGraphQLSubscriptionStart(fn func(GraphQLSubscriptionHookContext) error, ctx GraphQLSubscriptionHookContext) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("GraphQL subscription start hook panicked: %v", recovered)
		}
	}()
	return fn(ctx)
}

func invokeGraphQLSubscriptionEnd(fn func(GraphQLSubscriptionHookContext), ctx GraphQLSubscriptionHookContext) {
	defer func() {
		if recovered := recover(); recovered != nil && ctx.Logger() != nil {
			ctx.Logger().Error("GraphQL subscription end hook panicked", zap.Any("panic", recovered))
		}
	}()
	fn(ctx)
}
