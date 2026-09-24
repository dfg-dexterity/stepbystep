// Ciclo de vida: cria o gravador e o item de menu, prepara o monitor de eventos e confere as permissões no início.
import AppKit
import StepByStepNucleo

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  private var gravador: Gravador?
  private var menuBar: MenuBar?

  func applicationDidFinishLaunching(_ notification: Notification) {
    let novoGravador = Gravador()
    gravador = novoGravador
    menuBar = MenuBar(gravador: novoGravador)
    novoGravador.preparar()

    // Sem Acessibilidade + Gravação de Tela não há gravação: mostra o painel já na abertura.
    if !Permissoes.prontasParaGravar(pedir: false) {
      Permissoes.mostrarPainel()
    }

    // Gravação interrompida por crash/reinício: o menu mostra "Recuperar gravação…" (Persistencia.gravacoesInterrompidas).
    let interrompidas: [URL] = Persistencia.gravacoesInterrompidas()
    if !interrompidas.isEmpty {
      menuBar?.avisar("Há \(interrompidas.count) gravação(ões) sem fim. Use «Recuperar gravação…» no menu.")
    }
  }

  func applicationWillTerminate(_ notification: Notification) {
    // guide.json é reescrito a cada passo, então nada se perde aqui; uma gravação em curso fica
    // com estado "gravando" e aparece em "Recuperar gravação…" na próxima abertura.
    gravador?.encerrar()
  }
}
