// Máquina de estados da gravação: evento → descritor (AX) → captura (display sob o ponto) → passo → persistência.
// Tudo o que muda estado passa por um único fluxo sequencial (AsyncStream consumido por uma Task), então não há
// corrida entre cliques, teclas, ticks do temporizador, troca de app e comandos do menu. O estado (app frontal,
// guia, pasta, monitor do tap) é do fluxo: a main só envia comandos e recebe `aoMudar`/`aoErro`. Mesmas regras
// do redutor JS: digitação pendente antes do clique (imagem compartilhada), duplo clique atualiza o passo
// anterior (só `clicar`, nunca checkbox/radio/switch), troca de app sem clique recente vira passo `navegar`.
// A PNG é codificada e gravada fora do fluxo (Task.detached): o evento seguinte não espera pelo disco.
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
  case recuperar(pasta: URL)
  case monitorPronto(MonitorEventos)
}

private enum Entrada {
  case evento(EventoBruto)
  case comando(Comando)
  case appAtivado(pid: pid_t, nome: String, bundleId: String?)
  case rotuloOcr(passoId: String, rotulo: String)
  case imagemGravada(imagemId: String, erro: String?)
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

  // Estado do fluxo sequencial (só a Task de `processar` lê e escreve).
  private var estado: EstadoGravador = .parado
  private var guia: Guia?
  private var persistencia: Persistencia?
  private var contador: Int = 0
  private let capturador: Capturador = Capturador()
  private let teclado: Teclado = Teclado()
  private var monitorFluxo: MonitorEventos?
  private var appFrontal: (pid: pid_t, nome: String, bundleId: String?) = (0, "", nil)
  private var ultimoClique: (passoId: String, em: Date, pid: pid_t, tipo: String)?
  private var ultimoCliqueEm: Date = Date.distantPast
  private var primeiroFlagsEm: Date?
  private var teclasRecebidas: Int = 0
  private var monitoramentoPedido: Bool = false
  private var escritasPendentes: [String: Task<String?, Never>] = [:]
  private var capturaAvisada: Bool = false
  private var escritaAvisada: Bool = false

  // Estado da main (criação do tap, observador do workspace, temporizador).
  private var monitor: MonitorEventos?
  private var observador: NSObjectProtocol?
  private var temporizador: DispatchSourceTimer?

  private var continuacao: AsyncStream<Entrada>.Continuation?
  private var tarefa: Task<Void, Never>?
  private let pidProprio: pid_t = ProcessInfo.processInfo.processIdentifier

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
    // O app frontal entra pelo fluxo (`appAtivado`), nunca por escrita direta: `appFrontal` é estado do fluxo.
    if let frontal = NSWorkspace.shared.frontmostApplication, frontal.processIdentifier != pidProprio {
      _ = continuacao?.yield(.appAtivado(pid: frontal.processIdentifier, nome: frontal.localizedName ?? "", bundleId: frontal.bundleIdentifier))
    }
    observador = NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: nil) { [weak self] notificacao in
        guard let app = notificacao.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
        _ = self?.continuacao?.yield(.appAtivado(pid: app.processIdentifier, nome: app.localizedName ?? "", bundleId: app.bundleIdentifier))
    }
    prepararMonitor()
  }

  /// Cria o tap na main (precisa de Acessibilidade) e entrega a referência ao fluxo, que é quem liga/desliga.
  /// Fica ativo também parado, só para ouvir ⌥⇧R.
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
      _ = continuacao?.yield(.comando(.monitorPronto(novo)))
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
    // Só o app frontal de agora; sem ele (pid 0) o fluxo usa o último que viu.
    var nome: String = ""
    var pid: pid_t = 0
    var bundleId: String? = nil
    if let frontal = NSWorkspace.shared.frontmostApplication, frontal.processIdentifier != pidProprio {
      nome = frontal.localizedName ?? ""
      pid = frontal.processIdentifier
      bundleId = frontal.bundleIdentifier
    }
    _ = continuacao?.yield(.comando(.iniciar(app: nome, pid: pid, bundleId: bundleId)))
  }

  func pausarOuRetomar() {
    _ = continuacao?.yield(.comando(.pausarOuRetomar))
  }

  func parar() {
    _ = continuacao?.yield(.comando(.parar))
  }

  /// Reconstrói o guide.json do journal, compacta e revela no Finder — pelo fluxo e só parado (nunca a pasta em curso).
  func recuperar(pasta: URL) {
    _ = continuacao?.yield(.comando(.recuperar(pasta: pasta)))
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
    case .imagemGravada(let imagemId, let erro):
      concluirEscrita(imagemId: imagemId, erro: erro)
    case .tique:
      await processarTique()
    }
  }

  private func processarComando(_ comando: Comando) async {
    switch comando {
    case .monitorPronto(let novo):
      monitorFluxo = novo
    case .iniciar(let app, let pid, let bundleId):
      guard estado == .parado else { return }
      await iniciarGravacao(app: app, pid: pid, bundleId: bundleId)
    case .pausarOuRetomar:
      if estado == .gravando {
        await pausar()
      } else if estado == .pausado {
        await retomar()
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
    case .recuperar(let pasta):
      await recuperarGravacao(pasta: pasta)
    }
  }

  private func processarEvento(_ e: EventoBruto) async {
    if e.tipo == CGEventType.keyDown, !e.repeticao, Teclas.ehAtalhoAlternar(keycode: e.keycode, flags: e.flags) {
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

  /// Liga/desliga o tap na main (o MonitorEventos é @MainActor).
  private func habilitarMonitor(_ ligado: Bool) async {
    guard let atual = monitorFluxo else { return }
    await MainActor.run { atual.habilitar(ligado) }
  }

  // MARK: Início, pausa, fim

  private func iniciarGravacao(app: String, pid: pid_t, bundleId: String?) async {
    var nomeApp: String = app
    var pidApp: pid_t = pid
    var bundleApp: String? = bundleId
    if pidApp <= 0 {   // sem app frontal no momento do comando: o último visto pelo fluxo
      nomeApp = appFrontal.nome
      pidApp = appFrontal.pid
      bundleApp = appFrontal.bundleId
    }
    if nomeApp.isEmpty { nomeApp = "app" }

    // Captura de teste antes de criar a pasta: `CGPreflightScreenCaptureAccess` fica verdadeiro assim que a
    // permissão é concedida, mas o ScreenCaptureKit só funciona depois de reabrir o app — sem isto a gravação
    // inteira sairia com capturas faltantes, em silêncio.
    let displayInicial: CGDirectDisplayID = displaySobPonto(posicaoDoCursor())
    do {
      _ = try await capturador.capturar(display: Display(id: displayInicial, limites: CGDisplayBounds(displayInicial)))
    } catch {
      await notificarErro("Não foi possível capturar a tela (\(error.localizedDescription)). Conceda Gravação de Tela ao StepByStep em Ajustes do Sistema › Privacidade e Segurança e reabra o app.")
      return
    }

    do {
      persistencia = try Persistencia(app: nomeApp)
    } catch {
      await notificarErro("Não foi possível criar a pasta da gravação: \(error.localizedDescription)")
      return
    }
    guia = Guia.novo(app: nomeApp)
    contador = 0
    ultimoClique = nil
    ultimoCliqueEm = Date.distantPast
    capturaAvisada = false
    escritaAvisada = false
    teclado.descartar()
    if pidApp > 0 {
      appFrontal = (pidApp, nomeApp, bundleApp)
      Acessibilidade.habilitarAcessibilidadeManual(pid: pidApp)
    }
    estado = .gravando
    await habilitarMonitor(true)
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
    await habilitarMonitor(false)
    notificarMudanca()
  }

  private func retomar() async {
    estado = .gravando
    await habilitarMonitor(true)
    notificarMudanca()
  }

  private func pararGravacao() async {
    if estado == .gravando, teclado.pendente != nil {
      await confirmarDigitacao(confirmadoPor: "parar", foto: nil)
    }
    teclado.descartar()
    estado = .parado
    contador = 0
    notificarMudanca()
    await habilitarMonitor(true)   // continua ouvindo só o atalho ⌥⇧R
    // PNGs em segundo plano: o zip precisa delas (e das capturas marcadas faltantes quando falharam).
    await aguardarEscritas()
    guia?.estado = "concluido"
    guia?.atualizadoEm = agoraComMilissegundos()
    salvarGuia()
    let armazenamento: Persistencia? = persistencia
    persistencia = nil
    guia = nil
    ultimoClique = nil
    guard let arquivos = armazenamento else { return }
    arquivos.fechar()
    do {
      let zip: URL = try arquivos.compactar()
      await revelar(zip)
    } catch {
      await notificarErro(error.localizedDescription)
    }
  }

  /// Só parado: durante a gravação a pasta ativa também está "gravando" no guide.json, e recuperá-la marcaria o
  /// guia como concluído e ziparia a pasta pela metade, concorrendo com os passos.
  private func recuperarGravacao(pasta: URL) async {
    guard estado == .parado, persistencia == nil else {
      await notificarErro(ErroGravacao.gravacaoEmCurso.localizedDescription)
      return
    }
    do {
      _ = try Persistencia.recuperar(pasta: pasta)
      let zip: URL = try Persistencia.compactar(pasta: pasta)
      await revelar(zip)
    } catch {
      await notificarErro("Não foi possível recuperar a gravação: \(error.localizedDescription)")
    }
  }

  // MARK: Cliques

  private func tratarClique(_ e: EventoBruto) async {
    let p: CGPoint = e.local
    let descritor: DescritorAX? = Acessibilidade.descrever(ponto: p)
    if let d = descritor, d.pid == pidProprio { return }
    let janela: JanelaInfo? = Capturador.janelaSob(p, ignorandoPid: pidProprio)
    let em: Date = e.em
    let pidAlvo: pid_t = descritor?.pid ?? janela?.pid ?? appFrontal.pid
    let ehMarcar: Bool = descritor.map { $0.papel == "checkbox" || $0.papel == "radio" || $0.papel == "switch" } ?? false

    // Duplo clique: atualiza `evento.vezes` do passo anterior em vez de criar outro — só quando o anterior é um
    // `clicar` e o alvo não é checkbox/radio/switch (o segundo clique desmarca: é outro passo `marcar`), como o
    // redutor JS. Decidido antes da foto, para o segundo mouseDown não deixar uma PNG órfã.
    if e.cliques >= 2, !ehMarcar, let anterior = ultimoClique, anterior.tipo == "clicar", anterior.pid == pidAlvo,
       em.timeIntervalSince(anterior.em) < 1.0 {
      let atualizado: Bool = guia?.atualizar(passoId: anterior.passoId) { passo in
        if case .clicar(let botao, _, let modificadores) = passo.evento {
          passo.evento = .clicar(botao: botao, vezes: 2, modificadores: modificadores)
        }
      } ?? false
      if atualizado { salvarGuia() }
      ultimoClique = (anterior.passoId, em, anterior.pid, anterior.tipo)
      ultimoCliqueEm = em
      return
    }

    // Cada clique tem a própria foto (estado pré-clique dele): dois cliques em elementos distintos, mesmo a poucos
    // ms um do outro, não compartilham imagem — o item de menu precisa da foto com o menu aberto.
    let foto: Foto = await obterFoto(displayId: displaySobPonto(p), fonte: "pointerdown")

    // Digitação pendente em outro elemento: passo `digitar` antes do clique, com a mesma imagem.
    if let pendente = teclado.pendente {
      let cliqueNoMesmoCampo: Bool = descritor != nil && Acessibilidade.mesmoElemento(pendente.elemento, descritor?.elemento)
      if !cliqueNoMesmoCampo {
        await confirmarDigitacao(confirmadoPor: "clique", foto: foto.com(fonte: "compartilhada"))
      }
    }

    let botao: String
    switch e.tipo {
    case .rightMouseDown: botao = "direito"
    case .otherMouseDown: botao = "meio"
    default: botao = "esquerdo"
    }
    let alvo: Alvo = montarAlvo(descritor: descritor, janela: janela, foto: foto, ponto: p)
    var passo: Passo
    if let d = descritor, ehMarcar {
      passo = Passo.novo(tipo: "marcar")
      let marcadoAntes: Bool = d.marcado ?? false
      passo.evento = .marcar(marcado: d.papel == "radio" ? true : !marcadoAntes)
    } else {
      passo = Passo.novo(tipo: "clicar")
      passo.evento = .clicar(botao: botao, vezes: 1, modificadores: Teclas.modificadores(e.flags))
    }
    passo.contexto = contexto(pid: pidAlvo, janela: descritor?.janela ?? janela?.titulo, foto: foto)
    passo.alvo = alvo
    passo.captura = foto.captura
    passo.anotacoes = anotacoesAutomaticas(alvo: alvo)
    gravar(passo)
    ultimoClique = (passo.id, em, pidAlvo, passo.tipo)
    ultimoCliqueEm = em
    agendarOcr(passo: passo, foto: foto)

    // Campo seguro: o "secure input" do macOS não entrega keyDown ao tap; a digitação é registrada já no clique e
    // confirmada por foco/clique/tempo como passo `digitar` sensível (valor nil) — mas só se o número de caracteres
    // do campo (bullets) tiver mudado até lá; clique na senha seguido de «Cancelar» não vira passo.
    if let d = descritor, d.seguro, teclado.pendente == nil {
      teclado.acumular(elemento: d.elemento, pid: d.pid, descritor: d, em: em, caracteres: Acessibilidade.numeroDeCaracteres(d.elemento))
    }
  }

  // MARK: Teclado

  private func tratarTecla(_ e: EventoBruto) async {
    if e.repeticao { return }
    teclasRecebidas += 1
    let ehFuncaoOuEnter: Bool = Teclas.ehTeclaFuncao(e.keycode) || Teclas.keycodesEnter.contains(e.keycode)

    // ⌘/⌃ com qualquer tecla, ou ⌥ com F-key/Enter: atalho. ⌥ sozinho é entrada de caracteres (⌥C → ç,
    // ⌥E + vogal → acento) e segue como digitação abaixo.
    if Teclas.ehAtalho(keycode: e.keycode, flags: e.flags) {
      // O nome vem do caractere SEM ⌃/⌥: com ⌃ o evento entrega U+0001…U+001A e com ⌥ o caractere do layout (ß, ®).
      let nome: String = Teclas.nomeTecla(keycode: e.keycode, caracteres: e.caracteres, semModificadores: e.caracteresSemModificadores)
      if Teclas.ehAtalhoDeEdicao(nome: nome, flags: e.flags) {
        // ⌘V, ⌘A, ⌘Z…: mudam o campo em digitação (o valor sai do AX na confirmação), sem passo.
        if let pendente = teclado.pendente {
          teclado.acumular(elemento: pendente.elemento, pid: pendente.pid, descritor: pendente.descritor, em: e.em)
        }
        return
      }
      let escreve: Bool = Teclas.caractereDaTecla(keycode: e.keycode, caracteres: e.caracteres,
                                                  semModificadores: e.caracteresSemModificadores) != nil
      guard escreve || ehFuncaoOuEnter else { return }
      await passoTecla(nome: nome, flags: e.flags, em: e.em)
      return
    }
    if Teclas.keycodesEnter.contains(e.keycode) {
      await passoTecla(nome: "Enter", flags: [], em: e.em)
      return
    }
    if e.keycode == Teclas.keycodeTab {
      await confirmarDigitacao(confirmadoPor: "blur", foto: nil)
      return
    }
    if e.keycode == Teclas.keycodeEscape { return }
    if Teclas.ehTeclaFuncao(e.keycode) {
      await passoTecla(nome: Teclas.nomeTecla(keycode: e.keycode, caracteres: e.caracteres), flags: [], em: e.em)
      return
    }
    if e.keycode == Teclas.keycodeBackspace {   // Backspace só edita uma digitação já em curso
      if let pendente = teclado.pendente {
        teclado.acumular(elemento: pendente.elemento, pid: pendente.pid, descritor: pendente.descritor, em: e.em)
      }
      return
    }
    guard Teclas.ehImprimivel(e.caracteres) else { return }
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
    if let d = descritor {
      if d.pid == pidProprio { return }
      // Só campos de texto acumulam (textbox/combobox — input/textarea/contenteditable na extensão): teclas numa
      // lista, tabela ou botão (type-ahead do Finder, Espaço num botão) não viram passo.
      guard d.papel == "textbox" || d.papel == "combobox" else { return }
    }
    // Foco indeterminável (sem elemento): a digitação segue com elemento nil → passo sensível, como manda 6.2.
    teclado.acumular(elemento: focado, pid: descritor?.pid ?? appFrontal.pid, descritor: descritor, em: em)
  }

  /// Enter, F-keys e atalhos com ⌘/⌃/⌥: confirma a digitação pendente (captura própria) e cria o passo `tecla`.
  private func passoTecla(nome: String, flags: CGEventFlags, em: Date) async {
    var fotoCompartilhada: Foto? = nil
    if teclado.pendente != nil {
      let fotoDigitacao: Foto = await obterFoto(displayId: displayDoFoco(), fonte: "confirmacao")
      await confirmarDigitacao(confirmadoPor: "enter", foto: fotoDigitacao)
      fotoCompartilhada = fotoDigitacao.com(fonte: "compartilhada")
    }
    let foto: Foto
    if let compartilhada = fotoCompartilhada {
      foto = compartilhada
    } else {
      foto = await obterFoto(displayId: displayDoFoco(), fonte: "pointerdown")
    }
    var passo: Passo = Passo.novo(tipo: "tecla")
    passo.contexto = contexto(pid: appFrontal.pid, janela: janelaFrontal(), foto: foto)
    passo.evento = .tecla(tecla: nome, modificadores: Teclas.modificadores(flags), atalho: Teclas.atalho(tecla: nome, flags: flags))
    passo.captura = foto.captura
    gravar(passo)
    ultimoCliqueEm = em
  }

  private func confirmarDigitacao(confirmadoPor: String, foto fotoDada: Foto?) async {
    guard var pendente = teclado.retirar() else { return }
    // Campo seguro: sem keyDown no tap, o sinal de digitação é a variação do número de caracteres.
    if pendente.seguro, let el = pendente.elemento, let atual = Acessibilidade.numeroDeCaracteres(el) {
      pendente.caracteresAtuais = atual
    }
    guard pendente.houveDigitacao else { return }
    let foto: Foto
    if let dada = fotoDada {
      foto = dada
    } else {
      foto = await obterFoto(displayId: displayDe(pendente.elemento), fonte: "confirmacao")
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
    // Campo seguro: relê o comprimento (bullets); a variação conta como tecla e adia a confirmação por tempo.
    if pendente.seguro, let el = pendente.elemento, let quantidade = Acessibilidade.numeroDeCaracteres(el) {
      teclado.atualizarCaracteres(quantidade, em: agora)
    }
    guard let atual = teclado.pendente else { return }
    // Senha ainda sem digitação detectada: não confirma por tempo (o usuário pode estar pensando); a confirmação
    // vem do próximo clique, do foco, da troca de app ou de Parar — e é descartada se nada foi digitado.
    let aguardandoSenha: Bool = atual.seguro && atual.caracteresIniciais != nil && !atual.houveDigitacao
    if !aguardandoSenha, agora.timeIntervalSince(atual.ultimaTeclaEm) >= 1.5 {
      await confirmarDigitacao(confirmadoPor: "tempo", foto: nil)
      return
    }
    guard atual.elemento != nil else { return }
    let focado: AXUIElement? = Acessibilidade.elementoFocado(pid: appFrontal.pid)
    if focado != nil, !Acessibilidade.mesmoElemento(atual.elemento, focado) {
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
    let foto: Foto = await obterFoto(displayId: displaySobPonto(ponto), fonte: "navegacao")
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

  /// Fotografa o display agora. A PNG é gravada em segundo plano (`agendarEscrita`); o `imagemId` já vai no passo.
  private func obterFoto(displayId: CGDirectDisplayID, fonte: String) async -> Foto {
    let limites: CGRect = CGDisplayBounds(displayId)
    let display = Display(id: displayId, limites: limites)
    let viewport = Tamanho(largura: Double(limites.size.width), altura: Double(limites.size.height))
    let dpr: Double = Capturador.escalaFisica(display)
    guard let arquivos = persistencia else {
      var semPasta: Captura = Captura.faltante(motivo: "sem pasta de gravação", viewport: viewport, dpr: dpr)
      semPasta.fonte = fonte
      return Foto(captura: semPasta, display: display, imagem: nil)
    }
    do {
      let resultado: ImagemCapturada = try await capturador.capturar(display: display)
      let imagemId: String = gerarId("img")
      agendarEscrita(resultado.imagem, id: imagemId, arquivos: arquivos)
      let captura = Captura(imagemId: imagemId, largura: resultado.imagem.width, altura: resultado.imagem.height,
                            dpr: dpr, viewport: viewport, escala: resultado.escala, fonte: fonte, faltante: false, motivo: nil)
      return Foto(captura: captura, display: display, imagem: resultado.imagem)
    } catch {
      let motivo: String = error.localizedDescription
      // Avisa uma vez por gravação: sem isto o guia inteiro sairia sem imagem e só se descobriria no editor.
      if !capturaAvisada {
        capturaAvisada = true
        Task { @MainActor in
          self.aoErro?("Não foi possível capturar a tela (\(motivo)). Os passos seguem sem imagem; conceda Gravação de Tela ao StepByStep e reabra o app.")
        }
      }
      var faltante: Captura = Captura.faltante(motivo: motivo, viewport: viewport, dpr: dpr)
      faltante.fonte = fonte
      return Foto(captura: faltante, display: display, imagem: nil)
    }
  }

  /// Codifica e grava a PNG fora do fluxo (centenas de ms em Retina): o evento seguinte não espera pelo disco.
  /// O resultado volta pelo fluxo (`imagemGravada`); `pararGravacao` espera as pendentes antes de compactar.
  private func agendarEscrita(_ imagem: CGImage, id: String, arquivos: Persistencia) {
    let tarefa: Task<String?, Never> = Task.detached(priority: .utility) { [weak self] in
      var falha: String? = nil
      do {
        try arquivos.gravarImagem(imagem, id: id)
      } catch {
        falha = error.localizedDescription
      }
      _ = self?.continuacao?.yield(.imagemGravada(imagemId: id, erro: falha))
      return falha
    }
    escritasPendentes[id] = tarefa
  }

  private func aguardarEscritas() async {
    let pendentes: [String: Task<String?, Never>] = escritasPendentes
    escritasPendentes = [:]
    for (imagemId, tarefa) in pendentes {
      let falha: String? = await tarefa.value
      concluirEscrita(imagemId: imagemId, erro: falha)
    }
  }

  /// PNG que não chegou ao disco: os passos que a referenciam passam a captura faltante (imagemId null), como o
  /// validador exige, e o guide.json é reescrito.
  private func concluirEscrita(imagemId: String, erro: String?) {
    escritasPendentes[imagemId] = nil
    guard let motivo = erro, var atual = guia else { return }
    var mudou: Bool = false
    for indice in atual.passos.indices {
      guard let captura = atual.passos[indice].captura, captura.imagemId == imagemId, captura.faltante == false else { continue }
      var faltante: Captura = Captura.faltante(motivo: motivo, viewport: captura.viewport, dpr: captura.dpr)
      faltante.fonte = captura.fonte
      atual.passos[indice].captura = faltante
      mudou = true
    }
    guard mudou else { return }
    atual.atualizadoEm = agoraComMilissegundos()
    atual.atualizarImagens()
    guia = atual
    salvarGuia()
    if !escritaAvisada {
      escritaAvisada = true
      Task { @MainActor in self.aoErro?("Falha ao gravar a imagem \(imagemId).png: \(motivo)") }
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
