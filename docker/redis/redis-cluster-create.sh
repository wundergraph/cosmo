# wait for the docker-compose depends_on to spin up the redis nodes usually takes this long
sleep 10

resolve() {
  getent hosts "$1" | awk '{ print $1 }'
}

master_ips=""
for node in redis-cluster-node-1 redis-cluster-node-2 redis-cluster-node-3; do
  ip=$(resolve $node)
  if [ -z "$ip" ]; then
    echo "$node did not resolve, cannot create the cluster"
    exit 1
  fi
  master_ips="$master_ips $ip"
done

# Nodes 4-6 only run when the redis-cluster-replicas compose profile is enabled, so they are
# picked up when they resolve and left out of the cluster otherwise.
replica_ips=""
replica_count=0
for node in redis-cluster-node-4 redis-cluster-node-5 redis-cluster-node-6; do
  ip=$(resolve $node)
  if [ -z "$ip" ]; then
    continue
  fi
  replica_ips="$replica_ips $ip"
  replica_count=$((replica_count + 1))
done

# redis-cli spreads replicas evenly over the masters, so it takes one each or none at all.
replicas_per_master=0
if [ "$replica_count" -eq 3 ]; then
  replicas_per_master=1
elif [ "$replica_count" -ne 0 ]; then
  echo "Only $replica_count of the 3 replica nodes are running, creating the cluster without replicas"
  replica_ips=""
fi

node_ips="$master_ips $replica_ips"

# Prepare the nodes for the cluster
for ip in $node_ips; do
  echo "Emptying db 0 of Redis node at $ip and resetting cluster"
  redis-cli -h $ip -p 6379 FLUSHDB
  redis-cli -h $ip -p 6379 CLUSTER RESET
  redis-cli -h $ip -p 6379 CONFIG SET cluster-announce-ip "$ip"
done

# Create the cluster. The masters come first, so the replica nodes that follow become their
# replicas, which is what read_only=true routing needs to be exercised.
redis-cli --cluster create \
  $(for ip in $node_ips; do printf '%s:6379 ' "$ip"; done) \
  --cluster-replicas $replicas_per_master --cluster-yes

echo "Redis Cluster setup complete!"
