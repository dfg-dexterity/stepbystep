// Ponto de entrada: app de menu bar (sem Dock, sem janela principal).
import AppKit

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegado = AppDelegate()
app.delegate = delegado
app.run()
