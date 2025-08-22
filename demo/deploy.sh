#!/bin/bash
set -e

fly deploy -a product-api --dockerfile ./docker/products.Dockerfile
fly deploy -a employees-api --dockerfile ./docker/employees.Dockerfile
fly deploy -a family-api --dockerfile ./docker/family.Dockerfile
fly deploy -a hobbies-api --dockerfile ./docker/hobbies.Dockerfile
fly deploy -a availability-api --dockerfile ./docker/availability.Dockerfile
fly deploy -a mood-api --dockerfile ./docker/mood.Dockerfile
fly deploy -a product-api-fs --dockerfile ./docker/products_fg.Dockerfile
