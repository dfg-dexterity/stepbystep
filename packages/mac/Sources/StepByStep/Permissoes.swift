// Permissões do TCC: Acessibilidade (tap + AX), Gravação de Tela (ScreenCaptureKit) e, opcional, Monitoramento de Entrada.
// Não existem chaves de Info.plist para esses prompts; o pedido é feito pelas funções de preflight/request.
import AppKit
import ApplicationServices
import CoreGraphics

enum ErroPermissao: Error, LocalizedError {
  case semAcessibilidade
  case semGravacaoDeTela
  case tapSemRunLoop

  var errorDescription: String? {
    switch self {
    case .semAcessibilidade:
      return "Conceda Acessibilidade ao StepByStep em Ajustes do Sistema › Privacidade e Segurança e reabra o app."
    case .semGravacaoDeTela:
      return "Conceda Gravação de Tela ao StepByStep em Ajustes do Sistema › Privacidade e Segurança e reabra o app."
    case .tapSemRunLoop:
      return "Não foi possível ligar o monitor de eventos ao run loop."
    }
  }
}

/// Alvo dos botões do painel (um enum não pode ser target de NSButton).
@MainActor
final class ControladorPermissoes: NSObject {
  @objc func abrirAcessibilidade(_ sender: Any?) { Permissoes.abrirAjustes("Privacy_Accessibility") }
  @objc func abrirGravacaoDeTela(_ sender: Any?) { Permissoes.abrirAjustes("Privacy_ScreenCapture") }
  @objc func abrirMonitoramento(_ sender: Any?) { Permissoes.abrirAjustes("Privacy_ListenEvent") }
  @objc func verificar(_ sender: Any?) { Permissoes.atualizarPainel() }
}

@MainActor
enum Permissoes {
  private static var painel: NSPanel?
  private static var linhas: [NSTextField] = []
  private static var controlador: ControladorPermissoes?

  // MARK: Preflight

  static func acessibilidade(pedir: Bool) -> Bool {
    let chave: String = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    let opcoes: [String: Bool] = [chave: pedir]
    return AXIsProcessTrustedWithOptions(opcoes as CFDictionary)
  }

  static func gravacaoDeTela(pedir: Bool) -> Bool {
    if CGPreflightScreenCaptureAccess() { return true }
    if pedir { return CGRequestScreenCaptureAccess() }
    return false
  }

  static func monitoramentoDeEntrada(pedir: Bool) -> Bool {
    if CGPreflightListenEventAccess() { return true }
    if pedir { return CGRequestListenEventAccess() }
    return false
  }

  /// Gravar exige Acessibilidade + Gravação de Tela (Monitoramento de Entrada é opcional).
  static func prontasParaGravar(pedir: Bool) -> Bool {
    let ax: Bool = acessibilidade(pedir: pedir)
    let tela: Bool = gravacaoDeTela(pedir: pedir)
    return ax && tela
  }

  static func abrirAjustes(_ secao: String) {
    let texto: String = "x-apple.systempreferences:com.apple.preference.security?" + secao
    if let url = URL(string: texto) {
      _ = NSWorkspace.shared.open(url)
    }
  }

  // MARK: Painel

  static func mostrarPainel() {
    if painel == nil {
      painel = criarPainel()
    }
    atualizarPainel()
    NSApp.activate()
    painel?.center()
    painel?.makeKeyAndOrderFront(nil)
  }

  static func atualizarPainel() {
    guard linhas.count == 3 else { return }
    let estados: [Bool] = [acessibilidade(pedir: false), gravacaoDeTela(pedir: false), monitoramentoDeEntrada(pedir: false)]
    let nomes: [String] = ["Acessibilidade (obrigatória)", "Gravação de Tela (obrigatória)", "Monitoramento de Entrada (opcional)"]
    for indice in 0..<3 {
      let concedida: Bool = estados[indice]
      linhas[indice].stringValue = (concedida ? "● " : "○ ") + nomes[indice] + (concedida ? " — concedida" : " — pendente")
      linhas[indice].textColor = concedida ? NSColor.systemGreen : NSColor.systemOrange
    }
  }

  private static func criarPainel() -> NSPanel {
    let alvo = ControladorPermissoes()
    controlador = alvo
    let largura: CGFloat = 480
    let altura: CGFloat = 230
    let novo = NSPanel(contentRect: NSRect(x: 0, y: 0, width: largura, height: altura),
                       styleMask: [.titled, .closable], backing: .buffered, defer: false)
    novo.title = "Permissões do StepByStep"
    novo.isReleasedWhenClosed = false
    guard let conteudo = novo.contentView else { return novo }

    let titulo = NSTextField(labelWithString: "Abra o app sempre por build/StepByStep.app (nunca pelo Terminal) para as permissões ficarem com ele.")
    titulo.frame = NSRect(x: 20, y: altura - 50, width: largura - 40, height: 36)
    titulo.lineBreakMode = .byWordWrapping
    titulo.maximumNumberOfLines = 2
    titulo.font = NSFont.systemFont(ofSize: 11)
    titulo.textColor = NSColor.secondaryLabelColor
    conteudo.addSubview(titulo)

    let seletores: [Selector] = [#selector(ControladorPermissoes.abrirAcessibilidade(_:)),
                                 #selector(ControladorPermissoes.abrirGravacaoDeTela(_:)),
                                 #selector(ControladorPermissoes.abrirMonitoramento(_:))]
    linhas = []
    for indice in 0..<3 {
      let y: CGFloat = altura - 95 - CGFloat(indice) * 40
      let linha = NSTextField(labelWithString: "")
      linha.frame = NSRect(x: 20, y: y, width: largura - 160, height: 24)
      conteudo.addSubview(linha)
      linhas.append(linha)
      let botao = NSButton(title: "Abrir Ajustes", target: alvo, action: seletores[indice])
      botao.frame = NSRect(x: largura - 130, y: y - 4, width: 110, height: 30)
      conteudo.addSubview(botao)
    }

    let verificar = NSButton(title: "Verificar novamente", target: alvo, action: #selector(ControladorPermissoes.verificar(_:)))
    verificar.frame = NSRect(x: largura - 180, y: 16, width: 160, height: 30)
    conteudo.addSubview(verificar)
    return novo
  }
}
