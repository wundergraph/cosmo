package tsgen

import (
	"strings"
	"testing"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
)

const testSchema = `
directive @require on FIELD

schema { query: Query mutation: Mutation }

type Query {
  user(id: ID!): User
  search(q: String!): [SearchResult!]!
  ordersByStatus(status: OrderStatus!): [Order!]!
  top: [Animal!]!
  events: [Event!]!
}

type Mutation {
  createOrder(input: OrderInput!): Order!
  chargeOrder(orderId: ID!, method: PaymentMethod!): ChargeResult!
}

type User {
  id: ID!
  name: String!
  email: String
  orders(first: Int = 10, status: OrderStatus): [Order!]!
}

type Order {
  id: ID!
  total: Float!
  items: [OrderItem!]!
  notes: [String]
}

type OrderItem { sku: String! qty: Int! }

input OrderInput { userId: ID! items: [OrderItemInput!]! }
input OrderItemInput { sku: String! qty: Int! }

enum OrderStatus { PENDING SHIPPED DELIVERED }
enum PaymentMethod { CARD BANK CRYPTO }

union SearchResult = User | Org
type Org { id: ID! slug: String! }

interface Animal { id: ID! name: String! }
type Dog implements Animal { id: ID! name: String! barks: Boolean! }
type Cat implements Animal { id: ID! name: String! meows: Boolean! }

type Event { id: ID! payload: JSON }

scalar JSON
scalar DateTime

type ChargeResult { ok: Boolean! }
`

func mustParseSchema(t *testing.T) *ast.Document {
	t.Helper()
	doc, report := astparser.ParseGraphqlDocumentString(testSchema)
	if report.HasErrors() {
		t.Fatalf("parse schema: %s", report.Error())
	}
	if err := asttransform.MergeDefinitionWithBaseSchema(&doc); err != nil {
		t.Fatalf("merge base schema: %v", err)
	}
	return &doc
}

func mustParseOperation(t *testing.T, schema *ast.Document, src string) Operation {
	t.Helper()
	doc, report := astparser.ParseGraphqlDocumentString(src)
	if report.HasErrors() {
		t.Fatalf("parse operation: %s", report.Error())
	}

	report = operationreport.Report{}
	normalizer := astnormalization.NewNormalizer(true, false)
	normalizer.NormalizeOperation(&doc, schema, &report)
	if report.HasErrors() {
		t.Fatalf("normalize operation: %s", report.Error())
	}

	for i := range doc.RootNodes {
		if doc.RootNodes[i].Kind != ast.NodeKindOperationDefinition {
			continue
		}
		opRef := doc.RootNodes[i].Ref
		opDef := doc.OperationDefinitions[opRef]
		return Operation{
			Hash:  "h",
			Name:  doc.OperationDefinitionNameString(opRef),
			Kind:  opDef.OperationType,
			Doc:   &doc,
			OpRef: opRef,
		}
	}
	t.Fatalf("no operation definition found")
	return Operation{}
}

func TestWrapType(t *testing.T) {
	schema, _ := astparser.ParseGraphqlDocumentString(`type Q { a: String b: String! c: [String!]! d: [String]! e: [String!] f: [String] }`)

	cases := map[string]string{
		"a": "string | null",
		"b": "string",
		"c": "string[]",
		"d": "(string | null)[]",
		"e": "string[] | null",
		"f": "(string | null)[] | null",
	}
	for fieldName, want := range cases {
		t.Run(fieldName, func(t *testing.T) {
			obj := schema.ObjectTypeDefinitions[0]
			var ref int = -1
			for _, fdRef := range obj.FieldsDefinition.Refs {
				if schema.FieldDefinitionNameString(fdRef) == fieldName {
					ref = schema.FieldDefinitions[fdRef].Type
					break
				}
			}
			if ref == -1 {
				t.Fatalf("field %q not found", fieldName)
			}
			got := wrapType("string", &schema, ref, false)
			if got != want {
				t.Errorf("wrapType(%s) = %q, want %q", fieldName, got, want)
			}
		})
	}
}

func TestWrapTypeRequireOverride(t *testing.T) {
	schema, _ := astparser.ParseGraphqlDocumentString(`type Q { a: String b: [String!] }`)
	obj := schema.ObjectTypeDefinitions[0]
	for _, fdRef := range obj.FieldsDefinition.Refs {
		name := schema.FieldDefinitionNameString(fdRef)
		typeRef := schema.FieldDefinitions[fdRef].Type
		got := wrapType("string", &schema, typeRef, true)
		switch name {
		case "a":
			if got != "string" {
				t.Errorf("@require on a: got %q, want %q", got, "string")
			}
		case "b":
			if got != "string[]" {
				t.Errorf("@require on b: got %q, want %q", got, "string[]")
			}
		}
	}
}

func TestEnumLiteralUnion(t *testing.T) {
	schema, _ := astparser.ParseGraphqlDocumentString(`enum Color { RED GREEN BLUE }`)
	got := enumLiteralUnion(&schema, 0)
	want := `"RED"|"GREEN"|"BLUE"`
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestSimpleQuery(t *testing.T) {
	schema := mustParseSchema(t)
	op := mustParseOperation(t, schema, `query getUserOrders($userId: ID!, $limit: Int = 10, $status: OrderStatus) {
  user(id: $userId) {
    id
    name
    orders(first: $limit, status: $status) {
      id
      total
      items { sku qty }
    }
  }
}`)

	entry, _, err := GenerateSignature(op, schema, SharedTypes{}, Config{})
	if err != nil {
		t.Fatalf("GenerateSignature: %v", err)
	}

	wantVars := `{ userId: string; limit?: number; status?: "PENDING"|"SHIPPED"|"DELIVERED" | null }`
	if !strings.Contains(entry, wantVars) {
		t.Errorf("missing vars block:\n got: %s\nwant: %s", entry, wantVars)
	}
	wantData := `data: { user: { id: string; name: string; orders: { id: string; total: number; items: { sku: string; qty: number }[] }[] } | null }`
	if !strings.Contains(entry, wantData) {
		t.Errorf("missing data block:\n got: %s\nwant: %s", entry, wantData)
	}
}

func TestSelectionOmitsUnselectedFields(t *testing.T) {
	schema := mustParseSchema(t)
	op := mustParseOperation(t, schema, `query getUser($id: ID!) { user(id: $id) { id name } }`)

	entry, _, err := GenerateSignature(op, schema, SharedTypes{}, Config{})
	if err != nil {
		t.Fatalf("GenerateSignature: %v", err)
	}
	if strings.Contains(entry, "email") {
		t.Errorf("entry should not include unselected field email: %s", entry)
	}
	if !strings.Contains(entry, "id: string") || !strings.Contains(entry, "name: string") {
		t.Errorf("missing selected fields: %s", entry)
	}
}

func TestMutationWithInputObject(t *testing.T) {
	schema := mustParseSchema(t)
	op := mustParseOperation(t, schema, `mutation createOrder($input: OrderInput!) {
  createOrder(input: $input) { id total }
}`)

	entry, _, err := GenerateSignature(op, schema, SharedTypes{}, Config{})
	if err != nil {
		t.Fatalf("GenerateSignature: %v", err)
	}
	wantVars := `vars: { input: { userId: string; items: { sku: string; qty: number }[] } }`
	if !strings.Contains(entry, wantVars) {
		t.Errorf("missing vars block:\n got: %s\nwant substring: %s", entry, wantVars)
	}
	wantData := `data: { createOrder: { id: string; total: number } }`
	if !strings.Contains(entry, wantData) {
		t.Errorf("missing data block:\n got: %s\nwant substring: %s", entry, wantData)
	}
}

func TestUnionDiscriminator(t *testing.T) {
	schema := mustParseSchema(t)
	op := mustParseOperation(t, schema, `query search($q: String!) {
  search(q: $q) { __typename ... on User { id name } ... on Org { id slug } }
}`)

	entry, _, err := GenerateSignature(op, schema, SharedTypes{}, Config{})
	if err != nil {
		t.Fatalf("GenerateSignature: %v", err)
	}
	if !strings.Contains(entry, `__typename: "User"`) {
		t.Errorf("missing User branch: %s", entry)
	}
	if !strings.Contains(entry, `__typename: "Org"`) {
		t.Errorf("missing Org branch: %s", entry)
	}
}

func TestInterfaceDiscriminator(t *testing.T) {
	schema := mustParseSchema(t)
	op := mustParseOperation(t, schema, `query top {
  top { __typename id name ... on Dog { barks } ... on Cat { meows } }
}`)
	entry, _, err := GenerateSignature(op, schema, SharedTypes{}, Config{})
	if err != nil {
		t.Fatalf("GenerateSignature: %v", err)
	}
	if !strings.Contains(entry, `__typename: "Dog"`) {
		t.Errorf("missing Dog branch: %s", entry)
	}
	if !strings.Contains(entry, `__typename: "Cat"`) {
		t.Errorf("missing Cat branch: %s", entry)
	}
	if !strings.Contains(entry, "barks: boolean") {
		t.Errorf("missing barks field: %s", entry)
	}
	// Common interface fields should appear in every branch.
	if strings.Count(entry, "name: string") != 2 {
		t.Errorf("expected name in both branches: %s", entry)
	}
}

func TestRequireDirective(t *testing.T) {
	schema := mustParseSchema(t)
	op := mustParseOperation(t, schema, `query getUserOrders($userId: ID!) {
  user(id: $userId) @require {
    id
    name
    email @require
  }
}`)

	b := newSignatureBuilder(op, schema, SharedTypes{}, Config{})
	entry, _, err := b.build()
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	// `user` is normally nullable in the schema; @require should drop the null.
	if strings.Contains(entry, "user: { id: string; name: string; email: string } | null") {
		t.Errorf("require should drop user nullability: %s", entry)
	}
	if !strings.Contains(entry, "user: { id: string; name: string; email: string }") {
		t.Errorf("expected non-null user with @require: %s", entry)
	}
	// Required paths should be captured.
	paths := b.RequiredPaths()
	wantPaths := map[string]bool{"user": false, "user.email": false}
	for _, p := range paths {
		wantPaths[p] = true
	}
	for k, found := range wantPaths {
		if !found {
			t.Errorf("missing required path %q in %v", k, paths)
		}
	}
}

func TestRequiredFirstThenOptional(t *testing.T) {
	schema := mustParseSchema(t)
	op := mustParseOperation(t, schema, `query getOrders($status: OrderStatus, $userId: ID!) {
  user(id: $userId) { id orders(status: $status) { id } }
}`)
	entry, _, err := GenerateSignature(op, schema, SharedTypes{}, Config{})
	if err != nil {
		t.Fatalf("GenerateSignature: %v", err)
	}
	// userId is required (ID!), status is optional. Required must come first.
	idxUser := strings.Index(entry, "userId")
	idxStatus := strings.Index(entry, "status")
	if idxUser < 0 || idxStatus < 0 || idxUser > idxStatus {
		t.Errorf("required fields must come before optional ones: %s", entry)
	}
}

func TestKnownEnumIsReferenced(t *testing.T) {
	schema := mustParseSchema(t)
	op := mustParseOperation(t, schema, `query orders($s: OrderStatus!) { ordersByStatus(status: $s) { id } }`)
	known := SharedTypes{}
	known.Add(SharedType{Name: "OrderStatus", TS: `"PENDING"|"SHIPPED"|"DELIVERED"`, Kind: SharedTypeEnum})

	entry, used, err := GenerateSignature(op, schema, known, Config{})
	if err != nil {
		t.Fatalf("GenerateSignature: %v", err)
	}
	if !strings.Contains(entry, "s: OrderStatus") {
		t.Errorf("expected OrderStatus reference, got %s", entry)
	}
	if strings.Contains(entry, `"PENDING"|"SHIPPED"|"DELIVERED"`) {
		t.Errorf("entry should not inline a known enum: %s", entry)
	}
	if !used.Has("OrderStatus") {
		t.Errorf("expected OrderStatus in used: %+v", used)
	}
}

func TestKnownInputObjectIsReferenced(t *testing.T) {
	schema := mustParseSchema(t)
	op := mustParseOperation(t, schema, `mutation create($input: OrderInput!) { createOrder(input: $input) { id } }`)
	known := SharedTypes{}
	known.Add(SharedType{Name: "OrderInput", TS: `{ userId: string; items: { sku: string; qty: number }[] }`, Kind: SharedTypeInputObject})

	entry, used, err := GenerateSignature(op, schema, known, Config{})
	if err != nil {
		t.Fatalf("GenerateSignature: %v", err)
	}
	if !strings.Contains(entry, "input: OrderInput") {
		t.Errorf("expected OrderInput reference, got %s", entry)
	}
	if !used.Has("OrderInput") {
		t.Errorf("expected OrderInput in used: %+v", used)
	}
}

func TestCustomScalarMapping(t *testing.T) {
	schema := mustParseSchema(t)
	op := mustParseOperation(t, schema, `query e { events { id payload } }`)

	cfg := Config{Scalars: map[string]string{"JSON": "unknown"}}
	entry, _, err := GenerateSignature(op, schema, SharedTypes{}, cfg)
	if err != nil {
		t.Fatalf("GenerateSignature: %v", err)
	}
	if !strings.Contains(entry, "payload: unknown | null") {
		t.Errorf("expected JSON → unknown mapping, got %s", entry)
	}
}

func TestAlias(t *testing.T) {
	schema := mustParseSchema(t)
	op := mustParseOperation(t, schema, `query g($id: ID!) { user(id: $id) { id displayName: name } }`)
	entry, _, err := GenerateSignature(op, schema, SharedTypes{}, Config{})
	if err != nil {
		t.Fatalf("GenerateSignature: %v", err)
	}
	if !strings.Contains(entry, "displayName: string") {
		t.Errorf("expected displayName alias key, got %s", entry)
	}
}

func TestNestedNullableList(t *testing.T) {
	schema := mustParseSchema(t)
	op := mustParseOperation(t, schema, `query g($id: ID!) { user(id: $id) { orders { notes } } }`)
	entry, _, err := GenerateSignature(op, schema, SharedTypes{}, Config{})
	if err != nil {
		t.Fatalf("GenerateSignature: %v", err)
	}
	// notes: [String] → (string | null)[] | null
	if !strings.Contains(entry, "notes: (string | null)[] | null") {
		t.Errorf("expected nullable list of nullable strings, got %s", entry)
	}
}
