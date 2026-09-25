// Nome da pasta de gravação: <AAAA-MM-DD_HHmm>_<slug-do-app> (contrato 6.3). Duas gravações no mesmo minuto
// e no mesmo app não podem cair na mesma pasta (a segunda sobrescreveria o guide.json, anexaria ao journal e
// apagaria o zip da primeira): a segunda recebe o sufixo _2, a terceira _3, e assim por diante.
import Foundation

public enum PastaGravacao {
  /// "SAP GUI" → "sap-gui"; sem acentos, só [a-z0-9-], ≤ 40 chars.
  public static func slug(_ texto: String) -> String {
    let base: String = texto.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "pt_BR")).lowercased()
    var saida: String = ""
    var ultimoHifen: Bool = true
    for caractere in base {
      let ehAlfanumerico: Bool = caractere.isASCII && (caractere.isLetter || caractere.isNumber)
      if ehAlfanumerico {
        saida.append(caractere)
        ultimoHifen = false
      } else if !ultimoHifen {
        saida.append("-")
        ultimoHifen = true
      }
    }
    while saida.hasSuffix("-") { saida.removeLast() }
    if saida.count > 40 { saida = String(saida.prefix(40)) }
    return saida.isEmpty ? "app" : saida
  }

  /// "2026-09-24_1412_sap-gui" (hora local do fuso dado; padrão: o do sistema).
  public static func nomeBase(app: String, agora: Date, fuso: TimeZone = TimeZone.current) -> String {
    let formatador = DateFormatter()
    formatador.locale = Locale(identifier: "en_US_POSIX")
    formatador.timeZone = fuso
    formatador.dateFormat = "yyyy-MM-dd_HHmm"
    return formatador.string(from: agora) + "_" + slug(app)
  }

  /// Primeiro nome livre: `base`, senão `base_2`, `base_3`… (`existe` consulta o disco — pasta ou zip).
  public static func nomeLivre(base: String, existe: (String) -> Bool) -> String {
    if !existe(base) { return base }
    var sufixo: Int = 2
    while sufixo < 10_000 {
      let candidato: String = base + "_" + String(sufixo)
      if !existe(candidato) { return candidato }
      sufixo += 1
    }
    return base + "_" + String(Int(Date().timeIntervalSince1970))
  }
}
