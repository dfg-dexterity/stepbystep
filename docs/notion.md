# Publicar um manual no Notion

O StepByStep salva o manual como **uma página nova** dentro de uma página do seu Notion que você escolhe
(a "página-mãe"). Ele **nunca lê, altera ou apaga** outras páginas: só cria a página do manual, envia as
imagens dos passos e anexa os blocos de texto. Você repete a publicação quando quiser; cada publicação gera
uma página nova.

Para isso o Notion exige uma **integração interna** do seu espaço de trabalho e um **token** dela. O token
fica guardado só no seu navegador (IndexedDB do editor) — nunca vai para o código nem para o servidor da
Dexterity; o servidor apenas repassa a chamada ao Notion, sem registrar cabeçalhos.

## 1. Criar a integração interna (uma vez por espaço de trabalho)

1. Abra <https://www.notion.so/profile/integrations> (entre com a conta do espaço de trabalho onde os
   manuais vão morar).
2. Clique em **Nova integração** (*New integration*).
3. Preencha:
   - **Nome**: `StepByStep` (ou o que preferir — é o nome que aparece em "Conexões" da página).
   - **Espaço de trabalho associado**: o espaço onde está a página-mãe.
   - **Tipo**: **Interna** (*Internal*). Não é preciso integração pública nem OAuth.
4. Salve. Na aba **Capacidades** (*Capabilities*) deixe marcadas apenas:
   - **Ler conteúdo** (*Read content*) — necessária para a busca da página-mãe;
   - **Inserir conteúdo** (*Insert content*) — cria a página do manual e anexa os blocos.
   Pode desmarcar **Atualizar conteúdo**, **Ler comentários**, **Inserir comentários** e deixar as
   **Capacidades de usuário** em "Sem informações do usuário": o StepByStep não usa nada disso.
5. Em **Segredos** (*Secrets*), clique em **Mostrar** e copie o **Segredo da integração interna**
   (começa com `ntn_` ou, em integrações antigas, `secret_`). Esse é o token.

Trate o token como uma senha: quem o tiver consegue criar páginas nas páginas conectadas à integração.
Se vazar, clique em **Atualizar segredo** (*Refresh secret*) na mesma tela e cole o novo no editor.

## 2. Conectar a integração à página-mãe (o passo mais esquecido)

Uma integração interna **não enxerga nada** até ser conectada a uma página. Escolha (ou crie) a página que
vai receber os manuais — por exemplo `Manuais › Processos` — e:

1. Abra a página no Notion.
2. Clique em **···** (canto superior direito) › **Conexões** (*Connections*) › **Conectar a**
   (*Connect to*) e escolha a integração `StepByStep`.
3. Confirme. A integração passa a ver essa página **e as subpáginas dela** — é aí que o StepByStep cria a
   página nova.

Se a busca da página-mãe no editor vier vazia, ou a publicação falhar com "página não encontrada"
(`object_not_found`), é quase sempre este passo faltando. Só páginas conectadas aparecem.

## 3. Colar o token no editor

1. No editor do StepByStep (extensão ou <https://stepbystep-dexterity.vercel.app/editor/>), abra o guia e
   clique em **Notion**.
2. Cole o token em **Token de integração interna** e clique em **Testar**: o editor chama
   `GET /v1/users/me` e mostra o nome da integração. Se der "token inválido", confira se copiou o segredo
   inteiro e se a integração é do mesmo espaço de trabalho da página.
3. Em **Página-mãe**, digite parte do título e escolha a página conectada no passo 2. A última escolha
   fica lembrada.
4. Clique em **Publicar**. A barra de progresso mostra "Enviando imagem 3 de 6", "Criando página",
   "Anexando blocos 2/3". Ao terminar aparece **Abrir no Notion**.

O token fica salvo neste navegador até você clicar em **Esquecer**. Ele nunca é gravado no arquivo do guia
(`.stepbystep.zip`, Markdown ou HTML), então exportar e compartilhar um guia não expõe o token.

## 4. O que o StepByStep cria na página-mãe

Uma página nova com:

- ícone 📘 e o título do guia;
- um bloco de nota ("Manual gerado com StepByStep · Dexterity IT Solutions · n passos · data") e a
  descrição, se houver;
- um item numerado por passo, com o alvo em **negrito** (`Clique em «Criar»`), a descrição e a imagem do
  passo já com as anotações (retângulo, marcador, desfoque etc.) "assadas" — o original sem anotações
  nunca sai do seu computador;
- um título de seção (`heading 2`) para cada seção do guia. Como o Notion reinicia a numeração após um
  título, nesse caso os itens recebem o prefixo "Passo n — ".

As imagens sobem pela File Upload API do Notion, uma a uma, e ficam hospedadas no próprio Notion.

## 5. Limites e comportamento em falhas

- **Tamanho das imagens**: no editor hospedado cada imagem vai até **4 MB** (limite do repasse na Vercel);
  na extensão, até 20 MB. Acima disso o editor reduz automaticamente (2000 px, depois WebP, depois 1400
  px). Espaços de trabalho no plano gratuito do Notion aceitam até 5 MB por arquivo.
- **Ritmo**: o Notion aceita cerca de 3 requisições por segundo; os envios são sequenciais e, se ele
  pedir para esperar (`429`), o editor espera o tempo indicado e tenta de novo.
- **Falha no meio**: os uploads valem 1 hora. Se a conexão cair, o botão **Retomar** reaproveita a página já
  criada e as imagens já enviadas (com menos de 50 min) sem duplicar a página; **Criar nova página**
  recomeça do zero.
- **Mensagens comuns**:
  - *Token inválido ou expirado* — segredo errado/atualizado, ou integração de outro espaço.
  - *Página não encontrada… conectada à integração* — falta o passo 2.
  - *A integração não tem permissão* — capacidade **Inserir conteúdo** desmarcada.
  - *O Notion recusou os dados enviados* — bloco fora dos limites da API; abra um chamado com o guia.

## 6. Revogar o acesso

Para desligar tudo: no Notion, **···** › **Conexões** › remova a integração da página; ou em
<https://www.notion.so/profile/integrations> apague a integração. No editor, clique em **Esquecer** para
apagar o token do navegador.
