#!/bin/bash

echo "Setting up keycloak and seeding the database."

while true; do
    if [ $(docker wait full-cosmo-seed-1) -eq 0 ]; then
        break
    fi
done

echo "The database is seeded successfully."
echo "Creating federated graph and subgraphs."

cd ..
# Create the demo project
make create-cli-demo

export COSMO_API_KEY=cosmo_669b576aaadc10ee1ae81d9193425705
export COSMO_API_URL=http://localhost:3001
export KC_API_URL=http://localhost:8080
token=$(wgc router token create mytoken --graph-name mygraph --namespace default -r)

echo ''
echo $token
echo '---'
echo 'Please store the token in a secure place. It will not be shown again.'
echo 'You can use the token to authenticate against the control plane from the routers.'
echo ''

export ROUTER_TOKEN=$token
export OTEL_AUTH_TOKEN=$token

echo "Running the subgraphs and the router."

make dc-federation-demo