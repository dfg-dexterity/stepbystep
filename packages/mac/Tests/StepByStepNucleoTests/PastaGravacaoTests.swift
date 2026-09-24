// Nome da pasta de gravação (contrato 6.3) e o sufixo _2, _3… quando o nome já existe (mesmo minuto, mesmo app).
import XCTest
import StepByStepNucleo

final class PastaGravacaoTests: XCTestCase {
  private let utc: TimeZone = TimeZone(identifier: "UTC")!

  func testNomeBaseSegueOContrato() {
    let agora: Date = lerDataIso("2026-09-24T14:12:10.000Z")!
    XCTAssertEqual(PastaGravacao.nomeBase(app: "SAP GUI", agora: agora, fuso: utc), "2026-09-24_1412_sap-gui")
    // Segundos não entram no nome: 14:12:40 dá o mesmo nome base.
    XCTAssertEqual(PastaGravacao.nomeBase(app: "SAP GUI", agora: lerDataIso("2026-09-24T14:12:40.000Z")!, fuso: utc),
                   "2026-09-24_1412_sap-gui")
    // Fuso local: 14:12 UTC são 11:12 em São Paulo.
    XCTAssertEqual(PastaGravacao.nomeBase(app: "Finder", agora: agora, fuso: TimeZone(identifier: "America/Sao_Paulo")!),
                   "2026-09-24_1112_finder")
  }

  func testSlug() {
    XCTAssertEqual(PastaGravacao.slug("SAP GUI"), "sap-gui")
    XCTAssertEqual(PastaGravacao.slug("Gravação — Ação"), "gravacao-acao")
    XCTAssertEqual(PastaGravacao.slug("  --Visual Studio Code--  "), "visual-studio-code")
    XCTAssertEqual(PastaGravacao.slug("!!!"), "app")
    XCTAssertEqual(PastaGravacao.slug(""), "app")
    XCTAssertEqual(PastaGravacao.slug(String(repeating: "a", count: 60)).count, 40)
  }

  func testNomeLivreAcrescentaSufixoSoQuandoExiste() {
    XCTAssertEqual(PastaGravacao.nomeLivre(base: "2026-09-24_1412_sap-gui") { _ in false }, "2026-09-24_1412_sap-gui")
    var ocupados: Set<String> = ["2026-09-24_1412_sap-gui"]
    XCTAssertEqual(PastaGravacao.nomeLivre(base: "2026-09-24_1412_sap-gui") { ocupados.contains($0) }, "2026-09-24_1412_sap-gui_2")
    ocupados.insert("2026-09-24_1412_sap-gui_2")
    ocupados.insert("2026-09-24_1412_sap-gui_3")
    XCTAssertEqual(PastaGravacao.nomeLivre(base: "2026-09-24_1412_sap-gui") { ocupados.contains($0) }, "2026-09-24_1412_sap-gui_4")
    // O sufixo nunca reaproveita um nome já ocupado (pasta ou zip da gravação anterior).
    var consultados: [String] = []
    _ = PastaGravacao.nomeLivre(base: "b") { nome in
      consultados.append(nome)
      return nome == "b"
    }
    XCTAssertEqual(consultados, ["b", "b_2"])
  }
}
