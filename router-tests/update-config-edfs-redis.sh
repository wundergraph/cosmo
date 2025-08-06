#!/bin/bash

# js composition


# First save the current schema in a temp file to revert it again later

cp ../demo/pkg/subgraphs/employeeupdated/subgraph/schema.graphqls ../demo/pkg/subgraphs/employeeupdated/subgraph/schema.graphqls.tmp

# Apply sed magic to remove the directives for redis

sed -E '
/^[[:space:]]*type[[:space:]]+Query[[:space:]]*\{/,/^[}]/d
/^[[:space:]]*type[[:space:]]+Mutation[[:space:]]*\{/,/^[}]/ {
    /([Nn]ats|[Kk]afka)/d
}

/^[[:space:]]*type[[:space:]]+Subscription[[:space:]]*\{/,/^[}]/ {
    /filteredEmployeeUpdated\(/,+2d
}

/^[[:space:]]*type[[:space:]]+Subscription[[:space:]]*\{/,/^[}]/ {
    /filteredEmployeeUpdatedMyKafka\(/,+2d
}

/^[[:space:]]*type[[:space:]]+Subscription[[:space:]]*\{/,/^[}]/ {
    /filteredEmployeeUpdatedMyKafkaWithListFieldArguments\(/,+2d
}

/^[[:space:]]*type[[:space:]]+Subscription[[:space:]]*\{/,/^[}]/ {
    /filteredEmployeeUpdatedMyKafkaWithNestedListFieldArgument\(/,+7d
}

/^[[:space:]]*input[[:space:]]+KafkaInput[[:space:]]*\{/,/^[}]/d

/^[[:space:]]*type[[:space:]]+Subscription[[:space:]]*\{/,/^[}]/ {
    /([Nn]ats|[Kk]afka)/d
}
/^[[:space:]]*input[[:space:]]+edfs__NatsStreamConfiguration[[:space:]]*\{/,/^[}]/d
/^directive[[:space:]]+@edfs__natsRequest/d
/^directive[[:space:]]+@edfs__natsPublish/d
/^directive[[:space:]]+@edfs__natsSubscribe/d
/^directive[[:space:]]+@edfs__kafkaPublish/d
/^directive[[:space:]]+@edfs__kafkaSubscribe/d
' ../demo/pkg/subgraphs/employeeupdated/subgraph/schema.graphqls.tmp > ../demo/pkg/subgraphs/employeeupdated/subgraph/schema.graphqls


## using source code

cd "../cli" || exit
pnpm wgc router compose -i ../demo/graph.yaml -o ../router-tests/testenv/testdata/configWithEdfsRedis.json


# # echo "Formatting config"
jq . ../router-tests/testenv/testdata/configWithEdfsRedis.json > ../router-tests/testenv/testdata/configWithEdfsRedis.json.tmp
mv ../router-tests/testenv/testdata/configWithEdfsRedis.json.tmp ../router-tests/testenv/testdata/configWithEdfsRedis.json

mv ../demo/pkg/subgraphs/employeeupdated/subgraph/schema.graphqls.tmp ../demo/pkg/subgraphs/employeeupdated/subgraph/schema.graphqls


