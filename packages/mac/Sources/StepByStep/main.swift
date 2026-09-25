// Ponto de entrada: app de menu bar (sem Dock, sem janela principal).
// O código de topo de main.swift não é isolado no MainActor no modo Swift 5; como AppDelegate é
// @MainActor e este é o fio principal, a criação é feita dentro de MainActor.assumeIsolated.
import AppKit

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegado = MainActor.assumeIsolated { AppDelegate() }
app.delegate = delegado
app.run()
