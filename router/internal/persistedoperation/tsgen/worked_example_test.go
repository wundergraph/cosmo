package tsgen

import (
	"strings"
	"testing"
)

// TestWorkedExample_Spec covers §10 of the spec end-to-end: schema, three
// persisted operations, an append chunk that adds a fourth, and a second
// append chunk that introduces a new schema enum.
func TestWorkedExample_Spec(t *testing.T) {
	schema := mustParseSchema(t)

	op1 := mustParseOperation(t, schema, `query getUserOrders($userId: ID!, $limit: Int = 10, $status: OrderStatus) {
  user(id: $userId) { id name orders(first: $limit, status: $status) { id total items { sku qty } } }
}`)
	op1.Hash = "a3f9c1"
	op2 := mustParseOperation(t, schema, `mutation createOrder($input: OrderInput!) { createOrder(input: $input) { id total } }`)
	op2.Hash = "b71e08"
	op3 := mustParseOperation(t, schema, `query search($q: String!) {
  search(q: $q) { __typename ... on User { id name } ... on Org { id slug } }
}`)
	op3.Hash = "c4d2a0"

	bundle, registry, err := GenerateBundle([]Operation{op1, op2, op3}, schema, Config{
		BundleHeader: true,
		EmitComments: true,
		DeliveryMode: DeliveryModeAppend,
	})
	if err != nil {
		t.Fatalf("GenerateBundle: %v", err)
	}

	for _, want := range []string{
		`declare function op<H extends keyof Ops>`,
		`type OrderStatus = "PENDING"|"SHIPPED"|"DELIVERED";`,
		`type OrderInput = { userId: string; items: { sku: string; qty: number }[] };`,
		`"a3f9c1": { vars: { userId: string; limit?: number; status?: OrderStatus | null }`,
		`"b71e08": { vars: { input: OrderInput }`,
		`"c4d2a0": { vars: { q: string }`,
		`__typename: "User"`,
		`__typename: "Org"`,
	} {
		if !strings.Contains(bundle, want) {
			t.Errorf("bundle missing %q\n--- bundle ---\n%s", want, bundle)
		}
	}

	// Append #1: add ordersByStatus, references existing OrderStatus.
	op4 := mustParseOperation(t, schema, `query ordersByStatus($status: OrderStatus!) { ordersByStatus(status: $status) { id } }`)
	op4.Hash = "d8e211"

	chunk1, newly1, err := AppendChunk([]Operation{op4}, schema, registry, 1, Config{EmitComments: true})
	if err != nil {
		t.Fatalf("AppendChunk: %v", err)
	}
	for _, name := range []string{"OrderStatus", "OrderInput", "OrderItemInput", "PaymentMethod"} {
		if newly1.Has(name) {
			t.Errorf("append #1 should not re-introduce %s: %+v", name, newly1)
		}
	}
	if !strings.Contains(chunk1, `"d8e211": { vars: { status: OrderStatus }`) {
		t.Errorf("append #1 should reference existing OrderStatus:\n%s", chunk1)
	}

	// Append #2: chargeOrder uses PaymentMethod (already pre-extracted in
	// append-mode initial bundle, so won't be newly introduced).
	op5 := mustParseOperation(t, schema, `mutation chargeOrder($orderId: ID!, $method: PaymentMethod!) { chargeOrder(orderId: $orderId, method: $method) { ok } }`)
	op5.Hash = "f9a012"

	chunk2, _, err := AppendChunk([]Operation{op5}, schema, registry, 2, Config{EmitComments: true})
	if err != nil {
		t.Fatalf("AppendChunk: %v", err)
	}
	if !strings.Contains(chunk2, `"f9a012": { vars: { orderId: string; method: PaymentMethod }`) {
		t.Errorf("append #2 should reference PaymentMethod:\n%s", chunk2)
	}
}

// TestWorkedExample_RequireDirective covers the @require example from §4.4.1.
func TestWorkedExample_RequireDirective(t *testing.T) {
	schema := mustParseSchema(t)
	op := mustParseOperation(t, schema, `query getUserOrders($userId: ID!) {
  user(id: $userId) @require { id name orders @require { id total items { sku qty } } }
}`)
	op.Hash = "a3f9c1"

	res, err := GenerateSignatureWithPaths(op, schema, SharedTypes{}, Config{})
	if err != nil {
		t.Fatalf("GenerateSignatureWithPaths: %v", err)
	}

	// `user` and `user.orders` are both annotated with @require.
	want := []string{"user", "user.orders"}
	for _, p := range want {
		found := false
		for _, got := range res.RequiredPaths {
			if got == p {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("missing required path %q in %v", p, res.RequiredPaths)
		}
	}
	// The TS entry should not contain ` | null` for user or orders (they're
	// @require'd).
	if strings.Contains(res.Entry, "user: { id: string; name: string; orders:") &&
		strings.Contains(res.Entry, " }[] } | null") {
		t.Errorf("user should not be nullable in entry:\n%s", res.Entry)
	}
}
