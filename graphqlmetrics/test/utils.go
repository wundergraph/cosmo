package test

import (
	"context"
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

func GetTestDatabase(t *testing.T) clickhouse.Conn {
	databaseName := xid.New().String()

	if defaultURL == "" {
		defaultURL = "localhost:9000"
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

	adminConn, err := clickhouse.Open(&clickhouse.Options{
		Addr:     []string{defaultURL},
		Protocol: clickhouse.Native,
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
	require.NoError(t, err)

	ctx := context.Background()

	err = adminConn.Exec(ctx, "CREATE ROLE "+databaseName)
	require.NoError(t, err)

	err = adminConn.Exec(ctx, "CREATE DATABASE "+databaseName)
	require.NoError(t, err)

	err = adminConn.Exec(ctx, "GRANT ALL ON "+databaseName+".* TO "+databaseName)
	require.NoError(t, err)

	err = adminConn.Exec(ctx, "CREATE USER "+databaseName+" IDENTIFIED with no_password")
	require.NoError(t, err)

	err = adminConn.Exec(ctx, "GRANT "+databaseName+" to "+databaseName)
	require.NoError(t, err)

	dbUrl := "clickhouse://" + databaseName + "@localhost:9000/" + databaseName
	u, _ := url.Parse(dbUrl)
	migrator := dbmate.New(u)
	migrator.MigrationsDir = []string{"migrations"}
	migrator.AutoDumpSchema = false

	require.NoError(t, migrator.Wait())

	require.NoError(t, migrator.Migrate())

	t.Cleanup(func() {
		err := adminConn.Exec(ctx, "DROP DATABASE "+databaseName)
		require.NoError(t, err)

		err = adminConn.Exec(ctx, "DROP USER "+databaseName)
		require.NoError(t, err)

		err = adminConn.Exec(ctx, "DROP ROLE "+databaseName)
		require.NoError(t, err)
	})

	testConn, err := clickhouse.Open(&clickhouse.Options{
		Addr:     []string{defaultURL},
		Protocol: clickhouse.Native,
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
	require.NoError(t, err)

	return testConn
}
