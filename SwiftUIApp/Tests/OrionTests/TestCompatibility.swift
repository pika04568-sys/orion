import Testing

private enum TestFailure: Error {
    case unexpectedNil
}

func XCTAssertTrue(
    _ expression: @autoclosure () -> Bool,
    _ message: @autoclosure () -> String = ""
) {
    #expect(expression(), Comment(rawValue: message()))
}

func XCTAssertFalse(
    _ expression: @autoclosure () -> Bool,
    _ message: @autoclosure () -> String = ""
) {
    #expect(!expression(), Comment(rawValue: message()))
}

func XCTAssertNil<T>(
    _ expression: @autoclosure () -> T?,
    _ message: @autoclosure () -> String = ""
) {
    #expect(expression() == nil, Comment(rawValue: message()))
}

func XCTAssertNotNil<T>(
    _ expression: @autoclosure () -> T?,
    _ message: @autoclosure () -> String = ""
) {
    #expect(expression() != nil, Comment(rawValue: message()))
}

func XCTAssertEqual<T: Equatable>(
    _ first: @autoclosure () -> T,
    _ second: @autoclosure () -> T,
    _ message: @autoclosure () -> String = ""
) {
    #expect(first() == second(), Comment(rawValue: message()))
}

func XCTAssertNotEqual<T: Equatable>(
    _ first: @autoclosure () -> T,
    _ second: @autoclosure () -> T,
    _ message: @autoclosure () -> String = ""
) {
    #expect(first() != second(), Comment(rawValue: message()))
}

func XCTAssertGreaterThan<T: Comparable>(
    _ first: @autoclosure () -> T,
    _ second: @autoclosure () -> T,
    _ message: @autoclosure () -> String = ""
) {
    #expect(first() > second(), Comment(rawValue: message()))
}

func XCTAssertGreaterThanOrEqual<T: Comparable>(
    _ first: @autoclosure () -> T,
    _ second: @autoclosure () -> T,
    _ message: @autoclosure () -> String = ""
) {
    #expect(first() >= second(), Comment(rawValue: message()))
}

func XCTAssertLessThan<T: Comparable>(
    _ first: @autoclosure () -> T,
    _ second: @autoclosure () -> T,
    _ message: @autoclosure () -> String = ""
) {
    #expect(first() < second(), Comment(rawValue: message()))
}

func XCTAssertIdentical(
    _ first: @autoclosure () -> AnyObject?,
    _ second: @autoclosure () -> AnyObject?,
    _ message: @autoclosure () -> String = ""
) {
    #expect(first() === second(), Comment(rawValue: message()))
}

func XCTUnwrap<T>(
    _ expression: @autoclosure () -> T?,
    _ message: @autoclosure () -> String = ""
) throws -> T {
    guard let value = expression() else {
        Issue.record(Comment(rawValue: message().isEmpty ? "Expected a non-nil value." : message()))
        throw TestFailure.unexpectedNil
    }
    return value
}
