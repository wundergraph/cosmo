resource "aws_default_vpc" "default_vpc" {}

resource "aws_default_subnet" "default_subnet_a" {
  availability_zone = "${data.aws_region.current.name}a"
}

resource "aws_default_subnet" "default_subnet_b" {
  availability_zone = "${data.aws_region.current.name}b"
}

resource "aws_default_subnet" "default_subnet_c" {
  availability_zone = "${data.aws_region.current.name}c"
}
