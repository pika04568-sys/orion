import Testing

@main
struct OrionSwiftTestingMain {
    static func main() async {
        await Testing.__swiftPMEntryPoint() as Never
    }
}
