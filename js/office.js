/*
  Leitor leve de documentos OOXML (DOCX, XLSX, PPTX) sem dependências.
  Usa a API nativa DecompressionStream para descompactar as entradas ZIP.
*/

const decoder = new TextDecoder('utf-8');

function readU16(view, offset) { return view.getUint16(offset, true); }
function readU32(view, offset) { return view.getUint32(offset, true); }

function findEndOfCentralDirectory(view) {
  const length = view.byteLength;
  const start = Math.max(0, length - 65557);
  for (let offset = length - 22; offset >= start; offset--) {
    if (readU32(view, offset) === 0x06054b50) return offset;
  }
  return -1;
}

async function unzip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) throw new Error('Arquivo ZIP inválido.');
  const entryCount = readU16(view, eocd + 10);
  let pointer = readU32(view, eocd + 16);
  const entries = new Map();

  for (let i = 0; i < entryCount; i++) {
    if (readU32(view, pointer) !== 0x02014b50) break;
    const method = readU16(view, pointer + 10);
    const compressedSize = readU32(view, pointer + 20);
    const uncompressedSize = readU32(view, pointer + 24);
    const nameLength = readU16(view, pointer + 28);
    const extraLength = readU16(view, pointer + 30);
    const commentLength = readU16(view, pointer + 32);
    const localOffset = readU32(view, pointer + 42);
    const name = decoder.decode(bytes.slice(pointer + 46, pointer + 46 + nameLength)).replace(/\\/g, '/');
    entries.set(name, { method, compressedSize, uncompressedSize, localOffset });
    pointer += 46 + nameLength + extraLength + commentLength;
  }

  return {
    names: [...entries.keys()],
    async getText(name) {
      const entry = entries.get(name);
      if (!entry) return null;
      const local = entry.localOffset;
      if (readU32(view, local) !== 0x04034b50) throw new Error('Cabeçalho ZIP inválido.');
      const nameLength = readU16(view, local + 26);
      const extraLength = readU16(view, local + 28);
      const dataStart = local + 30 + nameLength + extraLength;
      const compressed = bytes.slice(dataStart, dataStart + entry.compressedSize);
      if (entry.method === 0) return decoder.decode(compressed);
      if (entry.method !== 8) throw new Error('Método de compressão não suportado.');
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('Este navegador não suporta a leitura de documentos compactados.');
      }
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const result = await new Response(stream).arrayBuffer();
      return decoder.decode(result);
    }
  };
}

function decodeXmlEntities(text = '') {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripXml(text = '') { return decodeXmlEntities(text.replace(/<[^>]+>/g, '')); }

function xmlParagraphs(xml = '') {
  return xml
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:tc>/g, ' · ')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map(line => decodeXmlEntities(line).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function pptxText(xml = '') {
  const matches = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map(m => decodeXmlEntities(m[1]).trim());
  return matches.filter(Boolean).join(' ');
}

function xlsxSheetText(xml = '', shared = []) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return '';
  const rows = [...doc.getElementsByTagName('row')];
  const lines = [];
  for (const row of rows) {
    const values = [];
    for (const cell of [...row.getElementsByTagName('c')]) {
      const type = cell.getAttribute('t');
      const valueNode = cell.getElementsByTagName('v')[0];
      const inline = cell.getElementsByTagName('t')[0];
      let value = '';
      if (type === 's' && valueNode) value = shared[Number(valueNode.textContent)] || '';
      else if (type === 'inlineStr' && inline) value = inline.textContent;
      else if (valueNode) value = valueNode.textContent;
      if (value) values.push(value.trim());
    }
    if (values.length) lines.push(values.join('\t'));
  }
  return lines.join('\n');
}

function sharedStrings(xml = '') {
  if (!xml) return [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return [];
  return [...doc.getElementsByTagName('si')].map(si => {
    return [...si.getElementsByTagName('t')].map(t => t.textContent || '').join('');
  });
}

export async function extractOfficeText(blob, extension) {
  const ext = String(extension || '').toLowerCase();
  if (!['docx', 'xlsx', 'pptx'].includes(ext)) {
    if (ext === 'doc' || ext === 'xls' || ext === 'ppt') {
      return 'Formato binário legado. Baixe o arquivo para visualizar no aplicativo de origem.';
    }
    return '';
  }
  const buffer = await blob.arrayBuffer();
  const zip = await unzip(buffer);

  if (ext === 'docx') {
    const main = await zip.getText('word/document.xml');
    if (!main) return '';
    const text = xmlParagraphs(main);
    return text.slice(0, 24000);
  }

  if (ext === 'pptx') {
    const slides = zip.names
      .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => Number(a.match(/(\d+)/)?.[1] || 0) - Number(b.match(/(\d+)/)?.[1] || 0));
    const parts = [];
    for (let i = 0; i < slides.length; i++) {
      const xml = await zip.getText(slides[i]);
      const text = pptxText(xml || '');
      if (text) parts.push(`Slide ${i + 1}\n${text}`);
    }
    return parts.join('\n\n').slice(0, 24000);
  }

  if (ext === 'xlsx') {
    const shared = sharedStrings(await zip.getText('xl/sharedStrings.xml'));
    const sheets = zip.names
      .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .sort((a, b) => Number(a.match(/(\d+)/)?.[1] || 0) - Number(b.match(/(\d+)/)?.[1] || 0));
    const parts = [];
    for (let i = 0; i < sheets.length; i++) {
      const xml = await zip.getText(sheets[i]);
      const text = xlsxSheetText(xml || '', shared);
      if (text) parts.push(`Planilha ${i + 1}\n${text}`);
    }
    return parts.join('\n\n').slice(0, 24000);
  }

  return '';
}
