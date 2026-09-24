// Quartz (pontos) → px da imagem: displays com origem negativa, escalas 1x/2x mistas, arredondamento e clamp.
import XCTest
import CoreGraphics
import StepByStepNucleo

final class CoordenadasTests: XCTestCase {
  private let principal2x: CGRect = CGRect(x: 0, y: 0, width: 1728, height: 1117)
  private let imagemPrincipal: CGSize = CGSize(width: 3456, height: 2234)

  func testDisplayPrincipalRetina() {
    // Mesmos números do fixture guia-mac (passo 2).
    let bbox: Rect = rectParaImagem(CGRect(x: 96, y: 58, width: 200, height: 22), display: principal2x, imagem: imagemPrincipal)
    XCTAssertEqual(bbox, Rect(x: 192, y: 116, w: 400, h: 44))
    let ponto: Ponto = pontoParaImagem(CGPoint(x: 130, y: 69), display: principal2x, imagem: imagemPrincipal)
    XCTAssertEqual(ponto, Ponto(x: 260, y: 138))
    let e = escalas(display: principal2x, imagem: imagemPrincipal)
    XCTAssertEqual(e.sx, 2)
    XCTAssertEqual(e.sy, 2)
    // rectCss só subtrai a origem (aqui zero).
    XCTAssertEqual(rectParaDisplay(CGRect(x: 96, y: 58, width: 200, height: 22), display: principal2x),
                   Rect(x: 96, y: 58, w: 200, h: 22))
  }

  func testDisplaySecundarioComOrigemNegativa() {
    // Monitor 1x à esquerda e acima do principal: origem (-1920, -1080).
    let secundario: CGRect = CGRect(x: -1920, y: -1080, width: 1920, height: 1080)
    let imagem: CGSize = CGSize(width: 1920, height: 1080)
    XCTAssertEqual(rectParaImagem(CGRect(x: -1800, y: -1000, width: 100, height: 50), display: secundario, imagem: imagem),
                   Rect(x: 120, y: 80, w: 100, h: 50))
    XCTAssertEqual(pontoParaImagem(CGPoint(x: -1920, y: -1080), display: secundario, imagem: imagem), Ponto(x: 0, y: 0))
    XCTAssertEqual(pontoParaImagem(CGPoint(x: -1, y: -1), display: secundario, imagem: imagem), Ponto(x: 1919, y: 1079))
    XCTAssertEqual(rectParaDisplay(CGRect(x: -1800, y: -1000, width: 100, height: 50), display: secundario),
                   Rect(x: 120, y: 80, w: 100, h: 50))
  }

  func testEscalasMistas() {
    // Principal 2x (0,0) e um 1x à direita (1728, 0): a escala é medida por display, nunca global.
    let direita1x: CGRect = CGRect(x: 1728, y: 0, width: 1920, height: 1080)
    let imagem1x: CGSize = CGSize(width: 1920, height: 1080)
    XCTAssertEqual(rectParaImagem(CGRect(x: 1828, y: 100, width: 50, height: 50), display: direita1x, imagem: imagem1x),
                   Rect(x: 100, y: 100, w: 50, h: 50))
    XCTAssertEqual(rectParaImagem(CGRect(x: 100, y: 100, width: 50, height: 50), display: principal2x, imagem: imagemPrincipal),
                   Rect(x: 200, y: 200, w: 100, h: 100))
    // Display 2x acima do principal (origem negativa em y) com imagem 2x.
    let acima2x: CGRect = CGRect(x: 0, y: -900, width: 1440, height: 900)
    let imagemAcima: CGSize = CGSize(width: 2880, height: 1800)
    XCTAssertEqual(pontoParaImagem(CGPoint(x: 720, y: -450), display: acima2x, imagem: imagemAcima), Ponto(x: 1440, y: 900))
    // Escala fracionária (1.5): a fórmula vale para qualquer razão imagem/display.
    let fracionario: CGRect = CGRect(x: 0, y: 0, width: 1000, height: 600)
    XCTAssertEqual(rectParaImagem(CGRect(x: 10, y: 10, width: 100, height: 20), display: fracionario,
                                  imagem: CGSize(width: 1500, height: 900)),
                   Rect(x: 15, y: 15, w: 150, h: 30))
  }

  func testArredondamentoIgualAoJs() {
    // 1.5 → 2 (Math.round arredonda metade para cima), 2.5 → 3.
    let display: CGRect = CGRect(x: 0, y: 0, width: 100, height: 100)
    let imagem: CGSize = CGSize(width: 150, height: 150)
    XCTAssertEqual(rectParaImagem(CGRect(x: 1, y: 1, width: 1, height: 1), display: display, imagem: imagem),
                   Rect(x: 2, y: 2, w: 2, h: 2))
    XCTAssertEqual(pontoParaImagem(CGPoint(x: 1.7, y: 0.3), display: display, imagem: imagem), Ponto(x: 3, y: 0))
  }

  func testClampNaImagem() {
    // Parcialmente fora (canto superior esquerdo): fica o pedaço visível.
    XCTAssertEqual(rectParaImagem(CGRect(x: -10, y: -10, width: 20, height: 20), display: principal2x, imagem: imagemPrincipal),
                   Rect(x: 0, y: 0, w: 20, h: 20))
    // Parcialmente fora à direita.
    XCTAssertEqual(rectParaImagem(CGRect(x: 1700, y: 0, width: 100, height: 10), display: principal2x, imagem: imagemPrincipal),
                   Rect(x: 3400, y: 0, w: 56, h: 20))
    // Totalmente fora: w = h = 0 (sem anotações automáticas no editor).
    let fora: Rect = rectParaImagem(CGRect(x: 2000, y: 0, width: 10, height: 10), display: principal2x, imagem: imagemPrincipal)
    XCTAssertEqual(fora.w, 0)
    XCTAssertEqual(fora.x, 3456)
    XCTAssertEqual(fora.h, 20)
    // Ponto fora é limitado à borda.
    XCTAssertEqual(pontoParaImagem(CGPoint(x: -5, y: 5000), display: principal2x, imagem: imagemPrincipal), Ponto(x: 0, y: 2234))
    // limitarAImagem direto.
    XCTAssertEqual(limitarAImagem(Rect(x: 100, y: 100, w: 5000, h: 5000), imagem: imagemPrincipal),
                   Rect(x: 100, y: 100, w: 3356, h: 2134))
  }

  func testDisplayDegenerado() {
    // Display sem largura não divide por zero.
    let vazio: CGRect = CGRect(x: 0, y: 0, width: 0, height: 0)
    let e = escalas(display: vazio, imagem: CGSize(width: 10, height: 10))
    XCTAssertEqual(e.sx, 1)
    XCTAssertEqual(e.sy, 1)
  }

  func testDisplaySobPontoDevolveAlgumDisplay() {
    // Sem sessão gráfica (CI) cai no display principal; com sessão, (1,1) está no principal por definição do Quartz.
    XCTAssertEqual(displaySobPonto(CGPoint(x: 1, y: 1)), CGMainDisplayID())
    let display = Display(id: CGMainDisplayID(), limites: principal2x)
    XCTAssertEqual(display, Display(id: CGMainDisplayID(), limites: principal2x))
  }
}
