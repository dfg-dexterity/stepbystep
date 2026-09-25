// Codifica/decodifica o fixture guia-mac (tests/fixtures/guia-mac/guide.json) e compara campo a campo.
// O fixture é o contrato com o editor: o que o app grava precisa ser exatamente isto.
import XCTest
import Foundation
import StepByStepNucleo

final class GuiaTests: XCTestCase {
  /// packages/mac/Tests/StepByStepNucleoTests/GuiaTests.swift → raiz do repositório (5 níveis acima).
  private func urlFixture(_ nome: String) -> URL {
    var url: URL = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { url = url.deletingLastPathComponent() }
    return url.appendingPathComponent("tests/fixtures/guia-mac").appendingPathComponent(nome)
  }

  private func lerFixture() throws -> (dados: Data, guia: Guia) {
    let dados: Data = try Data(contentsOf: urlFixture("guide.json"))
    let guia: Guia = try Guia.ler(dados)
    return (dados, guia)
  }

  private func dicionario(_ dados: Data) throws -> NSDictionary {
    let objeto: Any = try JSONSerialization.jsonObject(with: dados, options: [])
    guard let dict = objeto as? NSDictionary else {
      XCTFail("JSON não é um objeto")
      return NSDictionary()
    }
    return dict
  }

  // MARK: Leitura campo a campo

  func testDecodificaFixtureCampoACampo() throws {
    let guia: Guia = try lerFixture().guia

    XCTAssertEqual(guia.formato, "stepbystep/guia")
    XCTAssertEqual(guia.versao, 1)
    XCTAssertEqual(guia.id, "g_m1x7q2mac0aa")
    XCTAssertEqual(guia.titulo, "Gravação — SAP GUI")
    XCTAssertEqual(guia.descricao, "")
    XCTAssertEqual(guia.idioma, "pt-BR")
    XCTAssertEqual(guia.autor, "")
    XCTAssertEqual(guia.criadoEm, lerDataIso("2026-09-24T17:12:00.000Z"))
    XCTAssertEqual(guia.atualizadoEm, lerDataIso("2026-09-24T17:14:30.000Z"))
    XCTAssertEqual(guia.origem, Origem(tipo: "mac", versao: "0.1.0", plataforma: "macOS 15.0"))
    XCTAssertEqual(guia.estilo, Estilo(cor: "cerceta", escurecerFora: true))
    XCTAssertEqual(guia.estado, "concluido")
    XCTAssertEqual(guia.publicacoes.count, 0)
    XCTAssertEqual(guia.passos.count, 7)
    XCTAssertEqual(guia.imagens?.count, 6)
    XCTAssertEqual(guia.imagens?["img_m1x7q2mac01a"],
                   ImagemInfo(arquivo: "imagens/img_m1x7q2mac01a.png", largura: 3456, altura: 2234, mime: "image/png"))

    // Todo passo do Mac: título vazio para o editor gerar a frase.
    for passo in guia.passos {
      XCTAssertEqual(passo.titulo, "", "passo \(passo.id)")
      XCTAssertTrue(passo.tituloAuto, "passo \(passo.id)")
      XCTAssertEqual(passo.descricao, "")
      XCTAssertNil(passo.resultado)
      XCTAssertNil(passo.mescladoDe)
      XCTAssertEqual(passo.contexto?.app, "SAP GUI")
      XCTAssertEqual(passo.contexto?.bundleId, "com.sap.platin")
      XCTAssertEqual(passo.contexto?.tela, Tela(id: 2, largura: 1728, altura: 1117, escala: 2))
    }

    // 1: navegar (troca de app)
    let navegar: Passo = guia.passos[0]
    XCTAssertEqual(navegar.id, "p_m1x7q2mac01a")
    XCTAssertEqual(navegar.tipo, "navegar")
    XCTAssertEqual(navegar.criadoEm, lerDataIso("2026-09-24T17:12:01.000Z"))
    XCTAssertEqual(navegar.evento, Evento.navegarApp(app: "SAP GUI"))
    XCTAssertEqual(navegar.contexto?.janela, "SAP Easy Access")
    XCTAssertNil(navegar.alvo)
    XCTAssertEqual(navegar.anotacoes.count, 0)
    XCTAssertEqual(navegar.captura, Captura(imagemId: "img_m1x7q2mac01a", largura: 3456, altura: 2234, dpr: 2,
                                            viewport: Tamanho(largura: 1728, altura: 1117), escala: 2,
                                            fonte: "navegacao", faltante: false, motivo: nil))

    // 2: clique em item de menu, com recorte automático incluindo a barra de menus
    let clique: Passo = guia.passos[1]
    XCTAssertEqual(clique.tipo, "clicar")
    XCTAssertEqual(clique.evento, Evento.clicar(botao: "esquerdo", vezes: 1, modificadores: []))
    let alvo: Alvo? = clique.alvo
    XCTAssertEqual(alvo?.papel, "menuitem")
    XCTAssertEqual(alvo?.papelNativo, "AXMenuItem")
    XCTAssertEqual(alvo?.rotulo, "Novo")
    XCTAssertEqual(alvo?.fonteRotulo, "ax")
    XCTAssertNil(alvo?.campo)
    XCTAssertNil(alvo?.tag)
    XCTAssertNil(alvo?.tipoInput)
    XCTAssertNil(alvo?.seletor)
    XCTAssertEqual(alvo?.rectCss, Rect(x: 96, y: 58, w: 200, h: 22))
    XCTAssertEqual(alvo?.bbox, Rect(x: 192, y: 116, w: 400, h: 44))
    XCTAssertEqual(alvo?.ponto, Ponto(x: 260, y: 138))
    XCTAssertNil(alvo?.frame)
    XCTAssertEqual(alvo?.menu, "Arquivo › Novo")
    XCTAssertEqual(alvo?.janelaBbox, Rect(x: 160, y: 90, w: 3000, h: 1900))
    XCTAssertEqual(clique.captura?.fonte, "pointerdown")
    XCTAssertEqual(clique.anotacoes, [Anotacao.recorte(id: "a_m1x7q2mac02a1", auto: true, x: 160, y: 0, w: 3000, h: 1990)])

    // 3: clique em botão
    let botao: Passo = guia.passos[2]
    XCTAssertEqual(botao.alvo?.papel, "button")
    XCTAssertEqual(botao.alvo?.papelNativo, "AXButton")
    XCTAssertEqual(botao.alvo?.rotulo, "Executar")
    XCTAssertEqual(botao.contexto?.janela, "ME21N — Criar pedido")

    // 4: digitação confirmada por Enter
    let digitar: Passo = guia.passos[3]
    XCTAssertEqual(digitar.tipo, "digitar")
    XCTAssertEqual(digitar.evento, Evento.digitar(valor: "4500001234", sensivel: false, motivo: nil, confirmadoPor: "enter"))
    XCTAssertEqual(digitar.alvo?.papel, "textbox")
    XCTAssertEqual(digitar.alvo?.papelNativo, "AXTextField")
    XCTAssertEqual(digitar.alvo?.campo, "Pedido")
    XCTAssertNil(digitar.alvo?.ponto)
    XCTAssertEqual(digitar.captura?.fonte, "confirmacao")

    // 5: Enter compartilha a imagem da digitação
    let enter: Passo = guia.passos[4]
    XCTAssertEqual(enter.tipo, "tecla")
    XCTAssertEqual(enter.evento, Evento.tecla(tecla: "Enter", modificadores: [], atalho: "Enter"))
    XCTAssertNil(enter.alvo)
    XCTAssertEqual(enter.captura?.fonte, "compartilhada")
    XCTAssertEqual(enter.captura?.imagemId, digitar.captura?.imagemId)

    // 6: atalho ⌘S
    let atalho: Passo = guia.passos[5]
    XCTAssertEqual(atalho.evento, Evento.tecla(tecla: "S", modificadores: ["Meta"], atalho: "⌘S"))

    // 7: campo seguro — valor nulo, sensível
    let senha: Passo = guia.passos[6]
    XCTAssertEqual(senha.evento, Evento.digitar(valor: nil, sensivel: true, motivo: "AXSecureTextField", confirmadoPor: "tempo"))
    XCTAssertEqual(senha.alvo?.papelNativo, "AXSecureTextField")
    XCTAssertEqual(senha.alvo?.campo, "Senha")
    XCTAssertEqual(senha.anotacoes, [Anotacao.recorte(id: "a_m1x7q2mac07a1", auto: true, x: 1100, y: 800, w: 1200, h: 600)])
  }

  // MARK: Escrita idêntica ao fixture

  func testRecodificaIgualAoFixture() throws {
    let (dados, guia) = try lerFixture()
    let gerado: Data = try guia.json()

    // Estrutura JSON idêntica (ordem de chaves à parte): nulls explícitos, sem chaves a mais nem a menos.
    let original: NSDictionary = try dicionario(dados)
    let novo: NSDictionary = try dicionario(gerado)
    XCTAssertEqual(novo, original)

    // Round-trip das structs.
    let relido: Guia = try Guia.ler(gerado)
    XCTAssertEqual(relido, guia)

    // Formatação do codificador: multilinha, barras sem escape, datas com frações; sem chaves opcionais ausentes.
    let texto: String = String(decoding: gerado, as: UTF8.self)
    XCTAssertTrue(texto.contains("\n"))
    XCTAssertTrue(texto.contains("imagens/img_m1x7q2mac01a.png"))
    XCTAssertTrue(texto.contains("2026-09-24T17:12:00.000Z"))
    XCTAssertFalse(texto.contains("mescladoDe"))
    XCTAssertFalse(texto.contains("\\/"))

    // Nulls explícitos onde o formato os exige.
    guard let passos = novo["passos"] as? [NSDictionary], passos.count == 7,
          let evento = passos[6]["evento"] as? NSDictionary, let alvo = passos[1]["alvo"] as? NSDictionary else {
      XCTFail("passos não serializados como esperado")
      return
    }
    XCTAssertTrue(evento["valor"] is NSNull)
    XCTAssertTrue(passos[0]["alvo"] is NSNull)
    XCTAssertTrue(passos[0]["resultado"] is NSNull)
    XCTAssertTrue(alvo["frame"] is NSNull)
    XCTAssertTrue(alvo["campo"] is NSNull)
  }

  func testJournalNdjsonBateComOFixture() throws {
    let guia: Guia = try lerFixture().guia
    let journal: String = try String(contentsOf: urlFixture("eventos.ndjson"), encoding: .utf8)
    let linhas: [Substring] = journal.split(separator: "\n", omittingEmptySubsequences: true)
    XCTAssertEqual(linhas.count, guia.passos.count)

    for (indice, passo) in guia.passos.enumerated() {
      let compacto: Data = try Guia.codificadorCompacto.encode(passo)
      XCTAssertFalse(String(decoding: compacto, as: UTF8.self).contains("\n"), "linha \(indice) tem quebra")
      let esperado: NSDictionary = try dicionario(Data(String(linhas[indice]).utf8))
      let gerado: NSDictionary = try dicionario(compacto)
      XCTAssertEqual(gerado, esperado, "linha \(indice)")
      let relido: Passo = try Guia.decodificador.decode(Passo.self, from: compacto)
      XCTAssertEqual(relido, passo)
    }
  }

  // MARK: Construtores do app

  func testGuiaNovoSegueOContrato() throws {
    var guia: Guia = Guia.novo(app: "SAP GUI")
    XCTAssertEqual(guia.formato, "stepbystep/guia")
    XCTAssertEqual(guia.versao, 1)
    XCTAssertTrue(validarId(guia.id))
    XCTAssertTrue(guia.id.hasPrefix("g_"))
    XCTAssertEqual(guia.titulo, "Gravação — SAP GUI")
    XCTAssertEqual(guia.origem.tipo, "mac")
    XCTAssertEqual(guia.origem.versao, "0.1.0")
    XCTAssertTrue((guia.origem.plataforma ?? "").hasPrefix("macOS "))
    XCTAssertEqual(guia.estado, "gravando")
    XCTAssertEqual(guia.idioma, "pt-BR")
    XCTAssertEqual(guia.estilo, Estilo(cor: "cerceta", escurecerFora: true))
    XCTAssertEqual(guia.passos.count, 0)
    XCTAssertEqual(guia.imagens, [:])

    var passo: Passo = Passo.novo(tipo: "clicar")
    XCTAssertTrue(validarId(passo.id))
    XCTAssertTrue(passo.id.hasPrefix("p_"))
    XCTAssertEqual(passo.titulo, "")
    XCTAssertTrue(passo.tituloAuto)
    XCTAssertEqual(passo.anotacoes.count, 0)
    passo.captura = Captura(imagemId: "img_m1x7q2abcdef", largura: 3456, altura: 2234, dpr: 2,
                            viewport: Tamanho(largura: 1728, altura: 1117), escala: 2, fonte: "pointerdown",
                            faltante: false, motivo: nil)
    guia.anexar(passo)
    var tecla: Passo = Passo.novo(tipo: "tecla")
    tecla.captura = passo.captura
    tecla.captura?.fonte = "compartilhada"
    guia.anexar(tecla)

    // Mapa de imagens: uma entrada por imagem, mesmo compartilhada por dois passos.
    XCTAssertEqual(guia.imagens?.count, 1)
    XCTAssertEqual(guia.imagens?["img_m1x7q2abcdef"],
                   ImagemInfo(arquivo: "imagens/img_m1x7q2abcdef.png", largura: 3456, altura: 2234, mime: "image/png"))

    // Campos ausentes viram null explícito (o editor lê `alvo === null`).
    let dict: NSDictionary = try dicionario(try guia.json())
    guard let passos = dict["passos"] as? [NSDictionary], passos.count == 2 else {
      XCTFail("passos não serializados")
      return
    }
    XCTAssertTrue(passos[0]["alvo"] is NSNull)
    XCTAssertTrue(passos[0]["contexto"] is NSNull)
    XCTAssertTrue(passos[0]["evento"] is NSNull)
    XCTAssertTrue(passos[0]["resultado"] is NSNull)
    XCTAssertNil(passos[0]["mescladoDe"])
    XCTAssertEqual(passos[0]["titulo"] as? String, "")
    XCTAssertEqual(passos[0]["tituloAuto"] as? Bool, true)
    XCTAssertEqual(dict["publicacoes"] as? [NSDictionary], [])

    // Captura faltante: imagemId null e fora do mapa de imagens.
    var faltante: Passo = Passo.novo(tipo: "clicar")
    faltante.captura = Captura.faltante(motivo: "teste", viewport: Tamanho(largura: 1728, altura: 1117), dpr: 2)
    guia.anexar(faltante)
    XCTAssertEqual(guia.imagens?.count, 1)
    let relido: Guia = try Guia.ler(try guia.json())
    XCTAssertEqual(relido, guia)
    XCTAssertNil(relido.passos[2].captura?.imagemId)
    XCTAssertEqual(relido.passos[2].captura?.faltante, true)
  }

  func testAtualizarPasso() {
    var guia: Guia = Guia.novo(app: "Finder")
    var passo: Passo = Passo.novo(tipo: "clicar")
    passo.evento = .clicar(botao: "esquerdo", vezes: 1, modificadores: [])
    passo.alvo = Alvo(papel: "button", papelNativo: "AXButton", rotulo: nil, fonteRotulo: "nenhum", campo: nil,
                      rectCss: nil, bbox: nil, ponto: nil, menu: nil, janelaBbox: nil)
    guia.anexar(passo)
    let ok: Bool = guia.atualizar(passoId: passo.id) { p in
      p.alvo?.rotulo = "Salvar"
      p.alvo?.fonteRotulo = "ocr"
      p.evento = .clicar(botao: "esquerdo", vezes: 2, modificadores: [])
    }
    XCTAssertTrue(ok)
    XCTAssertEqual(guia.passos[0].alvo?.rotulo, "Salvar")
    XCTAssertEqual(guia.passos[0].alvo?.fonteRotulo, "ocr")
    XCTAssertEqual(guia.passos[0].evento, Evento.clicar(botao: "esquerdo", vezes: 2, modificadores: []))
    let inexistente: Bool = guia.atualizar(passoId: "p_inexistente1") { _ in }
    XCTAssertFalse(inexistente)
  }

  // MARK: Anotações e eventos por tipo

  func testAnotacoesCodificadasPorTipo() throws {
    let lista: [Anotacao] = [
      .recorte(id: "a_m1x4k9zr03a1", auto: false, x: 400, y: 400, w: 1600, h: 800),
      .desfoque(id: "a_m1x4k9zr05a1", auto: true, x: 700, y: 772, w: 800, h: 56, bloco: 16),
      .retangulo(id: "a_m1x4k9zr03a2", auto: true, x: 684, y: 596, w: 832, h: 88, cor: "cerceta"),
      .seta(id: "a_m1x4k9zr03a4", auto: false, de: Ponto(x: 1700, y: 900), para: Ponto(x: 1520, y: 680), cor: "ambar"),
      .marcador(id: "a_m1x4k9zr03a3", auto: true, x: 1516, y: 596, numero: 3, cor: "cerceta"),
      .texto(id: "a_m1x4k9zr03a5", auto: false, x: 1710, y: 920, texto: "Razão social", tamanho: 32, cor: "base", fundo: "off"),
      .texto(id: "a_m1x4k9zr03a6", auto: false, x: 10, y: 20, texto: "Nota", tamanho: 16, cor: "roxo", fundo: nil),
    ]
    let dados: Data = try Guia.codificadorCompacto.encode(lista)
    let relida: [Anotacao] = try Guia.decodificador.decode([Anotacao].self, from: dados)
    XCTAssertEqual(relida, lista)
    XCTAssertEqual(lista.map { $0.tipo }, ["recorte", "desfoque", "retangulo", "seta", "marcador", "texto", "texto"])
    XCTAssertEqual(lista[0].id, "a_m1x4k9zr03a1")
    let texto: String = String(decoding: dados, as: UTF8.self)
    XCTAssertTrue(texto.contains("\"tipo\":\"desfoque\""))
    XCTAssertTrue(texto.contains("\"fundo\":null"))
    XCTAssertFalse(texto.contains("\"cor\":\"cerceta\",\"h\":800"), "recorte não tem cor")
    XCTAssertThrowsError(try Guia.decodificador.decode([Anotacao].self, from: Data("[{\"id\":\"a_m1x4k9zr03a1\",\"tipo\":\"estrela\"}]".utf8)))
  }

  func testEventosDaExtensaoTambemSaoLidos() throws {
    let eventos: [Evento] = [
      .navegarUrl(url: "https://fiori.empresa.com.br/ui#Shell-home", transicao: "inicio"),
      .selecionar(valor: "BR", opcao: "Brasil"),
      .marcar(marcado: true),
      .clicar(botao: "direito", vezes: 1, modificadores: ["Shift"]),
    ]
    let dados: Data = try Guia.codificadorCompacto.encode(eventos)
    XCTAssertEqual(try Guia.decodificador.decode([Evento].self, from: dados), eventos)
    XCTAssertTrue(String(decoding: dados, as: UTF8.self).contains("https://fiori.empresa.com.br/ui#Shell-home"))
  }

  // MARK: Ids e datas

  func testIdsNoPadraoDoNucleoJs() {
    var vistos: Set<String> = []
    for _ in 0..<1000 {
      let id: String = gerarId("p")
      XCTAssertTrue(validarId(id), id)
      XCTAssertTrue(id.hasPrefix("p_"))
      vistos.insert(id)
    }
    XCTAssertEqual(vistos.count, 1000)
    XCTAssertTrue(validarId(gerarId("img")))
    XCTAssertTrue(validarId("g_m1x4k9zq7a2b"))
    XCTAssertTrue(validarId("a_m1x7q2mac02a1"))
    XCTAssertFalse(validarId("x_m1x4k9zq7a2b"))
    XCTAssertFalse(validarId("g_M1X4K9ZQ7A2B"))
    XCTAssertFalse(validarId("p_curto1"))
    XCTAssertFalse(validarId("p_"))
    XCTAssertFalse(validarId("sem-separador"))
  }

  func testDatasIso8601() {
    let texto: String = "2026-09-24T17:12:01.250Z"
    guard let data = lerDataIso(texto) else {
      XCTFail("não leu data com fração")
      return
    }
    XCTAssertEqual(formatarDataIso(data), texto)
    XCTAssertNotNil(lerDataIso("2026-09-24T17:12:01Z"))
    XCTAssertNil(lerDataIso("ontem"))
    XCTAssertTrue(formatarDataIso(Date()).hasSuffix("Z"))
  }
}
