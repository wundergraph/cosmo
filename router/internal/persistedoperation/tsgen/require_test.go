package tsgen

import (
	"errors"
	"testing"
)

func TestEnforceRequiredPaths_Pass(t *testing.T) {
	data := []byte(`{"user":{"id":"u1","name":"Ada","orders":[{"id":"o1"}]}}`)

	cases := [][]string{
		{"user"},
		{"user.id"},
		{"user.orders"},
		{"user.orders[]"},
		{"user.orders[].id"},
		{"user.orders[0].id"},
	}
	for _, paths := range cases {
		if err := EnforceRequiredPaths(data, paths, "h"); err != nil {
			t.Errorf("paths=%v: unexpected error %v", paths, err)
		}
	}
}

func TestEnforceRequiredPaths_NullField(t *testing.T) {
	data := []byte(`{"user":null}`)
	err := EnforceRequiredPaths(data, []string{"user.id"}, "h_42")
	if err == nil {
		t.Fatal("expected error")
	}
	var rfne *RequiredFieldNullError
	if !errors.As(err, &rfne) {
		t.Fatalf("expected RequiredFieldNullError, got %T", err)
	}
	if rfne.Code != "REQUIRED_FIELD_NULL" || rfne.Path != "user.id" || rfne.Hash != "h_42" {
		t.Errorf("wrong error fields: %+v", rfne)
	}
}

func TestEnforceRequiredPaths_NullArrayElement(t *testing.T) {
	data := []byte(`{"items":[{"sku":"a"},null]}`)
	err := EnforceRequiredPaths(data, []string{"items[]"}, "h")
	if err == nil {
		t.Fatal("expected error for null element")
	}
}

func TestEnforceRequiredPaths_EmptyListNotAllowed(t *testing.T) {
	data := []byte(`{"items":[]}`)
	err := EnforceRequiredPaths(data, []string{"items[]"}, "h")
	if err == nil {
		t.Fatal("expected error for empty list")
	}
}

func TestEnforceRequiredPaths_OptionalEmpty(t *testing.T) {
	data := []byte(`{"items":[]}`)
	if err := EnforceRequiredPaths(data, []string{"items[]?"}, "h"); err != nil {
		t.Errorf("[]? should accept empty: %v", err)
	}
}

func TestEnforceRequiredPaths_OptionalListNullElementsRejected(t *testing.T) {
	data := []byte(`{"items":[null]}`)
	err := EnforceRequiredPaths(data, []string{"items[]?.sku"}, "h")
	if err == nil {
		t.Fatal("expected error for null element under []?")
	}
}

func TestEnforceRequiredPaths_IndexedElement(t *testing.T) {
	data := []byte(`{"items":[{"id":"a"},{"id":"b"}]}`)
	if err := EnforceRequiredPaths(data, []string{"items[1].id"}, "h"); err != nil {
		t.Errorf("indexed access: %v", err)
	}
	err := EnforceRequiredPaths(data, []string{"items[5].id"}, "h")
	if err == nil {
		t.Fatal("expected error for out-of-range index")
	}
}

func TestEnforceRequiredPaths_NoDataReturnsErrorForKey(t *testing.T) {
	data := []byte(`{}`)
	err := EnforceRequiredPaths(data, []string{"user"}, "h")
	if err == nil {
		t.Fatal("expected missing-key to error")
	}
}

func TestParsePath(t *testing.T) {
	got, err := parsePath("user.orders[].items[]?.sku")
	if err != nil {
		t.Fatal(err)
	}
	want := []pathSegment{
		{kind: "key", key: "user"},
		{kind: "key", key: "orders"},
		{kind: "list"},
		{kind: "key", key: "items"},
		{kind: "listOptional"},
		{kind: "key", key: "sku"},
	}
	if len(got) != len(want) {
		t.Fatalf("len mismatch: got %d, want %d (%+v)", len(got), len(want), got)
	}
	for i := range got {
		if got[i].kind != want[i].kind || got[i].key != want[i].key || got[i].index != want[i].index {
			t.Errorf("seg %d: got %+v, want %+v", i, got[i], want[i])
		}
	}
}
