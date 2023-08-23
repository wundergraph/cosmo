#!/bin/bash

# Variables
envFilename='.env.production'
nextFolder='./studio/.next/'

apply_path() {
  if [[ ! -f $envFilename ]]; then
    echo "File $envFilename not found!"
    exit 1
  fi

  # Read each line from config file
  while IFS= read -r line || [[ -n "$line" ]]; do

    # Skip comments or empty lines
    if [[ "${line:0:1}" == "#" ]] || [[ -z "$line" ]]; then
      echo "Skipping comment or empty line"
      continue
    fi

    # Split config name and value
    configName="$(cut -d'=' -f1 <<<"$line")"
    configValue="$(cut -d'=' -f2 <<<"$line")"

    # Fetch value from system environment
    envValue=$(printenv "$configName")

    # If both values are found, replace them in the target folder
    if [[ -n "$configValue" ]] && [[ -n "$envValue" ]]; then
      echo "Detected env '$configName'"
      find $nextFolder \( -type d -name .git -prune \) -o -type f -print0 | xargs -0 sed -i "s#$configValue#$envValue#g"
    fi
  done < "$envFilename"
}

# Execute the function
apply_path

exec "$@"