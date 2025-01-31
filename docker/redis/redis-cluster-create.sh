# wait for the docker-compose depends_on to spin up the redis nodes usually takes this long
sleep 10

node_0_ip=$(getent hosts redis-cluster-node-0 | awk '{ print $1 }')
node_1_ip=$(getent hosts redis-cluster-node-1 | awk '{ print $1 }')
node_2_ip=$(getent hosts redis-cluster-node-2 | awk '{ print $1 }')


redis-cli --cluster create \
  $node_0_ip:6379 \
  $node_1_ip:6379 \
  $node_2_ip:6379 \
  --cluster-replicas 0 --cluster-yes