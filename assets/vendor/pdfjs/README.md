# pdf.js (build local)

- Versão: **4.10.38** (legacy build, ES modules)
- Origem: `pdfjs-dist@4.10.38/legacy/build/`
  - `pdf.min.mjs`
  - `pdf.worker.min.mjs`
- Licença: Apache 2.0 (o aviso completo está no cabeçalho de `pdf.min.mjs`).

O build é embarcado para que os anexos em PDF do relatório possam ser rasterizados sem acesso à
internet. Os arquivos são carregados sob demanda por `js/pdf-render.js`.
