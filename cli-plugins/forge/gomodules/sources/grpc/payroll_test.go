package grpcsource

import (
	"context"
	"encoding/json"
	"net"
	"reflect"
	"testing"

	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/dynamicpb"
)

// These tests are about the sample service in testdata/payroll.proto, which the files in this directory were
// generated from.

const (
	getSalary    = "/payroll.v1.PayrollService/GetSalary"
	listSalaries = "/payroll.v1.PayrollService/ListSalaries"
	updateSalary = "/payroll.v1.PayrollService/UpdateSalary"
	deleteSalary = "/payroll.v1.PayrollService/DeleteSalary"
)

func expectJSON(t *testing.T, message *dynamicpb.Message, want string) {
	t.Helper()

	encoded, err := protojson.Marshal(message)
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

// arguments fills a contract request from its protojson form.
func arguments(t *testing.T, literal string) func(request *dynamicpb.Message) {
	return func(request *dynamicpb.Message) {
		if err := protojson.Unmarshal([]byte(literal), request); err != nil {
			t.Fatal(err)
		}
	}
}

// respond answers an upstream call with the protojson form of its response.
func respond(literal string) answer {
	return func(_ *dynamicpb.Message, response *dynamicpb.Message) error {
		return protojson.Unmarshal([]byte(literal), response)
	}
}

func onlyCall(t *testing.T, stub *stubUpstream, method string) upstreamCall {
	t.Helper()

	calls := stub.calls()
	if len(calls) != 1 || calls[0].method != method {
		t.Fatalf("want one call to %s, got %v", method, calls)
	}
	return calls[0]
}

func freeAddress(t *testing.T) string {
	t.Helper()

	probe, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := probe.Addr().String()
	_ = probe.Close()
	return address
}

func TestSalaryIsReadFromTheUpstream(t *testing.T) {
	stub := startUpstream(t, map[string]answer{getSalary: respond(`{"salary": {
		"id": "s1",
		"userId": "u1",
		"base": {"currency": "EUR", "amountCents": 1250},
		"payFrequency": "PAY_FREQUENCY_MONTHLY",
		"effectiveFrom": "2026-01-01T09:30:00Z",
		"note": "raise",
		"tags": ["senior"],
		"labels": {"team": "core"}
	}}`)})
	started := startSubgraph(t, connect(t, stub, nil))

	response, err := started.invoke("QuerySalary", arguments(t, `{"userId": "u1"}`))
	if err != nil {
		t.Fatal(err)
	}

	expectJSON(t, onlyCall(t, stub, getSalary).request, `{"userId": "u1"}`)
	expectJSON(t, response, `{"salary": {
		"id": "s1",
		"userId": "u1",
		"base": {"currency": "EUR", "amountCents": "1250"},
		"payFrequency": "PAY_FREQUENCY_MONTHLY",
		"effectiveFrom": "2026-01-01T09:30:00Z",
		"note": "raise",
		"tags": ["senior"]
	}}`)
}

func TestAMissingSalaryIsNull(t *testing.T) {
	stub := startUpstream(t, map[string]answer{getSalary: func(*dynamicpb.Message, *dynamicpb.Message) error {
		return status.Error(codes.NotFound, "no salary for u1")
	}})
	started := startSubgraph(t, connect(t, stub, nil))

	response, err := started.invoke("QuerySalary", arguments(t, `{"userId": "u1"}`))
	if err != nil {
		t.Fatal(err)
	}

	expectJSON(t, response, `{}`)
}

func TestAnUpstreamErrorKeepsItsCodeAndNamesTheMethod(t *testing.T) {
	stub := startUpstream(t, map[string]answer{getSalary: func(*dynamicpb.Message, *dynamicpb.Message) error {
		return status.Error(codes.PermissionDenied, "no access to u1")
	}})
	started := startSubgraph(t, connect(t, stub, nil))

	_, err := started.invoke("QuerySalary", arguments(t, `{"userId": "u1"}`))

	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("want PermissionDenied, got %v", err)
	}
	if status.Convert(err).Message() != "/payroll.v1.PayrollService/GetSalary: no access to u1" {
		t.Fatalf("want the method and the upstream message, got %q", status.Convert(err).Message())
	}
}

func TestUpdateSalarySendsTheInputObjectAndEnumToTheUpstream(t *testing.T) {
	stub := startUpstream(t, map[string]answer{updateSalary: respond(`{"salary": {
		"id": "s1",
		"payFrequency": "PAY_FREQUENCY_BIWEEKLY"
	}}`)})
	started := startSubgraph(t, connect(t, stub, nil))

	response, err := started.invoke("MutationUpdateSalary", arguments(t, `{
		"userId": "u1",
		"base": {"currency": "EUR", "amountCents": "1250"},
		"payFrequency": "PAY_FREQUENCY_BIWEEKLY"
	}`))
	if err != nil {
		t.Fatal(err)
	}

	request := onlyCall(t, stub, updateSalary).request
	expectJSON(t, request, `{
		"userId": "u1",
		"base": {"currency": "EUR", "amountCents": "1250"},
		"payFrequency": "PAY_FREQUENCY_BIWEEKLY"
	}`)
	base := request.Get(request.Descriptor().Fields().ByName("base")).Message()
	if amount := base.Get(base.Descriptor().Fields().ByName("amount_cents")).Int(); amount != 1250 {
		t.Fatalf("want the int64 1250 upstream, got %d", amount)
	}
	expectJSON(t, response, `{"updateSalary": {"id": "s1", "payFrequency": "PAY_FREQUENCY_BIWEEKLY"}}`)
}

func TestDeleteSalaryAnswersTrue(t *testing.T) {
	stub := startUpstream(t, nil)
	started := startSubgraph(t, connect(t, stub, nil))

	response, err := started.invoke("MutationDeleteSalary", arguments(t, `{"userId": "u1"}`))
	if err != nil {
		t.Fatal(err)
	}

	expectJSON(t, onlyCall(t, stub, deleteSalary).request, `{"userId": "u1"}`)
	expectJSON(t, response, `{"deleteSalary": true}`)
}

func TestListSalariesSendsTheFrequenciesAndReturnsTheWholeResponse(t *testing.T) {
	stub := startUpstream(t, map[string]answer{listSalaries: respond(`{
		"salaries": [{"id": "s1"}, {"id": "s2", "payFrequency": "PAY_FREQUENCY_MONTHLY"}],
		"nextPageToken": "p2"
	}`)})
	started := startSubgraph(t, connect(t, stub, nil))

	response, err := started.invoke("QueryListSalaries", arguments(t, `{
		"frequencies": ["PAY_FREQUENCY_MONTHLY", "PAY_FREQUENCY_BIWEEKLY"],
		"pageSize": 2
	}`))
	if err != nil {
		t.Fatal(err)
	}

	expectJSON(t, onlyCall(t, stub, listSalaries).request, `{
		"frequencies": ["PAY_FREQUENCY_MONTHLY", "PAY_FREQUENCY_BIWEEKLY"],
		"pageSize": 2
	}`)
	expectJSON(t, response, `{"listSalaries": {
		"salaries": [{"id": "s1"}, {"id": "s2", "payFrequency": "PAY_FREQUENCY_MONTHLY"}],
		"nextPageToken": "p2"
	}}`)
}

func TestConfiguredHeadersReachTheUpstream(t *testing.T) {
	stub := startUpstream(t, map[string]answer{getSalary: respond(`{"salary": {"id": "s1"}}`)})

	loaded, err := loadSpec(operationsJSON)
	if err != nil {
		t.Fatal(err)
	}

	address := freeAddress(t)
	active.Store(connect(t, stub, map[string]string{"Authorization": "Bearer token"}))
	if err := serve(address, loaded, zap.NewNop()); err != nil {
		t.Fatal(err)
	}

	response, err := dial(t, address).invoke("QuerySalary", arguments(t, `{"userId": "u1"}`))
	if err != nil {
		t.Fatal(err)
	}

	authorization := onlyCall(t, stub, getSalary).metadata.Get("authorization")
	if !reflect.DeepEqual(authorization, []string{"Bearer token"}) {
		t.Fatalf("want the configured authorization metadata, got %v", authorization)
	}
	expectJSON(t, response, `{"salary": {"id": "s1"}}`)
}

func TestWithoutATargetTheRouterBootsAndEveryCallSaysWhatIsMissing(t *testing.T) {
	address := freeAddress(t)
	source := &Source{ListenAddr: address}
	if err := source.Provision(&core.ModuleContext{Context: context.Background(), Logger: zap.NewNop()}); err != nil {
		t.Fatal(err)
	}

	_, err := dial(t, address).invoke("QuerySalary", arguments(t, `{"userId": "u1"}`))

	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("want FailedPrecondition, got %v", err)
	}
	if status.Convert(err).Message() != "modules.grpc-source.target is not set" {
		t.Fatalf("want the missing setting in the message, got %q", status.Convert(err).Message())
	}
}

// The sample's contract and upstream use the same names, so this renames them to prove the walk follows the map.
func TestNamesThatDifferAreRenamedBothWays(t *testing.T) {
	service, err := compileService(serviceProto)
	if err != nil {
		t.Fatal(err)
	}
	renames := names{
		Messages: map[string]map[string]string{
			"Salary":                   {"id": "salary_id", "base": "pay", "pay_frequency": "frequency"},
			"Money":                    {"amount_cents": "cents"},
			"QueryListSalariesRequest": {"frequencies": "only"},
		},
		Enums: map[string]map[string]string{"PayFrequency": {"PAY_FREQUENCY_MONTHLY": "MONTHLY"}},
	}

	salary := service.Methods().ByName("QuerySalary").Output().Fields().ByName("salary")
	fromUpstream := map[string]any{
		"salary_id": "s1",
		"frequency": "MONTHLY",
		"pay":       map[string]any{"cents": "5", "currency": "EUR"},
		"labels":    map[string]any{"team": "core"},
	}
	toContract, kept := renames.convert(fromUpstream, salary, towardContract)
	want := map[string]any{"id": "s1", "pay_frequency": "PAY_FREQUENCY_MONTHLY", "base": map[string]any{"amount_cents": "5"}}
	if !kept || !reflect.DeepEqual(toContract, want) {
		t.Fatalf("want %v toward the contract, got %v", want, toContract)
	}

	listRequest := service.Methods().ByName("QueryListSalaries").Input()
	fromContract := map[string]any{"frequencies": []any{"PAY_FREQUENCY_MONTHLY", "PAY_FREQUENCY_BIWEEKLY"}}
	toUpstream := renames.convertObject(fromContract, listRequest, towardUpstream)
	if !reflect.DeepEqual(toUpstream, map[string]any{"only": []any{"MONTHLY"}}) {
		t.Fatalf("want only the mapped frequency toward the upstream, got %v", toUpstream)
	}
}
