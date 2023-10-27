package test

import (
	"database/sql"
	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/amacneil/dbmate/v2/pkg/dbmate"
	"github.com/rs/xid"
	"github.com/stretchr/testify/require"
	"net/url"
	"os"
	"testing"
)

var (
	defaultURL      = os.Getenv("CLICKHOUSE_URL")
	defaultDatabase = os.Getenv("CLICKHOUSE_DATABASE")
	defaultUsername = os.Getenv("CLICKHOUSE_USER")
	defaultPassword = os.Getenv("CLICKHOUSE_PASSWORD")
)

func GetTestDatabase(t *testing.T) *sql.DB {
	databaseName := xid.New().String()

	if defaultURL == "" {
		defaultURL = "localhost:8123"
	}
	if defaultDatabase == "" {
		defaultDatabase = "default"
	}
	if defaultUsername == "" {
		defaultUsername = "default"
	}
	if defaultPassword == "" {
		defaultPassword = "changeme"
	}

	rootDB := clickhouse.OpenDB(&clickhouse.Options{
		Addr:     []string{defaultURL},
		Protocol: clickhouse.HTTP,
		Settings: map[string]any{
			"insert_quorum":                 "1",
			"insert_quorum_parallel":        "0",
			"select_sequential_consistency": "1",
		},
		Auth: clickhouse.Auth{
			Database: defaultDatabase,
			Username: defaultUsername,
			Password: defaultPassword,
		},
	})

	_, err := rootDB.Exec("CREATE ROLE " + databaseName)
	require.NoError(t, err)

	_, err = rootDB.Exec("CREATE DATABASE " + databaseName)
	require.NoError(t, err)

	_, err = rootDB.Exec("GRANT ALL ON " + databaseName + ".* TO " + databaseName)
	require.NoError(t, err)

	_, err = rootDB.Exec("CREATE USER " + databaseName + " IDENTIFIED with no_password")
	require.NoError(t, err)

	_, err = rootDB.Exec("GRANT " + databaseName + " to " + databaseName)
	require.NoError(t, err)

	dbUrl := "clickhouse://" + databaseName + "@localhost:9000/" + databaseName
	u, _ := url.Parse(dbUrl)
	migrator := dbmate.New(u)
	migrator.MigrationsDir = []string{"migrations"}
	migrator.AutoDumpSchema = false

	require.NoError(t, migrator.Wait())

	require.NoError(t, migrator.Migrate())

	t.Cleanup(func() {
		_, err := rootDB.Exec("DROP DATABASE " + databaseName)
		require.NoError(t, err)

		_, err = rootDB.Exec("DROP USER " + databaseName)
		require.NoError(t, err)

		_, err = rootDB.Exec("DROP ROLE " + databaseName)
		require.NoError(t, err)
	})

	testDB := clickhouse.OpenDB(&clickhouse.Options{
		Addr:     []string{"localhost:8123"},
		Protocol: clickhouse.HTTP,
		Settings: map[string]any{
			"insert_quorum":                 "1",
			"insert_quorum_parallel":        "0",
			"select_sequential_consistency": "1",
		},
		Auth: clickhouse.Auth{
			Database: databaseName,
			Username: databaseName,
		},
	})

	return testDB
}
