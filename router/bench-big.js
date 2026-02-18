import http from 'k6/http';
import {check} from 'k6';

export const options = {
  stages: [
    { duration: '1s', target: 100 },
    { duration: '10s', target: 200 },
  ],
};

// oha http://localhost:3002/graphql -n 100 -z 10s -H 'content-type: application/json' -d '{"query":"  query Bench {\n    employees {\n      details {\n        forename\n      }\n    }\n}","operationName":"Bench"}'

export default function () {
  let query = `
query ListingById(
  $listingInput: ListingV2ByIdInput!, 
  $basiclistingdata: Boolean!, 
  $lclistingprovider: Boolean!, 
  $sapsvc: Boolean!, 
  $web3arianee: Boolean!, 
  $itmvzblit: Boolean!, 
  $itemcompatibilitysvc: Boolean!, 
  $mdmlusvcio: Boolean!) {
  listingV2ById(listingInput: $listingInput) {
    listing {
      listingId
      category {
        primaryCategory {
          id
        }
        secondaryCategory {
          id
        }
        storePrimaryCategory {
          id
          user {
            legacyUserId
          }
        }
        storeSecondaryCategory {
          id
          user {
            legacyUserId
          }
        }
      }
      marketplaceId
      applicationId
      aspects {
        name
        values
      }
      autoRelistTerms {
        autoRelist
        canAutoRelist
      }
      bestOfferEnabled
      bestOfferTerms {
        acceptBestOffer
        autoAcceptEnabled
        autoAcceptThresholdPrice {
          converted {
            amount
            currency
          }
          original {
            amount
            currency
          }
        }
        autoDeclineEnabled
        autoDeclineThresholdPrice {
          converted {
            amount
            currency
          }
          original {
            amount
            currency
          }
        }
      }
      buyerRestrictions {
        buyerRestrictionModifiedDate
        disableBuyerRestrictions
        purchaseRateRequirement {
          minimumFeedbackScore
          quantityLimitPerBuyer
        }
        quantityLimitPerBuyer
        residencyInShipToLocation
        restrictedBidding
        restrictedToBusinessUser
        unpaidTransactionStrikesThreshold {
          count
          period
        }
      }
      buyerRestrictionsDisabled
      charity {
        charityId
        charityOrganization {
          id
        }
        donationPercentage
      }
      coreListingVersionId
      creationDate
      creationMode
      customPolicies {
        productCompliancePolicyIds
        regionalProductCompliancePolicies {
          countryPolicies {
            country
            countryCode
            policyIds
          }
        }
        regionalTakeBackPolicies {
          countryPolicies {
            country
            countryCode
            policyIds
          }
        }
        takeBackPolicyId
      }
      descriptionRevisionDate
      draftId
      ebayCommunity {
        communityIds
        marketplaceVisibility
      }
      ebayVault
      endReason
      enrolledInPriceGuarantee
      fulfillmentTerms {
        digitalDeliveryLogisticsPlanSupported
        digitalDeliverySupported
        ebayManagedShipping
        freeShippingAvailable
        globalShippingLogisticsPlanSupported
        globalShippingSupported
        inStorePickupLogisticsPlanSupported
        inStorePickupSupported
        managedFulfillmentSupported
        managedShippingCostPaidBy
        managedShippingOptin
        overrideShippingOptions {
          additionalUnitShippingCost {
            converted {
              amount
              currency
            }
            original {
              amount
              currency
            }
          }
          internationalShippingService
          isInternational
          rank
          shippingCost {
            converted {
              amount
              currency
            }
            original {
              amount
              currency
            }
          }
        }
        packageSpec {
          depth
          irregularPackage
          length
          listingPackageType
          listingUnitOfMeasure
          majorWeight
          minorWeight
          packageDimensions {
            height
            length
            unit
            width
          }
          packageType
          packageWeight {
            majorUnit
            minorUnit
            unit
          }
          unitOfMeasure
          width
        }
        packageSpecifications {
          depth
          irregularPackage
          length
          listingPackageType
          listingUnitOfMeasure
          majorWeight
          minorWeight
          packageDimensions {
            height
            length
            unit
            width
          }
          packageType
          packageWeight {
            majorUnit
            minorUnit
            unit
          }
          unitOfMeasure
          width
        }
        shipToHomeLogisticsPlanSupported
        shippingTerms {
          businessPolicy {
            id
          }
          businessPolicyIdentifier {
            policyId
            versionId
          }
          buyerResponsibleForShipping
          domesticShippingOptions {
            costType
            internationalShippingService
            isInternational
            promotionalShipping
            rateTableId
            shippingCostType
            shippingDiscountProfileId
            shippingServices {
              additionalUnitShippingCost {
                converted {
                  amount
                  currency
                }
                original {
                  amount
                  currency
                }
              }
              includedShipToLocations {
                continent
                country
                region
              }
              packageHandlingCost {
                converted {
                  amount
                  currency
                }
                original {
                  amount
                  currency
                }
              }
              rank
              shipToLocations
              shippingCost {
                converted {
                  amount
                  currency
                }
                original {
                  amount
                  currency
                }
              }
              shippingServiceCode
              shippingServiceOptionCode
            }
          }
          excludeShipToLocations
          excludedShipToLocations {
            continent
            country
            region
          }
          handlingTime
          handlingTimeDuration
          includedShipToLocations {
            continent
            country
            region
          }
          internationalShippingOptions {
            costType
            internationalShippingService
            isInternational
            promotionalShipping
            rateTableId
            shippingCostType
            shippingDiscountProfileId
            shippingServices {
              additionalUnitShippingCost {
                converted {
                  amount
                  currency
                }
                original {
                  amount
                  currency
                }
              }
              includedShipToLocations {
                continent
                country
                region
              }
              packageHandlingCost {
                converted {
                  amount
                  currency
                }
                original {
                  amount
                  currency
                }
              }
              rank
              shipToLocations
              shippingCost {
                converted {
                  amount
                  currency
                }
                original {
                  amount
                  currency
                }
              }
              shippingServiceCode
              shippingServiceOptionCode
            }
          }
          shipToLocations
          shippingBusinessPolicy {
            businessPolicy {
              id
            }
            overrideShippingOptions {
              additionalUnitShippingCost {
                converted {
                  amount
                  currency
                }
                original {
                  amount
                  currency
                }
              }
              internationalShippingService
              isInternational
              rank
              shippingCost {
                converted {
                  amount
                  currency
                }
                original {
                  amount
                  currency
                }
              }
            }
          }
          shippingOptions {
            costType
            internationalShippingService
            isInternational
            promotionalShipping
            rateTableId
            shippingCostType
            shippingDiscountProfileId
            shippingServices {
              additionalUnitShippingCost {
                converted {
                  amount
                  currency
                }
                original {
                  amount
                  currency
                }
              }
              includedShipToLocations {
                continent
                country
                region
              }
              packageHandlingCost {
                converted {
                  amount
                  currency
                }
                original {
                  amount
                  currency
                }
              }
              rank
              shipToLocations
              shippingCost {
                converted {
                  amount
                  currency
                }
                original {
                  amount
                  currency
                }
              }
              shippingServiceCode
              shippingServiceOptionCode
            }
          }
        }
      }
      hasCompatibilityInfo
      hideParticipation
      inventoryTrackingMethod
      isItemOnSale
      itemCompatibilities {
        compatibilityNotes
        propertiesList {
          name
          values
        }
      }
      itemCondition {
        categoryId
        conditionDescription
        conditionDescriptors {
          additionalInfo
          conditionDescriptor {
            categoryId
            id
          }
          conditionDescriptorValues {
            categoryId
            id
          }
          id
          openText
          values {
            categoryId
            id
          }
        }
        id
        itemConditionDescriptors {
          additionalInfo
          conditionDescriptor {
            categoryId
            id
          }
          conditionDescriptorValues {
            categoryId
            id
          }
          id
          openText
          values {
            categoryId
            id
          }
        }
        sellerConditionDescription
      }
      itemLocation {
        country
        countryCode
        location
        postalCode
        streetAddress
      }
      itemRevisionDate
      items {
        itemId
        listing {
          listingId
        }
        creationDate
        extendedProducerResponsibility {
          ecoParticipationFee
          ecoParticipationFees {
            converted {
              amount
              currency
            }
            original {
              amount
              currency
            }
          }
          producerProductId
          productDocumentationId
          productPackageId
          shipmentPackageId
        }
        itemSellerProduct {
          globalIdentifiers {
            name
            values
          }
          images {
            ebayImageUrl
            externalImageUrl
            order
          }
          productIdentifiers {
            ebayProduct {
              id
            }
            globalIdentifiers {
              ean
              isbn
              upc
            }
            includeEbayProductDetails
          }
          traits {
            name
            value
          }
          videos {
            id
          }
        }
        itemTerms {
          availability {
            quantityAvailable
            quantitySold
          }
          extendedProducerResponsibility {
            ecoParticipationFee
            ecoParticipationFees {
              converted {
                amount
                currency
              }
              original {
                amount
                currency
              }
            }
            producerProductId
            productDocumentationId
            productPackageId
            shipmentPackageId
          }
          fulfillmentTerms {
            managedFulfillmentSupported
          }
          pricingTerms {
            auctionPrice {
              reservePrice {
                converted {
                  amount
                  currency
                }
                original {
                  amount
                  currency
                }
              }
              startingBidPrice {
                converted {
                  amount
                  currency
                }
                original {
                  amount
                  currency
                }
              }
              startingBidPriceWithHighPrecision {
                converted {
                  amount
                  currency
                }
                original {
                  amount
                  currency
                }
              }
            }
            costOfGoods {
              converted {
                amount
                currency
              }
              original {
                amount
                currency
              }
            }
            fixedPrice {
              converted {
                amount
                currency
              }
              original {
                amount
                currency
              }
            }
            fixedPriceWithHighPrecision {
              converted {
                amount
                currency
              }
              original {
                amount
                currency
              }
            }
            marketingPrice {
              madeForOutletComparisonPrice {
                converted {
                  amount
                  currency
                }
                original {
                  amount
                  currency
                }
              }
              minimumAdvertisedPrice {
                converted {
                  amount
                  currency
                }
                original {
                  amount
                  currency
                }
              }
              minimumAdvertisedPriceExposure
              originalRetailPrice {
                converted {
                  amount
                  currency
                }
                original {
                  amount
                  currency
                }
              }
              soldOffEbay
              soldOnEbay
            }
          }
        }
        listingItemId
        photos {
          ebayPictureUrl
          externalPictureUrl
          order
        }
        product {
          globalIdentifiers {
            name
            values
          }
          images {
            ebayImageUrl
            externalImageUrl
            order
          }
          productIdentifiers {
            ebayProduct {
              id
            }
            globalIdentifiers {
              ean
              isbn
              upc
            }
            includeEbayProductDetails
          }
          traits {
            name
            value
          }
          videos {
            id
          }
        }
        quantityAvailable
        quantitySold
        sellerPrice {
          auctionReservePrice {
            converted {
              amount
              currency
            }
            original {
              amount
              currency
            }
          }
          costOfGoods {
            converted {
              amount
              currency
            }
            original {
              amount
              currency
            }
          }
          fixedPrice {
            converted {
              amount
              currency
            }
            original {
              amount
              currency
            }
          }
          fixedPriceWithHighPrecision {
            converted {
              amount
              currency
            }
            original {
              amount
              currency
            }
          }
          marketingPrice {
            madeForOutletComparisonPrice {
              converted {
                amount
                currency
              }
              original {
                amount
                currency
              }
            }
            minimumAdvertisedPrice {
              converted {
                amount
                currency
              }
              original {
                amount
                currency
              }
            }
            minimumAdvertisedPriceExposure
            originalRetailPrice {
              converted {
                amount
                currency
              }
              original {
                amount
                currency
              }
            }
            pricingTreatment
            soldOffEbay
            soldOnEbay
          }
          originalPrice {
            converted {
              amount
              currency
            }
            original {
              amount
              currency
            }
          }
          startingBidPrice {
            converted {
              amount
              currency
            }
            original {
              amount
              currency
            }
          }
          startingBidPriceWithHighPrecision {
            converted {
              amount
              currency
            }
            original {
              amount
              currency
            }
          }
        }
        sku
        terms {
          fulfillmentTerms {
            managedFulfillmentSupported
          }
        }
        variationAspects {
          name
          values
        }
        videos {
          id
        }
      }
      listingCreationClientIP
      listingFormat
      listingLifecycle {
        actualEndDate
        createdAt
        duplicateAuction
        endDate
        endListingReason
        listedAsScheduled
        listingDuration
        listingDurationInDays
        listingStatus
        onHold
        scheduledEndAt
        scheduledEndDate
        startAt
        startDate
      }
      listingTerms {
        adsSellerContact {
          companyName
          contactByEmailEnabled
          country
          county
          phone
          primarySellerContactHours {
            anyTime
            supportHoursEnd
            supportHoursStart
            supportOnDays
          }
          secondarySellerContactHours {
            anyTime
            supportHoursEnd
            supportHoursStart
            supportOnDays
          }
          street1
          street2
        }
        bestOfferTerms {
          acceptBestOffer
          autoAcceptEnabled
          autoAcceptThresholdPrice {
            converted {
              amount
              currency
            }
            original {
              amount
              currency
            }
          }
          autoDeclineEnabled
          autoDeclineThresholdPrice {
            converted {
              amount
              currency
            }
            original {
              amount
              currency
            }
          }
        }
        buyerRestrictions {
          buyerRestrictionModifiedDate
          disableBuyerRestrictions
          purchaseRateRequirement {
            minimumFeedbackScore
            quantityLimitPerBuyer
          }
          quantityLimitPerBuyer
          residencyInShipToLocation
          restrictedBidding
          restrictedToBusinessUser
          unpaidTransactionStrikesThreshold {
            count
            period
          }
        }
        charity {
          charityId
          charityOrganization {
            id
          }
          donationPercentage
        }
        customPolicies {
          productCompliancePolicyIds
          regionalProductCompliancePolicies {
            countryPolicies {
              country
              countryCode
              policyIds
            }
          }
          regionalTakeBackPolicies {
            countryPolicies {
              country
              countryCode
              policyIds
            }
          }
          takeBackPolicyId
        }
        fulfillmentTerms {
          ... on BusinessPolicy {
            id
          }
          ... on FulfillmentTerms {
            digitalDeliveryLogisticsPlanSupported
            digitalDeliverySupported
            ebayManagedShipping
            freeShippingAvailable
            globalShippingLogisticsPlanSupported
            globalShippingSupported
            inStorePickupLogisticsPlanSupported
            inStorePickupSupported
            managedFulfillmentSupported
            managedShippingCostPaidBy
            managedShippingOptin
            overrideShippingOptions {
              additionalUnitShippingCost {
                converted {
                  amount
                  currency
                }
                original {
                  amount
                  currency
                }
              }
              internationalShippingService
              isInternational
              rank
              shippingCost {
                converted {
                  amount
                  currency
                }
                original {
                  amount
                  currency
                }
              }
            }
            packageSpec {
              depth
              irregularPackage
              length
              listingPackageType
              listingUnitOfMeasure
              majorWeight
              minorWeight
              packageDimensions {
                height
                length
                unit
                width
              }
              packageType
              packageWeight {
                majorUnit
                minorUnit
                unit
              }
              unitOfMeasure
              width
            }
            packageSpecifications {
              depth
              irregularPackage
              length
              listingPackageType
              listingUnitOfMeasure
              majorWeight
              minorWeight
              packageDimensions {
                height
                length
                unit
                width
              }
              packageType
              packageWeight {
                majorUnit
                minorUnit
                unit
              }
              unitOfMeasure
              width
            }
            shipToHomeLogisticsPlanSupported
            shippingTerms {
              businessPolicy {
                id
              }
              businessPolicyIdentifier {
                policyId
                versionId
              }
              buyerResponsibleForShipping
              domesticShippingOptions {
                costType
                internationalShippingService
                isInternational
                promotionalShipping
                rateTableId
                shippingCostType
                shippingDiscountProfileId
                shippingServices {
                  additionalUnitShippingCost {
                    converted {
                      amount
                      currency
                    }
                    original {
                      amount
                      currency
                    }
                  }
                  includedShipToLocations {
                    continent
                    country
                    region
                  }
                  packageHandlingCost {
                    converted {
                      amount
                      currency
                    }
                    original {
                      amount
                      currency
                    }
                  }
                  rank
                  shipToLocations
                  shippingCost {
                    converted {
                      amount
                      currency
                    }
                    original {
                      amount
                      currency
                    }
                  }
                  shippingServiceCode
                  shippingServiceOptionCode
                }
              }
              excludeShipToLocations
              excludedShipToLocations {
                continent
                country
                region
              }
              handlingTime
              handlingTimeDuration
              includedShipToLocations {
                continent
                country
                region
              }
              internationalShippingOptions {
                costType
                internationalShippingService
                isInternational
                promotionalShipping
                rateTableId
                shippingCostType
                shippingDiscountProfileId
                shippingServices {
                  additionalUnitShippingCost {
                    converted {
                      amount
                      currency
                    }
                    original {
                      amount
                      currency
                    }
                  }
                  includedShipToLocations {
                    continent
                    country
                    region
                  }
                  packageHandlingCost {
                    converted {
                      amount
                      currency
                    }
                    original {
                      amount
                      currency
                    }
                  }
                  rank
                  shipToLocations
                  shippingCost {
                    converted {
                      amount
                      currency
                    }
                    original {
                      amount
                      currency
                    }
                  }
                  shippingServiceCode
                  shippingServiceOptionCode
                }
              }
              shipToLocations
              shippingBusinessPolicy {
                businessPolicy {
                  id
                }
                overrideShippingOptions {
                  additionalUnitShippingCost {
                    converted {
                      amount
                      currency
                    }
                    original {
                      amount
                      currency
                    }
                  }
                  internationalShippingService
                  isInternational
                  rank
                  shippingCost {
                    converted {
                      amount
                      currency
                    }
                    original {
                      amount
                      currency
                    }
                  }
                }
              }
              shippingOptions {
                costType
                internationalShippingService
                isInternational
                promotionalShipping
                rateTableId
                shippingCostType
                shippingDiscountProfileId
                shippingServices {
                  additionalUnitShippingCost {
                    converted {
                      amount
                      currency
                    }
                    original {
                      amount
                      currency
                    }
                  }
                  includedShipToLocations {
                    continent
                    country
                    region
                  }
                  packageHandlingCost {
                    converted {
                      amount
                      currency
                    }
                    original {
                      amount
                      currency
                    }
                  }
                  rank
                  shipToLocations
                  shippingCost {
                    converted {
                      amount
                      currency
                    }
                    original {
                      amount
                      currency
                    }
                  }
                  shippingServiceCode
                  shippingServiceOptionCode
                }
              }
            }
          }
        }
        hideParticipation
        internationalSiteVisibility
        itemLocation {
          country
          countryCode
          location
          postalCode
          streetAddress
        }
        lifecycleTerms {
          actualEndDate
          createdAt
          duplicateAuction
          endDate
          endListingReason
          listedAsScheduled
          listingDuration
          listingDurationInDays
          listingStatus
          onHold
          scheduledEndAt
          scheduledEndDate
          startAt
          startDate
        }
        listingFormat
        localListingDistance {
          distance
          distanceUnit
        }
        lotSize
        paymentTerms {
          ... on BusinessPolicy {
            id
          }
          ... on PaymentTerms {
            businessPolicy {
              id
            }
            businessPolicyIdentifier {
              policyId
              versionId
            }
            daysToFullPayment
            depositAmount {
              converted {
                amount
                currency
              }
              original {
                amount
                currency
              }
            }
            depositRequired
            hoursToDeposit
            immediatePay
            listingPaymentMethods
            motorVehicleDepositDetails {
              daysToMakeFullPayment
              depositAmount {
                converted {
                  amount
                  currency
                }
                original {
                  amount
                  currency
                }
              }
              depositRequired
              hoursToDeposit
            }
            paymentInstructions
            paymentMethods
            paypalEmailAddress
          }
        }
        programsSupported
        regulatory {
          documents {
            id
          }
          economicOperator {
            city
            companyName
            country
            email
            phone
            postalCode
            stateOrProvince
            street1
            street2
          }
          energyEfficiencyLabel {
            image {
              ebayImageUrl
              externalImageUrl
              order
            }
            imageDescription
            imageUrl {
              ebayPictureUrl
              externalPictureUrl
              order
            }
            productDataSheet
            productInformationSheetUrl
          }
          hazardousMaterial {
            additionalInfo
            pictogramCodes
            pictogramIds
            signalWordCode
            signalWordId
            statementCodes
            statementIds
          }
          manufacturer {
            address {
              city
              country
              postalCode
              stateOrProvince
              street1
              street2
            }
            city
            companyName
            contact {
              contactUrl
              email
              phone
            }
            contactUrl
            country
            email
            phone
            postalCode
            stateOrProvince
            street1
            street2
          }
          productSafety {
            additionalInfo
            pictogramCodes
            pictogramIds
            statementCodes
            statementIds
          }
          repairIndexScore
          responsiblePersons {
            address {
              city
              country
              postalCode
              stateOrProvince
              street1
              street2
            }
            city
            companyName
            contact {
              contactUrl
              email
              phone
            }
            contactUrl
            country
            email
            personTypes
            phone
            postalCode
            stateOrProvince
            street1
            street2
          }
        }
        returnTerms {
          ... on BusinessPolicy {
            id
          }
          ... on ReturnTerms {
            businessPolicy {
              id
            }
            businessPolicyIdentifier {
              policyId
              versionId
            }
            domesticReturnTerms {
              listingRefundMethod
              refundMethod
              returnAccepted
              returnDuration
              returnPeriod
              returnShipmentInvoicee
              returnShipmentPayee
            }
            internationalReturnTerms {
              listingRefundMethod
              refundMethod
              returnAccepted
              returnDuration
              returnPeriod
              returnShipmentInvoicee
              returnShipmentPayee
            }
            returnInstructions
          }
        }
        sellerCustomData
        taxTerms {
          applicableToShipping
          recognizedAsBusinessSellerForVAT
          salesTaxApplicableToShipping
          salesTaxJurisdictionId
          salesTaxPercentage
          salesTaxTableUsed
          state
          taxRate
          thirdPartyTaxCategoryCode
          vatPercentage
          vatRecognizedBusinessSeller
          vatRestrictedToBusinessUser
        }
        totalQuantityAvailable
        visualEnhancements {
          boldTitle
          featuredPlus
          galleryDuration
          galleryPlus
          galleryType
          homePageFeatured
          listingDesignerOptimalPictureSize
          photoDisplayType
          subtitle
        }
      }
      lotSize
      managedByInventory
      marketplace
      minimumRemnantSet
      notes
      outOfStockDate
      partnerListedAutosDealerItem
      paymentTerms {
        businessPolicy {
          id
        }
        businessPolicyIdentifier {
          policyId
          versionId
        }
        daysToFullPayment
        depositAmount {
          converted {
            amount
            currency
          }
          original {
            amount
            currency
          }
        }
        depositRequired
        hoursToDeposit
        immediatePay
        listingPaymentMethods
        motorVehicleDepositDetails {
          daysToMakeFullPayment
          depositAmount {
            converted {
              amount
              currency
            }
            original {
              amount
              currency
            }
          }
          depositRequired
          hoursToDeposit
        }
        paymentInstructions
        paymentMethods
        paypalEmailAddress
      }
      photos {
        ebayPictureUrl
        externalPictureUrl
        order
      }
      product {
        aspects {
          name
          values
        }
        categories {
          primaryCategory {
            id
          }
          secondaryCategory {
            id
          }
          storePrimaryCategory {
            id
            user {
              legacyUserId
            }
          }
          storeSecondaryCategory {
            id
            user {
              legacyUserId
            }
          }
        }
        description
        descriptionRevisionDate
        ebayGeneratedTitle
        epid {
          id
        }
        globalIdentifiers {
          name
          values
        }
        hasCompatibilityInfo
        images {
          ebayImageUrl
          externalImageUrl
          order
        }
        includeeBayProductDetails
        itemCompatibilities {
          compatibilityNotes
          propertiesList {
            name
            values
          }
        }
        itemCondition {
          categoryId
          conditionDescription
          conditionDescriptors {
            additionalInfo
            conditionDescriptor {
              categoryId
              id
            }
            conditionDescriptorValues {
              categoryId
              id
            }
            id
            openText
            values {
              categoryId
              id
            }
          }
          id
          itemConditionDescriptors {
            additionalInfo
            conditionDescriptor {
              categoryId
              id
            }
            conditionDescriptorValues {
              categoryId
              id
            }
            id
            openText
            values {
              categoryId
              id
            }
          }
          sellerConditionDescription
        }
        motorVehicleIdentifier {
          vin
          vrm
        }
        title
        videos {
          id
        }
      }
      productGalleryFallbackURL
      programsSupported
      regulatoryInfo {
        documents {
          id
        }
        economicOperator {
          city
          companyName
          country
          email
          phone
          postalCode
          stateOrProvince
          street1
          street2
        }
        energyEfficiencyLabel {
          image {
            ebayImageUrl
            externalImageUrl
            order
          }
          imageDescription
          imageUrl {
            ebayPictureUrl
            externalPictureUrl
            order
          }
          productDataSheet
          productInformationSheetUrl
        }
        hazardousMaterial {
          additionalInfo
          pictogramCodes
          pictogramIds
          signalWordCode
          signalWordId
          statementCodes
          statementIds
        }
        manufacturer {
          address {
            city
            country
            postalCode
            stateOrProvince
            street1
            street2
          }
          city
          companyName
          contact {
            contactUrl
            email
            phone
          }
          contactUrl
          country
          email
          phone
          postalCode
          stateOrProvince
          street1
          street2
        }
        productSafety {
          additionalInfo
          pictogramCodes
          pictogramIds
          statementCodes
          statementIds
        }
        repairIndexScore
        responsiblePersons {
          address {
            city
            country
            postalCode
            stateOrProvince
            street1
            street2
          }
          city
          companyName
          contact {
            contactUrl
            email
            phone
          }
          contactUrl
          country
          email
          personTypes
          phone
          postalCode
          stateOrProvince
          street1
          street2
        }
      }
      relistId
      relistParentListingId
      returnTerms {
        businessPolicy {
          id
        }
        businessPolicyIdentifier {
          policyId
          versionId
        }
        domesticReturnTerms {
          listingRefundMethod
          refundMethod
          returnAccepted
          returnDuration
          returnPeriod
          returnShipmentInvoicee
          returnShipmentPayee
        }
        internationalReturnTerms {
          listingRefundMethod
          refundMethod
          returnAccepted
          returnDuration
          returnPeriod
          returnShipmentInvoicee
          returnShipmentPayee
        }
        returnInstructions
      }
      secondChanceItem
      seller {
        legacyUserId
      }
      sellerApplicationData
      sellerListingVersionId
      sellerProduct {
        aspects {
          name
          values
        }
        categories {
          primaryCategory {
            id
          }
          secondaryCategory {
            id
          }
          storePrimaryCategory {
            id
            user {
              legacyUserId
            }
          }
          storeSecondaryCategory {
            id
            user {
              legacyUserId
            }
          }
        }
        description
        descriptionRevisionDate
        ebayGeneratedTitle
        epid {
          id
        }
        globalIdentifiers {
          name
          values
        }
        hasCompatibilityInfo
        images {
          ebayImageUrl
          externalImageUrl
          order
        }
        includeeBayProductDetails
        itemCompatibilities {
          compatibilityNotes
          propertiesList {
            name
            values
          }
        }
        itemCondition {
          categoryId
          conditionDescription
          conditionDescriptors {
            additionalInfo
            conditionDescriptor {
              categoryId
              id
            }
            conditionDescriptorValues {
              categoryId
              id
            }
            id
            openText
            values {
              categoryId
              id
            }
          }
          id
          itemConditionDescriptors {
            additionalInfo
            conditionDescriptor {
              categoryId
              id
            }
            conditionDescriptorValues {
              categoryId
              id
            }
            id
            openText
            values {
              categoryId
              id
            }
          }
          sellerConditionDescription
        }
        motorVehicleIdentifier {
          vin
          vrm
        }
        title
        videos {
          id
        }
      }
      significantRevisionCount
      supportContact {
        companyName
        contactByEmailEnabled
        country
        primaryPhone
        primarySupportContactHours {
          anyTime
          supportHoursEnd
          supportHoursStart
          supportOnDays
        }
        secondarySupportContactHours {
          anyTime
          supportHoursEnd
          supportHoursStart
          supportOnDays
        }
      }
      taxInfo {
        applicableToShipping
        recognizedAsBusinessSellerForVAT
        salesTaxApplicableToShipping
        salesTaxJurisdictionId
        salesTaxPercentage
        salesTaxTableUsed
        state
        taxRate
        thirdPartyTaxCategoryCode
        vatPercentage
        vatRecognizedBusinessSeller
        vatRestrictedToBusinessUser
      }
      totalQuantity
      tradingScope {
        internationalSiteVisibility
        localListingDistance
      }
      vehicleIdentifiers {
        name
        values
      }
      vehiclePackageId
      videos {
        id
      }
      visualEnhancements {
        boldTitle
        featuredPlus
        galleryDuration
        galleryPlus
        galleryType
        homePageFeatured
        listingDesignerOptimalPictureSize
        photoDisplayType
        subtitle
      }
      warrantyTerms {
        duration
        type
      }
      ... on VariationListing {
        externalGroupId
        imagesVaryByAspect {
          name
          values {
            aspectValue
            images {
              ebayPictureUrl
              externalPictureUrl
              order
            }
          }
        }
        itemsVaryByAspect {
          name
          values
        }
        maxPrice {
          converted {
            amount
            currency
          }
          original {
            amount
            currency
          }
        }
        minPrice {
          converted {
            amount
            currency
          }
          original {
            amount
            currency
          }
        }
        sku
        variationDetails {
          imagesVaryByTrait {
            traitName
            traitValueImages {
              traitImages {
                ebayImageUrl
                externalImageUrl
                order
              }
              traitValue
            }
          }
          variationTraits {
            name
            values
          }
        }
      }
      __typename
    }
    _basiclistingdata: listing @include(if: $basiclistingdata) {
      items {
        certifiedExpertInsight {
          certifiedExpertInsightAssetId
          certifiedExpertInsightClassification
        }
        watchCount
        itemId
      }
      listingId
    }
    _lclistingprovider: listing @include(if: $lclistingprovider) {
      ebayLive {
        liveEvents {
          id
        }
        purchasable
        visible
      }
      listingId
    }
    _sapsvc: listing @include(if: $sapsvc) {
      items {
        autoTagProduct {
          id
        }
        itemId
      }
      listingId
    }
    _web3arianee: listing @include(if: $web3arianee) {
      items {
        hasDigitalPassportLink
        itemId
      }
      listingId
    }
    _itmvzblit: listing @include(if: $itmvzblit) {
      visibilitySummary {
        defaultVisibleSites
        explicitlySuppressedSites
        packedVisibilityString
      }
      listingId
    }
    _itemcompatibilitysvc: listing @include(if: $itemcompatibilitysvc) {
      items {
        compatibilities {
          computedCompatibilitiesByMarketplace {
            compatibilityNotionalProfileGrouping {
              id
            }
            marketplaceId
            searchConfig {
              id
            }
          }
        }
        itemId
      }
      listingId
    }
    _mdmlusvcio: listing @include(if: $mdmlusvcio) {
      items {
        markdownDiscountDuration {
          id
          promoSaleEndDateTime
          promoSaleStartDateTime
        }
        itemId
      }
      listingId
    }
  }
}

`;

  let headers = {
    'Content-Type': 'application/json',
    'GraphQL-Client-Name': 'k6',
    'GraphQL-Client-Version': '0.0.1',
  };

  let variables =`
{
  "listingInput": {"fromArchive": true, "listingId": 1123, "listingVersionId": 12},
  "itemcompatibilitysvc": true,
  "mdmlusvcio": true,
  "basiclistingdata": true,
  "lclistingprovider": false,
  "sapsvc": false,
  "web3arianee": false,
  "itmvzblit": false
}`;
  let res = http.post('http://localhost:3002/graphql', JSON.stringify({ query: query, operationName: 'ListingById'}), {
    headers: headers,
      variables: variables,
  });
  check(res, {
    'is status 200': (r) => r.status === 200 && r.body.includes('errors') === false,
  });
}
