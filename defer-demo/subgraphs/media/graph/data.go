package graph

import "deferdemo/media/graph/model"

// Fixed, deterministic mock data per FIXTURES.md §8.

var imageAssets = map[string]*model.ImageAsset{
	"i1": {ID: "i1", URL: "https://cdn.example.com/img/i1.jpg", Width: 1200, Height: 630},
}

var videoAssets = map[string]*model.VideoAsset{
	"v1": {ID: "v1", URL: "https://cdn.example.com/vid/v1.mp4", DurationSeconds: 300, TranscodeProgress: 0.75},
}

var mediaAssets = map[string]*model.MediaAsset{
	"m1": {ID: "m1", StorageKey: "s3://bucket/m1"},
}

// heroImageUrl values media takes ownership of via @override(from: "content").
var articleHeroImageURLs = map[string]string{
	"a1": "https://cdn.example.com/hero/a1.jpg",
	"a2": "https://cdn.example.com/hero/a2.jpg",
}

// assetByID resolves an id to whichever concrete Asset member owns it.
func assetByID(id string) model.Asset {
	if a, ok := imageAssets[id]; ok {
		return a
	}
	if a, ok := videoAssets[id]; ok {
		return a
	}
	return nil
}
