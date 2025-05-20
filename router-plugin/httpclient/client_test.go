package httpclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type TestResponse struct {
	Message string `json:"message"`
	Status  string `json:"status"`
}

func TestClientGet(t *testing.T) {
	// Create a test server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check request method
		if r.Method != http.MethodGet {
			t.Errorf("Expected method GET, got %s", r.Method)
		}

		// Check path
		if r.URL.Path != "/test" {
			t.Errorf("Expected path /test, got %s", r.URL.Path)
		}

		// Write response
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(TestResponse{
			Message: "Hello, World!",
			Status:  "success",
		})
	}))
	defer server.Close()

	// Create client with base URL
	client := New(WithBaseURL(server.URL))

	// Make request
	ctx := context.Background()
	response, err := client.Get(ctx, "/test")

	// Check for errors
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// Check status code
	if response.StatusCode != http.StatusOK {
		t.Errorf("Expected status code %d, got %d", http.StatusOK, response.StatusCode)
	}

	// Check response body
	var result TestResponse
	err = response.Unmarshal(&result)
	if err != nil {
		t.Fatalf("Error unmarshaling response: %v", err)
	}

	if result.Message != "Hello, World!" {
		t.Errorf("Expected message 'Hello, World!', got '%s'", result.Message)
	}

	if result.Status != "success" {
		t.Errorf("Expected status 'success', got '%s'", result.Status)
	}

	// Test generic unmarshaling
	resultGeneric, err := UnmarshalTo[TestResponse](response)
	if err != nil {
		t.Fatalf("Error with generic unmarshaling: %v", err)
	}

	if resultGeneric.Message != "Hello, World!" {
		t.Errorf("Expected message 'Hello, World!', got '%s'", resultGeneric.Message)
	}
}

func TestClientPost(t *testing.T) {
	// Create request body
	requestBody := struct {
		Name  string `json:"name"`
		Email string `json:"email"`
	}{
		Name:  "Test User",
		Email: "test@example.com",
	}

	// Create a test server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check request method
		if r.Method != http.MethodPost {
			t.Errorf("Expected method POST, got %s", r.Method)
		}

		// Check content type
		contentType := r.Header.Get("Content-Type")
		if contentType != "application/json" {
			t.Errorf("Expected Content-Type application/json, got %s", contentType)
		}

		// Decode request body
		var receivedBody struct {
			Name  string `json:"name"`
			Email string `json:"email"`
		}
		if err := json.NewDecoder(r.Body).Decode(&receivedBody); err != nil {
			t.Fatalf("Error decoding request body: %v", err)
		}

		// Check request body
		if receivedBody.Name != requestBody.Name {
			t.Errorf("Expected name %s, got %s", requestBody.Name, receivedBody.Name)
		}

		if receivedBody.Email != requestBody.Email {
			t.Errorf("Expected email %s, got %s", requestBody.Email, receivedBody.Email)
		}

		// Write response
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(TestResponse{
			Message: "User created",
			Status:  "success",
		})
	}))
	defer server.Close()

	// Create client with base URL
	client := New(WithBaseURL(server.URL))

	// Make request
	ctx := context.Background()
	response, err := client.Post(ctx, "/users", requestBody)

	// Check for errors
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// Check status code
	if response.StatusCode != http.StatusCreated {
		t.Errorf("Expected status code %d, got %d", http.StatusCreated, response.StatusCode)
	}

	// Check response body
	var result TestResponse
	err = response.Unmarshal(&result)
	if err != nil {
		t.Fatalf("Error unmarshaling response: %v", err)
	}

	if result.Message != "User created" {
		t.Errorf("Expected message 'User created', got '%s'", result.Message)
	}
}

func TestClientOptions(t *testing.T) {
	// Create a test server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check headers
		if r.Header.Get("X-API-Key") != "test-api-key" {
			t.Errorf("Expected X-API-Key header with value 'test-api-key', got '%s'", r.Header.Get("X-API-Key"))
		}

		if r.Header.Get("User-Agent") != "TestClient/1.0" {
			t.Errorf("Expected User-Agent header with value 'TestClient/1.0', got '%s'", r.Header.Get("User-Agent"))
		}

		// Check request-specific header
		if r.Header.Get("X-Request-ID") != "123456" {
			t.Errorf("Expected X-Request-ID header with value '123456', got '%s'", r.Header.Get("X-Request-ID"))
		}

		// Write response
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))
	defer server.Close()

	// Create client with options
	client := New(
		WithBaseURL(server.URL),
		WithTimeout(5*time.Second),
		WithHeader("X-API-Key", "test-api-key"),
		WithHeader("User-Agent", "TestClient/1.0"),
	)

	// Make request with request-specific options
	ctx := context.Background()
	response, err := client.Get(ctx, "/test", WithRequestHeader("X-Request-ID", "123456"))

	// Check for errors
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// Check status code
	if response.StatusCode != http.StatusOK {
		t.Errorf("Expected status code %d, got %d", http.StatusOK, response.StatusCode)
	}
}

func TestClientMiddleware(t *testing.T) {
	// Create a test server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check Authorization header
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("Expected Authorization header with value 'Bearer test-token', got '%s'", r.Header.Get("Authorization"))
		}

		// Write response
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))
	defer server.Close()

	// Create a client with middleware
	client := New(
		WithBaseURL(server.URL),
		WithMiddleware(AuthBearerMiddleware("test-token")),
	)

	// Make request
	ctx := context.Background()
	response, err := client.Get(ctx, "/test")

	// Check for errors
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// Check status code
	if response.StatusCode != http.StatusOK {
		t.Errorf("Expected status code %d, got %d", http.StatusOK, response.StatusCode)
	}
}

func TestResponseHelpers(t *testing.T) {
	// Create a response
	response := &Response{
		StatusCode: http.StatusOK,
		Headers:    http.Header{"Content-Type": []string{"application/json"}},
		Body:       []byte(`{"message":"Hello, World!","status":"success"}`),
	}

	// Test IsSuccess
	if !response.IsSuccess() {
		t.Errorf("Expected IsSuccess to return true for status code %d", http.StatusOK)
	}

	// Create a failed response
	failedResponse := &Response{
		StatusCode: http.StatusBadRequest,
		Headers:    http.Header{},
		Body:       []byte(`{"error":"Bad Request"}`),
	}

	// Test IsSuccess for failed response
	if failedResponse.IsSuccess() {
		t.Errorf("Expected IsSuccess to return false for status code %d", http.StatusBadRequest)
	}

	// Test String
	expected := `{"message":"Hello, World!","status":"success"}`
	if response.String() != expected {
		t.Errorf("Expected String to return '%s', got '%s'", expected, response.String())
	}
}
