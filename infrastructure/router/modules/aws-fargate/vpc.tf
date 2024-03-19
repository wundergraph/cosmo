resource "aws_default_vpc" "default_vpc" {
  count = var.network_configuration_vpc_id != "" ? 0 : 1
}

resource "aws_default_subnet" "default_subnet_a" {
  count = var.network_configuration_vpc_id != "" ? 0 : 1
  availability_zone = "${data.aws_region.current.name}a"
}

resource "aws_default_subnet" "default_subnet_b" {
  count = var.network_configuration_vpc_id != "" ? 0 : 1
  availability_zone = "${data.aws_region.current.name}b"
}

resource "aws_default_subnet" "default_subnet_c" {
  count = var.network_configuration_vpc_id != "" ? 0 : 1
  availability_zone = "${data.aws_region.current.name}c"
}
