#!/bin/bash

# First save the current schema in a temp file to revert it again later

mv ../demo/pkg/subgraphs/employeeupdated/subgraph/schema.graphqls.tmp ../demo/pkg/subgraphs/employeeupdated/subgraph/schema.graphqls
cp ../demo/pkg/subgraphs/employeeupdated/subgraph/schema.graphqls ../demo/pkg/subgraphs/employeeupdated/subgraph/schema.graphqls.tmp

# Apply sed magic to remove the directives for nats

sed -E '
/^[[:space:]]*type[[:space:]]+Mutation[[:space:]]*\{/,/^[}]/ {
    /([Kk]afka|[Rr]edis)/d
}

/^[[:space:]]*type[[:space:]]+Subscription[[:space:]]*\{/,/^[}]/ {
    /filteredEmployeeUpdatedMyRedis/{
        N
        N
        d
    }
}

/^[[:space:]]*type[[:space:]]+Subscription[[:space:]]*\{/,/^[}]/ {
    /filteredEmployeeUpdatedMyKafka\(/{
        N
        N
        d
    }
}

/^[[:space:]]*type[[:space:]]+Subscription[[:space:]]*\{/,/^[}]/ {
    /filteredEmployeeUpdatedMyKafkaWithListFieldArguments\(/{
        N
        N
        d
    }
}

/^[[:space:]]*type[[:space:]]+Subscription[[:space:]]*\{/,/^[}]/ {
    /filteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument\(/,+7d
}


/^[[:space:]]*type[[:space:]]+Subscription[[:space:]]*\{/,/^[}]/ {
    /([Kk]afka|[Rr]edis)/d
}

/^directive[[:space:]]+@edfs__kafkaPublish/d
/^directive[[:space:]]+@edfs__kafkaSubscribe/d
/^directive[[:space:]]+@edfs__redisPublish/d
/^directive[[:space:]]+@edfs__redisSubscribe/d

' ../demo/pkg/subgraphs/employeeupdated/subgraph/schema.graphqls.tmp > ../demo/pkg/subgraphs/employeeupdated/subgraph/schema.graphqls


## using source code

cd "../cli" || exit
pnpm wgc router compose -i ../demo/graph.yaml -o ../router-tests/testenv/testdata/configWithEdfsNats.json


# echo "Formatting config"
jq . ../router-tests/testenv/testdata/configWithEdfsNats.json > ../router-tests/testenv/testdata/configWithEdfsNats.json.tmp
mv ../router-tests/testenv/testdata/configWithEdfsNats.json.tmp ../router-tests/testenv/testdata/configWithEdfsNats.json

mv ../demo/pkg/subgraphs/employeeupdated/subgraph/schema.graphqls.tmp ../demo/pkg/subgraphs/employeeupdated/subgraph/schema.graphqls
