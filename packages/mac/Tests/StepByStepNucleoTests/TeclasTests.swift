// Nome da tecla independe do que o layout compõe com ⌃/⌥: ⌃C chega como U+0003, ⌥S como "ß", ⌥E como tecla
// morta (string vazia). Só ⌘ e ⌃ (ou ⌥ com F-key/Enter) viram atalho; ⌥+letra é digitação (ç, ª, €).
import XCTest
import CoreGraphics
import StepByStepNucleo

final class TeclasTests: XCTestCase {
  private let comando: CGEventFlags = [.maskCommand]
  private let controle: CGEventFlags = [.maskControl]
  private let opcao: CGEventFlags = [.maskAlternate]

  func testNomeComComandoPuro() {
    // ⌘S: o layout não altera o caractere (fixture guia-mac, passo 6).
    XCTAssertEqual(Teclas.nomeTecla(keycode: 1, caracteres: "s", semModificadores: "s"), "S")
    XCTAssertEqual(Teclas.atalho(tecla: "S", flags: comando), "⌘S")
    XCTAssertEqual(Teclas.modificadores(comando), ["Meta"])
    // ⇧⌘S: ⇧ é preservado no caractere sem modificadores.
    XCTAssertEqual(Teclas.nomeTecla(keycode: 1, caracteres: "S", semModificadores: "S"), "S")
    XCTAssertEqual(Teclas.atalho(tecla: "S", flags: [.maskShift, .maskCommand]), "⇧⌘S")
  }

  func testControleEntregaCaractereDeControle() {
    // ⌃C: `keyboardGetUnicodeString` devolve U+0003; o nome tem de ser "C".
    XCTAssertEqual(Teclas.nomeTecla(keycode: 8, caracteres: "\u{03}", semModificadores: "c"), "C")
    // Sem o AppKit (semModificadores vazio) o caractere de controle é mapeado de volta à letra.
    XCTAssertEqual(Teclas.nomeTecla(keycode: 8, caracteres: "\u{03}", semModificadores: ""), "C")
    XCTAssertEqual(Teclas.letraDeControle("\u{01}"), "a")
    XCTAssertEqual(Teclas.letraDeControle("\u{1A}"), "z")
    XCTAssertNil(Teclas.letraDeControle("\u{1B}"), "Esc não é letra")
    XCTAssertNil(Teclas.letraDeControle(""))
    XCTAssertNil(Teclas.letraDeControle("c"))
    XCTAssertFalse(Teclas.ehImprimivel("\u{03}"))
    XCTAssertNotNil(Teclas.caractereDaTecla(keycode: 8, caracteres: "\u{03}", semModificadores: ""))
    XCTAssertTrue(Teclas.ehAtalho(keycode: 8, flags: controle))
    XCTAssertEqual(Teclas.atalho(tecla: "C", flags: controle), "⌃C")
    XCTAssertEqual(Teclas.modificadores([.maskControl, .maskCommand]), ["Ctrl", "Meta"])
  }

  func testOpcaoEntregaCaractereDoLayout() {
    // ⌥S no layout US compõe "ß" (uppercased → "SS"); o nome vem do caractere sem modificadores.
    XCTAssertEqual(Teclas.nomeTecla(keycode: 1, caracteres: "ß", semModificadores: "s"), "S")
    // Sem o AppKit, o fallback é o layout ANSI pelo keycode — nunca "SS".
    XCTAssertEqual(Teclas.nomeTecla(keycode: 1, caracteres: "ß", semModificadores: ""), "S")
    // ⌥E é tecla morta: string vazia.
    XCTAssertEqual(Teclas.nomeTecla(keycode: 14, caracteres: "", semModificadores: "e"), "E")
    XCTAssertEqual(Teclas.nomeTecla(keycode: 14, caracteres: "", semModificadores: ""), "E")
    // ⌥R num app (fora do ⌥⇧R global) compõe "®".
    XCTAssertEqual(Teclas.nomeTecla(keycode: 15, caracteres: "®", semModificadores: "r"), "R")
    XCTAssertEqual(Teclas.atalho(tecla: "S", flags: [.maskAlternate, .maskCommand]), "⌥⌘S")
    XCTAssertEqual(Teclas.atalho(tecla: "S", flags: [.maskControl, .maskAlternate, .maskShift, .maskCommand]), "⌃⌥⇧⌘S")
    XCTAssertEqual(Teclas.modificadores([.maskControl, .maskAlternate, .maskShift, .maskCommand]), ["Ctrl", "Alt", "Shift", "Meta"])
  }

  func testOpcaoSozinhaEhDigitacaoSalvoFuncaoOuEnter() {
    // ⌥C → "ç" é entrada de caractere, não atalho.
    XCTAssertFalse(Teclas.ehAtalho(keycode: 8, flags: opcao))
    XCTAssertFalse(Teclas.ehAtalho(keycode: 8, flags: [.maskAlternate, .maskShift]))
    XCTAssertTrue(Teclas.ehImprimivel("ç"))
    // ⌥F5 e ⌥Enter continuam atalhos; ⌥⌘C também.
    XCTAssertTrue(Teclas.ehAtalho(keycode: 96, flags: opcao))
    XCTAssertTrue(Teclas.ehAtalho(keycode: 36, flags: opcao))
    XCTAssertTrue(Teclas.ehAtalho(keycode: 8, flags: [.maskAlternate, .maskCommand]))
    // Shift sozinho e nenhum modificador nunca são atalho.
    XCTAssertFalse(Teclas.ehAtalho(keycode: 1, flags: [.maskShift]))
    XCTAssertFalse(Teclas.ehAtalho(keycode: 1, flags: []))
    // ⌥⇧R é o atalho global (só sem ⌘/⌃).
    XCTAssertTrue(Teclas.ehAtalhoAlternar(keycode: 15, flags: [.maskAlternate, .maskShift]))
    XCTAssertFalse(Teclas.ehAtalhoAlternar(keycode: 15, flags: [.maskAlternate, .maskShift, .maskCommand]))
    XCTAssertFalse(Teclas.ehAtalhoAlternar(keycode: 1, flags: [.maskAlternate, .maskShift]))
  }

  func testTabelaPorKeycodeEFallbacks() {
    XCTAssertEqual(Teclas.nomeTecla(keycode: 36, caracteres: "\r", semModificadores: "\r"), "Enter")
    XCTAssertEqual(Teclas.nomeTecla(keycode: 76, caracteres: "\u{03}", semModificadores: ""), "Enter", "Enter do teclado numérico")
    XCTAssertEqual(Teclas.nomeTecla(keycode: 96, caracteres: "", semModificadores: ""), "F5")
    XCTAssertEqual(Teclas.nomeTecla(keycode: 53, caracteres: "\u{1B}", semModificadores: "\u{1B}"), "Esc")
    XCTAssertEqual(Teclas.nomeTecla(keycode: 49, caracteres: " ", semModificadores: " "), "Space")
    XCTAssertEqual(Teclas.nomeTecla(keycode: 18, caracteres: "1", semModificadores: "1"), "1")
    XCTAssertEqual(Teclas.nomeTecla(keycode: 44, caracteres: "/", semModificadores: "/"), "/")
    // Keycode desconhecido sem caractere: nome técnico.
    XCTAssertEqual(Teclas.nomeTecla(keycode: 999, caracteres: "", semModificadores: ""), "Tecla999")
    XCTAssertNil(Teclas.caractereDaTecla(keycode: 999, caracteres: "", semModificadores: ""))
    // Tab/Enter/Esc/setas não "escrevem": o U+0009 do Tab não é ⌃I, o U+000D do Enter não é ⌃M (⌘Tab não vira passo).
    XCTAssertNil(Teclas.caractereDaTecla(keycode: 48, caracteres: "\t", semModificadores: "\t"))
    XCTAssertNil(Teclas.caractereDaTecla(keycode: 36, caracteres: "\r", semModificadores: "\r"))
    XCTAssertNil(Teclas.caractereDaTecla(keycode: 123, caracteres: "\u{F702}", semModificadores: "\u{F702}"))
    // ⌘Space (Spotlight) escreve espaço, mesmo sem o AppKit.
    XCTAssertEqual(Teclas.caractereDaTecla(keycode: 49, caracteres: " ", semModificadores: ""), " ")
    // ⌃I de verdade (keycode 34) continua "I".
    XCTAssertEqual(Teclas.nomeTecla(keycode: 34, caracteres: "\t", semModificadores: ""), "I")
    XCTAssertTrue(Teclas.ehTeclaFuncao(122))
    XCTAssertFalse(Teclas.ehTeclaFuncao(36))
    XCTAssertTrue(Teclas.ehImprimivel("a"))
    XCTAssertTrue(Teclas.ehImprimivel(" "))
    XCTAssertFalse(Teclas.ehImprimivel("\t"))
    XCTAssertFalse(Teclas.ehImprimivel(""))
  }

  func testAtalhosDeEdicao() {
    XCTAssertTrue(Teclas.ehAtalhoDeEdicao(nome: "V", flags: comando))
    XCTAssertTrue(Teclas.ehAtalhoDeEdicao(nome: "A", flags: [.maskCommand, .maskShift]))
    XCTAssertFalse(Teclas.ehAtalhoDeEdicao(nome: "V", flags: [.maskCommand, .maskAlternate]))
    XCTAssertFalse(Teclas.ehAtalhoDeEdicao(nome: "V", flags: controle))
    XCTAssertFalse(Teclas.ehAtalhoDeEdicao(nome: "S", flags: comando))
  }
}
