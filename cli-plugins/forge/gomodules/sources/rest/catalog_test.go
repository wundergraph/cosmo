package restsource

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

// These tests are about the sample API in testdata/openapi.yaml, which the files in this directory were
// generated from.

func restAPI(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return server
}

func expectJSON(t *testing.T, response *dynamicpb.Message, want string) {
	t.Helper()

	encoded, err := protojson.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}

	var got, expected any
	if err := json.Unmarshal(encoded, &got); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(want), &expected); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, expected) {
		t.Fatalf("want %s, got %s", want, encoded)
	}
}

func setString(request *dynamicpb.Message, field string, value string) {
	request.Set(request.Descriptor().Fields().ByName(protoreflect.Name(field)), protoreflect.ValueOfString(value))
}

func TestCatalogItemIsReadFromTheRESTAPI(t *testing.T) {
	var paths []string
	started := startSubgraph(t, restAPI(t, func(writer http.ResponseWriter, request *http.Request) {
		paths = append(paths, request.Method+" "+request.URL.Path)
		_, _ = writer.Write([]byte(`{
			"item_id": "42",
			"display_name": "Field Guide",
			"tags": ["books"],
			"warehouse": {"code": "south", "aisle": 7},
			"internal_cost": 3
		}`))
	}))

	response, err := started.invoke("QueryCatalogItem", func(request *dynamicpb.Message) {
		setString(request, "id", "42")
	})
	if err != nil {
		t.Fatal(err)
	}

	if !reflect.DeepEqual(paths, []string{"GET /v1/items/42"}) {
		t.Fatalf("want one GET /v1/items/42, got %v", paths)
	}
	expectJSON(t, response, `{"catalogItem": {
		"itemId": "42",
		"displayName": "Field Guide",
		"tags": ["books"],
		"warehouse": {"code": "south"}
	}}`)
}

func TestAMissingItemIsNull(t *testing.T) {
	started := startSubgraph(t, restAPI(t, func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusNotFound)
	}))

	response, err := started.invoke("QueryCatalogItem", func(request *dynamicpb.Message) {
		setString(request, "id", "missing")
	})
	if err != nil {
		t.Fatal(err)
	}

	expectJSON(t, response, `{}`)
}

func TestItemsSendsOnlyTheArgumentsThatWereGiven(t *testing.T) {
	var queries []string
	started := startSubgraph(t, restAPI(t, func(writer http.ResponseWriter, request *http.Request) {
		queries = append(queries, request.URL.RawQuery)
		_, _ = writer.Write([]byte(`[{"item_id": "1", "tags": []}, {"item_id": "2", "price": 9.5, "tags": ["a", "b"]}]`))
	}))

	response, err := started.invoke("QueryItems", func(request *dynamicpb.Message) {
		limit := request.Descriptor().Fields().ByName("limit")
		wrapper := request.Mutable(limit).Message()
		wrapper.Set(limit.Message().Fields().ByName("value"), protoreflect.ValueOfInt32(2))
	})
	if err != nil {
		t.Fatal(err)
	}

	if !reflect.DeepEqual(queries, []string{"limit=2"}) {
		t.Fatalf("want the query limit=2, got %v", queries)
	}
	expectJSON(t, response, `{"items": [
		{"itemId": "1"},
		{"itemId": "2", "price": 9.5, "tags": ["a", "b"]}
	]}`)
}

func TestAFailingRESTAPIIsAnErrorThatNamesTheOperation(t *testing.T) {
	started := startSubgraph(t, restAPI(t, func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusServiceUnavailable)
	}))

	_, err := started.invoke("QueryCatalogItem", func(request *dynamicpb.Message) {
		setString(request, "id", "42")
	})

	if status.Code(err) != codes.Unavailable {
		t.Fatalf("want Unavailable, got %v", err)
	}
	if status.Convert(err).Message() != "GET /v1/items/{id} returned 503" {
		t.Fatalf("want the operation and status in the message, got %q", status.Convert(err).Message())
	}
}

func TestConfiguredHeadersReachTheRESTAPI(t *testing.T) {
	var authorization string
	api := restAPI(t, func(writer http.ResponseWriter, request *http.Request) {
		authorization = request.Header.Get("Authorization")
		_, _ = writer.Write([]byte(`{"item_id": "42", "tags": []}`))
	})

	loaded, err := loadSpec(operationsJSON)
	if err != nil {
		t.Fatal(err)
	}

	// Find a free port, then serve on it the way Provision does.
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := probe.Addr().String()
	_ = probe.Close()

	active.Store(&upstream{
		baseURL: api.URL,
		headers: map[string]string{"Authorization": "Bearer token"},
		client:  api.Client(),
	})
	if err := serve(address, loaded, zap.NewNop()); err != nil {
		t.Fatal(err)
	}

	response, err := dial(t, address, loaded).invoke("QueryCatalogItem", func(request *dynamicpb.Message) {
		setString(request, "id", "42")
	})
	if err != nil {
		t.Fatal(err)
	}

	if authorization != "Bearer token" {
		t.Fatalf("want the configured Authorization header, got %q", authorization)
	}
	expectJSON(t, response, `{"catalogItem": {"itemId": "42"}}`)
}
