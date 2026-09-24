// Formato do guia (JSON v1) em Swift: structs Codable com chaves em português idênticas ao JSON da especificação.
// O Mac grava `titulo: ""` + `tituloAuto: true`; as frases são geradas pelo editor (nenhuma regra é duplicada aqui).
// Campos opcionais que o formato exige presentes são gravados como `null` explícito (encode de Optional, não encodeIfPresent).
import Foundation

public let FORMATO_GUIA: String = "stepbystep/guia"
public let VERSAO_GUIA: Int = 1

// MARK: - Datas ISO 8601 (UTC, com frações de segundo)

private let formatadorComFracao: ISO8601DateFormatter = {
  let f = ISO8601DateFormatter()
  f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return f
}()

private let formatadorSemFracao: ISO8601DateFormatter = {
  let f = ISO8601DateFormatter()
  f.formatOptions = [.withInternetDateTime]
  return f
}()

/// `2026-09-24T14:03:11.000Z`
public func formatarDataIso(_ data: Date) -> String {
  return formatadorComFracao.string(from: data)
}

/// Aceita com e sem frações de segundo.
public func lerDataIso(_ texto: String) -> Date? {
  if let data = formatadorComFracao.date(from: texto) { return data }
  return formatadorSemFracao.date(from: texto)
}

/// Data truncada ao milissegundo — a precisão do formato. Toda data que entra no guia passa por aqui,
/// para que codificar e reler devolvam exatamente o mesmo valor (igualdade de structs nos testes).
/// A ida e volta pelo próprio formatador garante o mesmo Double que a leitura do JSON produz.
public func truncarAoMilissegundo(_ data: Date) -> Date {
  return lerDataIso(formatarDataIso(data)) ?? data
}

/// `Date()` já truncada ao milissegundo.
public func agoraComMilissegundos() -> Date {
  return truncarAoMilissegundo(Date())
}

// MARK: - Geometria (px da imagem original)

public struct Rect: Codable, Equatable {
  public var x: Double
  public var y: Double
  public var w: Double
  public var h: Double
  public init(x: Double, y: Double, w: Double, h: Double) {
    self.x = x
    self.y = y
    self.w = w
    self.h = h
  }
}

public struct Ponto: Codable, Equatable {
  public var x: Double
  public var y: Double
  public init(x: Double, y: Double) {
    self.x = x
    self.y = y
  }
}

public struct Tamanho: Codable, Equatable {
  public var largura: Double
  public var altura: Double
  public init(largura: Double, altura: Double) {
    self.largura = largura
    self.altura = altura
  }
}

// MARK: - Contexto

public struct Tela: Codable, Equatable {
  public var id: Int
  public var largura: Double
  public var altura: Double
  public var escala: Double
  public init(id: Int, largura: Double, altura: Double, escala: Double) {
    self.id = id
    self.largura = largura
    self.altura = altura
    self.escala = escala
  }
}

/// Contexto Mac `{app, bundleId, janela, tela}`; os campos web (`url`, `tituloPagina`, …) existem só para ler guias da extensão.
public struct Contexto: Codable, Equatable {
  public var app: String?
  public var bundleId: String?
  public var janela: String?
  public var tela: Tela?
  public var url: String?
  public var tituloPagina: String?
  public var abaId: Int?
  public var frameId: Int?
  public var scroll: Ponto?

  enum CodingKeys: String, CodingKey {
    case app, bundleId, janela, tela, url, tituloPagina, abaId, frameId, scroll
  }

  public init(app: String, bundleId: String?, janela: String?, tela: Tela) {
    self.app = app
    self.bundleId = bundleId
    self.janela = janela
    self.tela = tela
    self.url = nil
    self.tituloPagina = nil
    self.abaId = nil
    self.frameId = nil
    self.scroll = nil
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    if tela != nil || app != nil {
      try c.encode(app, forKey: .app)
      try c.encode(bundleId, forKey: .bundleId)
      try c.encode(janela, forKey: .janela)
      try c.encode(tela, forKey: .tela)
    } else {
      try c.encode(url, forKey: .url)
      try c.encode(tituloPagina, forKey: .tituloPagina)
      try c.encode(abaId, forKey: .abaId)
      try c.encode(frameId, forKey: .frameId)
      try c.encode(scroll, forKey: .scroll)
    }
  }
}

// MARK: - Evento (forma depende do tipo do passo; decodificado pelas chaves presentes)

public enum Evento: Equatable {
  case navegarApp(app: String)
  case navegarUrl(url: String, transicao: String)
  case clicar(botao: String, vezes: Int, modificadores: [String])
  case digitar(valor: String?, sensivel: Bool, motivo: String?, confirmadoPor: String)
  case selecionar(valor: String, opcao: String)
  case marcar(marcado: Bool)
  case tecla(tecla: String, modificadores: [String], atalho: String)
}

extension Evento: Codable {
  enum CodingKeys: String, CodingKey {
    case app, url, transicao, botao, vezes, modificadores, valor, sensivel, motivo, confirmadoPor, opcao, marcado, tecla, atalho
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    if c.contains(.confirmadoPor) {
      self = .digitar(valor: try c.decodeIfPresent(String.self, forKey: .valor),
                      sensivel: try c.decodeIfPresent(Bool.self, forKey: .sensivel) ?? false,
                      motivo: try c.decodeIfPresent(String.self, forKey: .motivo),
                      confirmadoPor: try c.decode(String.self, forKey: .confirmadoPor))
    } else if c.contains(.tecla) {
      self = .tecla(tecla: try c.decode(String.self, forKey: .tecla),
                    modificadores: try c.decodeIfPresent([String].self, forKey: .modificadores) ?? [],
                    atalho: try c.decodeIfPresent(String.self, forKey: .atalho) ?? "")
    } else if c.contains(.botao) {
      self = .clicar(botao: try c.decode(String.self, forKey: .botao),
                     vezes: try c.decodeIfPresent(Int.self, forKey: .vezes) ?? 1,
                     modificadores: try c.decodeIfPresent([String].self, forKey: .modificadores) ?? [])
    } else if c.contains(.opcao) {
      self = .selecionar(valor: try c.decodeIfPresent(String.self, forKey: .valor) ?? "",
                         opcao: try c.decodeIfPresent(String.self, forKey: .opcao) ?? "")
    } else if c.contains(.marcado) {
      self = .marcar(marcado: try c.decode(Bool.self, forKey: .marcado))
    } else if c.contains(.url) {
      self = .navegarUrl(url: try c.decode(String.self, forKey: .url),
                         transicao: try c.decodeIfPresent(String.self, forKey: .transicao) ?? "outro")
    } else if c.contains(.app) {
      self = .navegarApp(app: try c.decode(String.self, forKey: .app))
    } else {
      throw DecodingError.dataCorruptedError(forKey: CodingKeys.app, in: c, debugDescription: "Evento sem forma conhecida")
    }
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .navegarApp(let app):
      try c.encode(app, forKey: .app)
    case .navegarUrl(let url, let transicao):
      try c.encode(url, forKey: .url)
      try c.encode(transicao, forKey: .transicao)
    case .clicar(let botao, let vezes, let modificadores):
      try c.encode(botao, forKey: .botao)
      try c.encode(vezes, forKey: .vezes)
      try c.encode(modificadores, forKey: .modificadores)
    case .digitar(let valor, let sensivel, let motivo, let confirmadoPor):
      try c.encode(valor, forKey: .valor)      // Optional: `null` explícito quando sensível
      try c.encode(sensivel, forKey: .sensivel)
      try c.encode(motivo, forKey: .motivo)
      try c.encode(confirmadoPor, forKey: .confirmadoPor)
    case .selecionar(let valor, let opcao):
      try c.encode(valor, forKey: .valor)
      try c.encode(opcao, forKey: .opcao)
    case .marcar(let marcado):
      try c.encode(marcado, forKey: .marcado)
    case .tecla(let tecla, let modificadores, let atalho):
      try c.encode(tecla, forKey: .tecla)
      try c.encode(modificadores, forKey: .modificadores)
      try c.encode(atalho, forKey: .atalho)
    }
  }
}

// MARK: - Alvo

public struct Frame: Codable, Equatable {
  public var id: Int
  public var url: String?
  enum CodingKeys: String, CodingKey { case id, url }
  public init(id: Int, url: String?) {
    self.id = id
    self.url = url
  }
  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(id, forKey: .id)
    try c.encode(url, forKey: .url)
  }
}

public struct Alvo: Codable, Equatable {
  public var papel: String
  public var papelNativo: String?
  public var rotulo: String?
  public var fonteRotulo: String
  public var campo: String?
  public var tag: String?
  public var tipoInput: String?
  public var seletor: String?
  public var rectCss: Rect?
  public var bbox: Rect?
  public var ponto: Ponto?
  public var frame: Frame?
  public var menu: String?
  public var janelaBbox: Rect?

  enum CodingKeys: String, CodingKey {
    case papel, papelNativo, rotulo, fonteRotulo, campo, tag, tipoInput, seletor, rectCss, bbox, ponto, frame, menu, janelaBbox
  }

  public init(papel: String, papelNativo: String?, rotulo: String?, fonteRotulo: String, campo: String?,
              rectCss: Rect?, bbox: Rect?, ponto: Ponto?, menu: String?, janelaBbox: Rect?) {
    self.papel = papel
    self.papelNativo = papelNativo
    self.rotulo = rotulo
    self.fonteRotulo = fonteRotulo
    self.campo = campo
    self.tag = nil
    self.tipoInput = nil
    self.seletor = nil
    self.rectCss = rectCss
    self.bbox = bbox
    self.ponto = ponto
    self.frame = nil
    self.menu = menu
    self.janelaBbox = janelaBbox
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(papel, forKey: .papel)
    try c.encode(papelNativo, forKey: .papelNativo)
    try c.encode(rotulo, forKey: .rotulo)
    try c.encode(fonteRotulo, forKey: .fonteRotulo)
    try c.encode(campo, forKey: .campo)
    try c.encode(tag, forKey: .tag)
    try c.encode(tipoInput, forKey: .tipoInput)
    try c.encode(seletor, forKey: .seletor)
    try c.encode(rectCss, forKey: .rectCss)
    try c.encode(bbox, forKey: .bbox)
    try c.encode(ponto, forKey: .ponto)
    try c.encode(frame, forKey: .frame)
    try c.encode(menu, forKey: .menu)
    try c.encode(janelaBbox, forKey: .janelaBbox)
  }
}

// MARK: - Captura

public struct Captura: Codable, Equatable {
  public var imagemId: String?
  public var largura: Int
  public var altura: Int
  public var dpr: Double
  public var viewport: Tamanho?
  public var escala: Double
  public var fonte: String
  public var faltante: Bool
  /// Só quando `faltante` (motivo da falha); ausente nas capturas bem-sucedidas.
  public var motivo: String?

  enum CodingKeys: String, CodingKey {
    case imagemId, largura, altura, dpr, viewport, escala, fonte, faltante, motivo
  }

  public init(imagemId: String?, largura: Int, altura: Int, dpr: Double, viewport: Tamanho?, escala: Double,
              fonte: String, faltante: Bool, motivo: String?) {
    self.imagemId = imagemId
    self.largura = largura
    self.altura = altura
    self.dpr = dpr
    self.viewport = viewport
    self.escala = escala
    self.fonte = fonte
    self.faltante = faltante
    self.motivo = motivo
  }

  /// Captura que falhou: `imagemId: null`, `faltante: true` (o validador exige exatamente isso).
  public static func faltante(motivo: String, viewport: Tamanho?, dpr: Double) -> Captura {
    return Captura(imagemId: nil, largura: 0, altura: 0, dpr: dpr, viewport: viewport, escala: dpr,
                   fonte: "pointerdown", faltante: true, motivo: motivo)
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    imagemId = try c.decodeIfPresent(String.self, forKey: .imagemId)
    largura = try c.decodeIfPresent(Int.self, forKey: .largura) ?? 0
    altura = try c.decodeIfPresent(Int.self, forKey: .altura) ?? 0
    dpr = try c.decodeIfPresent(Double.self, forKey: .dpr) ?? 1
    viewport = try c.decodeIfPresent(Tamanho.self, forKey: .viewport)
    escala = try c.decodeIfPresent(Double.self, forKey: .escala) ?? 1
    fonte = try c.decodeIfPresent(String.self, forKey: .fonte) ?? "manual"
    faltante = try c.decodeIfPresent(Bool.self, forKey: .faltante) ?? false
    motivo = try c.decodeIfPresent(String.self, forKey: .motivo)
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(imagemId, forKey: .imagemId)
    try c.encode(largura, forKey: .largura)
    try c.encode(altura, forKey: .altura)
    try c.encode(dpr, forKey: .dpr)
    try c.encode(viewport, forKey: .viewport)
    try c.encode(escala, forKey: .escala)
    try c.encode(fonte, forKey: .fonte)
    try c.encode(faltante, forKey: .faltante)
    try c.encodeIfPresent(motivo, forKey: .motivo)
  }
}

public struct Resultado: Codable, Equatable {
  public var url: String
  public init(url: String) { self.url = url }
}

// MARK: - Anotações (lista ordenada de operações não destrutivas; codificadas por `tipo`)

public enum Anotacao: Equatable {
  case recorte(id: String, auto: Bool, x: Double, y: Double, w: Double, h: Double)
  case desfoque(id: String, auto: Bool, x: Double, y: Double, w: Double, h: Double, bloco: Double)
  case retangulo(id: String, auto: Bool, x: Double, y: Double, w: Double, h: Double, cor: String)
  case seta(id: String, auto: Bool, de: Ponto, para: Ponto, cor: String)
  case marcador(id: String, auto: Bool, x: Double, y: Double, numero: Int, cor: String)
  case texto(id: String, auto: Bool, x: Double, y: Double, texto: String, tamanho: Double, cor: String, fundo: String?)

  public var id: String {
    switch self {
    case .recorte(let id, _, _, _, _, _): return id
    case .desfoque(let id, _, _, _, _, _, _): return id
    case .retangulo(let id, _, _, _, _, _, _): return id
    case .seta(let id, _, _, _, _): return id
    case .marcador(let id, _, _, _, _, _): return id
    case .texto(let id, _, _, _, _, _, _, _): return id
    }
  }

  public var tipo: String {
    switch self {
    case .recorte: return "recorte"
    case .desfoque: return "desfoque"
    case .retangulo: return "retangulo"
    case .seta: return "seta"
    case .marcador: return "marcador"
    case .texto: return "texto"
    }
  }

  /// Recorte automático pela janela clicada.
  public static func recorteAutomatico(_ r: Rect) -> Anotacao {
    return .recorte(id: gerarId("a"), auto: true, x: r.x, y: r.y, w: r.w, h: r.h)
  }
}

extension Anotacao: Codable {
  enum CodingKeys: String, CodingKey {
    case id, tipo, auto, x, y, w, h, bloco, cor, de, para, numero, texto, tamanho, fundo
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    let tipo: String = try c.decode(String.self, forKey: .tipo)
    let id: String = try c.decode(String.self, forKey: .id)
    let auto: Bool = try c.decodeIfPresent(Bool.self, forKey: .auto) ?? false
    switch tipo {
    case "recorte":
      self = .recorte(id: id, auto: auto,
                      x: try c.decode(Double.self, forKey: .x), y: try c.decode(Double.self, forKey: .y),
                      w: try c.decode(Double.self, forKey: .w), h: try c.decode(Double.self, forKey: .h))
    case "desfoque":
      self = .desfoque(id: id, auto: auto,
                       x: try c.decode(Double.self, forKey: .x), y: try c.decode(Double.self, forKey: .y),
                       w: try c.decode(Double.self, forKey: .w), h: try c.decode(Double.self, forKey: .h),
                       bloco: try c.decodeIfPresent(Double.self, forKey: .bloco) ?? 8)
    case "retangulo":
      self = .retangulo(id: id, auto: auto,
                        x: try c.decode(Double.self, forKey: .x), y: try c.decode(Double.self, forKey: .y),
                        w: try c.decode(Double.self, forKey: .w), h: try c.decode(Double.self, forKey: .h),
                        cor: try c.decodeIfPresent(String.self, forKey: .cor) ?? "cerceta")
    case "seta":
      self = .seta(id: id, auto: auto,
                   de: try c.decode(Ponto.self, forKey: .de), para: try c.decode(Ponto.self, forKey: .para),
                   cor: try c.decodeIfPresent(String.self, forKey: .cor) ?? "cerceta")
    case "marcador":
      self = .marcador(id: id, auto: auto,
                       x: try c.decode(Double.self, forKey: .x), y: try c.decode(Double.self, forKey: .y),
                       numero: try c.decodeIfPresent(Int.self, forKey: .numero) ?? 1,
                       cor: try c.decodeIfPresent(String.self, forKey: .cor) ?? "cerceta")
    case "texto":
      self = .texto(id: id, auto: auto,
                    x: try c.decode(Double.self, forKey: .x), y: try c.decode(Double.self, forKey: .y),
                    texto: try c.decodeIfPresent(String.self, forKey: .texto) ?? "",
                    tamanho: try c.decodeIfPresent(Double.self, forKey: .tamanho) ?? 16,
                    cor: try c.decodeIfPresent(String.self, forKey: .cor) ?? "base",
                    fundo: try c.decodeIfPresent(String.self, forKey: .fundo))
    default:
      throw DecodingError.dataCorruptedError(forKey: CodingKeys.tipo, in: c, debugDescription: "Tipo de anotação desconhecido: \(tipo)")
    }
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(id, forKey: .id)
    try c.encode(tipo, forKey: .tipo)
    switch self {
    case .recorte(_, let auto, let x, let y, let w, let h):
      try c.encode(auto, forKey: .auto)
      try c.encode(x, forKey: .x)
      try c.encode(y, forKey: .y)
      try c.encode(w, forKey: .w)
      try c.encode(h, forKey: .h)
    case .desfoque(_, let auto, let x, let y, let w, let h, let bloco):
      try c.encode(auto, forKey: .auto)
      try c.encode(x, forKey: .x)
      try c.encode(y, forKey: .y)
      try c.encode(w, forKey: .w)
      try c.encode(h, forKey: .h)
      try c.encode(bloco, forKey: .bloco)
    case .retangulo(_, let auto, let x, let y, let w, let h, let cor):
      try c.encode(auto, forKey: .auto)
      try c.encode(x, forKey: .x)
      try c.encode(y, forKey: .y)
      try c.encode(w, forKey: .w)
      try c.encode(h, forKey: .h)
      try c.encode(cor, forKey: .cor)
    case .seta(_, let auto, let de, let para, let cor):
      try c.encode(auto, forKey: .auto)
      try c.encode(de, forKey: .de)
      try c.encode(para, forKey: .para)
      try c.encode(cor, forKey: .cor)
    case .marcador(_, let auto, let x, let y, let numero, let cor):
      try c.encode(auto, forKey: .auto)
      try c.encode(x, forKey: .x)
      try c.encode(y, forKey: .y)
      try c.encode(numero, forKey: .numero)
      try c.encode(cor, forKey: .cor)
    case .texto(_, let auto, let x, let y, let texto, let tamanho, let cor, let fundo):
      try c.encode(auto, forKey: .auto)
      try c.encode(x, forKey: .x)
      try c.encode(y, forKey: .y)
      try c.encode(texto, forKey: .texto)
      try c.encode(tamanho, forKey: .tamanho)
      try c.encode(cor, forKey: .cor)
      try c.encode(fundo, forKey: .fundo)   // token ou null
    }
  }
}

// MARK: - Passo

public struct Passo: Codable, Equatable {
  public var id: String
  public var tipo: String
  public var titulo: String
  public var tituloAuto: Bool
  public var descricao: String
  public var criadoEm: Date
  public var contexto: Contexto?
  public var evento: Evento?
  public var alvo: Alvo?
  public var captura: Captura?
  public var resultado: Resultado?
  public var anotacoes: [Anotacao]
  public var mescladoDe: [String]?

  enum CodingKeys: String, CodingKey {
    case id, tipo, titulo, tituloAuto, descricao, criadoEm, contexto, evento, alvo, captura, resultado, anotacoes, mescladoDe
  }

  public init(id: String, tipo: String, titulo: String, tituloAuto: Bool, descricao: String, criadoEm: Date,
              contexto: Contexto?, evento: Evento?, alvo: Alvo?, captura: Captura?, resultado: Resultado?,
              anotacoes: [Anotacao], mescladoDe: [String]?) {
    self.id = id
    self.tipo = tipo
    self.titulo = titulo
    self.tituloAuto = tituloAuto
    self.descricao = descricao
    self.criadoEm = criadoEm
    self.contexto = contexto
    self.evento = evento
    self.alvo = alvo
    self.captura = captura
    self.resultado = resultado
    self.anotacoes = anotacoes
    self.mescladoDe = mescladoDe
  }

  /// Passo vazio do Mac: `titulo: ""` + `tituloAuto: true` ("gere para mim"), criado agora.
  public static func novo(tipo: String) -> Passo {
    return Passo(id: gerarId("p"), tipo: tipo, titulo: "", tituloAuto: true, descricao: "", criadoEm: agoraComMilissegundos(),
                 contexto: nil, evento: nil, alvo: nil, captura: nil, resultado: nil, anotacoes: [], mescladoDe: nil)
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(id, forKey: .id)
    try c.encode(tipo, forKey: .tipo)
    try c.encode(titulo, forKey: .titulo)
    try c.encode(tituloAuto, forKey: .tituloAuto)
    try c.encode(descricao, forKey: .descricao)
    try c.encode(criadoEm, forKey: .criadoEm)
    try c.encode(contexto, forKey: .contexto)     // null explícito quando ausente (secao/manual)
    try c.encode(evento, forKey: .evento)
    try c.encode(alvo, forKey: .alvo)
    try c.encode(captura, forKey: .captura)
    try c.encode(resultado, forKey: .resultado)
    try c.encode(anotacoes, forKey: .anotacoes)
    try c.encodeIfPresent(mescladoDe, forKey: .mescladoDe)
  }
}

// MARK: - Guia

public struct Origem: Codable, Equatable {
  public var tipo: String
  public var versao: String?
  public var plataforma: String?
  enum CodingKeys: String, CodingKey { case tipo, versao, plataforma }
  public init(tipo: String, versao: String?, plataforma: String?) {
    self.tipo = tipo
    self.versao = versao
    self.plataforma = plataforma
  }
  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(tipo, forKey: .tipo)
    try c.encode(versao, forKey: .versao)
    try c.encode(plataforma, forKey: .plataforma)
  }
}

public struct Estilo: Codable, Equatable {
  public var cor: String
  public var escurecerFora: Bool
  public init(cor: String, escurecerFora: Bool) {
    self.cor = cor
    self.escurecerFora = escurecerFora
  }
}

/// Registro de publicação no Notion (o Mac nunca preenche; existe para ler guias do editor sem perder dados).
public struct Publicacao: Codable, Equatable {
  public var destino: String?
  public var paginaId: String?
  public var url: String?
  public var em: String?
  public var concluida: Bool?
  public var uploads: [String: String]?
  public var lotesEnviados: Int?
}

public struct ImagemInfo: Codable, Equatable {
  public var arquivo: String
  public var largura: Int
  public var altura: Int
  public var mime: String
  public init(arquivo: String, largura: Int, altura: Int, mime: String) {
    self.arquivo = arquivo
    self.largura = largura
    self.altura = altura
    self.mime = mime
  }
}

public struct Guia: Codable, Equatable {
  public var formato: String
  public var versao: Int
  public var id: String
  public var titulo: String
  public var descricao: String
  public var idioma: String
  public var autor: String
  public var criadoEm: Date
  public var atualizadoEm: Date
  public var origem: Origem
  public var estilo: Estilo
  public var estado: String
  public var publicacoes: [Publicacao]
  public var passos: [Passo]
  /// Só existe na serialização em pasta/zip (o editor remove ao salvar no IndexedDB).
  public var imagens: [String: ImagemInfo]?

  enum CodingKeys: String, CodingKey {
    case formato, versao, id, titulo, descricao, idioma, autor, criadoEm, atualizadoEm, origem, estilo, estado, publicacoes, passos, imagens
  }

  public init(formato: String, versao: Int, id: String, titulo: String, descricao: String, idioma: String, autor: String,
              criadoEm: Date, atualizadoEm: Date, origem: Origem, estilo: Estilo, estado: String,
              publicacoes: [Publicacao], passos: [Passo], imagens: [String: ImagemInfo]?) {
    self.formato = formato
    self.versao = versao
    self.id = id
    self.titulo = titulo
    self.descricao = descricao
    self.idioma = idioma
    self.autor = autor
    self.criadoEm = criadoEm
    self.atualizadoEm = atualizadoEm
    self.origem = origem
    self.estilo = estilo
    self.estado = estado
    self.publicacoes = publicacoes
    self.passos = passos
    self.imagens = imagens
  }

  /// "macOS 15.0"
  public static func plataformaAtual() -> String {
    let v = ProcessInfo.processInfo.operatingSystemVersion
    return "macOS \(v.majorVersion).\(v.minorVersion)"
  }

  /// Guia novo de uma gravação no Mac: `origem.tipo = "mac"`, estado `gravando`, sem passos.
  public static func novo(app: String, versaoApp: String = "0.1.0") -> Guia {
    let agora: Date = agoraComMilissegundos()
    let titulo: String = app.isEmpty ? "Gravação" : "Gravação — " + app
    return Guia(formato: FORMATO_GUIA, versao: VERSAO_GUIA, id: gerarId("g"), titulo: titulo, descricao: "",
                idioma: "pt-BR", autor: "", criadoEm: agora, atualizadoEm: agora,
                origem: Origem(tipo: "mac", versao: versaoApp, plataforma: plataformaAtual()),
                estilo: Estilo(cor: "cerceta", escurecerFora: true), estado: "gravando",
                publicacoes: [], passos: [], imagens: [:])
  }

  /// Reconstrói o mapa `imagens` a partir das capturas dos passos (`imagens/<imagemId>.png`).
  public mutating func atualizarImagens() {
    var mapa: [String: ImagemInfo] = [:]
    for passo in passos {
      guard let captura = passo.captura, let imagemId = captura.imagemId, captura.faltante == false else { continue }
      if mapa[imagemId] != nil { continue }
      mapa[imagemId] = ImagemInfo(arquivo: "imagens/" + imagemId + ".png", largura: captura.largura,
                                  altura: captura.altura, mime: "image/png")
    }
    imagens = mapa
  }

  /// Anexa um passo, marca `atualizadoEm` e atualiza `imagens`.
  public mutating func anexar(_ passo: Passo) {
    passos.append(passo)
    atualizadoEm = agoraComMilissegundos()
    atualizarImagens()
  }

  /// Aplica uma alteração ao passo com o id dado. Devolve falso se não existir.
  @discardableResult
  public mutating func atualizar(passoId: String, _ alteracao: (inout Passo) -> Void) -> Bool {
    guard let indice = passos.firstIndex(where: { $0.id == passoId }) else { return false }
    alteracao(&passos[indice])
    atualizadoEm = agoraComMilissegundos()
    atualizarImagens()
    return true
  }

  // MARK: JSON

  /// `.prettyPrinted, .sortedKeys, .withoutEscapingSlashes`; datas ISO 8601 UTC com frações (`guide.json`).
  public static let codificador: JSONEncoder = criarCodificador(compacto: false)
  /// Uma linha por passo (`eventos.ndjson`).
  public static let codificadorCompacto: JSONEncoder = criarCodificador(compacto: true)
  public static let decodificador: JSONDecoder = criarDecodificador()

  private static func criarCodificador(compacto: Bool) -> JSONEncoder {
    let e = JSONEncoder()
    if compacto {
      e.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    } else {
      e.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    }
    e.dateEncodingStrategy = .custom({ (data: Date, codificador: Encoder) throws -> Void in
      var c = codificador.singleValueContainer()
      try c.encode(formatarDataIso(data))
    })
    return e
  }

  private static func criarDecodificador() -> JSONDecoder {
    let d = JSONDecoder()
    d.dateDecodingStrategy = .custom({ (decodificador: Decoder) throws -> Date in
      let c = try decodificador.singleValueContainer()
      let texto: String = try c.decode(String.self)
      if let data = lerDataIso(texto) { return data }
      throw DecodingError.dataCorruptedError(in: c, debugDescription: "Data ISO 8601 inválida: \(texto)")
    })
    return d
  }

  public func json() throws -> Data {
    return try Guia.codificador.encode(self)
  }

  public static func ler(_ dados: Data) throws -> Guia {
    return try Guia.decodificador.decode(Guia.self, from: dados)
  }
}
