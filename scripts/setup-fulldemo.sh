#!/bin/bash

echo ""
echo "Setting up keycloak and seeding the database ..."

while true; do
    if [ $(docker wait full-cosmo-seed-1) -eq 0 ]; then
        break
    fi
done

set -e

echo "The database was seeded successfully."
echo "Creating federated graph and subgraphs ..."
echo ""

. ./scripts/configurations/local.sh

# Create the demo project
make create-cli-demo

echo "Demo project created successfully."

token=$(wgc router token create mytoken --graph-name mygraph --namespace default -r)

echo ''
echo 'Your graph token is:'
echo "$token"
echo '---'
echo 'Please store the token in a secure place. It will not be shown again.'
echo 'You can use the token to authenticate against the control plane from the routers.'
echo '---'
echo ''

export ROUTER_TOKEN=$token
export OTEL_AUTH_TOKEN=$token

echo "Start the subgraphs and the router ..."
make dc-federation-demo

echo ""
echo "The federated graph and subgraphs are running."
echo "The demo is ready to use. Please open the browser and go to http://localhost:3000"
echo ""
echo "Login: foo@wundergraph.com"
echo "Password: wunder@123"
echo ""
echo "To see the playground of the router, navigate to http://localhost:3002"