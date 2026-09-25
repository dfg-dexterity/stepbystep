// Fallback de rótulo quando a Acessibilidade não dá nome ao elemento: reconhece a linha de texto sob o clique
// num recorte de 240×80 pt ao redor dele (Vision, nível rápido). Síncrono — chamar fora da main.
import Foundation
import CoreGraphics
import Vision
import StepByStepNucleo

enum OCR {
  static func rotulo(imagem: CGImage, ponto: Ponto, escala: Double) -> String? {
    let larguraRecorte: Double = 240.0 * escala
    let alturaRecorte: Double = 80.0 * escala
    let x0: Double = Swift.max(0.0, ponto.x - larguraRecorte / 2.0)
    let y0: Double = Swift.max(0.0, ponto.y - alturaRecorte / 2.0)
    let x1: Double = Swift.min(Double(imagem.width), ponto.x + larguraRecorte / 2.0)
    let y1: Double = Swift.min(Double(imagem.height), ponto.y + alturaRecorte / 2.0)
    let area = CGRect(x: x0, y: y0, width: x1 - x0, height: y1 - y0)
    guard area.size.width > 4, area.size.height > 4, let recorte = imagem.cropping(to: area) else { return nil }

    let pedido = VNRecognizeTextRequest()
    pedido.recognitionLevel = .fast
    pedido.recognitionLanguages = ["pt-BR", "en-US"]
    pedido.usesLanguageCorrection = false
    let manipulador = VNImageRequestHandler(cgImage: recorte, options: [:])
    do {
      try manipulador.perform([pedido])
    } catch {
      return nil
    }
    guard let observacoes = pedido.results, !observacoes.isEmpty else { return nil }

    // Vision devolve caixas normalizadas com origem no canto inferior esquerdo.
    let alvo = CGPoint(x: (ponto.x - x0) / Double(area.size.width),
                       y: 1.0 - (ponto.y - y0) / Double(area.size.height))
    var escolhida: VNRecognizedTextObservation? = observacoes.first(where: { $0.boundingBox.contains(alvo) })
    if escolhida == nil {
      escolhida = observacoes.min(by: { distancia($0.boundingBox, alvo) < distancia($1.boundingBox, alvo) })
    }
    guard let observacao = escolhida, let candidato = observacao.topCandidates(1).first else { return nil }
    let texto: String = candidato.string.trimmingCharacters(in: .whitespacesAndNewlines)
    return texto.isEmpty ? nil : texto
  }

  private static func distancia(_ caixa: CGRect, _ p: CGPoint) -> Double {
    let dx: Double = Double(caixa.midX - p.x)
    let dy: Double = Double(caixa.midY - p.y)
    return dx * dx + dy * dy
  }
}
