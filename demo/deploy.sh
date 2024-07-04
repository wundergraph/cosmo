#!/bin/bash
set -e

fly deploy -a product-api --dockerfile ./Dockerfile.products
fly deploy -a employees-api --dockerfile ./Dockerfile.employees
fly deploy -a family-api --dockerfile ./Dockerfile.family
fly deploy -a hobbies-api --dockerfile ./Dockerfile.hobbies
fly deploy -a product-api-fs --dockerfile ./Dockerfile.products_fg