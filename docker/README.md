# Docker

This directory contains files for building and running the Docker images for cosmo stack.

# Docker Images in the Cosmo Stack

This directory contains subdirectories for each container in the Cosmo stack. These subdirectories include files used by Docker Compose to preconfigure the respective images.

## Subdirectories

- [clickhouse](#clickhouse)
- [grafana](#grafana)
- [keycloak](#keycloak)
- [postgres](#postgres)
- [prometheus](#prometheus)
- [redis](#redis)

### clickhouse

The `clickhouse` directory contains files necessary to configure and run the ClickHouse container. These files include any custom configuration and setup scripts.

### grafana

The `grafana` directory includes resources for provisioning the Grafana container. It contains the following subfolders:

### provisioning

This folder contains subdirectories for provisioning Grafana. These folders are used to automatically configure Grafana when the container starts. Dashboards will be imported to /etc/grafana/provisioning/dashboards and to subdirectories based on the folder structure in this directory.
E.g. for the prometheus dashboards it would be `/etc/grafana/provisioning/dashboards/prometheus`

#### datasources

This folder is used to configure data sources automatically when the container starts. To add a new data source, create a configuration file in YAML format and place it in this directory. The configuration should follow the [Grafana provisioning documentation](https://grafana.com/docs/grafana/latest/administration/provisioning/#data-sources).

A `datasource` in Grafana is a connection to a database or other data source that you want to visualize. The configuration file should specify the data source type, name, and connection details. A datasource config can also come from a plugin. You need to refer to the plugin documentation for the correct configuration.

#### dashboards

This folder contains predefined dashboards. You can add additional dashboards by placing JSON and yaml files here. These will be automatically imported when Grafana starts.
The `main.yml` file is used to configure the provisioning of dashboards. It defines which provider to use and the path to the dashboards. In `datasources.yml` we specify a provider name and optionally an orgId. 
The provider name must match the name of the folder containing the dashboards. See the example for prometheus in `main.yml`

**Note:** Grafana Labs already provides a number of dashboards for popular data sources. You can find them here [Grafana Dashboards](https://grafana.com/grafana/dashboards/).

#### Additional Plugins

If additional plugins are required for your Grafana instance, they must be specified using the `GF_INSTALL_PLUGINS` environment variable in the `docker-compose.yml` file located at the root of the project. This variable should list plugin IDs separated by commas. For example:

GF_INSTALL_PLUGINS: "grafana-clock-panel,grafana-piechart-panel"

### keycloak

The `keycloak` directory contains configuration files and resources required to initialize and run the Keycloak container.

### postgres

The `postgres` directory includes initialization scripts and configuration files for the PostgreSQL database container.

### prometheus

The `prometheus` directory contains configuration files and custom settings for running the Prometheus container.

### redis

The `redis` directory includes configuration files and scripts used to set up and run the Redis container.
