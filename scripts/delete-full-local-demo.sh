#!/bin/bash
set -e

###################################################################################################################
# This script deletes all the resources created by the create-full-local-demo.sh script
###################################################################################################################

wgc namespace delete dev -f
wgc namespace delete prod -f