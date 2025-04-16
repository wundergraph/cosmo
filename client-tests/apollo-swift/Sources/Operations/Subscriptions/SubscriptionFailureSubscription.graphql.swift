// @generated
// This file was automatically generated and should not be edited.

@_exported import ApolloAPI

public class SubscriptionFailureSubscription: GraphQLSubscription {
  public static let operationName: String = "SubscriptionFailure"
  public static let operationDocument: ApolloAPI.OperationDocument = .init(
    definition: .init(
      #"subscription SubscriptionFailure { countEmpTest2(max: 4, intervalMilliseconds: 3000) }"#
    ))

  public init() {}

  public struct Data: ApolloSwift.SelectionSet {
    public let __data: DataDict
    public init(_dataDict: DataDict) { __data = _dataDict }

    public static var __parentType: any ApolloAPI.ParentType { ApolloSwift.Objects.Subscription }
    public static var __selections: [ApolloAPI.Selection] { [
      .field("countEmpTest2", Int.self, arguments: [
        "max": 4,
        "intervalMilliseconds": 3000
      ]),
    ] }

    public var countEmpTest2: Int { __data["countEmpTest2"] }
  }
}
