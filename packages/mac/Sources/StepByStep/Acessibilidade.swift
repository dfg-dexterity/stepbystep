// Descrição do elemento sob o ponto via Acessibilidade (AXUIElement). Coordenadas AX são Quartz (pontos,
// origem superior esquerda), o mesmo sistema do evento do tap. Constantes kAX* são CFString.
import Foundation
import AppKit
import ApplicationServices

struct DescritorAX {
  /// Papel ARIA (button, link, textbox, combobox, checkbox, radio, switch, tab, menuitem, option, generic).
  var papel: String
  /// AXRole nativo, ou "AXSecureTextField" quando o subpapel é campo seguro.
  var papelNativo: String?
  var rotulo: String?
  /// ax | ocr | nenhum
  var fonteRotulo: String
  var campo: String?
  /// Quartz, pontos.
  var rect: CGRect?
  /// Caminho do menu ("Arquivo › Salvar como…") quando é item de menu.
  var menu: String?
  var seguro: Bool
  /// Valor atual de checkbox/radio/switch.
  var marcado: Bool?
  var pid: pid_t
  var janela: String?
  var elemento: AXUIElement
}

enum Acessibilidade {
  private static let tempoLimite: Float = 0.3

  // MARK: Elementos

  static func elementoEm(_ p: CGPoint) -> AXUIElement? {
    var elemento: AXUIElement?
    let sistema: AXUIElement = AXUIElementCreateSystemWide()
    let erro: AXError = AXUIElementCopyElementAtPosition(sistema, Float(p.x), Float(p.y), &elemento)
    guard erro == AXError.success, let achado = elemento else { return nil }
    _ = AXUIElementSetMessagingTimeout(achado, tempoLimite)
    return achado
  }

  /// Elemento com foco de teclado: primeiro o do sistema, depois o do app frontal.
  static func elementoFocado(pid: pid_t) -> AXUIElement? {
    let sistema: AXUIElement = AXUIElementCreateSystemWide()
    if let focado = elemento(atributo(sistema, kAXFocusedUIElementAttribute as CFString)) {
      _ = AXUIElementSetMessagingTimeout(focado, tempoLimite)
      return focado
    }
    guard pid > 0 else { return nil }
    let app: AXUIElement = AXUIElementCreateApplication(pid)
    _ = AXUIElementSetMessagingTimeout(app, tempoLimite)
    guard let focado = elemento(atributo(app, kAXFocusedUIElementAttribute as CFString)) else { return nil }
    _ = AXUIElementSetMessagingTimeout(focado, tempoLimite)
    return focado
  }

  /// Apps Chromium/Electron só expõem a árvore AX depois deste atributo.
  static func habilitarAcessibilidadeManual(pid: pid_t) {
    guard pid > 0 else { return }
    let app: AXUIElement = AXUIElementCreateApplication(pid)
    _ = AXUIElementSetMessagingTimeout(app, tempoLimite)
    _ = AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    _ = AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
  }

  static func pidDe(_ el: AXUIElement) -> pid_t? {
    var pid: pid_t = 0
    let erro: AXError = AXUIElementGetPid(el, &pid)
    return erro == AXError.success ? pid : nil
  }

  static func mesmoElemento(_ a: AXUIElement?, _ b: AXUIElement?) -> Bool {
    guard let a = a, let b = b else { return a == nil && b == nil }
    return CFEqual(a, b)
  }

  // MARK: Atributos

  static func atributo(_ el: AXUIElement, _ nome: CFString) -> AnyObject? {
    var valor: CFTypeRef?
    let erro: AXError = AXUIElementCopyAttributeValue(el, nome, &valor)
    guard erro == AXError.success, let achado = valor else { return nil }
    return achado
  }

  static func texto(_ el: AXUIElement, _ nome: CFString) -> String? {
    guard let valor = atributo(el, nome) else { return nil }
    if let s = valor as? String { return normalizar(s) }
    if let n = valor as? NSNumber { return n.stringValue }
    if let a = valor as? NSAttributedString { return normalizar(a.string) }
    return nil
  }

  /// Converte um CFTypeRef em AXUIElement quando é um (checagem pelo CFTypeID).
  static func elemento(_ valor: AnyObject?) -> AXUIElement? {
    guard let valor = valor, CFGetTypeID(valor) == AXUIElementGetTypeID() else { return nil }
    return (valor as! AXUIElement)
  }

  static func rectDe(_ el: AXUIElement) -> CGRect? {
    guard let vPosicao = atributo(el, kAXPositionAttribute as CFString),
          let vTamanho = atributo(el, kAXSizeAttribute as CFString) else { return nil }
    guard CFGetTypeID(vPosicao) == AXValueGetTypeID(), CFGetTypeID(vTamanho) == AXValueGetTypeID() else { return nil }
    let axPosicao: AXValue = vPosicao as! AXValue
    let axTamanho: AXValue = vTamanho as! AXValue
    var ponto: CGPoint = CGPoint.zero
    var tamanho: CGSize = CGSize.zero
    guard AXValueGetValue(axPosicao, AXValueType.cgPoint, &ponto),
          AXValueGetValue(axTamanho, AXValueType.cgSize, &tamanho) else { return nil }
    return CGRect(origin: ponto, size: tamanho)
  }

  /// `kAXValueAttribute` como texto (cobre autocorreção e colagem); nil se não for legível.
  static func valorTexto(_ el: AXUIElement) -> String? {
    guard let valor = atributo(el, kAXValueAttribute as CFString) else { return nil }
    if let s = valor as? String { return s }
    if let a = valor as? NSAttributedString { return a.string }
    if let n = valor as? NSNumber { return n.stringValue }
    return nil
  }

  /// `kAXNumberOfCharactersAttribute` (campos seguros contam os bullets); sem o atributo, o tamanho do valor.
  static func numeroDeCaracteres(_ el: AXUIElement) -> Int? {
    if let valor = atributo(el, kAXNumberOfCharactersAttribute as CFString), let n = valor as? NSNumber {
      return n.intValue
    }
    return valorTexto(el)?.count
  }

  static func valorBooleano(_ el: AXUIElement) -> Bool? {
    guard let valor = atributo(el, kAXValueAttribute as CFString) else { return nil }
    if let n = valor as? NSNumber { return n.intValue != 0 }
    if let s = valor as? String { return s == "1" }
    return nil
  }

  static func normalizar(_ texto: String) -> String {
    let partes: [String] = texto.components(separatedBy: CharacterSet.whitespacesAndNewlines).filter { !$0.isEmpty }
    let junto: String = partes.joined(separator: " ")
    if junto.count > 200 { return String(junto.prefix(199)) + "…" }
    return junto
  }

  // MARK: Papéis

  static func papelAria(role: String?, subrole: String?) -> String {
    if subrole == "AXTabButton" { return "tab" }
    if subrole == "AXSwitch" || subrole == "AXToggle" { return "switch" }
    switch role ?? "" {
    case "AXButton", "AXMenuButton", "AXDisclosureTriangle": return "button"
    case "AXLink": return "link"
    case "AXTextField", "AXTextArea", "AXSecureTextField", "AXSearchField": return "textbox"
    case "AXPopUpButton", "AXComboBox": return "combobox"
    case "AXCheckBox": return "checkbox"
    case "AXRadioButton": return "radio"
    case "AXMenuItem", "AXMenuBarItem": return "menuitem"
    case "AXTabGroup": return "tab"
    default: return "generic"
    }
  }

  // MARK: Descrição completa

  static func descrever(ponto p: CGPoint) -> DescritorAX? {
    guard let el = elementoEm(p) else { return nil }
    return descrever(elemento: el)
  }

  static func descrever(elemento el: AXUIElement) -> DescritorAX {
    let role: String? = texto(el, kAXRoleAttribute as CFString)
    let subrole: String? = texto(el, kAXSubroleAttribute as CFString)
    let seguro: Bool = subrole == "AXSecureTextField" || role == "AXSecureTextField"
    let papelNativo: String? = seguro ? "AXSecureTextField" : role
    let papel: String = papelAria(role: role, subrole: subrole)
    let titulo: String? = vazioParaNil(texto(el, kAXTitleAttribute as CFString))
    let descricao: String? = vazioParaNil(texto(el, kAXDescriptionAttribute as CFString))
    let ajuda: String? = vazioParaNil(texto(el, kAXHelpAttribute as CFString))

    // Rótulo vinculado (label ao lado do campo) e placeholder.
    var vinculado: String? = nil
    if let elementoTitulo = elemento(atributo(el, kAXTitleUIElementAttribute as CFString)) {
      vinculado = vazioParaNil(texto(elementoTitulo, kAXTitleAttribute as CFString))
      if vinculado == nil { vinculado = vazioParaNil(texto(elementoTitulo, kAXValueAttribute as CFString)) }
    }
    let placeholder: String? = vazioParaNil(texto(el, kAXPlaceholderValueAttribute as CFString))

    var rotulo: String? = nil
    var campo: String? = nil
    let ehCampo: Bool = papel == "textbox" || papel == "combobox"
    if ehCampo {
      campo = vinculado ?? placeholder ?? titulo ?? descricao
      rotulo = campo
    } else {
      rotulo = titulo ?? descricao ?? ajuda
      if rotulo == nil, role == "AXStaticText" {
        rotulo = vazioParaNil(valorTexto(el).map { normalizar($0) })
      }
      if rotulo == nil, role == "AXImage" || role == "AXCell" || role == "AXGroup" {
        if let pai = elemento(atributo(el, kAXParentAttribute as CFString)) {
          rotulo = vazioParaNil(texto(pai, kAXTitleAttribute as CFString))
        }
      }
    }
    let fonteRotulo: String = rotulo == nil ? "nenhum" : "ax"

    var menu: String? = nil
    if role == "AXMenuItem" || role == "AXMenuBarItem" {
      menu = caminhoMenu(el, titulo: titulo)
    }

    var marcado: Bool? = nil
    if papel == "checkbox" || papel == "radio" || papel == "switch" {
      marcado = valorBooleano(el)
    }

    return DescritorAX(papel: papel, papelNativo: papelNativo, rotulo: rotulo, fonteRotulo: fonteRotulo, campo: campo,
                       rect: rectDe(el), menu: menu, seguro: seguro, marcado: marcado, pid: pidDe(el) ?? 0,
                       janela: tituloJanela(el), elemento: el)
  }

  private static func vazioParaNil(_ texto: String?) -> String? {
    guard let t = texto, !t.isEmpty else { return nil }
    return t
  }

  /// Sobe por AXMenu / AXMenuItem / AXMenuBarItem coletando títulos: "Arquivo › Salvar como…".
  static func caminhoMenu(_ el: AXUIElement, titulo: String?) -> String? {
    var partes: [String] = []
    if let t = titulo { partes.append(t) }
    var atual: AXUIElement = el
    var nivel: Int = 0
    while nivel < 12, let pai = elemento(atributo(atual, kAXParentAttribute as CFString)) {
      nivel += 1
      let role: String = texto(pai, kAXRoleAttribute as CFString) ?? ""
      if role == "AXMenuItem" || role == "AXMenuBarItem" {
        if let t = vazioParaNil(texto(pai, kAXTitleAttribute as CFString)) { partes.insert(t, at: 0) }
      } else if role == "AXMenuBar" || role == "AXApplication" || role == "AXWindow" {
        break
      }
      atual = pai
    }
    return partes.isEmpty ? nil : partes.joined(separator: " › ")
  }

  static func tituloJanela(_ el: AXUIElement) -> String? {
    if let janela = elemento(atributo(el, kAXWindowAttribute as CFString)) {
      return vazioParaNil(texto(janela, kAXTitleAttribute as CFString))
    }
    var atual: AXUIElement = el
    var nivel: Int = 0
    while nivel < 20, let pai = elemento(atributo(atual, kAXParentAttribute as CFString)) {
      nivel += 1
      if texto(pai, kAXRoleAttribute as CFString) == "AXWindow" {
        return vazioParaNil(texto(pai, kAXTitleAttribute as CFString))
      }
      atual = pai
    }
    return nil
  }

  // MARK: Sensibilidade (mesmas regras de core/mascara.js para o que existe no Mac)

  private static let trechosSensiveis: [String] = ["senha", "password", "passwd", "token", "secret", "cvv", "cvc",
                                                   "cartão", "cartao", "cpf", "cnpj"]

  static func classificar(_ d: DescritorAX) -> (sensivel: Bool, motivo: String?) {
    if d.seguro || d.papelNativo == "AXSecureTextField" { return (true, "AXSecureTextField") }
    for nome in [d.campo, d.rotulo] {
      guard let n = nome else { continue }
      let minusculo: String = n.lowercased()
      for trecho in trechosSensiveis where minusculo.contains(trecho) {
        return (true, "nome:" + trecho)
      }
    }
    return (false, nil)
  }
}
