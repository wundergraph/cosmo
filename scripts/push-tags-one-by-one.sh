#!/bin/bash

# get all tags on this commit
TAGS=$(git tag --points-at HEAD | cat)

# only push tags one by one if there are more than 3
if (($(echo "$TAGS"| wc -l) > 3))
then
  echo "Pushing tags one by one to avoid GitHub webhook limit of 3"
  echo "$TAGS" | while read line ; do git push origin $line; done
fi