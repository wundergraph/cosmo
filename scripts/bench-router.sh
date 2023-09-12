#!/bin/bash

cd "../router"

go run main.go -override-env=.env.bench

