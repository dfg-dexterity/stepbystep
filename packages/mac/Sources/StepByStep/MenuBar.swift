// Item na barra de menus: ícone record.circle parado, "● 7" gravando (contador de passos), menu de comandos.
import AppKit
import StepByStepNucleo

@MainActor
final class MenuBar: NSObject, NSMenuDelegate {
  private let gravador: Gravador
  private let item: NSStatusItem
  private let menu: NSMenu
  private let itemIniciar: NSMenuItem
  private let itemPausar: NSMenuItem
  private let itemParar: NSMenuItem
  private let itemPasta: NSMenuItem
  private let itemRecuperar: NSMenuItem
  private let itemPermissoes: NSMenuItem
  private let itemSair: NSMenuItem
  private var estado: EstadoGravador = .parado
  private var contador: Int = 0

  init(gravador: Gravador) {
    self.gravador = gravador
    self.item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    self.menu = NSMenu(title: "StepByStep")
    self.itemIniciar = NSMenuItem(title: "Iniciar gravação", action: nil, keyEquivalent: "r")
    self.itemPausar = NSMenuItem(title: "Pausar", action: nil, keyEquivalent: "")
    self.itemParar = NSMenuItem(title: "Parar e revelar no Finder", action: nil, keyEquivalent: "")
    self.itemPasta = NSMenuItem(title: "Abrir pasta de gravações", action: nil, keyEquivalent: "")
    self.itemRecuperar = NSMenuItem(title: "Recuperar gravação…", action: nil, keyEquivalent: "")
    self.itemPermissoes = NSMenuItem(title: "Permissões…", action: nil, keyEquivalent: "")
    self.itemSair = NSMenuItem(title: "Sair", action: nil, keyEquivalent: "q")
    super.init()

    // O atalho ⌥⇧R aparece no menu; fora dele é detectado no próprio tap.
    itemIniciar.keyEquivalentModifierMask = [.option, .shift]
    itemSair.keyEquivalentModifierMask = [.command]
    let pares: [(NSMenuItem, Selector)] = [
      (itemIniciar, #selector(MenuBar.alternarGravacao(_:))),
      (itemPausar, #selector(MenuBar.pausarOuRetomar(_:))),
      (itemParar, #selector(MenuBar.parar(_:))),
      (itemPasta, #selector(MenuBar.abrirPasta(_:))),
      (itemPermissoes, #selector(MenuBar.permissoes(_:))),
      (itemSair, #selector(MenuBar.sair(_:))),
    ]
    for par in pares {
      par.0.target = self
      par.0.action = par.1
    }
    itemRecuperar.submenu = NSMenu(title: "Recuperar gravação")

    menu.autoenablesItems = false
    menu.delegate = self
    menu.addItem(itemIniciar)
    menu.addItem(itemPausar)
    menu.addItem(itemParar)
    menu.addItem(NSMenuItem.separator())
    menu.addItem(itemPasta)
    menu.addItem(itemRecuperar)
    menu.addItem(NSMenuItem.separator())
    menu.addItem(itemPermissoes)
    menu.addItem(NSMenuItem.separator())
    menu.addItem(itemSair)
    item.menu = menu

    gravador.aoMudar = { [weak self] novoEstado, novoContador in
      self?.atualizar(estado: novoEstado, contador: novoContador)
    }
    gravador.aoErro = { [weak self] mensagem in
      self?.avisar(mensagem)
    }
    atualizar(estado: .parado, contador: 0)
  }

  // MARK: Estado visual

  func atualizar(estado novoEstado: EstadoGravador, contador novoContador: Int) {
    estado = novoEstado
    contador = novoContador
    guard let botao = item.button else { return }
    switch estado {
    case .parado:
      botao.image = NSImage(systemSymbolName: "record.circle", accessibilityDescription: "StepByStep")
      botao.title = ""
      botao.toolTip = "StepByStep — parado"
    case .gravando:
      botao.image = nil
      botao.title = "● \(contador)"
      botao.toolTip = "StepByStep — gravando"
    case .pausado:
      botao.image = NSImage(systemSymbolName: "pause.circle", accessibilityDescription: "StepByStep pausado")
      botao.title = "\(contador)"
      botao.toolTip = "StepByStep — pausado"
    }
    itemIniciar.isHidden = estado != .parado
    itemPausar.isHidden = estado == .parado
    itemPausar.title = estado == .pausado ? "Retomar" : "Pausar"
    itemParar.isHidden = estado == .parado
  }

  func avisar(_ mensagem: String) {
    let alerta = NSAlert()
    alerta.messageText = "StepByStep"
    alerta.informativeText = mensagem
    alerta.alertStyle = .warning
    alerta.addButton(withTitle: "OK")
    NSApp.activate()
    _ = alerta.runModal()
  }

  // MARK: NSMenuDelegate

  func menuWillOpen(_ menu: NSMenu) {
    // Só parado: a gravação em curso também está "gravando" no guide.json e não pode ser recuperada por cima
    // dela (o Gravador ainda recusa pelo fluxo se o estado mudar entre abrir o menu e escolher).
    guard estado == .parado else {
      itemRecuperar.isHidden = true
      return
    }
    let interrompidas: [URL] = Persistencia.gravacoesInterrompidas()
    itemRecuperar.isHidden = interrompidas.isEmpty
    guard let submenu = itemRecuperar.submenu else { return }
    submenu.removeAllItems()
    for pasta in interrompidas {
      let entrada = NSMenuItem(title: pasta.lastPathComponent, action: #selector(MenuBar.recuperar(_:)), keyEquivalent: "")
      entrada.target = self
      entrada.representedObject = pasta
      submenu.addItem(entrada)
    }
  }

  // MARK: Ações

  @objc private func alternarGravacao(_ sender: Any?) {
    if estado == .parado {
      gravador.iniciar()
    } else {
      gravador.parar()
    }
  }

  @objc private func pausarOuRetomar(_ sender: Any?) {
    gravador.pausarOuRetomar()
  }

  @objc private func parar(_ sender: Any?) {
    gravador.parar()
  }

  @objc private func abrirPasta(_ sender: Any?) {
    let raiz: URL = Persistencia.raiz()
    try? FileManager.default.createDirectory(at: raiz, withIntermediateDirectories: true)
    _ = NSWorkspace.shared.open(raiz)
  }

  @objc private func recuperar(_ sender: Any?) {
    guard let entrada = sender as? NSMenuItem, let pasta = entrada.representedObject as? URL else { return }
    gravador.recuperar(pasta: pasta)
  }

  @objc private func permissoes(_ sender: Any?) {
    Permissoes.mostrarPainel()
  }

  @objc private func sair(_ sender: Any?) {
    NSApp.terminate(nil)
  }
}
