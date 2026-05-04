package core

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
)

func TestMapProtoFilterToPlanFilter(t *testing.T) {
	t.Parallel()

	t.Run("returns nil for nil input", func(t *testing.T) {
		t.Parallel()
		got := mapProtoFilterToPlanFilter(nil, &plan.SubscriptionFilterCondition{})
		assert.Nil(t, got)
	})

	t.Run("propagates BypassIfValuesNull=true onto IN", func(t *testing.T) {
		t.Parallel()

		flag := true
		input := &nodev1.SubscriptionFilterCondition{
			In: &nodev1.SubscriptionFieldCondition{
				FieldPath:          []string{"productName"},
				Json:               `["foo"]`,
				BypassIfValuesNull: &flag,
			},
		}

		got := mapProtoFilterToPlanFilter(input, &plan.SubscriptionFilterCondition{})
		require.NotNil(t, got)
		require.NotNil(t, got.In)
		assert.Equal(t, &plan.SubscriptionFieldCondition{
			FieldPath:          []string{"productName"},
			Values:             []string{`"foo"`},
			BypassIfValuesNull: true,
		}, got.In)
	})

	t.Run("treats unset BypassIfValuesNull as false on IN", func(t *testing.T) {
		t.Parallel()

		input := &nodev1.SubscriptionFilterCondition{
			In: &nodev1.SubscriptionFieldCondition{
				FieldPath: []string{"productName"},
				Json:      `["foo"]`,
			},
		}

		got := mapProtoFilterToPlanFilter(input, &plan.SubscriptionFilterCondition{})
		require.NotNil(t, got)
		require.NotNil(t, got.In)
		assert.Equal(t, &plan.SubscriptionFieldCondition{
			FieldPath:          []string{"productName"},
			Values:             []string{`"foo"`},
			BypassIfValuesNull: false,
		}, got.In)
	})

	t.Run("treats explicit BypassIfValuesNull=false as false on IN", func(t *testing.T) {
		t.Parallel()

		flag := false
		input := &nodev1.SubscriptionFilterCondition{
			In: &nodev1.SubscriptionFieldCondition{
				FieldPath:          []string{"productName"},
				Json:               `["foo"]`,
				BypassIfValuesNull: &flag,
			},
		}

		got := mapProtoFilterToPlanFilter(input, &plan.SubscriptionFilterCondition{})
		require.NotNil(t, got)
		require.NotNil(t, got.In)
		assert.Equal(t, &plan.SubscriptionFieldCondition{
			FieldPath:          []string{"productName"},
			Values:             []string{`"foo"`},
			BypassIfValuesNull: false,
		}, got.In)
	})

	t.Run("propagates BypassIfValuesNull through nested OR", func(t *testing.T) {
		t.Parallel()

		flag := true
		input := &nodev1.SubscriptionFilterCondition{
			Or: []*nodev1.SubscriptionFilterCondition{
				{
					In: &nodev1.SubscriptionFieldCondition{
						FieldPath:          []string{"id"},
						Json:               `["1"]`,
						BypassIfValuesNull: &flag,
					},
				},
				{
					In: &nodev1.SubscriptionFieldCondition{
						FieldPath: []string{"id"},
						Json:      `["2"]`,
					},
				},
			},
		}

		got := mapProtoFilterToPlanFilter(input, &plan.SubscriptionFilterCondition{})
		require.NotNil(t, got)
		assert.Equal(t, []plan.SubscriptionFilterCondition{
			{
				In: &plan.SubscriptionFieldCondition{
					FieldPath:          []string{"id"},
					Values:             []string{`"1"`},
					BypassIfValuesNull: true,
				},
			},
			{
				In: &plan.SubscriptionFieldCondition{
					FieldPath:          []string{"id"},
					Values:             []string{`"2"`},
					BypassIfValuesNull: false,
				},
			},
		}, got.Or)
	})

	t.Run("propagates BypassIfValuesNull through AND > NOT", func(t *testing.T) {
		t.Parallel()

		flag := true
		input := &nodev1.SubscriptionFilterCondition{
			And: []*nodev1.SubscriptionFilterCondition{
				{
					Not: &nodev1.SubscriptionFilterCondition{
						In: &nodev1.SubscriptionFieldCondition{
							FieldPath:          []string{"id"},
							Json:               `["1"]`,
							BypassIfValuesNull: &flag,
						},
					},
				},
			},
		}

		got := mapProtoFilterToPlanFilter(input, &plan.SubscriptionFilterCondition{})
		require.NotNil(t, got)
		require.Len(t, got.And, 1)
		require.NotNil(t, got.And[0].Not)
		assert.Equal(t, &plan.SubscriptionFieldCondition{
			FieldPath:          []string{"id"},
			Values:             []string{`"1"`},
			BypassIfValuesNull: true,
		}, got.And[0].Not.In)
	})
}
