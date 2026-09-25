// Ids no mesmo padrão do núcleo JS: `${prefixo}_${Date.now().toString(36)}${6 chars base36 aleatórios}`.
// O prefixo temporal mantém a ordem cronológica; o sufixo evita colisão no mesmo milissegundo.
import Foundation

private let alfabetoBase36: [Character] = Array("0123456789abcdefghijklmnopqrstuvwxyz")
private let prefixosValidos: Set<String> = ["g", "p", "img", "a"]

/// Gera um id `prefixo_<ms em base36><6 chars base36>`; prefixos: g (guia), p (passo), img (imagem), a (anotação).
public func gerarId(_ prefixo: String) -> String {
  let milissegundos: Int = Int(Date().timeIntervalSince1970 * 1000.0)
  let tempo: String = String(milissegundos, radix: 36, uppercase: false)
  var sufixo: String = ""
  for _ in 0..<6 {
    let indice: Int = Int.random(in: 0..<alfabetoBase36.count)
    sufixo.append(alfabetoBase36[indice])
  }
  return prefixo + "_" + tempo + sufixo
}

/// Verdadeiro quando o id casa /^(g|p|img|a)_[0-9a-z]{8,24}$/.
public func validarId(_ id: String) -> Bool {
  guard let separador = id.firstIndex(of: "_") else { return false }
  let prefixo: String = String(id[id.startIndex..<separador])
  guard prefixosValidos.contains(prefixo) else { return false }
  let corpo: Substring = id[id.index(after: separador)...]
  guard corpo.count >= 8, corpo.count <= 24 else { return false }
  for caractere in corpo {
    let ehDigito: Bool = caractere >= "0" && caractere <= "9"
    let ehLetra: Bool = caractere >= "a" && caractere <= "z"
    if !(ehDigito || ehLetra) { return false }
  }
  return true
}
