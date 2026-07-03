package subgraph

import (
	"testing"
)

func TestAllCatalogsReturnsStableIDOrder(t *testing.T) {
	expected := []string{"c1", "c2", "c3"}
	for attempt := 0; attempt < 200; attempt++ {
		catalogs := allCatalogs()

		if len(catalogs) != len(expected) {
			t.Fatalf("expected %d catalogs, got %d", len(expected), len(catalogs))
		}

		for index, id := range expected {
			if catalogs[index].ID != id {
				t.Fatalf(
					"attempt %d: expected catalog %d to be %s, got %s",
					attempt,
					index,
					id,
					catalogs[index].ID,
				)
			}
		}
	}
}
