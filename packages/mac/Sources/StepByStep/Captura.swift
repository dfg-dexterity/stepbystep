// Captura do display inteiro sob o cursor com ScreenCaptureKit (macOS 14): menus, popovers, sheets e listas de
// combo são janelas de layer ≠ 0 e sumiriam numa captura por janela. A janela clicada vira `alvo.janelaBbox`
// (recorte automático, não destrutivo).
import Foundation
import CoreGraphics
import ScreenCaptureKit
import StepByStepNucleo

struct ImagemCapturada {
  let imagem: CGImage
  /// Escala real, medida no bitmap: largura da imagem / largura do display em pontos.
  let escala: Double
}

struct JanelaInfo {
  /// Quartz global, pontos.
  let limites: CGRect
  let pid: pid_t
  let titulo: String?
}

final class Capturador {
  private var conteudoCache: SCShareableContent?
  private var conteudoEm: Date = Date.distantPast

  /// Lista de displays/janelas, com cache de 1 s (a consulta custa dezenas de ms).
  private func conteudo() async throws -> SCShareableContent {
    if let cache = conteudoCache, Date().timeIntervalSince(conteudoEm) < 1.0 {
      return cache
    }
    let novo: SCShareableContent = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    conteudoCache = novo
    conteudoEm = Date()
    return novo
  }

  /// Fator de backing do display (pixels / pontos), só informativo (`captura.dpr`); a escala do guia é medida no bitmap.
  static func escalaFisica(_ display: Display) -> Double {
    let larguraPontos: Double = Double(display.limites.size.width)
    guard larguraPontos > 0, let modo = CGDisplayCopyDisplayMode(display.id) else { return 1.0 }
    return Double(modo.pixelWidth) / larguraPontos
  }

  func capturar(display: Display) async throws -> ImagemCapturada {
    let lista: SCShareableContent = try await conteudo()
    guard let scDisplay = lista.displays.first(where: { $0.displayID == display.id }) else {
      throw ErroGravacao.displayNaoEncontrado
    }
    let filtro = SCContentFilter(display: scDisplay, excludingWindows: [])
    let configuracao = SCStreamConfiguration()
    let fator: Double = Capturador.escalaFisica(display)
    configuracao.width = Int((Double(display.limites.size.width) * fator).rounded())
    configuracao.height = Int((Double(display.limites.size.height) * fator).rounded())
    configuracao.showsCursor = false
    configuracao.captureResolution = .best
    configuracao.scalesToFit = false
    let imagem: CGImage = try await SCScreenshotManager.captureImage(contentFilter: filtro, configuration: configuracao)
    let larguraPontos: Double = Double(display.limites.size.width)
    let escala: Double = larguraPontos > 0 ? Double(imagem.width) / larguraPontos : 1.0
    return ImagemCapturada(imagem: imagem, escala: escala)
  }

  /// Primeira janela normal (layer 0) sob o ponto, da frente para trás. Ignora as janelas do próprio app.
  static func janelaSob(_ p: CGPoint, ignorandoPid: pid_t) -> JanelaInfo? {
    let opcoes: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let lista = CGWindowListCopyWindowInfo(opcoes, kCGNullWindowID) as? [[String: Any]] else { return nil }
    for info in lista {
      let camada: Int = (info[kCGWindowLayer as String] as? Int) ?? -1
      if camada != 0 { continue }
      let pidJanela: pid_t = pid_t((info[kCGWindowOwnerPID as String] as? Int) ?? 0)
      if pidJanela == ignorandoPid { continue }
      guard let dicionario = info[kCGWindowBounds as String] as? [String: Any],
            let limites = CGRect(dictionaryRepresentation: dicionario as CFDictionary) else { continue }
      if limites.contains(p) {
        let titulo: String? = info[kCGWindowName as String] as? String
        return JanelaInfo(limites: limites, pid: pidJanela, titulo: titulo)
      }
    }
    return nil
  }
}
