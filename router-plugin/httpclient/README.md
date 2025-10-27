# HTTP Client Package

A developer-friendly HTTP client package for the Cosmo Router Plugin. This package provides a simple, flexible, and feature-rich HTTP client implementation with a modern approach using functional options and generics.

## Features

- Simple, fluent API for making HTTP requests
- Function options pattern for configuration
- Context support for cancellation and timeouts
- Middleware support for request customization
- Generic response handling
- Built-in middleware implementations for common use cases
- Comprehensive test coverage

## Installation

```bash
go get github.com/wundergraph/cosmo/router-plugin
```

## Basic Usage

```go
package main

import (
	"context"
	"fmt"
	"time"

	"github.com/wundergraph/cosmo/router-plugin/httpclient"
)

func main() {
	// Create HTTP client with configuration options
	client := httpclient.New(
		httpclient.WithBaseURL("https://api.example.com"),
		httpclient.WithTimeout(10 * time.Second),
		httpclient.WithHeader("Accept", "application/json"),
	)

	// Create a context
	ctx := context.Background()

	// Make a GET request
	resp, err := client.Get(ctx, "/users/1")
	if err != nil {
		panic(err)
	}

	// Check if the request was successful
	if !resp.IsSuccess() {
		fmt.Printf("Request failed with status code: %d\n", resp.StatusCode)
		return
	}

	// Parse the response into a struct using generics
	type User struct {
		ID    int    `json:"id"`
		Name  string `json:"name"`
		Email string `json:"email"`
	}

	user, err := httpclient.UnmarshalTo[User](resp)
	if err != nil {
		panic(err)
	}

	fmt.Printf("User: %s (Email: %s)\n", user.Name, user.Email)
}
```

## Advanced Usage

### Middleware

The client supports middleware for request customization:

```go
// Create a client with middleware
client := httpclient.New(
	httpclient.WithBaseURL("https://api.example.com"),
	httpclient.WithMiddleware(httpclient.AuthBearerMiddleware("your-token")),
	httpclient.WithMiddleware(httpclient.UserAgentMiddleware("MyApp/1.0")),
)
```

### Request-specific options

You can add headers or other options to specific requests:

```go
// Make a request with specific headers
resp, err := client.Get(ctx, "/users/1", 
	httpclient.WithRequestHeader("X-Request-ID", "12345"),
)
```

### POST requests with JSON body

```go
// Create request body
newUser := struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}{
	Name:  "John Doe",
	Email: "john@example.com",
}

// Send POST request
resp, err := client.Post(ctx, "/users", newUser)
```

## Middleware Implementations

The package includes several built-in middleware implementations:

- `AuthBearerMiddleware`: Adds a Bearer token to the Authorization header
- `BasicAuthMiddleware`: Adds basic authentication to the request

## Custom Middleware

You can create your own middleware:

```go
// Create a custom middleware
customMiddleware := func(req *http.Request) (*http.Request, error) {
	// Customize the request
	req.Header.Set("X-Custom-Header", "custom-value")
	return req, nil
}

// Add the middleware to the client
client := httpclient.New(
	httpclient.WithMiddleware(customMiddleware),
)
```

## Error Handling

The client returns comprehensive errors that can be unwrapped:

```go
resp, err := client.Get(ctx, "/users/1")
if err != nil {
	// Check for specific error types
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		fmt.Printf("URL error: %v\n", urlErr)
	} else {
		fmt.Printf("Other error: %v\n", err)
	}
	return
}
```

## Response Helpers

The `Response` type provides helper methods:

- `Unmarshal(v interface{})`: Decodes the response body into a struct
- `String()`: Returns the response body as a string
- `IsSuccess()`: Returns true if the status code is in the 2xx range