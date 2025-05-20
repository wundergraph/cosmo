#!/bin/bash
set -e

fly deploy -a product-api --dockerfile ./Dockerfile --build-target products
fly deploy -a employees-api --dockerfile ./Dockerfile --build-target employees
fly deploy -a family-api --dockerfile ./Dockerfile --build-target family
fly deploy -a hobbies-api --dockerfile ./Dockerfile --build-target hobbies
fly deploy -a availability-api --dockerfile ./Dockerfile --build-target availability
fly deploy -a mood-api --dockerfile ./Dockerfile --build-target mood
fly deploy -a product-api-fs --dockerfile ./Dockerfile --build-target products_fg
