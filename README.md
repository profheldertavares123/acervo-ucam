# Acervo UCM — Consolidador de Atividades Acadêmicas

Aplicativo web institucional da Universidade Candido Mendes (UCAM) para registrar atividades
acadêmicas (aulas práticas, projetos de extensão e visitas programadas), anexar a documentação de
suporte e gerar um relatório consolidado em PDF com assinaturas e vistos.

O aplicativo é **100% estático e local**: não há servidor de aplicação, banco de dados remoto nem
envio de arquivos para a nuvem. Tudo o que é cadastrado fica no navegador do próprio dispositivo.

### Demonstração online

> **https://profheldertavares123.github.io/acervo-ucam/**
>
> Cópia publicada no GitHub Pages para apresentação. Abre com os dados de demonstração.
> Como o aplicativo é 100% local, **cada visitante tem seus próprios dados** no próprio navegador —
> nada é compartilhado nem enviado para o servidor do site.

---

## Recursos

- **Painel acadêmico** com indicadores do ciclo, agenda, pendências de assinatura e prontidão documental.
- **Cadastro de atividades** em assistente de 3 etapas: identificação, responsáveis e documentos.
  - Várias atividades na mesma data ou em datas diferentes.
  - Nome, natureza, data, horários de início e término, local, unidade de base, cursos e descrição.
  - Professores responsáveis, coordenadores (um por curso) e direção da unidade.
- **Documentos e comprovações**
  - Documentos: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, ODT e ODS.
  - Imagens: PNG, JPG, TIFF, WEBP, SVG e BMP.
  - Limite de 30 MB por arquivo, com pré-visualização antes de anexar.
- **Assinaturas e vistos** de professores, coordenações e direção, com registro de CPF, código de
  verificação e comprovante vinculados ao serviço oficial
  [Assinatura Eletrônica gov.br](https://www.gov.br/governodigital/pt-br/identidade/assinatura-eletronica).
- **Consolidação do relatório** com capa institucional e panorama das atividades na mesma página
  inicial, fichas por atividade, índice de documentos e folha única de assinaturas/vistos.
- **Documentos digitalizados na íntegra**: cada documento anexado ganha páginas exclusivas no
  relatório. PDFs são reproduzidos página a página em alta resolução; documentos do Office exibem a
  prévia textual paginada. O índice de documentos indica a página de cada anexo. A opção pode ser
  desativada em **Consolidação → Estrutura do documento**.
- **Comprovações por imagem** nas fichas de atividade, sem cortes e preservando a proporção original
  dos arquivos.
- **Impressão / PDF em A4** com numeração de páginas e quebras de página controladas.
- **Backup em JSON** de atividades, configurações e arquivos anexados.
- **Dados de demonstração** removíveis, para explorar o aplicativo antes de cadastrar registros reais.

---

## Como executar

O aplicativo usa módulos JavaScript (`type="module"`), por isso precisa ser servido por HTTP —
abrir o `index.html` diretamente (`file://`) não funciona na maioria dos navegadores.

### Opção 1 — Atalho `.bat` (Windows)

Na pasta acima de `ucam-consolidador/` há os arquivos:

- **`Iniciar App Acervo UCM.bat`** — inicia o servidor local e abre o aplicativo no navegador.
  Basta clicar duas vezes. A janela "Acervo UCM - servidor local" deve ficar aberta (minimizada)
  enquanto o app estiver em uso; feche-a para encerrar o servidor.
- **`abrir-app.html`** — página de atalho que verifica se o servidor está ligado e mostra o aviso
  "Servidor local desligado" com o procedimento, caso ele esteja parado.

### Opção 2 — Manual

Com Python instalado:

```bash
cd ucam-consolidador
python -m http.server 8765 --bind 127.0.0.1
```

Depois acesse:

```
http://127.0.0.1:8765
```

Também é possível usar qualquer servidor estático (Node `npx serve`, VS Code Live Server, IIS,
nginx, etc.) ou publicar a pasta em uma hospedagem interna.

### Requisitos

- Navegador atualizado (Chrome, Edge, Firefox ou Safari).
- `DecompressionStream` para pré-visualizar o texto de DOCX/XLSX/PPTX (Chrome/Edge 80+, Firefox 113+,
  Safari 16.4+).
- Armazenamento local habilitado (IndexedDB).

---

## Fluxo de uso

1. **Configurações** — preencha a identidade institucional, a unidade padrão, a direção, as unidades e
   os cursos cadastrados. Esses dados alimentam a capa e os documentos.
2. **Nova atividade** — informe identificação, responsáveis e anexos. É possível salvar mesmo sem
   documentos; a pendência fica registrada.
3. **Atividades** — abra a ficha de cada atividade para editar, anexar arquivos, visualizar
   comprovantes e acompanhar as assinaturas.
4. **Assinaturas** — para cada signatário, abra a Assinatura Eletrônica gov.br, conclua a assinatura no
   serviço oficial e registre no aplicativo o CPF, o código de verificação e, se quiser, o comprovante.
5. **Consolidação** — selecione as atividades, ajuste título, subtítulo, apresentação e seções do
   documento, confira a pré-visualização A4 e clique em **Imprimir / PDF**.

### Impressão em PDF

Na caixa de impressão do navegador:

- Destino: **Salvar como PDF**.
- Papel: **A4**.
- Margens: **Padrão** (o layout já reserva as margens).
- Ative **Gráficos de plano de fundo** para preservar o vinho institucional, os selos e as tarjas.

Os documentos anexados entram em páginas próprias: aguarde o aviso de prévia atualizada antes de
imprimir, pois os PDFs são rasterizados no navegador para garantir a reprodução fiel na impressão.
Por isso, o texto desses anexos não fica selecionável no PDF final — o arquivo original continua
disponível na ficha da atividade.

---

## Dados, privacidade e backup

- Os registros ficam no **IndexedDB** local, banco `acervo-ucam`, e os arquivos são guardados como
  blobs no mesmo navegador.
- Nada é enviado automaticamente para servidores externos. O acesso à Assinatura Eletrônica gov.br só
  ocorre quando o usuário clica em **Abrir serviço oficial**.
- Limpar os dados do site no navegador apaga o acervo. Faça backups periódicos em
  **Configurações → Backup do acervo → Exportar**.
- O backup é um arquivo `.json` com atividades, configurações e arquivos (em base64). Guarde-o em
  local seguro, pois contém dados pessoais (nomes, e-mails e CPF mascarado).

### Dados de demonstração

O primeiro acesso cria quatro atividades de exemplo com documentos, imagens e assinaturas. Elas são
identificadas pelo aviso **Ambiente de demonstração** e podem ser removidas em
**Configurações → Dados do acervo → Limpar exemplos** (ou pelo botão **Limpar exemplos** no topo).
O aplicativo não recria os exemplos depois de removidos.

---

## Limitações conhecidas

- **Assinatura Eletrônica gov.br**: o aplicativo **não** faz login OAuth nem assina documentos
  diretamente. Ele registra a conclusão da assinatura feita no
  [serviço oficial](https://www.gov.br/governodigital/pt-br/identidade/assinatura-eletronica) (CPF,
  código e comprovante). A validade jurídica deve ser confirmada no próprio serviço. A
  [API oficial](https://manual-integracao-assinatura-eletronica.servicos.gov.br/) é restrita a órgãos
  e entidades públicas, exige Login Único e credenciais de servidor, e não pode ser embutida em um
  aplicativo estático sem backend. Não há MCP oficial do gov.br; servidores MCP de terceiros não
  substituem a assinatura gov.br e exigem conta e credenciais próprias.
- **Backup somente para exportação**: não há importação de backup nesta versão.
- **Pré-visualização de documentos**: no relatório, PDFs são reproduzidos página a página como imagem
  e DOCX, XLSX e PPTX entram como prévia textual paginada (sem a diagramação original). DOC, XLS e PPT
  (formatos binários legados) e ODT/ODS não têm prévia no relatório; permanecem anexados ao acervo.
- **Armazenamento**: o limite depende do navegador (normalmente centenas de MB a alguns GB). Arquivos
  grandes reduzem o espaço disponível.
- **Um navegador por vez**: como os dados são locais, dois navegadores/dispositivos diferentes não
  compartilham o mesmo acervo sem backup manual.

---

## Estrutura do projeto

```
ucam-consolidador/
├── index.html            # ponto de entrada
├── assets/
│   ├── ucam-logo.png     # marca institucional
│   └── vendor/pdfjs/     # pdf.js local (renderização dos anexos em PDF)
├── css/
│   └── styles.css        # sistema visual, responsivo e estilos de impressão A4
└── js/
    ├── app.js            # shell, rotas, painel, atividades, assistente, assinaturas, configurações
    ├── store.js          # IndexedDB, dados de demonstração e persistência de arquivos
    ├── report.js         # composição das páginas do relatório e HTML de impressão
    ├── pdf-render.js     # rasterização de PDFs para as páginas de anexo
    ├── office.js         # extração de texto de DOCX/XLSX/PPTX (ZIP + XML)
    ├── utils.js          # datas, formatação, categorias de arquivo e utilitários
    └── icons.js          # biblioteca de ícones SVG inline
```

---

## Suporte

Universidade Candido Mendes — Coordenação Acadêmica.
Em caso de dúvidas sobre o fluxo institucional, procure a coordenação responsável pelo ciclo de
consolidação.
