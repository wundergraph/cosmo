package test

import (
	"database/sql"
	"github.com/ClickHouse/clickhouse-go/v2"
)

func GetTestDatabase() *sql.DB {
	db := clickhouse.OpenDB(&clickhouse.Options{
		Addr:     []string{"localhost:8123"},
		Protocol: clickhouse.HTTP,
		Settings: map[string]any{
			"insert_quorum":                 "1",
			"insert_quorum_parallel":        "0",
			"select_sequential_consistency": "1",
		},
		Auth: clickhouse.Auth{
			Database: "cosmo",
			Username: "default",
			Password: "changeme",
		},
	})
	return db
}
