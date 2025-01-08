# wait for the docker-compose depends_on to spin up the redis nodes usually takes this long
sleep 10

node_0_ip=$(getent hosts redis-cluster-node-0 | awk '{ print $1 }')
node_1_ip=$(getent hosts redis-cluster-node-1 | awk '{ print $1 }')
node_2_ip=$(getent hosts redis-cluster-node-2 | awk '{ print $1 }')
node_3_ip=$(getent hosts redis-cluster-node-3 | awk '{ print $1 }')
node_4_ip=$(getent hosts redis-cluster-node-4 | awk '{ print $1 }')
node_5_ip=$(getent hosts redis-cluster-node-5 | awk '{ print $1 }')


redis-cli --cluster create \
  $node_0_ip:6379 \
  $node_1_ip:6379 \
  $node_2_ip:6379 \
  $node_3_ip:6379 \
  $node_4_ip:6379 \
  $node_5_ip:6379 \
  --cluster-replicas 1 --cluster-yes