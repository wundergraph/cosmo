import XCTest
import Foundation
import Apollo
@testable import ApolloSwift

final class ClientTestCases: XCTestCase {

    func testSuccessQuery() throws {
        let expectation = XCTestExpectation(description: "Test Success Query")
        
        let apolloClient = ApolloClient(url: URL(string: "http://localhost:3002/graphql")!)
        apolloClient.fetch(query: QuerySuccessQuery()) { result in
            switch result {
            case .success(let graphQLResult):
                guard let data = graphQLResult.data else {
                    XCTFail("No data returned")
                    expectation.fulfill()
                    return
                }
                XCTAssertEqual(data.employees?.count, 10)
                XCTAssertEqual(data.employees?[0]?.id, 1)
                XCTAssertEqual(data.employees?[0]?.isAvailable, false)
            case .failure(let error):
                XCTFail("Error fetching employee: \(error)")
            }
            expectation.fulfill()
        }
        
        wait(for: [expectation], timeout: 5.0)
    }
    
    func testSuccessSubscription() throws {
        let expectation = XCTestExpectation(description: "Test Success Subscription")
        var receivedCount = 0
        
        let apolloClient = ApolloClient(url: URL(string: "http://localhost:3002/graphql")!)
        let subscription = apolloClient.subscribe(subscription: SubscriptionSuccessSubscription()) { result in
            switch result {
            case .success(let graphQLResult):
                XCTAssertNil(graphQLResult.errors)
                XCTAssertEqual(graphQLResult.data?.countEmp2, receivedCount)
                receivedCount += 1
                
                if receivedCount >= 4 {
                    expectation.fulfill()
                }
            case .failure(let error):
                XCTFail("Error in subscription: \(error)")
                expectation.fulfill()
            }
        }
        
        wait(for: [expectation], timeout: 20.0)
        subscription.cancel()
    }
    
    func testFailureSubscription() throws {
        let expectation = XCTestExpectation(description: "Test Success Subscription")
        
        let apolloClient = ApolloClient(url: URL(string: "http://localhost:3002/graphql")!)
        let subscription = apolloClient.subscribe(subscription: SubscriptionFailureSubscription()) { result in
            switch result {
            case .success(let graphQLResult):
                XCTAssertNil(graphQLResult.data)
                XCTAssertEqual(graphQLResult.errors?.count, 1)
                
                XCTAssertEqual(graphQLResult.errors?[0].message, "field: countEmpTest2 not defined on type: Subscription")
                XCTAssertEqual(graphQLResult.errors?[0].path?[0], .field("subscription"))
                expectation.fulfill()
            case .failure(let error):
                XCTFail("Error in subscription: \(error)")
                expectation.fulfill()
            }
        }
        
        wait(for: [expectation], timeout: 20.0)
        subscription.cancel()
    }
    
    func testFailQuery() throws {
        let expectation = XCTestExpectation(description: "Test Failure Query")
        
        let apolloClient = ApolloClient(url: URL(string: "http://localhost:3002/graphql")!)
        apolloClient.fetch(query: QueryFailureQuery()) { result in
            switch result {
            case .success(let graphQLResult):
                XCTAssertNil(graphQLResult.data)
                XCTAssertEqual(graphQLResult.errors?.count, 1)
                
                XCTAssertEqual(graphQLResult.errors?[0].message, "field: isAvailable2 not defined on type: Employee")
                XCTAssertEqual(graphQLResult.errors?[0].path?[0], .field("query"))
                XCTAssertEqual(graphQLResult.errors?[0].path?[1], .field("employees"))
                
            case .failure(let error):
                XCTFail("Error fetching employee: \(error)")
            }
            expectation.fulfill()
        }
        
        wait(for: [expectation], timeout: 5.0)
    }
}
