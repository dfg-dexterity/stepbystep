// Máquina de estados da gravação: evento → descritor (AX) → captura (display sob o ponto) → passo → persistência.
// Tudo o que muda estado passa por um único fluxo sequencial (AsyncStream consumido por uma Task), então não há
// corrida entre cliques, teclas, ticks do temporizador, troca de app e comandos do menu. Mesmas regras do
// redutor JS: digitação pendente antes do clique (imagem compartilhada), duplo clique atualiza o passo anterior,
// troca de app sem clique recente vira passo `navegar` com `evento.app`.
import Foundation
import AppKit
import CoreGraphics
import ApplicationServices
import StepByStepNucleo

enum EstadoGravador {
  case parado
  case gravando
  case pausado
}

private enum Comando {
  case iniciar(app: String, pid: pid_t, bundleId: String?)
  case pausarOuRetomar
  case parar
  case alternar
}

private enum Entrada {
  case evento(EventoBruto)
  case comando(Comando)
  case appAtivado(pid: pid_t, nome: String, bundleId: String?)
  case rotuloOcr(passoId: String, rotulo: String)
  case tique
}

/// Foto de um display: a `captura` do passo mais o display (para converter coordenadas) e o bitmap (para OCR).
private struct Foto {
  var captura: Captura
  let display: Display
  let imagem: CGImage?

  var tela: Tela {
    return Tela(id: Int(display.id), largura: Double(display.limites.size.width),
                altura: Double(display.limites.size.height), escala: captura.escala)
  }

  var tamanho: CGSize {
    return CGSize(width: Double(captura.largura), height: Double(captura.altura))
  }

  func com(fonte: String) -> Foto {
    var copia: Foto = self
    copia.captura.fonte = fonte
    return copia
  }
}

final class Gravador {
  /// Chamado na main a cada mudança de estado/contador (menu bar).
  var aoMudar: (@MainActor (EstadoGravador, Int) -> Void)?
  var aoErro: (@MainActor (String) -> Void)?

  private var estado: EstadoGravador = .parado
  private var guia: Guia?
  private var persistencia: Persistencia?
  private var contador: Int = 0
  private let capturador: Capturador = Capturador()
  private let teclado: Teclado = Teclado()
  private var monitor: MonitorEventos?
  private var continuacao: AsyncStream<Entrada>.Continuation?
  private var tarefa: Task<Void, Never>?
  private var temporizador: DispatchSourceTimer?
  private var observador: NSObjectProtocol?
  private let pidProprio: pid_t = ProcessInfo.processInfo.processIdentifier

  private var appFrontal: (pid: pid_t, nome: String, bundleId: String?) = (0, "", nil)
  private var ultimaFoto: (foto: Foto, em: Date)?
  private var ultimoClique: (passoId: String, em: Date, pid: pid_t)?
  private var ultimoCliqueEm: Date = Date.distantPast
  private var primeiroFlagsEm: Date?
  private var teclasRecebidas: Int = 0
  private var monitoramentoPedido: Bool = false

  init() {
    var novaContinuacao: AsyncStream<Entrada>.Continuation? = nil
    let fluxo = AsyncStream<Entrada>(bufferingPolicy: .unbounded) { c in
      novaContinuacao = c
    }
    continuacao = novaContinuacao
    tarefa = Task { [weak self] in
      for await entrada in fluxo {
        guard let forte = self else { return }
        await forte.processar(entrada)
      }
    }
    // Tick de 300 ms: tempo ocioso da digitação e mudança de foco (só age quando há digitação pendente).
    let fonteTempo: DispatchSourceTimer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
    fonteTempo.schedule(deadline: DispatchTime.now() + 0.3, repeating: 0.3)
    fonteTempo.setEventHandler { [weak self] in
      _ = self?.continuacao?.yield(.tique)
    }
    fonteTempo.resume()
    temporizador = fonteTempo
  }

  // MARK: API (main)

  @MainActor
  func preparar() {
    if let frontal = NSWorkspace.shared.frontmostApplication, frontal.processIdentifier != pidProprio {
      appFrontal = (frontal.processIdentifier, frontal.localizedName ?? "", frontal.bundleIdentifier)
    }
    observador = NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: nil) { [weak self] notificacao in
        guard let app = notificacao.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
        _ = self?.continuacao?.yield(.appAtivado(pid: app.processIdentifier, nome: app.localizedName ?? "", bundleId: app.bundleIdentifier))
    }
    prepararMonitor()
  }

  /// Cria o tap (precisa de Acessibilidade); fica ativo também parado, só para ouvir ⌥⇧R.
  @MainActor
  private func prepararMonitor() {
    if let atual = monitor, atual.criado { return }
    guard Permissoes.acessibilidade(pedir: false) else { return }
    let novo = MonitorEventos { [weak self] evento in
      _ = self?.continuacao?.yield(.evento(evento))
    }
    do {
      try novo.iniciar()
      monitor = novo
    } catch {
      monitor = nil
    }
  }

  @MainActor
  func iniciar() {
    guard Permissoes.prontasParaGravar(pedir: true) else {
      Permissoes.mostrarPainel()
      return
    }
    prepararMonitor()
    guard let atual = monitor, atual.criado else {
      aoErro?("O monitor de eventos não pôde ser criado. Conceda Acessibilidade ao StepByStep e reabra o app.")
      return
    }
    var nome: String = appFrontal.nome
    var pid: pid_t = appFrontal.pid
    var bundleId: String? = appFrontal.bundleId
    if let frontal = NSWorkspace.shared.frontmostApplication, frontal.processIdentifier != pidProprio {
      nome = frontal.localizedName ?? nome
      pid = frontal.processIdentifier
      bundleId = frontal.bundleIdentifier
    }
    continuacao?.yield(.comando(.iniciar(app: nome, pid: pid, bundleId: bundleId)))
  }

  func pausarOuRetomar() {
    continuacao?.yield(.comando(.pausarOuRetomar))
  }

  func parar() {
    continuacao?.yield(.comando(.parar))
  }

  /// Reconstrói o guide.json do journal, compacta e revela no Finder.
  func recuperar(pasta: URL) {
    Task { [weak self] in
      do {
        _ = try Persistencia.recuperar(pasta: pasta)
        let zip: URL = try Persistencia.compactar(pasta: pasta)
        await self?.revelar(zip)
      } catch {
        await self?.notificarErro("Não foi possível recuperar a gravação: \(error.localizedDescription)")
      }
    }
  }

  @MainActor
  func encerrar() {
    temporizador?.cancel()
    monitor?.parar()
  }

  // MARK: Fluxo sequencial

  private func processar(_ entrada: Entrada) async {
    switch entrada {
    case .evento(let e):
      await processarEvento(e)
    case .comando(let comando):
      await processarComando(comando)
    case .appAtivado(let pid, let nome, let bundleId):
      await processarAppAtivado(pid: pid, nome: nome, bundleId: bundleId)
    case .rotuloOcr(let passoId, let rotulo):
      aplicarRotuloOcr(passoId: passoId, rotulo: rotulo)
    case .tique:
      await processarTique()
    }
  }

  private func processarComando(_ comando: Comando) async {
    switch comando {
    case .iniciar(let app, let pid, let bundleId):
      guard estado == .parado else { return }
      await iniciarGravacao(app: app, pid: pid, bundleId: bundleId)
    case .pausarOuRetomar:
      if estado == .gravando {
        await pausar()
      } else if estado == .pausado {
        retomar()
      }
    case .parar:
      guard estado != .parado else { return }
      await pararGravacao()
    case .alternar:
      if estado == .parado {
        await MainActor.run { self.iniciar() }
      } else {
        await pararGravacao()
      }
    }
  }

  private func processarEvento(_ e: EventoBruto) async {
    if e.tipo == CGEventType.keyDown, !e.repeticao, Teclado.ehAtalhoAlternar(keycode: e.keycode, flags: e.flags) {
      await processarComando(.alternar)
      return
    }
    guard estado == .gravando else { return }
    switch e.tipo {
    case .leftMouseDown, .rightMouseDown, .otherMouseDown:
      await tratarClique(e)
    case .keyDown:
      await tratarTecla(e)
    case .flagsChanged:
      verificarMonitoramentoEntrada(e)
    default:
      break
    }
  }

  // MARK: Início, pausa, fim

  private func iniciarGravacao(app: String, pid: pid_t, bundleId: String?) async {
    let nomeApp: String = app.isEmpty ? "app" : app
    do {
      persistencia = try Persistencia(app: nomeApp)
    } catch {
      await notificarErro("Não foi possível criar a pasta da gravação: \(error.localizedDescription)")
      return
    }
    guia = Guia.novo(app: nomeApp)
    contador = 0
    ultimaFoto = nil
    ultimoClique = nil
    ultimoCliqueEm = Date.distantPast
    teclado.descartar()
    if pid > 0 {
      appFrontal = (pid, nomeApp, bundleId)
      Acessibilidade.habilitarAcessibilidadeManual(pid: pid)
    }
    estado = .gravando
    monitor?.habilitar(true)
    salvarGuia()
    notificarMudanca()
    // Passo inicial: "Abra o app «…»" com a tela como está 300 ms depois.
    try? await Task.sleep(nanoseconds: 300_000_000)
    await criarPassoNavegar(app: nomeApp, pid: appFrontal.pid, bundleId: appFrontal.bundleId)
  }

  private func pausar() async {
    if teclado.pendente != nil {
      await confirmarDigitacao(confirmadoPor: "tempo", foto: nil)
    }
    estado = .pausado
    monitor?.habilitar(false)
    notificarMudanca()
  }

  private func retomar() {
    estado = .gravando
    ultimaFoto = nil
    monitor?.habilitar(true)
    notificarMudanca()
  }

  private func pararGravacao() async {
    if estado == .gravando, teclado.pendente != nil {
      await confirmarDigitacao(confirmadoPor: "parar", foto: nil)
    }
    teclado.descartar()
    estado = .parado
    monitor?.habilitar(true)   // continua ouvindo só o atalho ⌥⇧R
    guia?.estado = "concluido"
    guia?.atualizadoEm = agoraComMilissegundos()
    salvarGuia()
    let armazenamento: Persistencia? = persistencia
    persistencia = nil
    guia = nil
    contador = 0
    ultimaFoto = nil
    ultimoClique = nil
    notificarMudanca()
    guard let arquivos = armazenamento else { return }
    arquivos.fechar()
    do {
      let zip: URL = try arquivos.compactar()
      await revelar(zip)
    } catch {
      await notificarErro(error.localizedDescription)
    }
  }

  // MARK: Cliques

  private func tratarClique(_ e: EventoBruto) async {
    let p: CGPoint = e.local
    let descritor: DescritorAX? = Acessibilidade.descrever(ponto: p)
    if let d = descritor, d.pid == pidProprio { return }
    let janela: JanelaInfo? = Capturador.janelaSob(p, ignorandoPid: pidProprio)
    let em: Date = e.em
    let foto: Foto = await obterFoto(displayId: displaySobPonto(p), em: em, fonte: "pointerdown")

    // Digitação pendente em outro elemento: passo `digitar` antes do clique, com a mesma imagem.
    if let pendente = teclado.pendente {
      let cliqueNoMesmoCampo: Bool = descritor != nil && Acessibilidade.mesmoElemento(pendente.elemento, descritor?.elemento)
      if !cliqueNoMesmoCampo {
        await confirmarDigitacao(confirmadoPor: "clique", foto: foto.com(fonte: "compartilhada"))
      }
    }

    let pidAlvo: pid_t = descritor?.pid ?? janela?.pid ?? appFrontal.pid

    // Duplo clique: atualiza `evento.vezes` do passo anterior em vez de criar outro.
    if e.cliques >= 2, let anterior = ultimoClique, anterior.pid == pidAlvo, em.timeIntervalSince(anterior.em) < 1.0 {
      let atualizado: Bool = guia?.atualizar(passoId: anterior.passoId) { passo in
        if case .clicar(let botao, _, let modificadores) = passo.evento {
          passo.evento = .clicar(botao: botao, vezes: 2, modificadores: modificadores)
        }
      } ?? false
      if atualizado { salvarGuia() }
      ultimoClique = (anterior.passoId, em, anterior.pid)
      ultimoCliqueEm = em
      return
    }

    let botao: String
    switch e.tipo {
    case .rightMouseDown: botao = "direito"
    case .otherMouseDown: botao = "meio"
    default: botao = "esquerdo"
    }
    let alvo: Alvo = montarAlvo(descritor: descritor, janela: janela, foto: foto, ponto: p)
    var passo: Passo
    if let d = descritor, d.papel == "checkbox" || d.papel == "radio" || d.papel == "switch" {
      passo = Passo.novo(tipo: "marcar")
      let marcadoAntes: Bool = d.marcado ?? false
      passo.evento = .marcar(marcado: d.papel == "radio" ? true : !marcadoAntes)
    } else {
      passo = Passo.novo(tipo: "clicar")
      passo.evento = .clicar(botao: botao, vezes: 1, modificadores: Teclado.modificadores(e.flags))
    }
    passo.contexto = contexto(pid: pidAlvo, janela: descritor?.janela ?? janela?.titulo, foto: foto)
    passo.alvo = alvo
    passo.captura = foto.captura
    passo.anotacoes = anotacoesAutomaticas(alvo: alvo)
    gravar(passo)
    ultimoClique = (passo.id, em, pidAlvo)
    ultimoCliqueEm = em
    agendarOcr(passo: passo, foto: foto)

    // Campo seguro: o "secure input" do macOS não entrega keyDown ao tap; a digitação é registrada já no clique
    // e confirmada por tempo/foco/clique como passo `digitar` sensível (valor nil), igual ao fixture guia-mac.
    if let d = descritor, d.seguro, teclado.pendente == nil {
      teclado.acumular(elemento: d.elemento, pid: d.pid, descritor: d, em: em)
    }
  }

  // MARK: Teclado

  private func tratarTecla(_ e: EventoBruto) async {
    if e.repeticao { return }
    teclasRecebidas += 1
    let nome: String = Teclado.nomeTecla(keycode: e.keycode, caracteres: e.caracteres)

    if Teclado.temModificadorDeAtalho(e.flags) {
      if Teclado.ehAtalhoDeEdicao(nome: nome, flags: e.flags) {
        // ⌘V, ⌘A, ⌘Z…: mudam o campo em digitação (o valor sai do AX na confirmação), sem passo.
        if let pendente = teclado.pendente {
          teclado.acumular(elemento: pendente.elemento, pid: pendente.pid, descritor: pendente.descritor, em: e.em)
        }
        return
      }
      guard Teclado.ehImprimivel(e.caracteres) || Teclado.ehTeclaFuncao(e.keycode) || nome == "Enter" else { return }
      await passoTecla(nome: nome, flags: e.flags, em: e.em)
      return
    }
    if Teclado.keycodesEnter.contains(e.keycode) {
      await passoTecla(nome: "Enter", flags: [], em: e.em)
      return
    }
    if e.keycode == Teclado.keycodeTab {
      await confirmarDigitacao(confirmadoPor: "blur", foto: nil)
      return
    }
    if e.keycode == Teclado.keycodeEscape { return }
    if Teclado.ehTeclaFuncao(e.keycode) {
      await passoTecla(nome: nome, flags: [], em: e.em)
      return
    }
    if e.keycode == 51 {   // Backspace só edita uma digitação já em curso
      if let pendente = teclado.pendente {
        teclado.acumular(elemento: pendente.elemento, pid: pendente.pid, descritor: pendente.descritor, em: e.em)
      }
      return
    }
    guard Teclado.ehImprimivel(e.caracteres) else { return }
    await acumularDigitacao(em: e.em)
  }

  private func acumularDigitacao(em: Date) async {
    let focado: AXUIElement? = Acessibilidade.elementoFocado(pid: appFrontal.pid)
    if let atual = teclado.pendente, Acessibilidade.mesmoElemento(atual.elemento, focado) {
      teclado.acumular(elemento: focado, pid: atual.pid, descritor: atual.descritor, em: em)
      return
    }
    if teclado.pendente != nil {
      await confirmarDigitacao(confirmadoPor: "blur", foto: nil)
    }
    var descritor: DescritorAX? = nil
    if let el = focado {
      descritor = Acessibilidade.descrever(elemento: el)
    }
    if let d = descritor, d.pid == pidProprio { return }
    teclado.acumular(elemento: focado, pid: descritor?.pid ?? appFrontal.pid, descritor: descritor, em: em)
  }

  /// Enter, F-keys e atalhos com ⌘/⌃/⌥: confirma a digitação pendente (captura própria) e cria o passo `tecla`.
  private func passoTecla(nome: String, flags: CGEventFlags, em: Date) async {
    var fotoCompartilhada: Foto? = nil
    if teclado.pendente != nil {
      let fotoDigitacao: Foto = await obterFoto(displayId: displayDoFoco(), em: em, fonte: "confirmacao")
      await confirmarDigitacao(confirmadoPor: "enter", foto: fotoDigitacao)
      fotoCompartilhada = fotoDigitacao.com(fonte: "compartilhada")
    }
    let foto: Foto
    if let compartilhada = fotoCompartilhada {
      foto = compartilhada
    } else {
      foto = await obterFoto(displayId: displayDoFoco(), em: em, fonte: "pointerdown")
    }
    var passo: Passo = Passo.novo(tipo: "tecla")
    passo.contexto = contexto(pid: appFrontal.pid, janela: janelaFrontal(), foto: foto)
    passo.evento = .tecla(tecla: nome, modificadores: Teclado.modificadores(flags), atalho: Teclado.atalho(tecla: nome, flags: flags))
    passo.captura = foto.captura
    gravar(passo)
    ultimoCliqueEm = em
  }

  private func confirmarDigitacao(confirmadoPor: String, foto fotoDada: Foto?) async {
    guard let pendente = teclado.retirar() else { return }
    let em: Date = Date()
    let foto: Foto
    if let dada = fotoDada {
      foto = dada
    } else {
      foto = await obterFoto(displayId: displayDe(pendente.elemento), em: em, fonte: "confirmacao")
    }
    // Descritor atualizado e valor lido do AX (cobre autocorreção e colagem).
    var descritor: DescritorAX? = pendente.descritor
    if let el = pendente.elemento {
      descritor = Acessibilidade.descrever(elemento: el)
    }
    var valorLido: String? = nil
    if let el = pendente.elemento {
      valorLido = Acessibilidade.valorTexto(el)
    }
    var sensivel: Bool = false
    var motivo: String? = nil
    if let d = descritor {
      let classe = Acessibilidade.classificar(d)
      sensivel = classe.sensivel
      motivo = classe.motivo
    }
    if pendente.elemento == nil || valorLido == nil {
      sensivel = true
      if motivo == nil { motivo = "foco indeterminável" }
    }
    let valor: String? = sensivel ? nil : valorLido

    var janela: JanelaInfo? = nil
    if let r = descritor?.rect {
      janela = Capturador.janelaSob(CGPoint(x: r.midX, y: r.midY), ignorandoPid: pidProprio)
    }
    var alvo: Alvo = montarAlvo(descritor: descritor, janela: janela, foto: foto, ponto: nil)
    if descritor == nil { alvo.papel = "textbox" }
    var passo: Passo = Passo.novo(tipo: "digitar")
    passo.contexto = contexto(pid: descritor?.pid ?? pendente.pid, janela: descritor?.janela ?? janela?.titulo, foto: foto)
    passo.evento = .digitar(valor: valor, sensivel: sensivel, motivo: motivo, confirmadoPor: confirmadoPor)
    passo.alvo = alvo
    passo.captura = foto.captura
    passo.anotacoes = anotacoesAutomaticas(alvo: alvo)
    gravar(passo)
  }

  private func processarTique() async {
    guard estado == .gravando, let pendente = teclado.pendente else { return }
    let agora: Date = Date()
    if agora.timeIntervalSince(pendente.ultimaTeclaEm) >= 1.5 {
      await confirmarDigitacao(confirmadoPor: "tempo", foto: nil)
      return
    }
    guard pendente.elemento != nil else { return }
    let focado: AXUIElement? = Acessibilidade.elementoFocado(pid: appFrontal.pid)
    if focado != nil, !Acessibilidade.mesmoElemento(pendente.elemento, focado) {
      await confirmarDigitacao(confirmadoPor: "blur", foto: nil)
    }
  }

  // MARK: Troca de app

  private func processarAppAtivado(pid: pid_t, nome: String, bundleId: String?) async {
    if pid == pidProprio { return }
    let anterior: pid_t = appFrontal.pid
    appFrontal = (pid, nome, bundleId)
    guard estado == .gravando else { return }
    Acessibilidade.habilitarAcessibilidadeManual(pid: pid)
    if anterior == pid { return }
    if teclado.pendente != nil {
      await confirmarDigitacao(confirmadoPor: "navegacao", foto: nil)
    }
    // Troca disparada por um clique recente já está registrada no passo do clique.
    if Date().timeIntervalSince(ultimoCliqueEm) < 2.0 { return }
    try? await Task.sleep(nanoseconds: 300_000_000)
    await criarPassoNavegar(app: nome, pid: pid, bundleId: bundleId)
  }

  private func criarPassoNavegar(app: String, pid: pid_t, bundleId: String?) async {
    let ponto: CGPoint = posicaoDoCursor()
    let foto: Foto = await obterFoto(displayId: displaySobPonto(ponto), em: Date(), fonte: "navegacao")
    var passo: Passo = Passo.novo(tipo: "navegar")
    passo.contexto = contexto(pid: pid, janela: janelaFrontal(), foto: foto)
    passo.evento = .navegarApp(app: passo.contexto?.app ?? app)
    passo.captura = foto.captura
    gravar(passo)
  }

  /// Sem Monitoramento de Entrada o tap recebe flagsChanged mas nunca keyDown: pede a permissão uma vez.
  private func verificarMonitoramentoEntrada(_ e: EventoBruto) {
    guard !monitoramentoPedido, teclasRecebidas == 0 else { return }
    guard let inicio = primeiroFlagsEm else {
      primeiroFlagsEm = e.em
      return
    }
    if e.em.timeIntervalSince(inicio) > 10.0 {
      monitoramentoPedido = true
      Task { @MainActor in
        _ = Permissoes.monitoramentoDeEntrada(pedir: true)
      }
    }
  }

  // MARK: Captura e conversões

  private func obterFoto(displayId: CGDirectDisplayID, em: Date, fonte: String) async -> Foto {
    let limites: CGRect = CGDisplayBounds(displayId)
    let display = Display(id: displayId, limites: limites)
    let viewport = Tamanho(largura: Double(limites.size.width), altura: Double(limites.size.height))
    // Imagem de < 500 ms atrás é o estado pré-clique que se quer: reaproveita em vez de fotografar de novo.
    if let ultima = ultimaFoto, ultima.foto.display.id == displayId, ultima.foto.captura.faltante == false,
       em.timeIntervalSince(ultima.em) < 0.5 {
      return ultima.foto.com(fonte: "compartilhada")
    }
    let dpr: Double = Capturador.escalaFisica(display)
    guard let arquivos = persistencia else {
      var semPasta: Captura = Captura.faltante(motivo: "sem pasta de gravação", viewport: viewport, dpr: dpr)
      semPasta.fonte = fonte
      return Foto(captura: semPasta, display: display, imagem: nil)
    }
    do {
      let resultado: ImagemCapturada = try await capturador.capturar(display: display)
      let imagemId: String = gerarId("img")
      try arquivos.gravarImagem(resultado.imagem, id: imagemId)
      let captura = Captura(imagemId: imagemId, largura: resultado.imagem.width, altura: resultado.imagem.height,
                            dpr: dpr, viewport: viewport, escala: resultado.escala, fonte: fonte, faltante: false, motivo: nil)
      let foto = Foto(captura: captura, display: display, imagem: resultado.imagem)
      ultimaFoto = (foto, em)
      return foto
    } catch {
      var faltante: Captura = Captura.faltante(motivo: error.localizedDescription, viewport: viewport, dpr: dpr)
      faltante.fonte = fonte
      return Foto(captura: faltante, display: display, imagem: nil)
    }
  }

  private func montarAlvo(descritor: DescritorAX?, janela: JanelaInfo?, foto: Foto, ponto p: CGPoint?) -> Alvo {
    let display: CGRect = foto.display.limites
    let tamanho: CGSize = foto.tamanho
    let temImagem: Bool = foto.captura.faltante == false
    var rectCss: Rect? = nil
    var bbox: Rect? = nil
    if let r = descritor?.rect {
      rectCss = rectParaDisplay(r, display: display)
      if temImagem { bbox = rectParaImagem(r, display: display, imagem: tamanho) }
    }
    var pontoImagem: Ponto? = nil
    if let ponto = p, temImagem {
      pontoImagem = pontoParaImagem(ponto, display: display, imagem: tamanho)
    }
    var janelaBbox: Rect? = nil
    if let j = janela, temImagem {
      janelaBbox = rectParaImagem(j.limites, display: display, imagem: tamanho)
    }
    return Alvo(papel: descritor?.papel ?? "generic", papelNativo: descritor?.papelNativo, rotulo: descritor?.rotulo,
                fonteRotulo: descritor?.fonteRotulo ?? "nenhum", campo: descritor?.campo, rectCss: rectCss, bbox: bbox,
                ponto: pontoImagem, menu: descritor?.menu, janelaBbox: janelaBbox)
  }

  /// Só o recorte pela janela; retângulo, marcador e desfoque são gerados pelo editor (anotacoesAutomaticas).
  private func anotacoesAutomaticas(alvo: Alvo) -> [Anotacao] {
    guard var r = alvo.janelaBbox, r.w > 0, r.h > 0 else { return [] }
    if alvo.menu != nil {   // item de menu: inclui a barra de menus no recorte
      r.h = r.y + r.h
      r.y = 0
    }
    return [Anotacao.recorteAutomatico(r)]
  }

  private func contexto(pid: pid_t, janela: String?, foto: Foto) -> Contexto {
    var nome: String = appFrontal.nome
    var bundleId: String? = appFrontal.bundleId
    if let app = NSRunningApplication(processIdentifier: pid) {
      if let n = app.localizedName, !n.isEmpty { nome = n }
      if let b = app.bundleIdentifier { bundleId = b }
    }
    return Contexto(app: nome, bundleId: bundleId, janela: janela, tela: foto.tela)
  }

  private func posicaoDoCursor() -> CGPoint {
    return CGEvent(source: nil)?.location ?? CGPoint.zero
  }

  private func displayDe(_ elemento: AXUIElement?) -> CGDirectDisplayID {
    if let el = elemento, let r = Acessibilidade.rectDe(el) {
      return displaySobPonto(CGPoint(x: r.midX, y: r.midY))
    }
    return displaySobPonto(posicaoDoCursor())
  }

  private func displayDoFoco() -> CGDirectDisplayID {
    return displayDe(teclado.pendente?.elemento)
  }

  private func janelaFrontal() -> String? {
    guard let el = Acessibilidade.elementoFocado(pid: appFrontal.pid) else { return nil }
    return Acessibilidade.tituloJanela(el)
  }

  // MARK: OCR (fallback de rótulo, em segundo plano)

  private func agendarOcr(passo: Passo, foto: Foto) {
    guard passo.alvo?.rotulo == nil, let imagem = foto.imagem else { return }
    var pontoAlvo: Ponto? = passo.alvo?.ponto
    if pontoAlvo == nil, let bbox = passo.alvo?.bbox, bbox.w > 0 {
      pontoAlvo = Ponto(x: bbox.x + bbox.w / 2.0, y: bbox.y + bbox.h / 2.0)
    }
    guard let ponto = pontoAlvo else { return }
    let escala: Double = foto.captura.escala
    let passoId: String = passo.id
    DispatchQueue.global(qos: .utility).async { [weak self] in
      guard let rotulo = OCR.rotulo(imagem: imagem, ponto: ponto, escala: escala) else { return }
      _ = self?.continuacao?.yield(.rotuloOcr(passoId: passoId, rotulo: rotulo))
    }
  }

  private func aplicarRotuloOcr(passoId: String, rotulo: String) {
    let atualizado: Bool = guia?.atualizar(passoId: passoId) { passo in
      if passo.alvo != nil, passo.alvo?.rotulo == nil {
        passo.alvo?.rotulo = rotulo
        passo.alvo?.fonteRotulo = "ocr"
      }
    } ?? false
    if atualizado { salvarGuia() }
  }

  // MARK: Persistência e notificações

  private func gravar(_ passo: Passo) {
    guard guia != nil else { return }
    guia?.anexar(passo)
    contador += 1
    do {
      try persistencia?.anexarEvento(passo)
    } catch {
      let mensagem: String = error.localizedDescription
      Task { @MainActor in self.aoErro?("Falha ao gravar eventos.ndjson: \(mensagem)") }
    }
    salvarGuia()
    notificarMudanca()
  }

  private func salvarGuia() {
    guard let atual = guia, let arquivos = persistencia else { return }
    do {
      try arquivos.gravarGuia(atual)
    } catch {
      let mensagem: String = error.localizedDescription
      Task { @MainActor in self.aoErro?("Falha ao gravar guide.json: \(mensagem)") }
    }
  }

  private func notificarMudanca() {
    let estadoAtual: EstadoGravador = estado
    let contadorAtual: Int = contador
    Task { @MainActor in self.aoMudar?(estadoAtual, contadorAtual) }
  }

  @MainActor
  private func notificarErro(_ mensagem: String) {
    aoErro?(mensagem)
  }

  @MainActor
  private func revelar(_ zip: URL) {
    NSWorkspace.shared.activateFileViewerSelecting([zip])
    if let url = URL(string: "https://stepbystep-dexterity.vercel.app/editor/#/importar") {
      _ = NSWorkspace.shared.open(url)
    }
  }
}
