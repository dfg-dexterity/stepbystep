// Pasta da gravação: ~/Documents/StepByStep/<AAAA-MM-DD_HHmm>_<slug-do-app>/ com imagens/*.png,
// eventos.ndjson (journal, uma linha por passo, sincronizado) e guide.json (reescrito atômico após cada passo).
// Um crash perde no máximo o último passo; "Recuperar gravação" reconstrói o guide.json a partir do journal.
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import StepByStepNucleo

enum ErroGravacao: Error, LocalizedError {
  case displayNaoEncontrado
  case imagemNaoGravada(String)
  case dittoFalhou(Int32)
  case journalIndisponivel

  var errorDescription: String? {
    switch self {
    case .displayNaoEncontrado: return "O display sob o cursor não está disponível para captura."
    case .imagemNaoGravada(let nome): return "Não foi possível gravar a imagem \(nome)."
    case .dittoFalhou(let codigo): return "O ditto falhou ao compactar a gravação (código \(codigo))."
    case .journalIndisponivel: return "Não foi possível abrir eventos.ndjson para escrita."
    }
  }
}

final class Persistencia {
  static let nomeGuide: String = "guide.json"
  static let nomeJournal: String = "eventos.ndjson"
  static let nomePastaImagens: String = "imagens"

  let pasta: URL
  let pastaImagens: URL
  private let journal: FileHandle

  /// Cria a pasta da gravação (data local + slug do app frontal).
  init(app: String, agora: Date = Date()) throws {
    let raiz: URL = Persistencia.raiz()
    let formatador = DateFormatter()
    formatador.locale = Locale(identifier: "en_US_POSIX")
    formatador.dateFormat = "yyyy-MM-dd_HHmm"
    let nome: String = formatador.string(from: agora) + "_" + Persistencia.slug(app)
    pasta = raiz.appendingPathComponent(nome, isDirectory: true)
    pastaImagens = pasta.appendingPathComponent(Persistencia.nomePastaImagens, isDirectory: true)
    try FileManager.default.createDirectory(at: pastaImagens, withIntermediateDirectories: true)
    let urlJournal: URL = pasta.appendingPathComponent(Persistencia.nomeJournal)
    if !FileManager.default.fileExists(atPath: urlJournal.path) {
      guard FileManager.default.createFile(atPath: urlJournal.path, contents: nil) else { throw ErroGravacao.journalIndisponivel }
    }
    journal = try FileHandle(forWritingTo: urlJournal)
  }

  static func raiz() -> URL {
    let documentos: URL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
      ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Documents", isDirectory: true)
    return documentos.appendingPathComponent("StepByStep", isDirectory: true)
  }

  /// "SAP GUI" → "sap-gui"; sem acentos, só [a-z0-9-], ≤ 40 chars.
  static func slug(_ texto: String) -> String {
    let base: String = texto.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "pt_BR")).lowercased()
    var saida: String = ""
    var ultimoHifen: Bool = true
    for caractere in base {
      let ehAlfanumerico: Bool = caractere.isASCII && (caractere.isLetter || caractere.isNumber)
      if ehAlfanumerico {
        saida.append(caractere)
        ultimoHifen = false
      } else if !ultimoHifen {
        saida.append("-")
        ultimoHifen = true
      }
    }
    while saida.hasSuffix("-") { saida.removeLast() }
    if saida.count > 40 { saida = String(saida.prefix(40)) }
    return saida.isEmpty ? "app" : saida
  }

  // MARK: Escrita

  /// imagens/<imagemId>.png — display inteiro em pixels reais.
  func gravarImagem(_ imagem: CGImage, id: String) throws {
    let url: URL = pastaImagens.appendingPathComponent(id + ".png")
    guard let destino = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
      throw ErroGravacao.imagemNaoGravada(url.lastPathComponent)
    }
    CGImageDestinationAddImage(destino, imagem, nil)
    guard CGImageDestinationFinalize(destino) else {
      throw ErroGravacao.imagemNaoGravada(url.lastPathComponent)
    }
  }

  /// Uma linha JSON por passo, forçada ao disco.
  func anexarEvento(_ passo: Passo) throws {
    var dados: Data = try Guia.codificadorCompacto.encode(passo)
    dados.append(UInt8(0x0A))
    _ = try journal.seekToEnd()
    try journal.write(contentsOf: dados)
    try journal.synchronize()
  }

  /// guide.json completo (com o mapa `imagens`), escrita atômica.
  func gravarGuia(_ guia: Guia) throws {
    var copia: Guia = guia
    copia.atualizarImagens()
    let dados: Data = try copia.json()
    try dados.write(to: pasta.appendingPathComponent(Persistencia.nomeGuide), options: .atomic)
  }

  /// <pasta>.stepbystep.zip com a pasta como diretório de primeiro nível (lerPacote aceita).
  func compactar() throws -> URL {
    return try Persistencia.compactar(pasta: pasta)
  }

  static func compactar(pasta: URL) throws -> URL {
    let zip: URL = URL(fileURLWithPath: pasta.path + ".stepbystep.zip")
    if FileManager.default.fileExists(atPath: zip.path) {
      try FileManager.default.removeItem(at: zip)
    }
    let processo = Process()
    processo.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
    processo.arguments = ["-c", "-k", "--sequesterRsrc", "--keepParent", pasta.path, zip.path]
    try processo.run()
    processo.waitUntilExit()
    guard processo.terminationStatus == 0 else { throw ErroGravacao.dittoFalhou(processo.terminationStatus) }
    return zip
  }

  func fechar() {
    try? journal.close()
  }

  // MARK: Recuperação

  /// Pastas com journal cujo guide.json ainda está "gravando" (ou nem existe), mais recentes primeiro.
  static func gravacoesInterrompidas() -> [URL] {
    let gerenciador = FileManager.default
    guard let itens = try? gerenciador.contentsOfDirectory(at: raiz(), includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]) else {
      return []
    }
    var achadas: [URL] = []
    for pasta in itens {
      var ehDiretorio: ObjCBool = false
      guard gerenciador.fileExists(atPath: pasta.path, isDirectory: &ehDiretorio), ehDiretorio.boolValue else { continue }
      guard gerenciador.fileExists(atPath: pasta.appendingPathComponent(nomeJournal).path) else { continue }
      let urlGuide: URL = pasta.appendingPathComponent(nomeGuide)
      if let dados = try? Data(contentsOf: urlGuide), let guia = try? Guia.ler(dados) {
        if guia.estado == "gravando" { achadas.append(pasta) }
      } else {
        achadas.append(pasta)
      }
    }
    return achadas.sorted { $0.lastPathComponent > $1.lastPathComponent }
  }

  /// Reconstrói o guide.json a partir do journal (que pode ter um passo a mais), marca concluído e devolve o guia.
  static func recuperar(pasta: URL) throws -> Guia {
    let urlGuide: URL = pasta.appendingPathComponent(nomeGuide)
    var guia: Guia
    if let dados = try? Data(contentsOf: urlGuide), let lido = try? Guia.ler(dados) {
      guia = lido
    } else {
      guia = Guia.novo(app: pasta.lastPathComponent)
    }
    let texto: String = try String(contentsOf: pasta.appendingPathComponent(nomeJournal), encoding: .utf8)
    var doJournal: [Passo] = []
    for linha in texto.split(separator: "\n", omittingEmptySubsequences: true) {
      guard let dados = String(linha).data(using: .utf8),
            let passo = try? Guia.decodificador.decode(Passo.self, from: dados) else { continue }
      doJournal.append(passo)
    }
    // guide.json pode ter atualizações posteriores (OCR); o journal tem os passos que faltaram.
    if doJournal.count > guia.passos.count {
      let idsConhecidos: Set<String> = Set(guia.passos.map { $0.id })
      for passo in doJournal where !idsConhecidos.contains(passo.id) {
        guia.passos.append(passo)
      }
    }
    // Imagem que não chegou ao disco → captura faltante (imagemId null), como o validador exige.
    for indice in guia.passos.indices {
      guard let captura = guia.passos[indice].captura, let imagemId = captura.imagemId else { continue }
      let urlImagem: URL = pasta.appendingPathComponent(nomePastaImagens).appendingPathComponent(imagemId + ".png")
      if !FileManager.default.fileExists(atPath: urlImagem.path) {
        guia.passos[indice].captura = Captura.faltante(motivo: "imagem não gravada", viewport: captura.viewport, dpr: captura.dpr)
      }
    }
    guia.estado = "concluido"
    guia.atualizadoEm = agoraComMilissegundos()
    guia.atualizarImagens()
    try guia.json().write(to: urlGuide, options: .atomic)
    return guia
  }
}
