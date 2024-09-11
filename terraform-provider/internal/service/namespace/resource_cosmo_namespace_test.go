package namespace_test

import (
	"fmt"
	"regexp"
	"testing"

	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/resource"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/acceptance"
)

func TestAccNamespaceResource(t *testing.T) {
	rName := "test-namespace"
	updatedName := "updated-namespace"

	resource.Test(t, resource.TestCase{
		PreCheck:                 func() { acceptance.TestAccPreCheck(t) },
		ProtoV6ProviderFactories: acceptance.TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config: testAccNamespaceResourceConfig(rName),
				Check: resource.ComposeTestCheckFunc(
					resource.TestCheckResourceAttr("cosmo_namespace.test", "name", rName),
				),
			},
			{
				ResourceName: "cosmo_namespace.test",
				RefreshState: true,
			},
			{
				Config:      testAccNamespaceResourceConfig(updatedName),
				ExpectError: regexp.MustCompile(`Changing the namespace name requires recreation.`),
			},
		},
	})
}

func testAccNamespaceResourceConfig(name string) string {
	return fmt.Sprintf(`
resource "cosmo_namespace" "test" {
  name = "%s"
}
`, name)
}
