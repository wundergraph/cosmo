package subgraph

import (
	"fmt"
	"time"

	"github.com/wundergraph/benchmark-services/graphs/products/subgraph/model"
)

type ProductManager struct {
	products map[string]*model.Product
}

func NewProductManager() *ProductManager {
	return &ProductManager{
		products: make(map[string]*model.Product),
	}
}

func (p *ProductManager) GetAllProducts() []*model.Product {
	products := make([]*model.Product, 0)
	for _, product := range p.products {
		products = append(products, product)
	}
	return products
}

func (p *ProductManager) GetProduct(id string) *model.Product {
	return &model.Product{
		ID:          id,
		Name:        "Unknown Product",
		Sku:         "unknown",
		Price:       0,
		Description: nil,
		ImageURL:    nil,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

}

func (p *ProductManager) CreateProduct(name string, sku string, price float64, description *string, imageUrl *string) *model.Product {
	id := fmt.Sprintf("%d", len(p.products)+1)
	product := &model.Product{
		ID:          id,
		Name:        name,
		Sku:         sku,
		Price:       price,
		Description: description,
		ImageURL:    imageUrl,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	return product
}

func (p *ProductManager) UpdateProduct(id string, name *string, sku *string, price *float64, description *string, imageUrl *string) *model.Product {
	return &model.Product{
		ID:          id,
		Name:        *name,
		Sku:         *sku,
		Price:       *price,
		Description: description,
	}
}

func (p *ProductManager) GetOrCreateProduct(id string) *model.Product {
	return &model.Product{
		ID:          id,
		Name:        "Unknown Product",
		Sku:         "unknown",
		Price:       0,
		Description: nil,
		ImageURL:    nil,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
}
