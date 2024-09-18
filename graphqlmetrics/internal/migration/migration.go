package migration

import (
	"fmt"
	"github.com/amacneil/dbmate/v2/pkg/dbmate"
	"go.uber.org/zap"
	"net/url"
)

func Migrate(clickhouseDSN string, logger *zap.Logger) error {
	chDNS, err := url.Parse(clickhouseDSN)
	if err != nil {
		return fmt.Errorf("could not parse clickhouseDSN %w", err)
	}

	migrator := dbmate.New(chDNS)
	migrator.MigrationsDir = []string{"migrations"}
	migrator.AutoDumpSchema = false
	migrator.Log = zap.NewStdLog(logger).Writer()
	migrator.MigrationsTableName = "graphqlmetrics_schema_migrations"

	if err := migrator.CreateAndMigrate(); err != nil {
		return fmt.Errorf("could not migrate %w", err)
	} else {
		logger.Info("Migration is up to date")
	}

	return nil
}
