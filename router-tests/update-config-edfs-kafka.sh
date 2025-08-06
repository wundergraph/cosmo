#!/bin/bash

# js composition


# First save the current schema in a temp file to revert it again later

cp ../demo/pkg/subgraphs/employeeupdated/subgraph/schema.graphqls ../demo/pkg/subgraphs/employeeupdated/subgraph/schema.graphqls.tmp

# Apply sed magic to remove the directives for kafka

sed -E '
/^[[:space:]]*type[[:space:]]+Query[[:space:]]*\{/,/^[}]/d
/^[[:space:]]*type[[:space:]]+Mutation[[:space:]]*\{/,/^[}]/ {
    /([Nn]ats|[Rr]edis)/d
}

/^[[:space:]]*type[[:space:]]+Subscription[[:space:]]*\{/,/^[}]/ {
    /filteredEmployeeUpdatedMyRedis/{
        N
        N
        d
    }
}

/^[[:space:]]*type[[:space:]]+Subscription[[:space:]]*\{/,/^[}]/ {
    /filteredEmployeeUpdated\(/{
        N
        N
        d
    }
}


/^[[:space:]]*type[[:space:]]+Subscription[[:space:]]*\{/,/^[}]/ {
    /([Nn]ats|[Rr]edis)/d
}
/^[[:space:]]*input[[:space:]]+edfs__NatsStreamConfiguration[[:space:]]*\{/,/^[}]/d
/^directive[[:space:]]+@edfs__natsRequest/d
/^directive[[:space:]]+@edfs__natsPublish/d
/^directive[[:space:]]+@edfs__natsSubscribe/d
/^directive[[:space:]]+@edfs__redisPublish/d
/^directive[[:space:]]+@edfs__redisSubscribe/d
' ../demo/pkg/subgraphs/employeeupdated/subgraph/schema.graphqls.tmp > ../demo/pkg/subgraphs/employeeupdated/subgraph/schema.graphqls


## using source code

cd "../cli" || exit
pnpm wgc router compose -i ../demo/graph.yaml -o ../router-tests/testenv/testdata/configWithEdfsKafka.json


# echo "Formatting config"
jq . ../router-tests/testenv/testdata/configWithEdfsKafka.json > ../router-tests/testenv/testdata/configWithEdfsKafka.json.tmp
mv ../router-tests/testenv/testdata/configWithEdfsKafka.json.tmp ../router-tests/testenv/testdata/configWithEdfsKafka.json

mv ../demo/pkg/subgraphs/employeeupdated/subgraph/schema.graphqls.tmp ../demo/pkg/subgraphs/employeeupdated/subgraph/schema.graphqls


