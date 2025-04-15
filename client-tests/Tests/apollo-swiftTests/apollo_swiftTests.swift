import XCTest
@testable import apollo_swift

final class CalculatorTests: XCTestCase {
    func testAdd() {
        let calculator = Calculator()
        XCTAssertEqual(calculator.add(2, 3), 5)
        XCTAssertEqual(calculator.add(-1, 1), 0)
        XCTAssertEqual(calculator.add(0, 0), 0)
    }
} 