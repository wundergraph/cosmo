package subgraph_test

import (
	"fmt"
	"testing"

	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/acctest"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/resource"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/acceptance"
)

func TestAccSubgraphDataSource(t *testing.T) {
	rName := acctest.RandomWithPrefix("test-subgraph")
	rBaseSubgraphName := "base-subgraph"

	resource.Test(t, resource.TestCase{
		PreCheck:                 func() { acceptance.TestAccPreCheck(t) },
		ProtoV6ProviderFactories: acceptance.TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config: testAccSubgraphDataSourceConfig(rName, rBaseSubgraphName),
				Check: resource.ComposeTestCheckFunc(
					resource.TestCheckResourceAttr("data.cosmo_subgraph.test", "name", rName),
				),
			},
		},
	})
}

func testAccSubgraphDataSourceConfig(name, baseSubgraphName string) string {
	return fmt.Sprintf(`
resource "cosmo_subgraph" "test" {
  name      = "%s"
  namespace = "default"
  base_subgraph_name  = "%s"
  routing_url = "https://example.com"
}
data "cosmo_subgraph" "test" {
  name      = cosmo_subgraph.test.name
  namespace = cosmo_subgraph.test.namespace
}
`, name, baseSubgraphName)
}
