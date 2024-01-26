// Code generated by github.com/99designs/gqlgen, DO NOT EDIT.

package model

import (
	"fmt"
	"io"
	"strconv"
)

type Products interface {
	IsProducts()
}

type TopSecretFact interface {
	IsTopSecretFact()
	GetDescription() string
	GetFactType() *TopSecretFactType
}

type Consultancy struct {
	Upc  string      `json:"upc"`
	Name ProductName `json:"name"`
}

func (Consultancy) IsProducts() {}

func (Consultancy) IsEntity() {}

type Cosmo struct {
	Upc           string      `json:"upc"`
	Name          ProductName `json:"name"`
	RepositoryURL string      `json:"repositoryURL"`
}

func (Cosmo) IsProducts() {}

func (Cosmo) IsEntity() {}

type DirectiveFact struct {
	Title       string             `json:"title"`
	Description string             `json:"description"`
	FactType    *TopSecretFactType `json:"factType,omitempty"`
}

func (DirectiveFact) IsTopSecretFact()                     {}
func (this DirectiveFact) GetDescription() string          { return this.Description }
func (this DirectiveFact) GetFactType() *TopSecretFactType { return this.FactType }

type Documentation struct {
	URL  string   `json:"url"`
	Urls []string `json:"urls"`
}

func (Documentation) IsProducts() {}

type Employee struct {
	ID       int           `json:"id"`
	Products []ProductName `json:"products"`
	Notes    *string       `json:"notes,omitempty"`
}

func (Employee) IsEntity() {}

type EntityFact struct {
	Title       string             `json:"title"`
	Description string             `json:"description"`
	FactType    *TopSecretFactType `json:"factType,omitempty"`
}

func (EntityFact) IsTopSecretFact()                     {}
func (this EntityFact) GetDescription() string          { return this.Description }
func (this EntityFact) GetFactType() *TopSecretFactType { return this.FactType }

type MiscellaneousFact struct {
	Title       string             `json:"title"`
	Description string             `json:"description"`
	FactType    *TopSecretFactType `json:"factType,omitempty"`
}

func (MiscellaneousFact) IsTopSecretFact()                     {}
func (this MiscellaneousFact) GetDescription() string          { return this.Description }
func (this MiscellaneousFact) GetFactType() *TopSecretFactType { return this.FactType }

type ProductName string

const (
	ProductNameConsultancy    ProductName = "CONSULTANCY"
	ProductNameCosmo          ProductName = "COSMO"
	ProductNameEngine         ProductName = "ENGINE"
	ProductNameFinance        ProductName = "FINANCE"
	ProductNameHumanResources ProductName = "HUMAN_RESOURCES"
	ProductNameMarketing      ProductName = "MARKETING"
	ProductNameSdk            ProductName = "SDK"
)

var AllProductName = []ProductName{
	ProductNameConsultancy,
	ProductNameCosmo,
	ProductNameEngine,
	ProductNameFinance,
	ProductNameHumanResources,
	ProductNameMarketing,
	ProductNameSdk,
}

func (e ProductName) IsValid() bool {
	switch e {
	case ProductNameConsultancy, ProductNameCosmo, ProductNameEngine, ProductNameFinance, ProductNameHumanResources, ProductNameMarketing, ProductNameSdk:
		return true
	}
	return false
}

func (e ProductName) String() string {
	return string(e)
}

func (e *ProductName) UnmarshalGQL(v interface{}) error {
	str, ok := v.(string)
	if !ok {
		return fmt.Errorf("enums must be strings")
	}

	*e = ProductName(str)
	if !e.IsValid() {
		return fmt.Errorf("%s is not a valid ProductName", str)
	}
	return nil
}

func (e ProductName) MarshalGQL(w io.Writer) {
	fmt.Fprint(w, strconv.Quote(e.String()))
}

type TopSecretFactType string

const (
	TopSecretFactTypeDirective     TopSecretFactType = "DIRECTIVE"
	TopSecretFactTypeEntity        TopSecretFactType = "ENTITY"
	TopSecretFactTypeMiscellaneous TopSecretFactType = "MISCELLANEOUS"
)

var AllTopSecretFactType = []TopSecretFactType{
	TopSecretFactTypeDirective,
	TopSecretFactTypeEntity,
	TopSecretFactTypeMiscellaneous,
}

func (e TopSecretFactType) IsValid() bool {
	switch e {
	case TopSecretFactTypeDirective, TopSecretFactTypeEntity, TopSecretFactTypeMiscellaneous:
		return true
	}
	return false
}

func (e TopSecretFactType) String() string {
	return string(e)
}

func (e *TopSecretFactType) UnmarshalGQL(v interface{}) error {
	str, ok := v.(string)
	if !ok {
		return fmt.Errorf("enums must be strings")
	}

	*e = TopSecretFactType(str)
	if !e.IsValid() {
		return fmt.Errorf("%s is not a valid TopSecretFactType", str)
	}
	return nil
}

func (e TopSecretFactType) MarshalGQL(w io.Writer) {
	fmt.Fprint(w, strconv.Quote(e.String()))
}
