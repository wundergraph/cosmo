package test

import (
	"database/sql"
	"github.com/ClickHouse/clickhouse-go/v2"
)

func GetTestDatabase() *sql.DB {
	db := clickhouse.OpenDB(&clickhouse.Options{
		Addr:     []string{"localhost:8123"},
		Protocol: clickhouse.HTTP,
		Auth: clickhouse.Auth{
			Database: "cosmo",
			Username: "default",
			Password: "changeme",
		},
	})
	return db
}
