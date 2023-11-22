#!/bin/sh

mkdir -p /data/cosmo
minio server /data --console-address ":9001"
