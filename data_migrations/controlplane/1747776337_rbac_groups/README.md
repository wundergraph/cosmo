# New RBAC system

## Purpose
This migration will help customers migrate the existing roles system to a groups-based system to provide better control over resources access.

---

## Prerequisites:
Before proceeding, ensure the following:

1. **Back up existing data**: Always back up your existing tables and data to avoid any accidental data loss.
2. **Database maintenance window**: Schedule downtime if necessary to avoid service interruptions during the migration.
3. **PNPM**: You need to have PNPM installed to run the script.
4. **Keycloak**: You need an instance of Keycloak with the client `admin-cli` to issue commands.
5. **migrate.sh**: The script file must have execution permission (`chmod +x ./migrate.sh`)

---

## Migration Steps

Please ensure the latest version of Cosmo has been deployed. This migration is only applicable to the following components:

- **PostgreSQL**: 15.3 (or greater)
- **Keycloak**: 25.02 (or greater)
- **Controlplane**: vx.Y
- **Studio**: vx.Y

### Running the migration

Run the script [migrate.sh](./migrate.sh)

> Running the script multiple times will not

```bash
./migrate.sh --api-url="<keycloak api url>" --db-url="<db url>"
```

### Migration arguments

| Argument        | Description                                                       | Default Value                                                |
|-----------------|-------------------------------------------------------------------|--------------------------------------------------------------|
| `--api-url`     | The endpoint for your Keycloak instance.                          | `http://localhost:8080`                                      |
| `--login-realm` | The Keycloak realm to use when authenticating as the admin user.  | `master`                                                     |
| `--realm`       | The Keycloak realm where your users are stored.                   | `cosmo`                                                      |
| `--admin-user`  | The Keycloak admin user to authenticate as when issuing commands. | `admin`                                                      |
| `--admin-pass`  | The password for the Keycloak admin user.                         | `changeme`                                                   |
| `--db-url`      | The connection string to your PostgreSQL database.                | `postgresql://postgres:changeme@localhost:5432/controlplane` |
| `--db-tls-ca`   | The CA used to connect to the database.                           | `null`                                                       |
| `--db-tls-cert` | The certificate used to connect to the database.                  | `null`                                                       |
| `--db-tls-key`  | The certificate key used to connect to the database.              | `null`                                                       |
