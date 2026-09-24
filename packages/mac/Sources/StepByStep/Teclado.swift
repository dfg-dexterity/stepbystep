// Buffer de digitação por elemento focado. O valor digitado nunca é reconstruído das teclas: na confirmação ele
// é lido de kAXValueAttribute. Nomes de tecla, modificadores e atalhos ficam em StepByStepNucleo.Teclas
// (puro, coberto por TeclasTests).
import Foundation
import ApplicationServices

struct DigitacaoPendente {
  /// nil quando o foco não pôde ser determinado (o valor vira nil e o passo é marcado sensível).
  let elemento: AXUIElement?
  let pid: pid_t
  let descritor: DescritorAX?
  let iniciadoEm: Date
  var ultimaTeclaEm: Date
  var teclas: Int
  /// Campo seguro: o "secure input" não entrega keyDown ao tap, então a digitação é detectada pela variação de
  /// kAXNumberOfCharactersAttribute (bullets contam). `nil` quando o atributo não pôde ser lido no clique.
  var caracteresIniciais: Int?
  var caracteresAtuais: Int?

  var seguro: Bool {
    return descritor?.seguro ?? false
  }

  /// Falso só quando o campo é seguro, o comprimento foi lido no clique e não mudou desde então.
  var houveDigitacao: Bool {
    guard seguro, let inicial = caracteresIniciais else { return true }
    return (caracteresAtuais ?? inicial) != inicial
  }
}

final class Teclado {
  private(set) var pendente: DigitacaoPendente?

  /// Começa ou continua a digitação no elemento focado. `caracteres`: comprimento atual de um campo seguro.
  func acumular(elemento: AXUIElement?, pid: pid_t, descritor: DescritorAX?, em: Date, caracteres: Int? = nil) {
    if var atual = pendente, Acessibilidade.mesmoElemento(atual.elemento, elemento) {
      atual.ultimaTeclaEm = em
      atual.teclas += 1
      pendente = atual
      return
    }
    pendente = DigitacaoPendente(elemento: elemento, pid: pid, descritor: descritor, iniciadoEm: em, ultimaTeclaEm: em,
                                 teclas: 1, caracteresIniciais: caracteres, caracteresAtuais: caracteres)
  }

  /// Campo seguro: comprimento relido no tique; se mudou, conta como tecla (adia a confirmação por tempo).
  func atualizarCaracteres(_ quantidade: Int, em: Date) {
    guard var atual = pendente, atual.seguro else { return }
    if atual.caracteresAtuais == quantidade { return }
    atual.caracteresAtuais = quantidade
    atual.ultimaTeclaEm = em
    atual.teclas += 1
    pendente = atual
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
}
