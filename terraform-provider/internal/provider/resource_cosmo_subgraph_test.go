package provider

import (
	"fmt"
	"testing"

	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/resource"
)

func TestAccSubgraphResource(t *testing.T) {
	rName := "test-subgraph"
	rNamespace := "default"
	rRoutingUrl := "https://example.com/graphql"
	rBaseSubgraphName := "base-subgraph"

	resource.Test(t, resource.TestCase{
		PreCheck:                 func() { testAccPreCheck(t) },
		ProtoV6ProviderFactories: testAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config: testAccSubgraphResourceConfig(rName, rNamespace, rRoutingUrl, rBaseSubgraphName),
				Check: resource.ComposeTestCheckFunc(
					resource.TestCheckResourceAttr("cosmo_subgraph.test", "name", rName),
					resource.TestCheckResourceAttr("cosmo_subgraph.test", "namespace", rNamespace),
					resource.TestCheckResourceAttr("cosmo_subgraph.test", "routing_url", rRoutingUrl),
					resource.TestCheckResourceAttr("cosmo_subgraph.test", "base_subgraph_name", rBaseSubgraphName),
				),
			},
			{
				ResourceName: "cosmo_subgraph.test",
				RefreshState: true,
			},
		},
	})
}

func testAccSubgraphResourceConfig(name, namespace, routingUrl, baseSubgraphName string) string {
	return fmt.Sprintf(`
resource "cosmo_subgraph" "test" {
  name                = "%s"
  namespace           = "%s"
  routing_url         = "%s"
  base_subgraph_name  = "%s"
}
`, name, namespace, routingUrl, baseSubgraphName)
}
