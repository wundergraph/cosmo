package tsgen

import (
	"strings"
	"testing"
	"time"
)

func TestGenerateBundle_BundleMode_ExtractsReusedEnums(t *testing.T) {
	schema := mustParseSchema(t)
	op1 := mustParseOperation(t, schema, `query a($s: OrderStatus!) { ordersByStatus(status: $s) { id } }`)
	op1.Hash = "h1"
	op2 := mustParseOperation(t, schema, `query b($s: OrderStatus!) { ordersByStatus(status: $s) { id total } }`)
	op2.Hash = "h2"

	bundle, registry, err := GenerateBundle([]Operation{op1, op2}, schema, Config{
		BundleHeader: true,
		DeliveryMode: DeliveryModeBundle,
		EmitComments: true,
	})
	if err != nil {
		t.Fatalf("GenerateBundle: %v", err)
	}

	if !registry.Has("OrderStatus") {
		t.Errorf("OrderStatus should be extracted (used by 2 ops): %+v", registry)
	}
	if !strings.Contains(bundle, `type OrderStatus = "PENDING"|"SHIPPED"|"DELIVERED";`) {
		t.Errorf("bundle missing OrderStatus alias:\n%s", bundle)
	}
	if !strings.Contains(bundle, `"h1": { vars: { s: OrderStatus };`) {
		t.Errorf("h1 should reference OrderStatus by name:\n%s", bundle)
	}
	if !strings.Contains(bundle, "declare function op<H extends keyof Ops>") {
		t.Errorf("bundle missing op declaration:\n%s", bundle)
	}
	if !strings.Contains(bundle, "interface Ops {") {
		t.Errorf("bundle missing interface Ops:\n%s", bundle)
	}
}

func TestGenerateBundle_BundleMode_DoesNotExtractSingleUseEnums(t *testing.T) {
	schema := mustParseSchema(t)
	op := mustParseOperation(t, schema, `query a($s: OrderStatus!) { ordersByStatus(status: $s) { id } }`)
	op.Hash = "h1"

	bundle, registry, err := GenerateBundle([]Operation{op}, schema, Config{
		DeliveryMode: DeliveryModeBundle,
	})
	if err != nil {
		t.Fatalf("GenerateBundle: %v", err)
	}
	if registry.Has("OrderStatus") {
		t.Errorf("OrderStatus should NOT be extracted with single use: %+v", registry)
	}
	if !strings.Contains(bundle, `"PENDING"|"SHIPPED"|"DELIVERED"`) {
		t.Errorf("bundle should inline enum literal:\n%s", bundle)
	}
}

func TestGenerateBundle_AppendMode_PreExtractsAllSchemaTypes(t *testing.T) {
	schema := mustParseSchema(t)
	op := mustParseOperation(t, schema, `query a($id: ID!) { user(id: $id) { id } }`)
	op.Hash = "h1"

	bundle, registry, err := GenerateBundle([]Operation{op}, schema, Config{
		BundleHeader: true,
		DeliveryMode: DeliveryModeAppend,
	})
	if err != nil {
		t.Fatalf("GenerateBundle: %v", err)
	}
	for _, name := range []string{"OrderStatus", "PaymentMethod", "OrderInput", "OrderItemInput"} {
		if !registry.Has(name) {
			t.Errorf("append mode should pre-extract %s: %+v", name, registry)
		}
		if !strings.Contains(bundle, "type "+name+" =") {
			t.Errorf("bundle should declare alias for %s:\n%s", name, bundle)
		}
	}
}

func TestAppendChunk_ReferencesKnownTypes(t *testing.T) {
	schema := mustParseSchema(t)
	known := SharedTypes{}
	known.Add(SharedType{Name: "OrderStatus", TS: `"PENDING"|"SHIPPED"|"DELIVERED"`, Kind: SharedTypeEnum})

	op := mustParseOperation(t, schema, `query a($s: OrderStatus!) { ordersByStatus(status: $s) { id } }`)
	op.Hash = "h_new"

	now, _ := time.Parse(time.RFC3339, "2026-04-26T14:22:00Z")
	chunk, newly, err := appendChunkImpl([]Operation{op}, schema, known, 1, Config{}, now)
	if err != nil {
		t.Fatalf("AppendChunk: %v", err)
	}
	if len(newly.Aliases) != 0 {
		t.Errorf("OrderStatus is already known; expected no new aliases: %+v", newly)
	}
	if !strings.Contains(chunk, `"h_new": { vars: { s: OrderStatus }`) {
		t.Errorf("chunk should reference OrderStatus by name:\n%s", chunk)
	}
	if !strings.Contains(chunk, "(append #1 @ 2026-04-26T14:22:00Z)") {
		t.Errorf("chunk header should include seq/timestamp:\n%s", chunk)
	}
}

func TestAppendChunk_IntroducesNewSchemaType(t *testing.T) {
	schema := mustParseSchema(t)
	known := SharedTypes{}
	op1 := mustParseOperation(t, schema, `mutation c($id: ID!, $m: PaymentMethod!) { chargeOrder(orderId: $id, method: $m) { ok } }`)
	op1.Hash = "h_charge1"
	op2 := mustParseOperation(t, schema, `mutation d($id: ID!, $m: PaymentMethod!) { chargeOrder(orderId: $id, method: $m) { ok } }`)
	op2.Hash = "h_charge2"

	now, _ := time.Parse(time.RFC3339, "2026-04-26T15:08:00Z")
	chunk, newly, err := appendChunkImpl([]Operation{op1, op2}, schema, known, 2, Config{}, now)
	if err != nil {
		t.Fatalf("AppendChunk: %v", err)
	}
	if !newly.Has("PaymentMethod") {
		t.Errorf("expected PaymentMethod to be newly introduced: %+v", newly)
	}
	if !strings.Contains(chunk, `type PaymentMethod = "CARD"|"BANK"|"CRYPTO";`) {
		t.Errorf("chunk should declare PaymentMethod:\n%s", chunk)
	}
}

func TestGeneratePerOp(t *testing.T) {
	schema := mustParseSchema(t)
	op1 := mustParseOperation(t, schema, `query a($s: OrderStatus!) { ordersByStatus(status: $s) { id } }`)
	op1.Hash = "h1"
	op2 := mustParseOperation(t, schema, `query b($s: OrderStatus!) { ordersByStatus(status: $s) { id total } }`)
	op2.Hash = "h2"

	out, err := GeneratePerOp([]Operation{op1, op2}, schema, Config{})
	if err != nil {
		t.Fatalf("GeneratePerOp: %v", err)
	}
	for _, hash := range []string{"h1", "h2"} {
		entry, ok := out[hash]
		if !ok {
			t.Errorf("missing entry for %s", hash)
			continue
		}
		// Per-op form always inlines.
		if !strings.Contains(entry, `"PENDING"|"SHIPPED"|"DELIVERED"`) {
			t.Errorf("per-op should inline enum: %s", entry)
		}
		if strings.Contains(entry, "OrderStatus") {
			t.Errorf("per-op should not reference shared aliases: %s", entry)
		}
	}
}

func TestSchemaSharedTypes_IncludesEnumsAndInputs(t *testing.T) {
	schema := mustParseSchema(t)
	st := schemaSharedTypes(schema, Config{})
	for _, want := range []string{"OrderStatus", "PaymentMethod", "OrderInput", "OrderItemInput"} {
		if !st.Has(want) {
			t.Errorf("schemaSharedTypes missing %s: %+v", want, st)
		}
	}
}
