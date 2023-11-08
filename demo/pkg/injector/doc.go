// Package injector implements HTTP and WS middlewares that injects the request headers and the WS payload into the context.
//
// This is used in the demos to give the schema resolvers access to the request headers and the WS payload,
// since gqlgen doesn't expose this information.
package injector
