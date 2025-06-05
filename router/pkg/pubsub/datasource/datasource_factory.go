package datasource

type PubSubDataSourceFactory[P, E any] struct {
	providerBuilder ProviderBuilder[P, E]
	event           E
}

func (p *PubSubDataSourceFactory[P, E]) BuildDataSource() (PubSubDataSource, error) {
	return p.providerBuilder.BuildDataSource(p.event)
}

func NewPubSubDataSourceFactory[P, E any](builder ProviderBuilder[P, E], event E) *PubSubDataSourceFactory[P, E] {
	return &PubSubDataSourceFactory[P, E]{
		providerBuilder: builder,
		event:           event,
	}
}
