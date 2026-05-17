import SwiftUI
import WebKit

/// Tab 2: English fill-in-the-blank quiz. The quiz itself is HTML rendered in
/// a WKWebView; the bridge generates `artifacts/<id>/index.html` from a starter
/// pack and updates `artifacts/latest`. iPhone fetches via the bridge's static
/// /artifact/latest/ route (same port as the WS / cmd queue, no extra server).
///
/// Future iteration: bridge can LLM-extract questions from accumulated
/// conversation transcripts; for now starter packs cycle by topic.
struct DrillView: View {
    @StateObject private var model = DrillViewModel()

    var body: some View {
        VStack(spacing: 0) {
            ArtifactWebView(url: model.artifactURL, reloadToken: model.reloadToken)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.black)
            VStack(spacing: 8) {
                if let err = model.lastError {
                    Text(err)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }
                Button(action: { Task { await model.generate() } }) {
                    HStack(spacing: 8) {
                        if model.generating {
                            ProgressView().controlSize(.small).tint(.white)
                        }
                        Text(model.generating ? "Generating…" : "Generate New Drill")
                            .font(.title3.bold())
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(model.generating ? Color.gray : Color.blue)
                    .clipShape(Capsule())
                }
                .disabled(model.generating)
                .padding(.horizontal, 24)
                .padding(.bottom, 8)
            }
            .padding(.top, 8)
            .background(Color.black)
        }
        .background(Color.black.ignoresSafeArea())
        .onAppear { Task { if model.firstLoad { await model.generateIfEmpty() } } }
    }
}

@MainActor
final class DrillViewModel: ObservableObject {
    @Published var generating = false
    @Published var lastError: String?
    @Published var reloadToken = 0
    @Published var firstLoad = true

    private var bridgeBase: String {
        if let v = UserDefaults.standard.string(forKey: "bridgeBase") { return v }
        #if targetEnvironment(simulator)
        return "http://127.0.0.1:3205"
        #else
        return "http://127.0.0.1:3205"
        #endif
    }

    var artifactURL: URL {
        URL(string: "\(bridgeBase)/artifact/latest/")!
    }

    /// Starter packs — keyed by a coarse topic. Generate cycles randomly so
    /// repeated taps don't show the same quiz. Curated for an A2-B2 ESL learner.
    private static let packs: [(topic: String, questions: [(sentence: String, answer: String, options: [String])])] = [
        (
            topic: "Restaurant English",
            questions: [
                ("Could I see the ____, please?", "menu", ["menu", "ticket", "platform", "lobby"]),
                ("I'd like to ____ the chicken pasta.", "order", ["order", "depart", "transfer"]),
                ("Can we have the ____, please?", "check", ["check", "floor", "luggage", "reservation"]),
                ("What dish do you ____?", "recommend", ["recommend", "wait", "arrive"]),
                ("We would like an ____ before the main course.", "appetizer", ["appetizer", "airport", "receipt"]),
            ]
        ),
        (
            topic: "Travel & Directions",
            questions: [
                ("Which ____ does the train leave from?", "platform", ["platform", "waiter", "menu", "key card"]),
                ("I need to buy a ____ to Boston.", "ticket", ["ticket", "lobby", "breakfast"]),
                ("Do I need to ____ at the next station?", "transfer", ["transfer", "recommend", "check-in"]),
                ("Where can I pick up my ____?", "luggage", ["luggage", "appetizer", "floor"]),
                ("What time is the ____?", "departure", ["departure", "reservation", "latte"]),
            ]
        ),
        (
            topic: "Hotel Check-in",
            questions: [
                ("I have a ____ under the name Chen.", "reservation", ["reservation", "station", "appetizer"]),
                ("What time can I ____?", "check-in", ["check-in", "order", "transfer"]),
                ("The elevator is next to the ____.", "lobby", ["lobby", "menu", "ticket"]),
                ("My ____ does not open the door.", "key card", ["key card", "platform", "latte"]),
                ("Is ____ included with the room?", "breakfast", ["breakfast", "departure", "waiter"]),
            ]
        ),
        (
            topic: "Daily Conversation",
            questions: [
                ("It was ____ to meet you.", "nice", ["nice", "later", "care"]),
                ("____ was your day?", "How", ["How", "Where", "When"]),
                ("I'll ____ you later.", "see", ["see", "take", "point"]),
                ("Please ____ care on your trip.", "take", ["take", "meet", "switch"]),
                ("That's a really good ____.", "point", ["point", "floor", "ticket"]),
            ]
        ),
        (
            topic: "Café Order",
            questions: [
                ("Can I get a small ____?", "latte", ["latte", "lobby", "ticket"]),
                ("Is that for here or to ____?", "go", ["go", "meet", "floor"]),
                ("Could you add less ____?", "ice", ["ice", "menu", "platform"]),
                ("Do you have ____ milk?", "oat", ["oat", "key", "check"]),
                ("Can I ____ up to a large?", "size", ["size", "depart", "reserve"]),
            ]
        ),
    ]

    func generateIfEmpty() async {
        firstLoad = false
        // Probe whether an artifact already exists; if not, generate one so the
        // user lands on a playable game on first open.
        do {
            let (_, resp) = try await URLSession.shared.data(from: artifactURL)
            if let http = resp as? HTTPURLResponse, http.statusCode == 200 {
                reloadToken += 1
                return
            }
        } catch {}
        await generate()
    }

    func generate() async {
        guard !generating else { return }
        generating = true
        lastError = nil
        defer { generating = false }

        let pack = Self.packs.randomElement()!
        let questionsBody = pack.questions.map {
            ["sentence": $0.sentence, "answer": $0.answer, "options": $0.options] as [String: Any]
        }
        let body: [String: Any] = ["topic": pack.topic, "questions": questionsBody]

        guard let url = URL(string: "\(bridgeBase)/artifact/fill-blank"),
              let json = try? JSONSerialization.data(withJSONObject: body) else {
            lastError = "internal error: bad request"
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = json
        req.timeoutInterval = 10
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse else { lastError = "no http response"; return }
            if http.statusCode != 200 {
                let msg = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
                lastError = "bridge \(http.statusCode): \(msg.prefix(120))"
                return
            }
            // Trigger webview reload.
            reloadToken += 1
            // Tell the agent (get_app_state tool) which drill is now active.
            postDrillState(topic: pack.topic, questions: questionsBody)
        } catch {
            lastError = "couldn't reach bridge: \(error.localizedDescription)"
        }
    }

    private func postDrillState(topic: String, questions: [[String: Any]]) {
        let drill: [String: Any] = [
            "topic": topic,
            "kind": "fill_blank",
            "questions": questions,
            "answered": 0,
            "correct": 0,
            "wrong": 0,
            "completed": false,
        ]
        guard let url = URL(string: "\(bridgeBase)/test/app-state"),
              let body = try? JSONSerialization.data(withJSONObject: ["drill": drill]) else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        URLSession.shared.dataTask(with: req).resume()
    }
}

/// WKWebView that re-loads ONLY when reloadToken bumps. SwiftUI calls
/// updateUIView on every observed @Published change in the parent, so without
/// the coordinator we'd reload the page every time `generating` toggles or
/// `lastError` updates — wiping the user's in-progress game. (Codex P2.)
struct ArtifactWebView: UIViewRepresentable {
    let url: URL
    let reloadToken: Int

    func makeCoordinator() -> Coordinator { Coordinator(initialToken: -1) }

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        let view = WKWebView(frame: .zero, configuration: cfg)
        view.isOpaque = false
        view.backgroundColor = .black
        view.scrollView.backgroundColor = .black
        view.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 10))
        context.coordinator.lastLoadedToken = reloadToken
        DrillWebViewRegistry.shared.register(view)
        return view
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard reloadToken != context.coordinator.lastLoadedToken else { return }
        context.coordinator.lastLoadedToken = reloadToken
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 10))
    }

    final class Coordinator {
        var lastLoadedToken: Int
        init(initialToken: Int) { lastLoadedToken = initialToken }
    }
}

/// Lets PollClient call evaluateJavaScript on the live drill webview from
/// outside SwiftUI. Holds a weak ref so view destruction doesn't leak.
@MainActor
final class DrillWebViewRegistry {
    static let shared = DrillWebViewRegistry()
    private weak var webView: WKWebView?
    func register(_ view: WKWebView) { webView = view }
    func current() -> WKWebView? { webView }
}
