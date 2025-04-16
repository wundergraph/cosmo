// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class SubscriptionSuccessSubscription: GraphQLSubscription {
  public static let operationName: String = "SubscriptionSuccess"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"subscription SubscriptionSuccess { countEmp2(max: 3, intervalMilliseconds: 500) }"#
    ))

  public init() {}

  public struct Data: ApolloSwift.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { ApolloSwift.Objects.Subscription }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("countEmp2", Int.self, arguments: [
        "max": 3,
        "intervalMilliseconds": 500
      ]),
    ] }

    public var countEmp2: Int { __data["countEmp2"] }
  }
}
