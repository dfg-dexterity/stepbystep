// Buffer de digitação por elemento focado e tradução de teclas/modificadores para o vocabulário do guia.
// O valor digitado nunca é reconstruído das teclas: na confirmação ele é lido de kAXValueAttribute.
import Foundation
import CoreGraphics
import ApplicationServices

struct DigitacaoPendente {
  /// nil quando o foco não pôde ser determinado (o valor vira nil e o passo é marcado sensível).
  let elemento: AXUIElement?
  let pid: pid_t
  let descritor: DescritorAX?
  let iniciadoEm: Date
  var ultimaTeclaEm: Date
  var teclas: Int
}

final class Teclado {
  private(set) var pendente: DigitacaoPendente?

  /// Começa ou continua a digitação no elemento focado.
  func acumular(elemento: AXUIElement?, pid: pid_t, descritor: DescritorAX?, em: Date) {
    if var atual = pendente, Acessibilidade.mesmoElemento(atual.elemento, elemento) {
      atual.ultimaTeclaEm = em
      atual.teclas += 1
      pendente = atual
      return
    }
    pendente = DigitacaoPendente(elemento: elemento, pid: pid, descritor: descritor, iniciadoEm: em, ultimaTeclaEm: em, teclas: 1)
  }

  /// Devolve e limpa a digitação pendente.
  func retirar() -> DigitacaoPendente? {
    let atual = pendente
    pendente = nil
    return atual
  }

  func descartar() {
    pendente = nil
  }

  /// Segundos desde a última tecla (nil sem digitação pendente).
  func ociosaHa(_ agora: Date) -> TimeInterval? {
    guard let atual = pendente else { return nil }
    return agora.timeIntervalSince(atual.ultimaTeclaEm)
  }

  // MARK: Teclas

  static let keycodeR: Int64 = 15
  static let keycodesEnter: Set<Int64> = [36, 76]
  static let keycodeTab: Int64 = 48
  static let keycodeEscape: Int64 = 53

  private static let nomesPorKeycode: [Int64: String] = [
    36: "Enter", 76: "Enter", 48: "Tab", 53: "Esc", 51: "Backspace", 117: "Delete", 49: "Space",
    123: "ArrowLeft", 124: "ArrowRight", 125: "ArrowDown", 126: "ArrowUp",
    115: "Home", 119: "End", 116: "PageUp", 121: "PageDown",
    122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6", 98: "F7", 100: "F8",
    101: "F9", 109: "F10", 103: "F11", 111: "F12",
  ]

  private static let keycodesFuncao: Set<Int64> = [122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111]

  static func ehTeclaFuncao(_ keycode: Int64) -> Bool {
    return keycodesFuncao.contains(keycode)
  }

  /// Nome da tecla no vocabulário do guia (Enter, Esc, Tab, F5, Delete, S…).
  static func nomeTecla(keycode: Int64, caracteres: String) -> String {
    if let nome = nomesPorKeycode[keycode] { return nome }
    let limpo: String = caracteres.trimmingCharacters(in: CharacterSet.controlCharacters)
    if let primeiro = limpo.first, !primeiro.isWhitespace {
      return String(primeiro).uppercased()
    }
    return "Tecla" + String(keycode)
  }

  static func ehImprimivel(_ caracteres: String) -> Bool {
    guard let primeiro = caracteres.first else { return false }
    if primeiro.isLetter || primeiro.isNumber || primeiro.isPunctuation || primeiro.isSymbol { return true }
    return primeiro == " "
  }

  /// ⌘, ⌃ ou ⌥ pressionados (Shift sozinho não conta).
  static func temModificadorDeAtalho(_ flags: CGEventFlags) -> Bool {
    return flags.contains(.maskCommand) || flags.contains(.maskControl) || flags.contains(.maskAlternate)
  }

  /// Atalho global ⌥⇧R (sem ⌘/⌃).
  static func ehAtalhoAlternar(keycode: Int64, flags: CGEventFlags) -> Bool {
    return keycode == keycodeR && flags.contains(.maskAlternate) && flags.contains(.maskShift)
      && !flags.contains(.maskCommand) && !flags.contains(.maskControl)
  }

  /// Atalhos de edição (colar, selecionar tudo…) que alteram o campo sem confirmar a digitação.
  static func ehAtalhoDeEdicao(nome: String, flags: CGEventFlags) -> Bool {
    guard flags.contains(.maskCommand), !flags.contains(.maskControl), !flags.contains(.maskAlternate) else { return false }
    return ["V", "A", "Z", "X", "C"].contains(nome)
  }

  /// Ordem do guia: Ctrl, Alt, Shift, Meta.
  static func modificadores(_ flags: CGEventFlags) -> [String] {
    var lista: [String] = []
    if flags.contains(.maskControl) { lista.append("Ctrl") }
    if flags.contains(.maskAlternate) { lista.append("Alt") }
    if flags.contains(.maskShift) { lista.append("Shift") }
    if flags.contains(.maskCommand) { lista.append("Meta") }
    return lista
  }

  /// Estilo Mac: ⌃⌥⇧⌘ + tecla, sem "+".
  static func atalho(tecla: String, flags: CGEventFlags) -> String {
    var texto: String = ""
    if flags.contains(.maskControl) { texto += "⌃" }
    if flags.contains(.maskAlternate) { texto += "⌥" }
    if flags.contains(.maskShift) { texto += "⇧" }
    if flags.contains(.maskCommand) { texto += "⌘" }
    return texto + tecla
  }
}
