import {
  escapeHtml,
  formatDate,
  timeLabel,
  formatDuration,
  eventDuration,
  eventDocStats,
  getEventSigners,
  getSignature,
  initials,
  monthKey,
  reportPeriodLabel,
  typeMeta,
  verificationCode,
  blobToDataURL,
  isTiff,
  extname,
  formatBytes,
  sortSigners,
  chunk,
  formatDate as fd,
  structureLabel
} from './utils.js';
import { getFileBlob } from './store.js';
import { renderPdfPages } from './pdf-render.js';
import { extractOfficeText } from './office.js';

function header(settings) {
  return `<div class="report-page__top">
    <img src="assets/ucam-logo.png" alt="Universidade Candido Mendes">
    <div class="report-page__top-meta">
      <strong>Acervo UCM</strong>
      Consolidação de atividades acadêmicas<br>
      ${escapeHtml(settings.institution)}
    </div>
  </div>`;
}

function page(body, pageClass = '') {
  return `<section class="report-page ${pageClass}">${body}</section>`;
}

async function collectImages(events) {
  const results = new Map();
  const jobs = [];
  for (const event of events) {
    for (const attachment of event.attachments || []) {
      if (attachment.kind !== 'image') continue;
      jobs.push((async () => {
        try {
          const blob = await getFileBlob(attachment.id);
          if (!blob || isTiff(attachment.name, attachment.type)) {
            results.set(attachment.id, null);
            return;
          }
          if (!blob.type.startsWith('image/')) {
            results.set(attachment.id, null);
            return;
          }
          results.set(attachment.id, await blobToDataURL(blob));
        } catch {
          results.set(attachment.id, null);
        }
      })());
    }
  }
  await Promise.all(jobs);
  return results;
}

function imageFigure(attachment, dataUrl, caption = '') {
  return `<figure class="report-proof">
    ${dataUrl ? `<img src="${escapeHtml(dataUrl)}" alt="${escapeHtml(caption || attachment.name)}">` : `<div class="report-proof__fallback">Imagem indisponível para pré-visualização</div>`}
    <figcaption class="report-proof__caption">${escapeHtml(caption || attachment.name)}</figcaption>
  </figure>`;
}

const SUMMARY_FIRST_ROWS = 7;
const SUMMARY_PAGE_ROWS = 11;

function summaryRows(events) {
  return events.map(event => {
    const { docsCount } = eventDocStats(event);
    return `<tr>
      <td class="col-date">${formatDate(event.date, 'numeric')}</td>
      <td class="col-time">${timeLabel(event.start)}–${timeLabel(event.end)}</td>
      <td><strong>${escapeHtml(event.title)}</strong><br><span style="color:#927d75">${escapeHtml(event.location || '')}</span></td>
      <td class="col-type">${escapeHtml(typeMeta(event.type).label)}</td>
      <td>${escapeHtml((event.courses || []).join(', ') || '—')}</td>
      <td>${docsCount}</td>
    </tr>`;
  });
}

function summaryTable(rows) {
  return `<table class="report-table">
    <thead><tr><th scope="col" class="col-date">Data</th><th scope="col" class="col-time">Horário</th><th scope="col">Atividade / local</th><th scope="col" class="col-type">Natureza</th><th scope="col">Cursos</th><th scope="col">Docs.</th></tr></thead>
    <tbody>${rows.join('') || '<tr><td colspan="6">Nenhuma atividade no período.</td></tr>'}</tbody>
  </table>`;
}

function summaryKpis({ events, hours, docCount, imageCount }) {
  return `<div class="report-summary">
    <div class="report-kpi"><strong>${events.length}</strong><span>Atividades</span></div>
    <div class="report-kpi"><strong>${hours}</strong><span>Horas</span></div>
    <div class="report-kpi"><strong>${docCount}</strong><span>Documentos</span></div>
    <div class="report-kpi"><strong>${imageCount}</strong><span>Registros de imagem</span></div>
  </div>`;
}

function summaryIntro(config) {
  return `<div class="report-note">${escapeHtml(config.intro || 'Este relatório reúne as atividades acadêmicas realizadas no período de referência, com a respectiva documentação de suporte e as instâncias de validação institucional.')}</div>`;
}

function coverPage({ events, settings, config, code, imageCount, docCount, hours, rows = [], totalRows = 0 }) {
  const courses = [...new Set(events.flatMap(e => e.courses || []))];
  const period = config.periodLabel || reportPeriodLabel(events);
  const coverUnit = settings.unit || events.find(e => e.baseUnit)?.baseUnit || '—';
  const coverDirector = settings.director?.name || events.find(e => e.director?.name)?.director.name || 'A designar';
  const showSummary = Boolean(config.includeSummary && rows.length);
  return page(`
    <div class="report-cover${showSummary ? ' report-cover--overview' : ''}">
      <div class="report-page__top">
        <img src="assets/ucam-logo.png" alt="Universidade Candido Mendes">
        <div class="report-page__top-meta">
          <strong>Relatório institucional</strong>
          Emitido em ${formatDate(new Date().toISOString().slice(0, 10), 'short')}<br>
          ${escapeHtml(code)}
        </div>
      </div>
      <div class="report-cover__mark">Núcleo de Registros Acadêmicos</div>
      <h1>${escapeHtml(config.title || 'Relatório Consolidado de Atividades Acadêmicas')}</h1>
      <p class="report-cover__sub">${escapeHtml(config.subtitle || 'Aulas práticas, projetos de prática de extensão e visitas programadas a instituições conveniadas.')}</p>
      <div class="report-cover__rule"></div>
      <div class="report-cover__meta">
        <div><div class="report-cover__meta-label">Unidade base</div><div class="report-cover__meta-value">${escapeHtml(coverUnit)}</div></div>
        <div><div class="report-cover__meta-label">Período de referência</div><div class="report-cover__meta-value">${escapeHtml(period)}</div></div>
        <div><div class="report-cover__meta-label">Cursos envolvidos</div><div class="report-cover__meta-value">${escapeHtml(courses.join(' · ') || '—')}</div></div>
        <div><div class="report-cover__meta-label">Direção da unidade</div><div class="report-cover__meta-value">${escapeHtml(coverDirector)}</div></div>
      </div>
      ${showSummary ? `
        ${summaryKpis({ events, hours, docCount, imageCount })}
        ${summaryIntro(config)}
        <div class="report-section-label">Panorama das atividades</div>
        ${summaryTable(rows)}
        ${totalRows > rows.length ? `<div class="report-note report-note--continuation">Continua na próxima página · atividades ${rows.length + 1} a ${Math.min(totalRows, rows.length + SUMMARY_PAGE_ROWS)} de ${totalRows}.</div>` : ''}
      ` : `
        <div class="report-cover__stats">
          <div class="report-cover__stat"><strong>${events.length}</strong><span>Atividades</span></div>
          <div class="report-cover__stat"><strong>${hours}</strong><span>Horas registradas</span></div>
          <div class="report-cover__stat"><strong>${docCount + imageCount}</strong><span>Comprovações</span></div>
        </div>
      `}
      <div class="report-cover__seal">
        <img src="assets/ucam-logo.png" alt="">
        <div><strong>Universidade Candido Mendes</strong>${escapeHtml(settings.institution)}<br>Documento consolidado para fins de registro e comprovação acadêmica.</div>
      </div>
    </div>
  `, 'report-cover-page');
}

function summaryPages({ events, settings, config, rows, docCount, imageCount, hours }) {
  if (!rows.length) return [];
  const chunks = chunk(rows, SUMMARY_PAGE_ROWS);
  return chunks.map((chunkRows, index) => page(`
    ${header(settings)}
    <div class="report-title">
      <div class="report-title__eyebrow">Seção 01${index ? ' · continuação' : ''}</div>
      <h2>Panorama das atividades</h2>
      <p>${index === 0 ? escapeHtml(config.periodLabel || reportPeriodLabel(events)) : `Atividades ${index * SUMMARY_PAGE_ROWS + 1} a ${Math.min(events.length, (index + 1) * SUMMARY_PAGE_ROWS)} de ${events.length}`}</p>
    </div>
    ${index === 0 ? `${summaryKpis({ events, hours, docCount, imageCount })}${summaryIntro(config)}` : ''}
    <div class="report-section-label">Relação consolidada</div>
    ${summaryTable(chunkRows)}
  `));
}

function summaryContinuationPages({ events, settings, rows, offset }) {
  if (!rows.length) return [];
  return chunk(rows, SUMMARY_PAGE_ROWS).map((chunkRows, index) => page(`
    ${header(settings)}
    <div class="report-title">
      <div class="report-title__eyebrow">Seção 01 · continuação</div>
      <h2>Panorama das atividades</h2>
      <p>Atividades ${offset + index * SUMMARY_PAGE_ROWS + 1} a ${offset + index * SUMMARY_PAGE_ROWS + chunkRows.length} de ${events.length}</p>
    </div>
    <div class="report-section-label">Relação consolidada</div>
    ${summaryTable(chunkRows)}
  `));
}

function eventPage({ event, index, settings, config, code, images }) {
  const meta = typeMeta(event.type);
  const { docs, images: imageAttachments, docsCount, imagesCount } = eventDocStats(event);
  const signers = getEventSigners(event);
  const shownImages = imageAttachments.slice(0, 4);
  const coordinator = (event.coordinators || []).map(c => `${c.name}${c.course ? ` (${c.course})` : ''}`).join(' · ');
  const professors = (event.professors || []).map(p => p.name).filter(Boolean).join(' · ');
  const students = (event.students || []).filter(Boolean);
  const status = signers.every(s => getSignature(event, s.key)?.status === 'assinado') && signers.length > 0 ? 'Assinaturas concluídas' : `${signers.filter(s => getSignature(event, s.key)?.status === 'assinado').length} de ${signers.length} assinaturas`;

  return page(`
    ${header(settings)}
    <div class="report-event-head">
      <div class="report-event-number">${String(index + 1).padStart(2, '0')}</div>
      <div class="report-event-head__body">
        <div class="report-event-head__type">${escapeHtml(meta.label)} · ${escapeHtml(formatDate(event.date, 'full'))}</div>
        <h2>${escapeHtml(event.title)}</h2>
        <div class="report-event-head__meta">
          <span>${timeLabel(event.start)}–${timeLabel(event.end)} · ${formatDuration(eventDuration(event), true)}</span>
          <span>${escapeHtml(event.location || 'Local não informado')}</span>
        </div>
      </div>
      <div class="report-event-head__badge">${escapeHtml(status)}</div>
    </div>

    <div class="report-detail-grid">
      <div class="report-detail-cell"><div class="report-detail-cell__label">Unidade base de elaboração</div><div class="report-detail-cell__value">${escapeHtml(event.baseUnit || '—')}</div></div>
      <div class="report-detail-cell"><div class="report-detail-cell__label">Curso(s) envolvido(s)</div><div class="report-detail-cell__value">${escapeHtml((event.courses || []).join(' · ') || '—')}</div></div>
      <div class="report-detail-cell"><div class="report-detail-cell__label">Disciplina</div><div class="report-detail-cell__value">${escapeHtml(event.discipline || '—')}</div></div>
      <div class="report-detail-cell"><div class="report-detail-cell__label">Estrutura da aula</div><div class="report-detail-cell__value">${escapeHtml(structureLabel(event.structure))}</div></div>
      <div class="report-detail-cell"><div class="report-detail-cell__label">Professor(es) responsável(is)</div><div class="report-detail-cell__value">${escapeHtml(professors || '—')}</div></div>
      <div class="report-detail-cell"><div class="report-detail-cell__label">Coordenação de curso</div><div class="report-detail-cell__value">${escapeHtml(coordinator || '—')}</div></div>
      <div class="report-detail-cell report-detail-cell--wide"><div class="report-detail-cell__label">Local do evento</div><div class="report-detail-cell__value">${escapeHtml(event.location || '—')}</div></div>
      <div class="report-detail-cell report-detail-cell--wide"><div class="report-detail-cell__label">Alunos participantes${students.length ? ` (${students.length})` : ''}</div><div class="report-detail-cell__value">${escapeHtml(students.join(' · ') || '—')}</div></div>
    </div>

    <div class="report-h3">Síntese da atividade</div>
    <div class="report-description">${escapeHtml((event.description || 'Sem descrição registrada.').slice(0, 1800))}</div>

    ${config.includeImages && imagesCount ? `
      <div class="report-h3">Comprovação por imagem</div>
      <div class="report-proof-grid">
        ${shownImages.map((attachment, i) => imageFigure(attachment, images.get(attachment.id), `Registro ${String(i + 1).padStart(2, '0')} · ${attachment.name}`)).join('')}
      </div>
    ` : ''}

    ${config.includeDocs ? `
      <div class="report-h3">Documentos digitalizados</div>
      ${docsCount ? `<div class="report-docs">${docs.map(doc => `<div class="report-doc"><span class="report-doc__name">${escapeHtml(doc.name)}</span><span class="report-doc__ref" data-doc-ref="${escapeHtml(doc.id)}"></span></div>`).join('')}</div>` : `<div class="report-note">Nenhum documento digitalizado anexado a esta atividade.</div>`}
    ` : ''}

    ${config.includeSignatures ? `
      <div class="report-h3">Responsáveis pela atividade</div>
      <div class="report-note">
        ${signers.map(s => {
          const sig = getSignature(event, s.key);
          return `${escapeHtml(s.name)} — ${escapeHtml(s.role)}${s.course ? ` · ${escapeHtml(s.course)}` : ''} ${sig?.status === 'assinado' ? '· assinatura gov.br registrada' : '· assinatura pendente'}`;
        }).join('<br>') || 'Signatários não informados.'}
      </div>
    ` : ''}
  `);
}

function annexPages({ events, settings, code, images, extraImages }) {
  if (!extraImages.length) return [];
  const pages = [];
  for (let i = 0; i < extraImages.length; i += 4) {
    const items = extraImages.slice(i, i + 4);
    pages.push(page(`
      ${header(settings)}
      <div class="report-title">
        <div class="report-title__eyebrow">Anexos · continuação</div>
        <h2>Comprovação por imagem</h2>
        <p>Registros adicionais das atividades, na mesma seção apresentada nas fichas.</p>
      </div>
      <div class="report-anexo-grid">
        ${items.map(item => `
          <figure class="report-anexo">
            ${images.get(item.attachment.id) ? `<img src="${escapeHtml(images.get(item.attachment.id))}" alt="${escapeHtml(item.attachment.name)}">` : '<div class="report-anexo__fallback">Imagem indisponível</div>'}
            <figcaption class="report-anexo__caption">${escapeHtml(item.event.title)} · ${escapeHtml(item.attachment.name)}</figcaption>
          </figure>
        `).join('')}
      </div>
    `));
  }
  return pages;
}

/* ---------- Documentos de comprovação em páginas exclusivas ---------- */

const DOC_TEXT_LINE_WIDTH = 96;
const DOC_TEXT_PAGE_LINES = 54;
const DOC_RENDER_CONCURRENCY = 2;

function paginateText(text) {
  const source = String(text || '').replace(/\r\n?/g, '\n');
  const lines = [];
  for (const raw of source.split('\n')) {
    const line = raw.replace(/\t/g, '    ');
    if (line.length <= DOC_TEXT_LINE_WIDTH) {
      lines.push(line);
      continue;
    }
    for (let i = 0; i < line.length; i += DOC_TEXT_LINE_WIDTH) lines.push(line.slice(i, i + DOC_TEXT_LINE_WIDTH));
  }
  if (!lines.length) return ['(Não foi possível extrair texto deste documento.)'];
  const pages = [];
  for (let i = 0; i < lines.length; i += DOC_TEXT_PAGE_LINES) pages.push(lines.slice(i, i + DOC_TEXT_PAGE_LINES).join('\n'));
  return pages;
}

async function mapLimit(items, limit, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function collectDocuments(events) {
  const docs = new Map();
  const jobs = [];
  for (const event of events) {
    for (const attachment of event.attachments || []) {
      if (attachment.kind === 'document') jobs.push({ event, attachment });
    }
  }
  await mapLimit(jobs, DOC_RENDER_CONCURRENCY, async ({ event, attachment }) => {
    try {
      const blob = await getFileBlob(attachment.id);
      if (!blob) return;
      const ext = (extname(attachment.name || '') || '').toLowerCase();
      if (ext === 'pdf' || blob.type === 'application/pdf') {
        const rendered = await renderPdfPages(blob, `${attachment.id}:${blob.size}:${blob.lastModified || 0}`);
        docs.set(attachment.id, {
          attachment, event, kind: 'pdf',
          pages: rendered.pages, totalPages: rendered.totalPages, truncated: rendered.truncated
        });
        return;
      }
      if (blob.type.startsWith('image/') && !isTiff(attachment.name, attachment.type)) {
        docs.set(attachment.id, { attachment, event, kind: 'image', pages: [await blobToDataURL(blob)] });
        return;
      }
      if (['docx', 'xlsx', 'pptx'].includes(ext)) {
        const text = await extractOfficeText(blob, ext);
        docs.set(attachment.id, { attachment, event, kind: 'text', ext, pages: paginateText(text) });
      }
    } catch (error) {
      console.warn('Não foi possível preparar o anexo do documento:', attachment.name, error);
    }
  });
  return docs;
}

function documentAnnexPages({ events, settings, docs }) {
  const pages = [];
  if (!docs.size) return pages;
  const eventNumber = new Map(events.map((event, index) => [event.id, index + 1]));

  for (const event of events) {
    const attachments = (event.attachments || []).filter(attachment => attachment.kind === 'document' && docs.has(attachment.id));
    for (const attachment of attachments) {
      const item = docs.get(attachment.id);
      const total = item.pages.length;
      item.pages.forEach((source, index) => {
        const isText = item.kind === 'text';
        const pageLabel = total > 1
          ? `Página ${index + 1} de ${total}`
          : (item.kind === 'pdf' ? 'Página 1 de 1' : 'Documento digitalizado');
        const extension = (extname(attachment.name || '') || 'arquivo').toUpperCase();
        pages.push(`<section class="report-page report-doc-page" data-doc-annex="${escapeHtml(attachment.id)}">
          ${header(settings)}
          <div class="report-doc-head">
            <div class="report-doc-eyebrow">Anexo · documento de comprovação</div>
            <h2 class="report-doc-title">${escapeHtml(attachment.name)}</h2>
            <div class="report-doc-meta">
              <span><strong>Atividade ${String(eventNumber.get(event.id)).padStart(2, '0')}</strong> · ${escapeHtml(event.title)}</span>
              <span>${escapeHtml(formatDate(event.date, 'short'))} · ${escapeHtml(extension)} · ${formatBytes(attachment.size || 0)}</span>
              <span>${escapeHtml(pageLabel)}</span>
            </div>
          </div>
          ${isText
            ? `<pre class="report-doc-text">${escapeHtml(source)}</pre>
               <div class="report-doc-note">Prévia textual do arquivo anexado. O documento original permanece disponível na ficha da atividade.</div>`
            : `<div class="report-doc-canvas"><img src="${escapeHtml(source)}" alt="${escapeHtml(`${attachment.name} — página ${index + 1}`)}"></div>
               ${item.truncated && index === total - 1 ? `<div class="report-doc-note">Documento com ${item.totalPages} páginas; exibidas as primeiras ${total}. O arquivo original permanece disponível na ficha da atividade.</div>` : ''}`}
        </section>`);
      });
    }
  }
  return pages;
}

function signaturePages({ events, settings, code }) {
  const allRows = [];
  for (const event of events) {
    for (const signer of getEventSigners(event)) {
      allRows.push({ event, signer, signature: getSignature(event, signer.key) });
    }
  }

  const seen = new Set();
  const unique = [];
  for (const row of sortSigners(allRows)) {
    const key = `${row.signer.kind}:${row.signer.name.toLowerCase()}:${row.signer.course || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }

  if (!unique.length) {
    return [page(`
      ${header(settings)}
      <div class="report-title">
        <div class="report-title__eyebrow">Validação institucional</div>
        <h2>Folha de assinaturas</h2>
        <p>Ciência e validação das atividades consolidadas.</p>
      </div>
      <div class="report-empty-page">
        <strong>Nenhum signatário informado</strong>
        <span>Cadastre professores responsáveis, coordenadores de curso e a direção da unidade para compor a folha de validação.</span>
      </div>
    `)];
  }

  const columns = unique.length > 18 ? 4 : unique.length > 12 ? 3 : 2;
  const compact = unique.length > 8;

  return [page(`
    ${header(settings)}
    <div class="report-title">
      <div class="report-title__eyebrow">Validação institucional</div>
      <h2>Folha de assinaturas</h2>
      <p>${escapeHtml(reportPeriodLabel(events))} · ${unique.length} ${unique.length === 1 ? 'signatário' : 'signatários'} · assinatura eletrônica vinculada à Assinatura Eletrônica gov.br</p>
    </div>
    <div class="report-signature-grid${compact ? ' report-signature-grid--compact' : ''}" style="grid-template-columns:repeat(${columns},minmax(0,1fr))">
      ${unique.map(row => {
        const signed = row.signature?.status === 'assinado';
        return `<div class="report-signature">
          <div class="report-signature__line"></div>
          ${signed ? '<div class="report-signature__seal">✓</div>' : ''}
          <div class="report-signature__name">${escapeHtml(row.signer.name)}</div>
          <div class="report-signature__role">${escapeHtml(row.signer.role)}${row.signer.course ? ` · ${escapeHtml(row.signer.course)}` : ''}</div>
          <div class="report-signature__gov">${signed ? 'Assinatura gov.br registrada' : 'Assinatura gov.br pendente'}</div>
          <div class="report-signature__hash">${signed ? escapeHtml(row.signature.code || '') : 'Aguardando assinatura'}</div>
        </div>`;
      }).join('')}
    </div>
    <div class="report-verification">
      <div class="report-qr">${verificationSeal()}</div>
      <div class="report-verification__body">
        <strong>Documento vinculado à Assinatura Eletrônica gov.br</strong>
        <span>As assinaturas devem ser concluídas no serviço oficial. O código abaixo identifica esta consolidação no Acervo UCM.</span>
        <div class="report-verification__code">${escapeHtml(code)}</div>
        <div class="report-verification__url">Serviço oficial: <a href="https://www.gov.br/governodigital/pt-br/identidade/assinatura-eletronica" target="_blank" rel="noopener">www.gov.br/governodigital/pt-br/identidade/assinatura-eletronica</a></div>
      </div>
    </div>
  `, 'report-signature-page')];
}

function verificationSeal() {
  return `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Selo de verificação">
    <rect width="80" height="80" fill="#fff"/>
    <rect x="6" y="6" width="16" height="16" fill="#6b1624"/>
    <rect x="9" y="9" width="10" height="10" fill="#fff"/>
    <rect x="58" y="6" width="16" height="16" fill="#6b1624"/>
    <rect x="61" y="9" width="10" height="10" fill="#fff"/>
    <rect x="6" y="58" width="16" height="16" fill="#6b1624"/>
    <rect x="9" y="61" width="10" height="10" fill="#fff"/>
    <rect x="30" y="6" width="5" height="5" fill="#6b1624"/><rect x="40" y="6" width="5" height="5" fill="#6b1624"/>
    <rect x="30" y="16" width="5" height="5" fill="#6b1624"/><rect x="45" y="16" width="5" height="5" fill="#6b1624"/>
    <rect x="30" y="30" width="5" height="5" fill="#6b1624"/><rect x="40" y="30" width="5" height="5" fill="#6b1624"/><rect x="50" y="30" width="5" height="5" fill="#6b1624"/>
    <rect x="6" y="30" width="5" height="5" fill="#6b1624"/><rect x="16" y="30" width="5" height="5" fill="#6b1624"/>
    <rect x="6" y="42" width="5" height="5" fill="#6b1624"/><rect x="16" y="42" width="5" height="5" fill="#6b1624"/>
    <rect x="60" y="32" width="5" height="5" fill="#6b1624"/><rect x="69" y="32" width="5" height="5" fill="#6b1624"/>
    <rect x="60" y="45" width="5" height="5" fill="#6b1624"/><rect x="69" y="45" width="5" height="5" fill="#6b1624"/>
    <rect x="30" y="60" width="5" height="5" fill="#6b1624"/><rect x="45" y="60" width="5" height="5" fill="#6b1624"/>
    <rect x="60" y="60" width="14" height="14" fill="none" stroke="#6b1624" stroke-width="3"/>
    <rect x="64" y="64" width="6" height="6" fill="#6b1624"/>
    <circle cx="40" cy="40" r="10" fill="#6b1624"/>
    <path d="M36 40l3 3 6-6" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

export async function buildReport({ events, settings, config }) {
  const selected = [...events].sort((a, b) => `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`));
  const images = await collectImages(selected);
  const docCount = selected.reduce((sum, e) => sum + eventDocStats(e).docsCount, 0);
  const imageCount = selected.reduce((sum, e) => sum + eventDocStats(e).imagesCount, 0);
  const hours = selected.reduce((sum, e) => sum + eventDuration(e), 0);
  const code = verificationCode(selected.map(e => `${e.id}${e.updatedAt}`).join('|') + config.title);
  const includeDocPages = config.includeDocPages !== false;
  const documents = includeDocPages ? await collectDocuments(selected) : new Map();
  const rows = summaryRows(selected);

  const pages = [];
  if (config.includeCover) {
    const coverRows = config.includeSummary ? rows.slice(0, SUMMARY_FIRST_ROWS) : [];
    pages.push(coverPage({ events: selected, settings, config, code, imageCount, docCount, hours: formatDuration(hours, true), rows: coverRows, totalRows: rows.length }));
  }
  if (config.includeSummary) {
    if (config.includeCover) {
      pages.push(...summaryContinuationPages({ events: selected, settings, rows: rows.slice(SUMMARY_FIRST_ROWS), offset: SUMMARY_FIRST_ROWS }));
    } else {
      pages.push(...summaryPages({ events: selected, settings, config, rows, docCount, imageCount, hours: formatDuration(hours, true) }));
    }
  }
  selected.forEach((event, index) => {
    pages.push(eventPage({ event, index, settings, config, code, images }));
  });
  if (config.includeImages) {
    const extraImages = [];
    selected.forEach(event => {
      const imgs = (event.attachments || []).filter(a => a.kind === 'image');
      imgs.slice(4).forEach(attachment => extraImages.push({ event, attachment }));
    });
    pages.push(...annexPages({ events: selected, settings, code, images, extraImages }));
  }
  const annexStart = pages.length;
  if (includeDocPages) pages.push(...documentAnnexPages({ events: selected, settings, docs: documents }));
  const docPages = pages.length - annexStart;
  if (config.includeSignatures) pages.push(...signaturePages({ events: selected, settings, code }));

  if (!pages.length) {
    pages.push(page(`
      ${header(settings)}
      <div class="report-empty-page">
        <strong>Selecione ao menos uma atividade</strong>
        <span>O relatório consolidado será montado automaticamente com as fichas, comprovações e assinaturas das atividades selecionadas.</span>
      </div>
    `));
  }

  // Numeração dos anexos: liga cada documento ao intervalo de páginas em que aparece.
  let resolvedPages = pages;
  if (includeDocPages) {
    const annexRanges = new Map();
    pages.forEach((html, index) => {
      const finder = /data-doc-annex="([^"]+)"/g;
      let match;
      while ((match = finder.exec(html))) {
        const id = match[1];
        const range = annexRanges.get(id);
        if (range) range.end = index + 1;
        else annexRanges.set(id, { start: index + 1, end: index + 1 });
      }
    });
    resolvedPages = pages.map(html => html.replace(
      /<span class="report-doc__ref" data-doc-ref="([^"]*)"><\/span>/g,
      (full, id) => {
        const range = annexRanges.get(id);
        if (!range) return '<span class="report-doc__ref">sem prévia</span>';
        return `<span class="report-doc__ref">p. ${range.start}${range.end > range.start ? `–${range.end}` : ''}</span>`;
      }
    ));
  }

  const total = resolvedPages.length;
  const numberedPages = resolvedPages.map((html, index) => {
    const pageNumber = index + 1;
    const foot = `<div class="report-page__foot">
      <span>${escapeHtml(settings.institution)} · <strong>Acervo UCM</strong></span>
      <span>${escapeHtml(code)} · Página ${pageNumber} de ${total}</span>
    </div>`;
    return html.replace('</section>', `${foot}\n</section>`);
  });

  return {
    pages: numberedPages,
    html: numberedPages.join('\n'),
    code,
    meta: { count: selected.length, docCount, imageCount, docPages, hours, totalPages: total }
  };
}

export async function renderReportInto(element, options) {
  const result = await buildReport(options);
  element.innerHTML = result.pages.map((html, i) => `
    <div class="preview-page-wrap" style="--preview-scale: .68">
      ${html}
      <div class="preview-page-number">Página ${i + 1} de ${result.meta.totalPages}</div>
    </div>
  `).join('');
  return result;
}
