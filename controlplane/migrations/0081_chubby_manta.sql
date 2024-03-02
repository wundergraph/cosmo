DO $$ BEGIN
 CREATE TYPE "lint_rules" AS ENUM('FIELD_NAMES_SHOULD_BE_CAMEL_CASE', 'TYPE_NAMES_SHOULD_BE_PASCAL_CASE', 'SHOULD_NOT_HAVE_TYPE_PREFIX', 'SHOULD_NOT_HAVE_TYPE_SUFFIX', 'SHOULD_NOT_HAVE_INPUT_PREFIX', 'SHOULD_HAVE_INPUT_SUFFIX', 'SHOULD_NOT_HAVE_ENUM_PREFIX', 'SHOULD_NOT_HAVE_ENUM_SUFFIX', 'SHOULD_NOT_HAVE_INTERFACE_PREFIX', 'SHOULD_NOT_HAVE_INTERFACE_SUFFIX', 'ENUM_VALUES_SHOULD_BE_UPPER_CASE', 'ORDER_FIELDS', 'ORDER_ENUM_VALUES', 'ORDER_DEFINITIONS', 'ALL_TYPES_REQUIRE_DESCRIPTION', 'DISALLOW_CASE_INSENSITIVE_ENUM_VALUES', 'NO_TYPENAME_PREFIX_IN_TYPE_FIELDS', 'REQUIRE_DEPRECATION_REASON', 'REQUIRE_DEPRECATION_DATE');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "lint_severity" AS ENUM('warn', 'error');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "namespace_lint_check_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace_id" uuid NOT NULL,
	"lint_rule" "lint_rules" NOT NULL,
	"severity_level" "lint_severity" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schema_check_lint_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_check_id" uuid NOT NULL,
	"message" text,
	"is_error" boolean DEFAULT false,
	"location" json NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schema_checks" ADD COLUMN "has_lint_errors" boolean DEFAULT false;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "namespace_lint_check_config" ADD CONSTRAINT "namespace_lint_check_config_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "namespaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_check_lint_action" ADD CONSTRAINT "schema_check_lint_action_schema_check_id_schema_checks_id_fk" FOREIGN KEY ("schema_check_id") REFERENCES "schema_checks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
