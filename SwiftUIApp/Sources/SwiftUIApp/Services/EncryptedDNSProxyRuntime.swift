import Combine
import Foundation
import Network
import WebKit

@MainActor
final class EncryptedDNSProxyRuntime: ObservableObject {
    enum State: Equatable {
        case idle
        case starting
        case ready(port: UInt16)
        case failed(String)
    }

    @Published private(set) var state: State = .idle

    private let username = UUID().uuidString
    private let password = UUID().uuidString
    private var server: SOCKS5Server?

    func start(for dataStore: WKWebsiteDataStore) async {
        guard BrowserPreferences.dnsOverHttpsEnabled else {
            dataStore.proxyConfigurations = []
            state = .idle
            return
        }
        if case .ready = state { return }
        state = .starting
        do {
            let created = try SOCKS5Server(username: username, password: password)
            let port = try await created.start()
            server = created

            var proxy = ProxyConfiguration(
                socksv5Proxy: .hostPort(
                    host: .ipv4(.loopback),
                    port: port
                )
            )
            proxy.applyCredential(username: username, password: password)
            proxy.allowFailover = false
            proxy.matchDomains = [""]
            proxy.excludedDomains = [
                "localhost",
                "localhost.",
                "127.0.0.1",
                "::1",
                ".local"
            ]
            dataStore.proxyConfigurations = [proxy]
            state = .ready(port: port.rawValue)
        } catch {
            dataStore.proxyConfigurations = []
            state = .failed(error.localizedDescription)
        }
    }

    func stop(for dataStore: WKWebsiteDataStore) {
        server?.stop()
        server = nil
        dataStore.proxyConfigurations = []
        state = .idle
    }
}

private final class SOCKS5Server: @unchecked Sendable {
    private let username: Data
    private let password: Data
    private let listener: NWListener
    private let queue = DispatchQueue(label: "com.orion.browser.doh-socks")

    init(username: String, password: String) throws {
        self.username = Data(username.utf8)
        self.password = Data(password.utf8)
        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
        listener = try NWListener(using: parameters, on: .any)
    }

    func start() async throws -> NWEndpoint.Port {
        try await withCheckedThrowingContinuation { continuation in
            let gate = SOCKSContinuationGate(continuation)
            listener.stateUpdateHandler = { [weak self] state in
                guard let self else { return }
                switch state {
                case .ready:
                    guard let port = listener.port else {
                        gate.resume(.failure(URLError(.cannotCreateFile)))
                        return
                    }
                    gate.resume(.success(port))
                case let .failed(error):
                    gate.resume(.failure(error))
                case .cancelled:
                    gate.resume(.failure(CancellationError()))
                default:
                    break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                self?.accept(connection)
            }
            listener.start(queue: queue)
        }
    }

    func stop() {
        listener.cancel()
    }

    private func accept(_ connection: NWConnection) {
        let client = SOCKS5Client(
            connection: connection,
            username: username,
            password: password,
            queue: queue
        )
        connection.stateUpdateHandler = { state in
            if case .failed = state {
                connection.cancel()
            }
        }
        connection.start(queue: queue)
        client.start()
    }
}

private final class SOCKS5Client: @unchecked Sendable {
    private enum Phase {
        case greeting
        case authentication
        case request
        case relaying
    }

    private let connection: NWConnection
    private let username: Data
    private let password: Data
    private let queue: DispatchQueue
    private var phase = Phase.greeting
    private var buffer = SOCKS5ByteBuffer()
    private var retainedSelf: SOCKS5Client?

    init(
        connection: NWConnection,
        username: Data,
        password: Data,
        queue: DispatchQueue
    ) {
        self.connection = connection
        self.username = username
        self.password = password
        self.queue = queue
    }

    func start() {
        retainedSelf = self
        receiveHandshake()
    }

    private func receiveHandshake() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8_192) {
            [weak self] data, _, complete, error in
            guard let self else { return }
            if let data { buffer.append(data) }
            if error != nil || complete {
                close()
                return
            }
            do {
                try processBuffer()
                if phase != .relaying {
                    receiveHandshake()
                }
            } catch {
                close()
            }
        }
    }

    private func processBuffer() throws {
        switch phase {
        case .greeting:
            guard buffer.count >= 2 else { return }
            let count = Int(buffer.byte(at: 1))
            guard buffer.count >= 2 + count, buffer.byte(at: 0) == 5 else { return }
            let methods = buffer.bytes(in: 2..<(2 + count))
            buffer.consume(2 + count)
            guard methods.contains(2) else {
                send(Data([5, 0xff]))
                throw URLError(.userAuthenticationRequired)
            }
            phase = .authentication
            send(Data([5, 2]))
            try processBuffer()
        case .authentication:
            guard buffer.count >= 2 else { return }
            let userLength = Int(buffer.byte(at: 1))
            guard buffer.count >= 2 + userLength + 1 else { return }
            let passwordLengthIndex = 2 + userLength
            let passwordLength = Int(buffer.byte(at: passwordLengthIndex))
            let total = passwordLengthIndex + 1 + passwordLength
            guard buffer.count >= total else { return }
            let user = buffer.bytes(in: 2..<passwordLengthIndex)
            let suppliedPassword = buffer.bytes(in: (passwordLengthIndex + 1)..<total)
            buffer.consume(total)
            guard user == username,
                  suppliedPassword == password
            else {
                send(Data([1, 1]))
                throw URLError(.userAuthenticationRequired)
            }
            phase = .request
            send(Data([1, 0]))
            try processBuffer()
        case .request:
            guard buffer.count >= 7,
                  buffer.byte(at: 0) == 5,
                  buffer.byte(at: 1) == 1
            else { return }
            let addressType = buffer.byte(at: 3)
            let host: String
            let portIndex: Int
            switch addressType {
            case 1:
                guard buffer.count >= 10 else { return }
                host = buffer.bytes(in: 4..<8).map(String.init).joined(separator: ".")
                portIndex = 8
            case 3:
                let length = Int(buffer.byte(at: 4))
                guard buffer.count >= 5 + length + 2 else { return }
                host = String(data: buffer.bytes(in: 5..<(5 + length)), encoding: .utf8) ?? ""
                portIndex = 5 + length
            case 4:
                guard buffer.count >= 22 else { return }
                let bytes = buffer.bytes(in: 4..<20)
                host = stride(from: 0, to: 16, by: 2).map { index in
                    String(format: "%02x%02x", bytes[index], bytes[index + 1])
                }.joined(separator: ":")
                portIndex = 20
            default:
                throw URLError(.unsupportedURL)
            }
            let portValue = UInt16(buffer.byte(at: portIndex)) << 8
                | UInt16(buffer.byte(at: portIndex + 1))
            buffer.consume(portIndex + 2)
            guard !host.isEmpty, let port = NWEndpoint.Port(rawValue: portValue) else {
                throw URLError(.badURL)
            }
            connect(to: host, port: port)
        case .relaying:
            break
        }
    }

    private func connect(to host: String, port: NWEndpoint.Port) {
        phase = .relaying
        let parameters = NWParameters.tcp
        let privacy = NWParameters.PrivacyContext(description: "Orion Cloudflare DoH")
        let resolver = NWParameters.PrivacyContext.ResolverConfiguration.https(
            URL(string: "https://cloudflare-dns.com/dns-query")!,
            serverAddresses: [
                .hostPort(host: "1.1.1.1", port: 443),
                .hostPort(host: "1.0.0.1", port: 443),
                .hostPort(host: "2606:4700:4700::1111", port: 443),
                .hostPort(host: "2606:4700:4700::1001", port: 443)
            ]
        )
        privacy.requireEncryptedNameResolution(true, fallbackResolver: resolver)
        parameters.setPrivacyContext(privacy)
        let outbound = NWConnection(host: NWEndpoint.Host(host), port: port, using: parameters)
        outbound.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                send(Data([5, 0, 0, 1, 127, 0, 0, 1, 0, 0])) { [self] in
                    if !self.buffer.isEmpty {
                        let buffered = self.buffer.consumeAll()
                        self.send(buffered, over: outbound)
                    }
                    self.pump(from: self.connection, to: outbound)
                    self.pump(from: outbound, to: self.connection)
                }
            case .failed:
                send(Data([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]))
                close()
            case .cancelled:
                close()
            default:
                break
            }
        }
        outbound.start(queue: queue)
    }

    private func pump(from source: NWConnection, to destination: NWConnection) {
        source.receive(minimumIncompleteLength: 1, maximumLength: 65_536) {
            [weak self] data, _, complete, error in
            guard let self else { return }
            if let data, !data.isEmpty {
                send(data, over: destination) {
                    if complete || error != nil {
                        self.close()
                    } else {
                        self.pump(from: source, to: destination)
                    }
                }
            } else if complete || error != nil {
                close()
            } else {
                pump(from: source, to: destination)
            }
        }
    }

    private func send(_ data: Data, completion: (@Sendable () -> Void)? = nil) {
        send(data, over: connection, completion: completion)
    }

    private func send(
        _ data: Data,
        over connection: NWConnection,
        completion: (@Sendable () -> Void)? = nil
    ) {
        connection.send(content: data, completion: .contentProcessed { error in
            if error == nil { completion?() }
        })
    }

    private func close() {
        connection.cancel()
        retainedSelf = nil
    }
}

struct SOCKS5ByteBuffer: Sendable {
    private var storage = Data()

    var count: Int { storage.count }
    var isEmpty: Bool { storage.isEmpty }

    mutating func append(_ data: Data) {
        storage.append(data)
    }

    func byte(at offset: Int) -> UInt8 {
        precondition(offset >= 0 && offset < storage.count)
        return storage[storage.index(storage.startIndex, offsetBy: offset)]
    }

    func bytes(in offsets: Range<Int>) -> Data {
        precondition(offsets.lowerBound >= 0 && offsets.upperBound <= storage.count)
        let lower = storage.index(storage.startIndex, offsetBy: offsets.lowerBound)
        let upper = storage.index(storage.startIndex, offsetBy: offsets.upperBound)
        return Data(storage[lower..<upper])
    }

    mutating func consume(_ count: Int) {
        precondition(count >= 0 && count <= storage.count)
        storage = Data(storage.dropFirst(count))
    }

    mutating func consumeAll() -> Data {
        let result = Data(storage)
        storage.removeAll(keepingCapacity: true)
        return result
    }
}

private final class SOCKSContinuationGate: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<NWEndpoint.Port, any Error>?

    init(_ continuation: CheckedContinuation<NWEndpoint.Port, any Error>) {
        self.continuation = continuation
    }

    func resume(_ result: Result<NWEndpoint.Port, any Error>) {
        lock.lock()
        guard let continuation else {
            lock.unlock()
            return
        }
        self.continuation = nil
        lock.unlock()
        continuation.resume(with: result)
    }
}
