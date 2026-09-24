// Tradução de teclas e modificadores do tap para o vocabulário do guia (Enter, Esc, F5, S…), sem AppKit,
// para os testes cobrirem o que o layout faz com ⌃ e ⌥: com ⌃ o evento entrega um caractere de controle
// (⌃C → U+0003) e com ⌥ o caractere alternativo ou uma tecla morta (⌥S → "ß", ⌥E → ""). O nome da tecla
// vem sempre do caractere SEM ⌃/⌥ (⇧ preservado, como `e.key` no navegador), com fallback pelo keycode.
import Foundation
import CoreGraphics

public enum Teclas {
  public static let keycodeR: Int64 = 15
  public static let keycodesEnter: Set<Int64> = [36, 76]
  public static let keycodeTab: Int64 = 48
  public static let keycodeEscape: Int64 = 53
  public static let keycodeBackspace: Int64 = 51

  private static let nomesPorKeycode: [Int64: String] = [
    36: "Enter", 76: "Enter", 48: "Tab", 53: "Esc", 51: "Backspace", 117: "Delete", 49: "Space",
    123: "ArrowLeft", 124: "ArrowRight", 125: "ArrowDown", 126: "ArrowUp",
    115: "Home", 119: "End", 116: "PageUp", 121: "PageDown",
    122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6", 98: "F7", 100: "F8",
    101: "F9", 109: "F10", 103: "F11", 111: "F12",
  ]

  private static let keycodesFuncao: Set<Int64> = [122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111]

  /// Layout ANSI-US por keycode (letras coincidem com o ABNT2): último recurso quando o AppKit não devolve a
  /// tecla sem modificadores.
  private static let caracteresAnsiPorKeycode: [Int64: String] = [
    0: "a", 1: "s", 2: "d", 3: "f", 4: "h", 5: "g", 6: "z", 7: "x", 8: "c", 9: "v", 11: "b", 12: "q", 13: "w",
    14: "e", 15: "r", 16: "y", 17: "t", 18: "1", 19: "2", 20: "3", 21: "4", 22: "6", 23: "5", 24: "=", 25: "9",
    26: "7", 27: "-", 28: "8", 29: "0", 30: "]", 31: "o", 32: "u", 33: "[", 34: "i", 35: "p", 37: "l", 38: "j",
    39: "'", 40: "k", 41: ";", 42: "\\", 43: ",", 44: "/", 45: "n", 46: "m", 47: ".", 50: "`",
  ]

  public static func ehTeclaFuncao(_ keycode: Int64) -> Bool {
    return keycodesFuncao.contains(keycode)
  }

  /// Letra, número, pontuação, símbolo ou espaço (a tecla escreve algo). Caracteres de controle não contam.
  public static func ehImprimivel(_ caracteres: String) -> Bool {
    guard let primeiro = caracteres.first else { return false }
    if primeiro.isLetter || primeiro.isNumber || primeiro.isPunctuation || primeiro.isSymbol { return true }
    return primeiro == " "
  }

  /// U+0001…U+001A (o que ⌃A…⌃Z entregam em `keyboardGetUnicodeString`) → "a"…"z"; nil para o resto.
  public static func letraDeControle(_ caracteres: String) -> String? {
    guard let escalar = caracteres.unicodeScalars.first, escalar.value >= 1, escalar.value <= 26,
          let letra = UnicodeScalar(0x60 + escalar.value) else { return nil }
    return String(Character(letra))
  }

  /// Caractere que a tecla escreve sem ⌃/⌥: `semModificadores` (AppKit, ⇧ preservado), senão a letra do caractere
  /// de controle, senão o layout ANSI pelo keycode, senão o próprio `caracteres`. nil quando a tecla não escreve
  /// nada (Enter, Tab, Esc, setas, ⌫, tecla morta sem fallback).
  public static func caractereDaTecla(keycode: Int64, caracteres: String, semModificadores: String) -> String? {
    if ehImprimivel(semModificadores), let primeiro = semModificadores.first { return String(primeiro) }
    if keycode == 49 { return " " }
    // Teclas com nome próprio não escrevem: Tab/Enter entregam U+0009/U+000D, que não são ⌃I/⌃M.
    if nomesPorKeycode[keycode] != nil { return nil }
    if let letra = letraDeControle(caracteres) { return letra }
    if let ansi = caracteresAnsiPorKeycode[keycode] { return ansi }
    if ehImprimivel(caracteres), let primeiro = caracteres.first { return String(primeiro) }
    return nil
  }

  /// Nome da tecla no vocabulário do guia: tabela por keycode (Enter, Esc, Tab, F5, Delete…), senão o caractere
  /// da tecla em maiúscula (S, 1, /), senão "Tecla<keycode>".
  public static func nomeTecla(keycode: Int64, caracteres: String, semModificadores: String = "") -> String {
    if let nome = nomesPorKeycode[keycode] { return nome }
    if let caractere = caractereDaTecla(keycode: keycode, caracteres: caracteres, semModificadores: semModificadores) {
      return caractere.uppercased()
    }
    return "Tecla" + String(keycode)
  }

  /// Combinação que vira passo `tecla`: ⌘ ou ⌃ com qualquer tecla; ⌥ só com tecla de função ou Enter — ⌥ sozinho
  /// é o mecanismo de entrada de caracteres do macOS (⌥C → ç, ⌥E + vogal → acento) e conta como digitação.
  public static func ehAtalho(keycode: Int64, flags: CGEventFlags) -> Bool {
    if flags.contains(.maskCommand) || flags.contains(.maskControl) { return true }
    if flags.contains(.maskAlternate) { return ehTeclaFuncao(keycode) || keycodesEnter.contains(keycode) }
    return false
  }

  /// Atalho global ⌥⇧R (sem ⌘/⌃).
  public static func ehAtalhoAlternar(keycode: Int64, flags: CGEventFlags) -> Bool {
    return keycode == keycodeR && flags.contains(.maskAlternate) && flags.contains(.maskShift)
      && !flags.contains(.maskCommand) && !flags.contains(.maskControl)
  }

  /// Atalhos de edição (colar, selecionar tudo…) que alteram o campo sem confirmar a digitação.
  public static func ehAtalhoDeEdicao(nome: String, flags: CGEventFlags) -> Bool {
    guard flags.contains(.maskCommand), !flags.contains(.maskControl), !flags.contains(.maskAlternate) else { return false }
    return ["V", "A", "Z", "X", "C"].contains(nome)
  }

  /// Ordem do guia: Ctrl, Alt, Shift, Meta.
  public static func modificadores(_ flags: CGEventFlags) -> [String] {
    var lista: [String] = []
    if flags.contains(.maskControl) { lista.append("Ctrl") }
    if flags.contains(.maskAlternate) { lista.append("Alt") }
    if flags.contains(.maskShift) { lista.append("Shift") }
    if flags.contains(.maskCommand) { lista.append("Meta") }
    return lista
  }

  /// Estilo Mac: ⌃⌥⇧⌘ + tecla, sem "+".
  public static func atalho(tecla: String, flags: CGEventFlags) -> String {
    var texto: String = ""
    if flags.contains(.maskControl) { texto += "⌃" }
    if flags.contains(.maskAlternate) { texto += "⌥" }
    if flags.contains(.maskShift) { texto += "⇧" }
    if flags.contains(.maskCommand) { texto += "⌘" }
    return texto + tecla
  }
}
