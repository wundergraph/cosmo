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
	// RootFieldArguments resolves the selected root field's argument values as
	// a JSON object, including field defaults when an argument was omitted.
	// Resolution is lazy and cached only for this hook invocation, not for the
	// lifetime of the subscription or for each event. The returned bytes are
	// read-only and may contain sensitive client input; copy them to retain
	// them after the hook returns.
	RootFieldArguments() (json.RawMessage, error)
}

// SubscriptionOperationStartHandler runs once for each downstream GraphQL
// subscription, before it is registered with the resolver. Returning an error
// rejects only this subscription. Request authentication has run, but engine
// field authorization may run later; hooks must not assume it has succeeded.
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
	request           *http.Request
	logger            *zap.Logger
	operation         OperationContext
	authentication    authentication.Authentication
	instanceID        string
	rootFieldName     string
	argumentOperation *operationContext
	schema            *ast.Document
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
func (c *graphqlSubscriptionHookContext) RootFieldArguments() (json.RawMessage, error) {
	return subscriptionRootFieldArguments(c.argumentOperation, c.schema, c.rootFieldName)
}

// Each hook phase gets its own cache. The end closure retains only the base
// context, so a resolved JSON value from the start phase is not retained for
// the lifetime of a long-running subscription.
type graphqlSubscriptionHookInvocation struct {
	GraphQLSubscriptionHookContext
	once      sync.Once
	arguments json.RawMessage
	err       error
}

func (c *graphqlSubscriptionHookInvocation) RootFieldArguments() (json.RawMessage, error) {
	c.once.Do(func() {
		c.arguments, c.err = c.GraphQLSubscriptionHookContext.RootFieldArguments()
	})
	return c.arguments, c.err
}

// subscriptionRootFieldArguments resolves the selected root field's arguments
// from the normalized operation and its request-scoped variables.
func subscriptionRootFieldArguments(operation *operationContext, schema *ast.Document, rootFieldName string) (json.RawMessage, error) {
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
	originalVariables := make(map[string]json.RawMessage)
	if operation.variables != nil && operation.variables.GetObject() != nil {
		operation.variables.GetObject().Visit(func(key []byte, value *astjson.Value) {
			originalVariables[string(key)] = value.MarshalTo(nil)
		})
	}
	variables := make(map[string]json.RawMessage, len(originalVariables)+len(operation.remapVariables))
	for name, value := range originalVariables {
		variables[name] = value
	}
	// A generated name may also be an original name for another variable.
	// Clear every remapped destination before populating it from the unchanged
	// source map, so an omitted source cannot leave a stale value behind.
	for newName := range operation.remapVariables {
		delete(variables, newName)
	}
	for newName, oldName := range operation.remapVariables {
		if value, ok := originalVariables[oldName]; ok {
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
				argValue := doc.ArgumentValue(argRef)
				if argValue.Kind == ast.ValueKindVariable {
					variableName := doc.VariableValueNameString(argValue.Ref)
					if _, provided := variables[variableName]; !provided {
						continue // An omitted variable is not an explicit null.
					}
				}
				value, valueErr := doc.ValueToJSON(argValue)
				if valueErr != nil {
					return nil, fmt.Errorf("resolve subscription argument %s: %w", doc.ArgumentNameString(argRef), valueErr)
				}
				arguments[doc.ArgumentNameString(argRef)] = value
			}
			if schema != nil {
				subscriptionTypeName := schema.Index.SubscriptionTypeName
				if len(subscriptionTypeName) == 0 {
					subscriptionTypeName = ast.DefaultSubscriptionTypeName
				}
				if subscriptionType, exists := schema.Index.FirstNodeByNameBytes(subscriptionTypeName); exists {
					for _, definitionRef := range schema.NodeFieldDefinitionArgumentsDefinitions(subscriptionType, []byte(rootFieldName)) {
						name := schema.InputValueDefinitionNameString(definitionRef)
						if _, provided := arguments[name]; provided || !schema.InputValueDefinitionHasDefaultValue(definitionRef) {
							continue
						}
						value, valueErr := schema.ValueToJSON(schema.InputValueDefinitionDefaultValue(definitionRef))
						if valueErr != nil {
							return nil, fmt.Errorf("resolve subscription argument default %s: %w", name, valueErr)
						}
						arguments[name] = value
					}
				}
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

	type completedHook struct {
		onEnd      func(GraphQLSubscriptionHookContext)
		hasStarted bool
	}
	completed := make([]completedHook, 0, len(handlers))
	allStartsSucceeded := false
	var once sync.Once
	end = func() {
		once.Do(func() {
			endCtx := &graphqlSubscriptionHookInvocation{GraphQLSubscriptionHookContext: ctx}
			for i := len(completed) - 1; i >= 0; i-- {
				// An end-only module has no startup work to unwind when a
				// later module rejects the subscription.
				if !allStartsSucceeded && !completed[i].hasStarted {
					continue
				}
				invokeGraphQLSubscriptionEnd(completed[i].onEnd, endCtx)
			}
		})
	}

	startCtx := &graphqlSubscriptionHookInvocation{GraphQLSubscriptionHookContext: ctx}
	for _, handler := range handlers {
		if handler.onStart != nil {
			if err = invokeGraphQLSubscriptionStart(handler.onStart, startCtx); err != nil {
				end()
				return nil, err
			}
		}
		if handler.onEnd != nil {
			completed = append(completed, completedHook{onEnd: handler.onEnd, hasStarted: handler.onStart != nil})
		}
	}

	allStartsSucceeded = true
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
