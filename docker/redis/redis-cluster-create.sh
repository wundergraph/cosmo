# wait for the docker-compose depends_on to spin up the redis nodes usually takes this long
sleep 10

node_1_ip=$(getent hosts redis-cluster-node-1 | awk '{ print $1 }')
node_2_ip=$(getent hosts redis-cluster-node-2 | awk '{ print $1 }')
node_3_ip=$(getent hosts redis-cluster-node-3 | awk '{ print $1 }')

# Prepare the nodes for the cluster
for ip in $node_1_ip $node_2_ip $node_3_ip; do
  echo "Emptying db 0 of Redis node at $ip and resetting cluster"
  redis-cli -h $ip -p 6379 FLUSHDB
  redis-cli -h $ip -p 6379 CLUSTER RESET
  redis-cli -h $ip -p 6379 CONFIG SET cluster-announce-ip "$ip"
done

# Create the cluster
redis-cli --cluster create \
  $node_1_ip:6379 \
  $node_2_ip:6379 \
  $node_3_ip:6379 \
  --cluster-replicas 0 --cluster-yes

echo "Redis Cluster setup complete!"