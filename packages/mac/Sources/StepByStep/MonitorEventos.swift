// CGEventTap listen-only na sessão: mouse down, keyDown e flagsChanged. O callback C nunca bloqueia —
// copia os campos do evento e despacha para uma fila serial. Se o sistema desabilitar o tap (callback lento
// ou entrada do usuário), reabilita na hora.
import Foundation
import CoreGraphics
import ApplicationServices

struct EventoBruto {
  let tipo: CGEventType
  /// Coordenadas Quartz globais (pontos, origem no canto superior esquerdo do display principal).
  let local: CGPoint
  let flags: CGEventFlags
  /// mouseEventClickState: 2 = duplo clique.
  let cliques: Int64
  let botao: Int64
  let keycode: Int64
  let caracteres: String
  let repeticao: Bool
  let em: Date
}

/// Callback C do tap: sem capturas; `info` carrega o MonitorEventos por Unmanaged.
private func retornoTap(proxy: CGEventTapProxy, tipo: CGEventType, evento: CGEvent,
                        info: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
  guard let info = info else { return Unmanaged.passUnretained(evento) }
  let monitor: MonitorEventos = Unmanaged<MonitorEventos>.fromOpaque(info).takeUnretainedValue()
  if tipo == CGEventType.tapDisabledByTimeout || tipo == CGEventType.tapDisabledByUserInput {
    monitor.reabilitar()
    return Unmanaged.passUnretained(evento)
  }
  monitor.receber(tipo: tipo, evento: evento)
  return Unmanaged.passUnretained(evento)
}

final class MonitorEventos {
  private let fila: DispatchQueue = DispatchQueue(label: "br.com.dexterity.stepbystep.gravacao")
  private let aoReceber: (EventoBruto) -> Void
  private var tap: CFMachPort?
  private var fonte: CFRunLoopSource?
  private(set) var ativo: Bool = false

  init(aoReceber: @escaping (EventoBruto) -> Void) {
    self.aoReceber = aoReceber
  }

  var criado: Bool {
    return tap != nil
  }

  /// Cria o tap no run loop principal. Sem Acessibilidade, `tapCreate` devolve nil.
  func iniciar() throws {
    if tap != nil { return }
    var mascara: CGEventMask = 0
    let tipos: [CGEventType] = [.leftMouseDown, .rightMouseDown, .otherMouseDown, .keyDown, .flagsChanged]
    for tipo in tipos {
      mascara = mascara | (CGEventMask(1) << CGEventMask(tipo.rawValue))
    }
    let info: UnsafeMutableRawPointer = Unmanaged.passUnretained(self).toOpaque()
    guard let novoTap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                                          eventsOfInterest: mascara, callback: retornoTap, userInfo: info) else {
      throw ErroPermissao.semAcessibilidade
    }
    guard let novaFonte = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, novoTap, 0) else {
      throw ErroPermissao.tapSemRunLoop
    }
    CFRunLoopAddSource(CFRunLoopGetMain(), novaFonte, CFRunLoopMode.commonModes)
    CGEvent.tapEnable(tap: novoTap, enable: true)
    tap = novoTap
    fonte = novaFonte
    ativo = true
  }

  /// Pausar = desabilitar o tap; retomar = habilitar.
  func habilitar(_ ligado: Bool) {
    guard let tapAtual = tap else { return }
    ativo = ligado
    CGEvent.tapEnable(tap: tapAtual, enable: ligado)
  }

  func reabilitar() {
    guard let tapAtual = tap, ativo else { return }
    CGEvent.tapEnable(tap: tapAtual, enable: true)
  }

  func parar() {
    if let tapAtual = tap {
      CGEvent.tapEnable(tap: tapAtual, enable: false)
    }
    if let fonteAtual = fonte {
      CFRunLoopRemoveSource(CFRunLoopGetMain(), fonteAtual, CFRunLoopMode.commonModes)
    }
    tap = nil
    fonte = nil
    ativo = false
  }

  /// Chamado no thread do run loop principal pelo callback: só copia campos e despacha.
  func receber(tipo: CGEventType, evento: CGEvent) {
    let ehTeclado: Bool = tipo == CGEventType.keyDown
    let bruto = EventoBruto(
      tipo: tipo,
      local: evento.location,
      flags: evento.flags,
      cliques: evento.getIntegerValueField(.mouseEventClickState),
      botao: evento.getIntegerValueField(.mouseEventButtonNumber),
      keycode: evento.getIntegerValueField(.keyboardEventKeycode),
      caracteres: ehTeclado ? MonitorEventos.caracteres(evento) : "",
      repeticao: ehTeclado && evento.getIntegerValueField(.keyboardEventAutorepeat) != 0,
      em: Date())
    let entregar: (EventoBruto) -> Void = aoReceber
    fila.async {
      entregar(bruto)
    }
  }

  private static func caracteres(_ evento: CGEvent) -> String {
    var comprimento: UniCharCount = 0
    var buffer: [UniChar] = [UniChar](repeating: 0, count: 8)
    evento.keyboardGetUnicodeString(maxStringLength: UniCharCount(8), actualStringLength: &comprimento, unicodeString: &buffer)
    if comprimento <= 0 { return "" }
    return String(utf16CodeUnits: buffer, count: Int(comprimento))
  }
}
