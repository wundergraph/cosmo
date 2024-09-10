package monograph_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/resource"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/acceptance"
)

func TestAccMonographDataSource(t *testing.T) {
	rName := fmt.Sprintf("test-monograph-%d", time.Now().UnixNano()) // Ensure a unique name

	resource.Test(t, resource.TestCase{
		PreCheck:                 func() { acceptance.TestAccPreCheck(t) },
		ProtoV6ProviderFactories: acceptance.TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config: testAccMonographDataSourceConfig(rName),
				Check: resource.ComposeTestCheckFunc(
					resource.TestCheckResourceAttr("data.cosmo_monograph.test", "name", rName),
					resource.TestCheckResourceAttr("data.cosmo_monograph.test", "namespace", "default"),
				),
			},
		},
	})
}

func testAccMonographDataSourceConfig(name string) string {
	return fmt.Sprintf(`
resource "cosmo_monograph" "test" {
  name      	= "%s"
  namespace 	= "default"
  routing_url 	= "http://example.com/routing"
  graph_url 	= "http://example.com/graphql" 
}
data "cosmo_monograph" "test" {
  name      = cosmo_monograph.test.name
  namespace = cosmo_monograph.test.namespace
}
`, name)
}
