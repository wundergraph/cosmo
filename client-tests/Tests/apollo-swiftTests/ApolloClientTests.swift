import XCTest
import Apollo
@testable import apollo_swift

final class ApolloClientTests: XCTestCase {
    let serverUrl = "http://localhost:3002/graphql"
    var client: ApolloClient!
    
    override func setUp() {
        super.setUp()
        let url = URL(string: serverUrl)!
        let store = ApolloStore()
        let provider = DefaultInterceptorProvider(store: store)
        let transport = RequestChainNetworkTransport(interceptorProvider: provider,
                                                   endpointURL: url)
        client = ApolloClient(networkTransport: transport, store: store)
    }
    
    func testFailingQuery() async throws {
        let query = """
        query QueryFailure {
            employees {
                id
                isAvailable2
            }
        }
        """
        
        do {
            _ = try await client.fetch(query: GraphQLQueryString(query))
            XCTFail("Expected query to fail")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("field: isAvailable2 not defined on type: Employee"))
        }
    }
    
    func testSuccessfulQuery() async throws {
        let query = """
        query QuerySuccess {
            employees {
                id
                isAvailable
            }
        }
        """
        
        let result = try await client.fetch(query: GraphQLQueryString(query))
        
        guard let data = result.data else {
            XCTFail("No data received")
            return
        }
        
        guard let employees = data["employees"] as? [[String: Any]] else {
            XCTFail("Employees data not in expected format")
            return
        }
        
        XCTAssertTrue(employees.count > 0)
        XCTAssertNotNil(employees[0]["id"])
        XCTAssertNotNil(employees[0]["isAvailable"])
    }
}

// Helper class to execute raw GraphQL queries
private class GraphQLQueryString: GraphQLQuery {
    let queryString: String
    
    init(_ queryString: String) {
        self.queryString = queryString
    }
    
    var operationDefinition: String {
        return queryString
    }
    
    var operationName: String {
        return "DynamicQuery"
    }
    
    func parse(data: [String: Any]) throws -> [String: Any] {
        return data
    }
} 