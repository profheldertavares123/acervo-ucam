/**
 * Renderização de PDFs para os anexos do relatório.
 *
 * O relatório é impresso a partir do HTML, então cada página do PDF é
 * rasterizada em alta resolução (JPEG) para ser exibida integralmente em
 * uma página A4 própria. O pdf.js é carregado sob demanda e fica embarcado
 * no projeto (assets/vendor/pdfjs), sem depender de CDN.
 */

const PDFJS_URL = new URL('../assets/vendor/pdfjs/pdf.min.mjs', import.meta.url).href;
const WORKER_URL = new URL('../assets/vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const TARGET_WIDTH = 1680; // ~250 dpi para uma página A4
const MAX_SCALE = 4;
const MAX_PAGES = 120;
const JPEG_QUALITY = 0.86;

const cache = new Map();
const pending = new Map();

let pdfjsPromise = null;

function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDFJS_URL)
      .then((mod) => {
        mod.GlobalWorkerOptions.workerSrc = WORKER_URL;
        return mod;
      })
      .catch((error) => {
        pdfjsPromise = null;
        throw error;
      });
  }
  return pdfjsPromise;
}

function canvasToDataUrl(canvas) {
  const url = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  canvas.width = 0;
  canvas.height = 0;
  return url;
}

async function renderDocument(blob, key) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;

  try {
    const count = Math.min(doc.numPages, MAX_PAGES);
    const pages = [];
    for (let number = 1; number <= count; number += 1) {
      const page = await doc.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(MAX_SCALE, TARGET_WIDTH / base.width);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);

      // intent: 'print' evita o agendamento por requestAnimationFrame (o que
      // também evita travas quando a aba está em segundo plano) e usa o
      // mesmo caminho de renderização empregado na impressão.
      await page.render({ canvasContext: context, viewport, background: '#ffffff', intent: 'print' }).promise;
      pages.push(canvasToDataUrl(canvas));
      page.cleanup();
    }

    return { pages, totalPages: doc.numPages, truncated: doc.numPages > count };
  } finally {
    await doc.destroy();
  }
}

/**
 * Converte um PDF em uma lista de imagens (uma por página).
 * O resultado é cacheado por arquivo para que a prévia do relatório
 * possa ser reconstruída sem rasterizar tudo novamente.
 *
 * @param {Blob} blob
 * @param {string} key identifica o arquivo (id + tamanho + data)
 * @returns {Promise<{ pages: string[], totalPages: number, truncated: boolean }>}
 */
export function renderPdfPages(blob, key) {
  if (key && cache.has(key)) return Promise.resolve(cache.get(key));
  if (key && pending.has(key)) return pending.get(key);

  const job = renderDocument(blob, key)
    .then((result) => {
      if (key) cache.set(key, result);
      return result;
    })
    .finally(() => {
      if (key) pending.delete(key);
    });

  if (key) pending.set(key, job);
  return job;
}

/** Libera as imagens em cache (chamado ao trocar de acervo). */
export function clearPdfCache() {
  cache.clear();
  pending.clear();
}
