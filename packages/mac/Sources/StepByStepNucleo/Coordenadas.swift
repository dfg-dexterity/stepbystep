// Conversão de coordenadas Quartz (pontos, origem no canto superior esquerdo do display principal, y para baixo)
// para pixels da imagem capturada. A escala é sempre medida no bitmap (imagem / display), nunca no backing scale.
// Nunca misturar com NSScreen.frame / NSEvent.mouseLocation (Cocoa, y para cima).
import Foundation
import CoreGraphics

public struct Display: Equatable {
  public let id: CGDirectDisplayID
  /// Limites em coordenadas Quartz globais, em pontos.
  public let limites: CGRect
  public init(id: CGDirectDisplayID, limites: CGRect) {
    self.id = id
    self.limites = limites
  }
}

/// Display que contém o ponto (Quartz). Sem correspondência → display principal.
public func displaySobPonto(_ p: CGPoint) -> CGDirectDisplayID {
  var ids: [CGDirectDisplayID] = [CGDirectDisplayID](repeating: 0, count: 8)
  var quantidade: UInt32 = 0
  let erro: CGError = CGGetDisplaysWithPoint(p, 8, &ids, &quantidade)
  if erro != CGError.success || quantidade == 0 { return CGMainDisplayID() }
  return ids[0]
}

/// Arredondamento igual ao Math.round do JS (metade sobe), para bater com o núcleo.
func arredondar(_ v: Double) -> Double {
  return (v + 0.5).rounded(.down)
}

func limitar(_ v: Double, _ minimo: Double, _ maximo: Double) -> Double {
  return Swift.min(Swift.max(v, minimo), maximo)
}

/// Escalas medidas: sx = imagem.width / display.width, sy = imagem.height / display.height.
public func escalas(display: CGRect, imagem: CGSize) -> (sx: Double, sy: Double) {
  let larguraDisplay: Double = Double(display.size.width)
  let alturaDisplay: Double = Double(display.size.height)
  let sx: Double = larguraDisplay > 0 ? Double(imagem.width) / larguraDisplay : 1.0
  let sy: Double = alturaDisplay > 0 ? Double(imagem.height) / alturaDisplay : sx
  return (sx: sx, sy: sy)
}

/// Limita o rect à imagem; w/h ficam 0 se o rect estiver totalmente fora.
public func limitarAImagem(_ r: Rect, imagem: CGSize) -> Rect {
  let largura: Double = Double(imagem.width)
  let altura: Double = Double(imagem.height)
  let x0: Double = limitar(r.x, 0, largura)
  let y0: Double = limitar(r.y, 0, altura)
  let x1: Double = limitar(r.x + r.w, 0, largura)
  let y1: Double = limitar(r.y + r.h, 0, altura)
  return Rect(x: x0, y: y0, w: Swift.max(0, x1 - x0), h: Swift.max(0, y1 - y0))
}

/// Rect Quartz (pontos) → px da imagem: subtrai a origem do display, escala, arredonda e limita.
public func rectParaImagem(_ r: CGRect, display: CGRect, imagem: CGSize) -> Rect {
  let e = escalas(display: display, imagem: imagem)
  let x: Double = arredondar((Double(r.origin.x) - Double(display.origin.x)) * e.sx)
  let y: Double = arredondar((Double(r.origin.y) - Double(display.origin.y)) * e.sy)
  let w: Double = arredondar(Double(r.size.width) * e.sx)
  let h: Double = arredondar(Double(r.size.height) * e.sy)
  return limitarAImagem(Rect(x: x, y: y, w: w, h: h), imagem: imagem)
}

/// Ponto Quartz (pontos) → px da imagem, limitado à imagem.
public func pontoParaImagem(_ p: CGPoint, display: CGRect, imagem: CGSize) -> Ponto {
  let e = escalas(display: display, imagem: imagem)
  let x: Double = arredondar((Double(p.x) - Double(display.origin.x)) * e.sx)
  let y: Double = arredondar((Double(p.y) - Double(display.origin.y)) * e.sy)
  return Ponto(x: limitar(x, 0, Double(imagem.width)), y: limitar(y, 0, Double(imagem.height)))
}

/// Rect Quartz (pontos) → `alvo.rectCss`: só subtrai a origem do display (mesma origem que o navegador usa).
public func rectParaDisplay(_ r: CGRect, display: CGRect) -> Rect {
  return Rect(x: Double(r.origin.x) - Double(display.origin.x),
              y: Double(r.origin.y) - Double(display.origin.y),
              w: Double(r.size.width),
              h: Double(r.size.height))
}
