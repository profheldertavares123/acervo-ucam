import { icon } from './icons.js';
import {
  $, $$, escapeHtml, uid, formatDate, timeLabel, formatDuration, eventDuration,
  eventDocStats, getEventSigners, getSignature, initials, monthKey, currentMonthKey,
  monthLabelFromKey, todayISO, typeMeta, EVENT_TYPES, sortEvents, sortSigners,
  allSigners, eventStatus, signatureStats, plural, fileCategory, fileTypeLabel,
  formatBytes, extname, isTiff, titleFromFilename, MAX_FILE_SIZE, downloadBlob,
  blobToDataURL, verificationCode, maskCpf, cpfLastDigits, relTime, reportPeriodLabel,
  firstName, debounce, groupBy, chunk, safeJSONParse, isUpcoming,
  CLASS_STRUCTURES, structureLabel, parseStudents
} from './utils.js';
import {
  initializeStore, saveEvent, deleteEvent, saveSettings as persistSettings,
  putFile, getFileBlob, deleteFiles, clearDemoEvents, clearAllEvents, loadEvents,
  DEFAULT_SETTINGS, createBlankEvent
} from './store.js';
import { buildReport } from './report.js';
import { extractOfficeText } from './office.js';

const appRoot = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const toastRoot = document.getElementById('toast-root');
const printRoot = document.getElementById('print-root');

const SIGNATURE_URL = 'https://www.gov.br/governodigital/pt-br/identidade/assinatura-eletronica';
const SIGNATURE_API_DOCS = 'https://manual-integracao-assinatura-eletronica.servicos.gov.br/';

const ROUTES = {
  painel: { title: 'Visão geral', crumb: 'Painel', icon: 'dashboard' },
  eventos: { title: 'Atividades acadêmicas', crumb: 'Eventos', icon: 'calendar' },
  consolidacao: { title: 'Consolidação', crumb: 'Relatório', icon: 'file-text' },
  assinaturas: { title: 'Assinaturas', crumb: 'Validação', icon: 'signature' },
  configuracoes: { title: 'Configurações', crumb: 'Sistema', icon: 'settings' }
};

const REPORT_DEFAULTS = {
  title: 'Relatório Consolidado de Atividades Acadêmicas',
  subtitle: 'Aulas práticas, projetos de prática de extensão e visitas programadas a instituições conveniadas.',
  intro: 'Este relatório reúne as atividades acadêmicas realizadas no período de referência, com a respectiva documentação de suporte e as instâncias de validação institucional.',
  includeCover: true,
  includeSummary: true,
  includeImages: true,
  includeDocs: true,
  includeDocPages: true,
  includeSignatures: true,
  selectedIds: null
};

const state = {
  events: [],
  settings: structuredClone(DEFAULT_SETTINGS),
  demoSeeded: false,
  route: 'painel',
  filters: { q: '', type: 'all', unit: 'all', status: 'all', view: 'grid' },
  reportConfig: loadReportConfig(),
  modal: null,
  objectUrls: [],
  signatureFilter: 'all',
  previewToken: 0,
  initialized: false
};

let activeModal = null;
let searchTimer = null;

function loadReportConfig() {
  try {
    const stored = JSON.parse(localStorage.getItem('acervo-ucam-report') || 'null');
    if (stored && typeof stored === 'object') return { ...REPORT_DEFAULTS, ...stored };
  } catch { /* ignore */ }
  return structuredClone(REPORT_DEFAULTS);
}

function persistReportConfig() {
  try {
    const { selectedIds, ...rest } = state.reportConfig;
    localStorage.setItem('acervo-ucam-report', JSON.stringify({ ...rest, selectedIds }));
  } catch { /* ignore */ }
}

function trackUrl(url) {
  if (url) state.objectUrls.push(url);
  return url;
}

function revokeTrackedUrls() {
  state.objectUrls.forEach(url => {
    try { URL.revokeObjectURL(url); } catch { /* noop */ }
  });
  state.objectUrls = [];
}

function findEvent(id) { return state.events.find(event => event.id === id); }

function updateEventInState(event) {
  const idx = state.events.findIndex(e => e.id === event.id);
  if (idx >= 0) state.events[idx] = event; else state.events.unshift(event);
  state.events.sort((a, b) => `${b.date}T${b.start}`.localeCompare(`${a.date}T${a.start}`));
}

function pendingSigners(events = state.events) {
  return allSigners(events).filter(row => row.signature?.status !== 'assinado');
}

function pendingCount() { return pendingSigners().length; }

function selectedReportEvents() {
  const ids = state.reportConfig.selectedIds;
  if (!Array.isArray(ids) || !ids.length) return [];
  return state.events.filter(event => ids.includes(event.id));
}

function ensureReportSelection() {
  const ids = state.reportConfig.selectedIds;
  if (!Array.isArray(ids)) {
    state.reportConfig.selectedIds = state.events.map(e => e.id);
    return;
  }
  const valid = ids.filter(id => state.events.some(e => e.id === id));
  state.reportConfig.selectedIds = valid;
}

/* ============================================================
   Toasts, modals, confirmations
   ============================================================ */
function toast(title, message = '', type = 'success', duration = 4200) {
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  const iconName = type === 'error' ? 'alert-circle' : type === 'info' ? 'info' : 'check-circle';
  el.innerHTML = `
    <div class="toast__icon">${icon(iconName)}</div>
    <div class="toast__body">
      <div class="toast__title">${escapeHtml(title)}</div>
      ${message ? `<div class="toast__message">${escapeHtml(message)}</div>` : ''}
    </div>
    <button class="icon-btn toast__close" type="button" aria-label="Fechar aviso">${icon('x', 'icon icon--sm')}</button>
  `;
  toastRoot.appendChild(el);
  const remove = () => {
    if (!el.isConnected) return;
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 210);
  };
  el.querySelector('.toast__close').addEventListener('click', remove);
  if (duration) setTimeout(remove, duration);
}

function modalMarkup({ title, subtitle = '', body = '', footer = '', size = '', drawer = false, headExtra = '', bodyClass = '' }) {
  return `
    <div class="modal ${size ? `modal--${size}` : ''} ${drawer ? 'drawer' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal__head">
        <div>
          <h2 id="modal-title">${title}</h2>
          ${subtitle ? `<p>${subtitle}</p>` : ''}
        </div>
        ${headExtra}
        <button class="icon-btn" type="button" data-close-modal aria-label="Fechar">${icon('x')}</button>
      </div>
      <div class="modal__body ${bodyClass}">${body}</div>
      ${footer ? `<div class="modal__foot">${footer}</div>` : ''}
    </div>
  `;
}

function openModal({ content, drawer = false, onMount, onClose, closeOnBackdrop = true }) {
  closeModal();
  const backdrop = document.createElement('div');
  backdrop.className = `modal-backdrop ${drawer ? 'modal-backdrop--drawer' : ''}`;
  backdrop.innerHTML = content;
  modalRoot.appendChild(backdrop);
  document.body.classList.add('is-locked');
  activeModal = { backdrop, onClose };
  if (closeOnBackdrop) {
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) closeModal();
    });
  }
  backdrop.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-modal]')) closeModal();
  });
  onMount?.(backdrop);
  setTimeout(() => {
    const focusTarget = backdrop.querySelector('[autofocus], input:not([type="hidden"]), select, textarea, button');
    focusTarget?.focus?.();
  }, 50);
  return activeModal;
}

function closeModal() {
  if (!activeModal) return;
  try { activeModal.onClose?.(); } catch { /* noop */ }
  activeModal.backdrop.remove();
  activeModal = null;
  document.body.classList.remove('is-locked');
}

function confirmAction({ title, message, confirmLabel = 'Confirmar', tone = 'danger', onConfirm }) {
  const footer = `
    <div class="spacer"></div>
    <button class="btn btn--secondary" type="button" data-close-modal>Cancelar</button>
    <button class="btn ${tone === 'danger' ? 'btn--primary' : 'btn--primary'}" type="button" id="confirm-action">${escapeHtml(confirmLabel)}</button>
  `;
  const body = `<div class="detail-footer-note" style="margin:0">${icon('alert-triangle')}<span>${message}</span></div>`;
  openModal({
    content: modalMarkup({ title, subtitle: 'Esta ação requer confirmação.', body, footer, size: 'sm' }),
    onMount: (root) => {
      root.querySelector('#confirm-action').addEventListener('click', async () => {
        const button = root.querySelector('#confirm-action');
        button.disabled = true;
        button.textContent = 'Processando…';
        try {
          await onConfirm?.();
          closeModal();
        } catch (error) {
          console.error(error);
          button.disabled = false;
          button.textContent = confirmLabel;
          toast('Não foi possível concluir', error.message || 'Tente novamente.', 'error');
        }
      });
    }
  });
}

/* ============================================================
   Shell & navigation
   ============================================================ */
function navItem(route, label, iconName, badge = '') {
  return `<a class="nav__item" href="#/${route}" data-nav="${route}">
    ${icon(iconName)}
    <span>${label}</span>
    ${badge ? `<span class="nav__badge">${badge}</span>` : ''}
  </a>`;
}

function shellHTML() {
  const month = monthLabelFromKey(currentMonthKey());
  return `
    <div class="app-shell">
    <div class="sidebar-overlay" id="sidebar-overlay"></div>
    <aside class="sidebar" id="sidebar" aria-label="Navegação principal">
      <a class="brand" href="#/painel" aria-label="Acervo UCM — início">
        <img class="brand__logo" src="assets/ucam-logo.png" alt="Universidade Candido Mendes">
        <div class="brand__tag">Acervo de atividades</div>
      </a>
      <button class="btn btn--primary" type="button" data-action="new-event">
        ${icon('plus')}<span>Nova atividade</span>
      </button>
      <nav class="nav">
        <div class="nav__label">Painel</div>
        ${navItem('painel', 'Visão geral', 'dashboard')}
        ${navItem('eventos', 'Atividades', 'calendar')}
        ${navItem('consolidacao', 'Consolidação', 'file-text')}
      </nav>
      <nav class="nav">
        <div class="nav__label">Validação</div>
        ${navItem('assinaturas', 'Assinaturas', 'signature', '<span data-pending-badge>0</span>')}
        ${navItem('configuracoes', 'Configurações', 'settings')}
      </nav>
      <div class="sidebar__spacer"></div>
      <div class="cycle-card">
        <div class="cycle-card__top"><span>Ciclo atual</span><span class="cycle-card__dot"></span></div>
        <div class="cycle-card__month" data-cycle-month>${escapeHtml(month)}</div>
        <div class="cycle-card__meta" data-cycle-meta>Carregando…</div>
        <div class="progress"><span data-cycle-progress style="width:0%"></span></div>
      </div>
      <div class="user-card">
        <div class="user-card__avatar">CM</div>
        <div>
          <div class="user-card__name">Coordenação Acadêmica</div>
          <div class="user-card__role">Universidade Candido Mendes</div>
        </div>
        <button class="icon-btn user-card__more" type="button" data-action="open-help" aria-label="Ajuda e informações">${icon('help-circle', 'icon icon--sm')}</button>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn mobile-menu-btn" type="button" data-action="toggle-sidebar" aria-label="Abrir menu">${icon('menu')}</button>
        <div class="topbar__left">
          <div class="topbar__crumb">
            <span>Acervo UCM</span>${icon('chevron-right')}<strong id="crumb-current">Painel</strong>
          </div>
        </div>
        <form class="topbar__search" id="global-search" role="search">
          ${icon('search')}
          <input type="search" id="global-search-input" placeholder="Buscar atividades, locais ou pessoas" autocomplete="off" aria-label="Busca global">
          <kbd>Ctrl K</kbd>
        </form>
        <div class="topbar__actions">
          <button class="icon-btn" type="button" data-action="open-help" aria-label="Ajuda">${icon('help-circle')}</button>
          <button class="icon-btn" type="button" data-action="open-pending" aria-label="Pendências de assinatura" style="position:relative">
            ${icon('bell')}
            <span class="notification-dot" data-notification-dot></span>
          </button>
          <div class="topbar__divider"></div>
          <div class="avatar" title="Coordenação Acadêmica">CM</div>
        </div>
      </header>
      <main class="page" id="main-content"></main>
    </div>
    </div>
  `;
}

function renderShell() {
  appRoot.innerHTML = shellHTML();
  const sidebarOverlay = $('#sidebar-overlay');
  sidebarOverlay?.addEventListener('click', closeSidebar);
}

function openSidebar() {
  $('#sidebar')?.classList.add('is-open');
  $('#sidebar-overlay')?.classList.add('is-open');
}
function closeSidebar() {
  $('#sidebar')?.classList.remove('is-open');
  $('#sidebar-overlay')?.classList.remove('is-open');
}

function updateShell() {
  const routeInfo = ROUTES[state.route] || ROUTES.painel;
  $$('[data-nav]').forEach(el => {
    const active = el.dataset.nav === state.route;
    el.classList.toggle('is-active', active);
    if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
  const crumb = $('#crumb-current');
  if (crumb) crumb.textContent = routeInfo.crumb;
  document.title = `${routeInfo.title} · Acervo UCM`;

  const pending = pendingCount();
  $$('[data-pending-badge]').forEach(el => { el.textContent = pending; el.style.display = pending ? '' : 'none'; });
  const dot = $('[data-notification-dot]');
  if (dot) dot.style.display = pending ? '' : 'none';

  const monthEvents = state.events.filter(e => monthKey(e.date) === currentMonthKey());
  const completed = monthEvents.filter(e => eventStatus(e).id === 'completo').length;
  const progress = monthEvents.length ? Math.round((completed / monthEvents.length) * 100) : 0;
  const cycleMonth = $('[data-cycle-month]');
  if (cycleMonth) cycleMonth.textContent = monthLabelFromKey(currentMonthKey());
  const cycleMeta = $('[data-cycle-meta]');
  if (cycleMeta) cycleMeta.textContent = monthEvents.length ? `${monthEvents.length} ${monthEvents.length === 1 ? 'atividade' : 'atividades'} · ${progress}% completas` : 'Nenhuma atividade registrada';
  const cycleProgress = $('[data-cycle-progress]');
  if (cycleProgress) cycleProgress.style.width = `${progress}%`;
}

function currentRouteFromHash() {
  const hash = location.hash.replace(/^#\/?/, '').split('?')[0];
  return ROUTES[hash] ? hash : 'painel';
}

async function navigate() {
  state.route = currentRouteFromHash();
  await renderRoute();
  closeSidebar();
}

async function renderRoute() {
  revokeTrackedUrls();
  updateShell();
  const container = $('#main-content');
  if (!container) return;
  container.innerHTML = skeletonPage();
  try {
    if (state.route === 'painel') await renderDashboard(container);
    else if (state.route === 'eventos') await renderEventsPage(container);
    else if (state.route === 'consolidacao') await renderConsolidationPage(container);
    else if (state.route === 'assinaturas') await renderSignaturesPage(container);
    else if (state.route === 'configuracoes') await renderSettingsPage(container);
  } catch (error) {
    console.error(error);
    container.innerHTML = `<div class="empty-state"><div class="empty-state__icon">${icon('alert-triangle')}</div><h3>Não foi possível abrir esta página</h3><p>${escapeHtml(error.message || 'Tente recarregar o aplicativo.')}</p><button class="btn btn--primary" data-action="reload">Recarregar</button></div>`;
  }
  updateShell();
}

function skeletonPage() {
  return `<div style="padding:55px;text-align:center;color:var(--muted);font-size:12px">Preparando o painel…</div>`;
}

/* ============================================================
   Shared UI
   ============================================================ */
function pageHead({ eyebrow, title, subtitle, actions = '' }) {
  return `<div class="page-head">
    <div>
      <div class="eyebrow">${escapeHtml(eyebrow)}</div>
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<p class="page-head__sub">${escapeHtml(subtitle)}</p>` : ''}
    </div>
    ${actions ? `<div class="page-head__actions">${actions}</div>` : ''}
  </div>`;
}

function demoBanner() {
  const demoCount = state.events.filter(e => e.demo).length;
  if (!demoCount) return '';
  return `<div class="demo-banner">
    <div class="demo-banner__icon">${icon('sparkles')}</div>
    <div class="demo-banner__body">
      <strong>Ambiente de demonstração</strong>
      <span>${demoCount} ${demoCount === 1 ? 'atividade de exemplo' : 'atividades de exemplo'} para explorar todos os recursos. Remova quando começar a usar seus próprios registros.</span>
    </div>
    <button class="btn btn--secondary btn--sm" type="button" data-action="clear-demo">Limpar exemplos</button>
  </div>`;
}

function badge(text, tone = '', dot = false) {
  return `<span class="badge ${tone ? `badge--${tone}` : ''} ${dot ? 'badge--dot' : ''}">${escapeHtml(text)}</span>`;
}

function statusBadge(event) {
  const status = eventStatus(event);
  return badge(status.label, status.tone, true);
}

function avatar(name, cls = '') {
  return `<span class="avatar ${cls}" aria-hidden="true">${escapeHtml(initials(name))}</span>`;
}

function pendingBadgeForEvent(event) {
  const stats = signatureStats(event);
  if (!stats.total) return badge('Sem signatários', 'amber', true);
  if (!stats.pending) return badge('Assinaturas completas', 'green', true);
  return badge(`${stats.pending} pendente${stats.pending > 1 ? 's' : ''}`, 'amber', true);
}

function emptyState({ iconName = 'calendar', title, description, action = '' }) {
  return `<div class="empty-state">
    <div class="empty-state__icon">${icon(iconName)}</div>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(description)}</p>
    ${action}
  </div>`;
}

function eventMeta(event) {
  const meta = typeMeta(event.type);
  return `<div class="event-list__meta">
    <span>${icon('clock')}${timeLabel(event.start)}–${timeLabel(event.end)}</span>
    <span>${icon('map-pin')}${escapeHtml(event.location || 'Local a informar')}</span>
    <span>${icon('building')}${escapeHtml(event.baseUnit || '—')}</span>
  </div>`;
}

/* ============================================================
   Dashboard
   ============================================================ */
async function renderDashboard(container) {
  const monthEvents = state.events.filter(e => monthKey(e.date) === currentMonthKey());
  const hours = monthEvents.reduce((sum, e) => sum + eventDuration(e), 0);
  const docs = monthEvents.reduce((sum, e) => sum + (e.attachments || []).filter(a => a.kind === 'document').length, 0);
  const images = monthEvents.reduce((sum, e) => sum + (e.attachments || []).filter(a => a.kind === 'image').length, 0);
  const pending = pendingSigners().length;
  const complete = monthEvents.filter(e => eventStatus(e).id === 'completo').length;
  const coverage = monthEvents.length ? Math.round((complete / monthEvents.length) * 100) : 0;
  const greeting = new Date().getHours() < 12 ? 'Bom dia' : new Date().getHours() < 18 ? 'Boa tarde' : 'Boa noite';
  const displayEvents = sortEvents(monthEvents.length ? monthEvents : state.events, 'desc').slice(0, 5);
  const upcoming = sortEvents(state.events.filter(isUpcoming), 'asc').slice(0, 3);

  const pendingRows = pendingSigners().slice(0, 4);
  const monthName = monthLabelFromKey(currentMonthKey());
  const completionClass = coverage > 0 ? '' : 'stat-card__trend--neutral';

  container.innerHTML = `
    ${demoBanner()}
    ${pageHead({
      eyebrow: `Painel acadêmico · ${monthName}`,
      title: `${greeting}, Coordenação.`,
      subtitle: 'Acompanhe as atividades do ciclo, organize as comprovações e prepare a consolidação institucional.',
      actions: `
        <a class="btn btn--secondary" href="#/consolidacao">${icon('file-text')}Ver consolidação</a>
        <button class="btn btn--primary" type="button" data-action="new-event">${icon('plus')}Nova atividade</button>
      `
    })}

    <section class="dashboard-hero" aria-label="Resumo do ciclo">
      <div class="hero-main">
        <span class="hero-kicker">Ciclo de consolidação aberto</span>
        <h2>Relatório de <em>${escapeHtml(monthName.split(' de ')[0])}</em></h2>
        <p>${monthEvents.length ? `${monthEvents.length} ${monthEvents.length === 1 ? 'atividade registrada' : 'atividades registradas'} neste ciclo. ${complete} ${complete === 1 ? 'está pronta' : 'estão prontas'} para consolidação com documentação e assinaturas completas.` : 'Registre a primeira atividade do mês para iniciar a composição do relatório acadêmico.'}</p>
        <div class="hero-main__foot">
          <a class="btn btn--cream" href="#/consolidacao">${icon('sparkles')}Preparar relatório</a>
          <span class="hero-note">${icon('shield')}Documento institucional verificável</span>
        </div>
      </div>
      <div class="hero-side">
        <div class="hero-side__label">Indicadores do ciclo</div>
        <div class="hero-side__stats">
          <div class="hero-stat"><div class="hero-stat__value">${monthEvents.length}<small>atividades</small></div><div class="hero-stat__label">registradas</div></div>
          <div class="hero-stat"><div class="hero-stat__value">${formatDuration(hours, true)}</div><div class="hero-stat__label">carga horária</div></div>
          <div class="hero-stat"><div class="hero-stat__value">${docs}<small>docs.</small></div><div class="hero-stat__label">digitalizados</div></div>
          <div class="hero-stat"><div class="hero-stat__value">${images}<small>img.</small></div><div class="hero-stat__label">comprovações</div></div>
        </div>
        <div class="hero-side__foot">
          <span>${pending} assinatura${pending === 1 ? '' : 's'} pendente${pending === 1 ? '' : 's'} no acervo</span>
          <a class="btn btn--cream" href="#/assinaturas">${icon('signature')}Validar</a>
        </div>
      </div>
    </section>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-card__icon">${icon('calendar')}</div>
        <div>
          <div class="stat-card__label">Atividades no ciclo</div>
          <div class="stat-card__value">${monthEvents.length}</div>
          <div class="stat-card__trend ${completionClass}">${icon('trend-up')}${complete} consolidadas</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-card__icon stat-card__icon--green">${icon('clock')}</div>
        <div>
          <div class="stat-card__label">Carga horária registrada</div>
          <div class="stat-card__value">${formatDuration(hours, true)}</div>
          <div class="stat-card__trend">${icon('check-circle')}${monthEvents.length ? 'Horas validadas por atividade' : 'Aguardando registros'}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-card__icon stat-card__icon--gold">${icon('paperclip')}</div>
        <div>
          <div class="stat-card__label">Comprovações anexadas</div>
          <div class="stat-card__value">${docs + images} <small>arquivos</small></div>
          <div class="stat-card__trend stat-card__trend--neutral">${icon('file-text')}${docs} documentos · ${images} imagens</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-card__icon stat-card__icon--blue">${icon('signature')}</div>
        <div>
          <div class="stat-card__label">Assinaturas pendentes</div>
          <div class="stat-card__value">${pending}</div>
          <div class="stat-card__trend ${pending ? '' : 'stat-card__trend--neutral'}">${icon(pending ? 'alert-circle' : 'check-circle')}${pending ? 'Requer atenção' : 'Tudo em dia'}</div>
        </div>
      </div>
    </div>

    <div class="dashboard-grid">
      <section class="card card--padded">
        <div class="card__head">
          <div><h2 class="card__title">Agenda e atividades</h2><p class="card__sub">${monthEvents.length ? `Registros de ${monthName}` : 'Nenhum registro neste ciclo'}</p></div>
          <a class="card__link" href="#/eventos">Ver todas ${icon('arrow-right')}</a>
        </div>
        ${displayEvents.length ? `<div class="event-list">
          ${displayEvents.map(event => eventListRow(event)).join('')}
        </div>` : emptyState({
          iconName: 'calendar',
          title: 'Seu acervo começa aqui',
          description: 'Registre aulas práticas, projetos de extensão e visitas programadas com documentos, imagens e assinaturas.',
          action: '<button class="btn btn--primary btn--sm" type="button" data-action="new-event">Registrar primeira atividade</button>'
        })}
      </section>

      <div class="dashboard-side">
        <section class="card card--padded">
          <div class="card__head">
            <div><h2 class="card__title">Assinaturas pendentes</h2><p class="card__sub">${pending} no acervo completo</p></div>
            <a class="card__link" href="#/assinaturas">Validar ${icon('arrow-right')}</a>
          </div>
          ${pendingRows.length ? `<div class="signature-list">
            ${pendingRows.map(({ event, signer }) => `
              <div class="signature-mini">
                <div class="signature-mini__avatar">${escapeHtml(initials(signer.name))}</div>
                <div class="signature-mini__body">
                  <div class="signature-mini__name">${escapeHtml(signer.name)}</div>
                  <div class="signature-mini__role">${escapeHtml(signer.shortRole)} · ${escapeHtml(shortTitle(event.title))}</div>
                </div>
                <button class="icon-btn" type="button" data-sign-event="${event.id}" data-sign-key="${escapeHtml(signer.key)}" aria-label="Registrar assinatura">${icon('arrow-right', 'icon icon--sm')}</button>
              </div>
            `).join('')}
          </div>` : `<div class="detail-footer-note" style="margin:0">${icon('check-circle')}<span>Nenhuma pendência de assinatura. O acervo está em dia.</span></div>`}
        </section>

        <section class="card card--padded">
          <div class="card__head">
            <div><h2 class="card__title">Prontidão documental</h2><p class="card__sub">Atividades completas no ciclo</p></div>
          </div>
          <div class="coverage">
            <div class="donut" style="--value:${coverage}">
              <div class="donut__center"><div class="donut__value">${coverage}%</div><div class="donut__label">prontas</div></div>
            </div>
            <div class="coverage__legend">
              <div class="legend-row"><span class="legend-row__dot"></span>Completas <strong>${complete}</strong></div>
              <div class="legend-row"><span class="legend-row__dot" style="background:var(--amber)"></span>Com pendência <strong>${Math.max(0, monthEvents.length - complete)}</strong></div>
              <div class="legend-row"><span class="legend-row__dot legend-row__dot--muted"></span>Total do ciclo <strong>${monthEvents.length}</strong></div>
            </div>
          </div>
        </section>

        <section class="card card--padded">
          <div class="card__head">
            <div><h2 class="card__title">Próximos compromissos</h2><p class="card__sub">Visitas e atividades programadas</p></div>
          </div>
          ${upcoming.length ? `<div class="signature-list">
            ${upcoming.map(event => `<div class="signature-mini">
              <div class="signature-mini__avatar" style="background:var(--wine-50)">${escapeHtml(String(new Date(event.date + 'T12:00:00').getDate()).padStart(2, '0'))}</div>
              <div class="signature-mini__body">
                <div class="signature-mini__name">${escapeHtml(shortTitle(event.title))}</div>
                <div class="signature-mini__role">${timeLabel(event.start)} · ${escapeHtml(event.location || 'Local a informar')}</div>
              </div>
              <span class="badge badge--outline">${escapeHtml(formatDate(event.date, 'numeric'))}</span>
            </div>`).join('')}
          </div>` : `<div class="detail-footer-note" style="margin:0">${icon('calendar')}<span>Nenhuma atividade futura registrada.</span></div>`}
        </section>
      </div>
    </div>

    <section class="card" style="margin-top:18px">
      <div class="card__head" style="padding:21px 23px 0">
        <div><h2 class="card__title">Últimos registros</h2><p class="card__sub">Movimentações recentes do acervo acadêmico</p></div>
        <a class="card__link" href="#/eventos">Abrir acervo ${icon('arrow-right')}</a>
      </div>
      <div class="table-wrap" style="padding:8px 10px 10px">
        <table class="data-table">
          <thead><tr><th scope="col">Atividade</th><th scope="col">Data e horário</th><th scope="col">Unidade</th><th scope="col">Comprovações</th><th scope="col">Responsáveis</th><th scope="col">Status</th><th scope="col" aria-label="Ações"></th></tr></thead>
          <tbody>
            ${state.events.slice(0, 5).map(event => {
              const docsStats = eventDocStats(event);
              const signers = getEventSigners(event);
              return `<tr data-open-event="${event.id}" style="cursor:pointer">
                <td><div class="data-table__title">${escapeHtml(event.title)}</div><div class="data-table__meta">${escapeHtml(typeMeta(event.type).label)} · ${escapeHtml((event.courses || []).join(', '))}${event.discipline ? ` · ${escapeHtml(event.discipline)}` : ''}</div></td>
                <td>${escapeHtml(formatDate(event.date, 'short'))}<div class="data-table__meta">${timeLabel(event.start)}–${timeLabel(event.end)}</div></td>
                <td>${escapeHtml(shortUnit(event.baseUnit))}</td>
                <td><span class="table-doc">${icon('paperclip')}${docsStats.docsCount + docsStats.imagesCount} arquivos</span></td>
                <td><div class="avatar-stack">${signers.slice(0, 3).map(s => `<span class="avatar" title="${escapeHtml(s.name)}">${escapeHtml(initials(s.name))}</span>`).join('')}${signers.length > 3 ? `<span class="avatar avatar--more">+${signers.length - 3}</span>` : ''}</div></td>
                <td>${statusBadge(event)}</td>
                <td>${icon('chevron-right', 'icon icon--sm')}</td>
              </tr>`;
            }).join('') || `<tr><td colspan="7" style="text-align:center;padding:35px;color:var(--muted)">Nenhuma atividade registrada.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function shortTitle(title = '') {
  return title.length > 58 ? `${title.slice(0, 57)}…` : title;
}
function shortUnit(unit = '') {
  return unit.replace('Unidade ', '').split('—')[0].trim() || '—';
}

function eventListRow(event) {
  const meta = typeMeta(event.type);
  const stats = eventDocStats(event);
  return `<div class="event-list__item">
    <div class="date-tile" aria-label="${escapeHtml(formatDate(event.date, 'long'))}">
      <span class="date-tile__month">${escapeHtml(formatDate(event.date, 'numeric').slice(3))}</span>
      <span class="date-tile__day">${escapeHtml(formatDate(event.date, 'numeric').slice(0, 2))}</span>
      <span class="date-tile__week">${escapeHtml(formatDate(event.date, 'full').slice(0, 3))}</span>
    </div>
    <div class="event-list__body">
      <button class="event-list__title" type="button" data-open-event="${event.id}" style="border:0;background:none;padding:0;text-align:left">${escapeHtml(event.title)}</button>
      ${eventMeta(event)}
      <div class="event-list__tags">${badge(meta.label, meta.tone === 'outline' ? 'outline' : meta.tone)} ${statusBadge(event)}</div>
    </div>
    <div class="event-list__aside">
      <span class="event-list__docs">${icon('paperclip')}${stats.docsCount + stats.imagesCount}</span>
      <span class="badge badge--outline">${timeLabel(event.start)}</span>
    </div>
  </div>`;
}

/* ============================================================
   Events page
   ============================================================ */
async function renderEventsPage(container) {
  ensureReportSelection();
  const units = [...new Set(state.events.map(e => e.baseUnit).filter(Boolean))];
  if (state.filters.unit !== 'all' && !units.includes(state.filters.unit)) state.filters.unit = 'all';

  const typeCounts = Object.fromEntries(EVENT_TYPES.map(t => [t.id, state.events.filter(e => e.type === t.id).length]));

  container.innerHTML = `
    ${demoBanner()}
    ${pageHead({
      eyebrow: 'Acervo acadêmico · registros',
      title: 'Atividades acadêmicas',
      subtitle: 'Aulas práticas, projetos de extensão e visitas programadas com documentação e validação institucional.',
      actions: `<button class="btn btn--primary" type="button" data-action="new-event">${icon('plus')}Nova atividade</button>`
    })}
    <div class="toolbar">
      <div class="search-field">
        ${icon('search')}
        <input type="search" id="event-search" value="${escapeHtml(state.filters.q)}" placeholder="Buscar por denominação, local, curso ou responsável" aria-label="Buscar atividades">
      </div>
      <select class="select" id="event-unit" aria-label="Filtrar por unidade">
        <option value="all">Todas as unidades</option>
        ${units.map(u => `<option value="${escapeHtml(u)}" ${state.filters.unit === u ? 'selected' : ''}>${escapeHtml(u)}</option>`).join('')}
      </select>
      <select class="select" id="event-status" aria-label="Filtrar por situação">
        <option value="all" ${state.filters.status === 'all' ? 'selected' : ''}>Todas as situações</option>
        <option value="completo" ${state.filters.status === 'completo' ? 'selected' : ''}>Completas</option>
        <option value="pendente" ${state.filters.status === 'pendente' ? 'selected' : ''}>Com pendência</option>
        <option value="sem-documentos" ${state.filters.status === 'sem-documentos' ? 'selected' : ''}>Sem documentos</option>
      </select>
      <div class="segmented" aria-label="Visualização">
        <button type="button" data-view="grid" class="${state.filters.view === 'grid' ? 'is-active' : ''}" aria-label="Visualização em cartões">${icon('layout-grid')}</button>
        <button type="button" data-view="list" class="${state.filters.view === 'list' ? 'is-active' : ''}" aria-label="Visualização em lista">${icon('list')}</button>
      </div>
    </div>
    <div class="filter-chips" id="type-chips">
      <button class="filter-chip ${state.filters.type === 'all' ? 'is-active' : ''}" data-type="all">Todas <span>${state.events.length}</span></button>
      ${EVENT_TYPES.map(type => `<button class="filter-chip ${state.filters.type === type.id ? 'is-active' : ''}" data-type="${type.id}">${escapeHtml(type.label)} <span>${typeCounts[type.id] || 0}</span></button>`).join('')}
    </div>
    <div id="events-results"></div>
  `;

  const search = $('#event-search', container);
  search?.addEventListener('input', debounce(() => {
    state.filters.q = search.value;
    renderEventResults();
  }, 180));
  $('#event-unit', container)?.addEventListener('change', (e) => { state.filters.unit = e.target.value; renderEventResults(); });
  $('#event-status', container)?.addEventListener('change', (e) => { state.filters.status = e.target.value; renderEventResults(); });
  $$('[data-view]', container).forEach(btn => btn.addEventListener('click', () => {
    state.filters.view = btn.dataset.view;
    $$('[data-view]', container).forEach(b => b.classList.toggle('is-active', b === btn));
    renderEventResults();
  }));
  $$('#type-chips [data-type]', container).forEach(btn => btn.addEventListener('click', () => {
    state.filters.type = btn.dataset.type;
    $$('#type-chips .filter-chip', container).forEach(b => b.classList.toggle('is-active', b === btn));
    renderEventResults();
  }));

  renderEventResults();
}

function filteredEvents() {
  const q = state.filters.q.trim().toLowerCase();
  return state.events.filter(event => {
    if (state.filters.type !== 'all' && event.type !== state.filters.type) return false;
    if (state.filters.unit !== 'all' && event.baseUnit !== state.filters.unit) return false;
    if (state.filters.status !== 'all') {
      const status = eventStatus(event).id;
      if (state.filters.status === 'pendente' && status === 'completo') return false;
      if (state.filters.status !== 'pendente' && status !== state.filters.status) return false;
    }
    if (q) {
      const haystack = [
        event.title, event.location, event.baseUnit, event.description,
        ...(event.courses || []),
        ...(event.professors || []).map(p => p.name),
        ...(event.coordinators || []).map(c => c.name)
      ].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function renderEventResults() {
  const results = $('#events-results');
  if (!results) return;
  const events = sortEvents(filteredEvents(), 'desc');
  if (!events.length) {
    const hasFilters = state.filters.q || state.filters.type !== 'all' || state.filters.unit !== 'all' || state.filters.status !== 'all';
    results.innerHTML = emptyState({
      iconName: hasFilters ? 'search' : 'calendar',
      title: hasFilters ? 'Nenhuma atividade encontrada' : 'Nenhuma atividade registrada',
      description: hasFilters ? 'Ajuste os filtros ou tente outro termo de busca.' : 'Registre aulas práticas, projetos de extensão e visitas programadas para iniciar o acervo.',
      action: hasFilters
        ? '<button class="btn btn--secondary btn--sm" type="button" data-action="clear-filters">Limpar filtros</button>'
        : '<button class="btn btn--primary btn--sm" type="button" data-action="new-event">Nova atividade</button>'
    });
    return;
  }
  results.innerHTML = `<div class="event-grid ${state.filters.view === 'list' ? 'event-grid--list' : ''}">
    ${events.map(eventCard).join('')}
  </div>`;
}

function eventCard(event) {
  const meta = typeMeta(event.type);
  const docStats = eventDocStats(event);
  const signerCount = getEventSigners(event).length;
  return `<article class="event-card" data-open-event="${event.id}" tabindex="0" role="button" aria-label="Abrir ${escapeHtml(event.title)}">
    <div class="event-card__top">
      <div class="event-card__date">
        <span>${escapeHtml(formatDate(event.date, 'numeric').slice(3))}</span>
        <strong>${escapeHtml(formatDate(event.date, 'numeric').slice(0, 2))}</strong>
      </div>
      <div class="event-card__heading">
        <div class="event-card__type">${icon(meta.icon, 'icon icon--sm')}${escapeHtml(meta.label)}</div>
        <h3 class="event-card__title">${escapeHtml(event.title)}</h3>
      </div>
    </div>
    <div class="event-card__meta">
      <span>${icon('clock')}${timeLabel(event.start)}–${timeLabel(event.end)}</span>
      <span>${icon('map-pin')}${escapeHtml(event.location || 'Local a informar')}</span>
      <span>${icon('graduation-cap')}${escapeHtml((event.courses || []).join(' · ') || 'Curso a informar')}</span>
      ${event.discipline ? `<span>${icon('book-open')}${escapeHtml(event.discipline)}</span>` : ''}
    </div>
    <p class="event-card__desc">${escapeHtml(event.description || 'Sem síntese registrada para esta atividade.')}</p>
    <div class="event-card__foot">
      ${statusBadge(event)}
      <div class="event-card__stats">
        <span>${icon('file-text')}${docStats.docsCount}</span>
        <span>${icon('image')}${docStats.imagesCount}</span>
        <span>${icon('signature')}${signerCount}</span>
      </div>
      <span class="event-card__arrow">${icon('chevron-right')}</span>
    </div>
  </article>`;
}

/* ============================================================
   Event detail drawer
   ============================================================ */
function openEventDetail(eventId) {
  const event = findEvent(eventId);
  if (!event) return toast('Atividade não encontrada', '', 'error');
  const meta = typeMeta(event.type);
  const docStats = eventDocStats(event);
  const signers = getEventSigners(event);
  const docs = (event.attachments || []).filter(a => a.kind === 'document');
  const imgs = (event.attachments || []).filter(a => a.kind === 'image');
  const students = Array.isArray(event.students) ? event.students.filter(Boolean) : parseStudents(event.students || '');

  const body = `
    <div class="detail-head">
      <div class="detail-head__date"><span>${escapeHtml(formatDate(event.date, 'numeric').slice(3))}</span><strong>${escapeHtml(formatDate(event.date, 'numeric').slice(0, 2))}</strong></div>
      <div class="detail-head__body">
        <div class="detail-head__type">${icon(meta.icon, 'icon icon--sm')}${escapeHtml(meta.label)}</div>
        <h2>${escapeHtml(event.title)}</h2>
        <div class="detail-head__meta">
          <span>${icon('calendar')}${escapeHtml(formatDate(event.date, 'full'))}</span>
          <span>${icon('clock')}${timeLabel(event.start)}–${timeLabel(event.end)}</span>
          <span>${icon('map-pin')}${escapeHtml(event.location || 'Local a informar')}</span>
        </div>
      </div>
    </div>
    <div class="detail-actions" style="margin-top:18px">
      <button class="btn btn--secondary btn--sm" type="button" data-edit-event="${event.id}">${icon('edit')}Editar</button>
      <button class="btn btn--secondary btn--sm" type="button" data-report-event="${event.id}">${icon('file-text')}Relatório da atividade</button>
      <button class="btn btn--danger btn--sm" type="button" data-delete-event="${event.id}">${icon('trash')}Excluir</button>
    </div>

    <div class="detail-section">
      <div class="detail-section__head"><h3>Dados da atividade</h3><span class="line"></span>${statusBadge(event)}</div>
      <div class="detail-grid">
        <div class="detail-cell"><div class="detail-cell__label">Unidade base de elaboração</div><div class="detail-cell__value">${escapeHtml(event.baseUnit || '—')}</div></div>
        <div class="detail-cell"><div class="detail-cell__label">Curso(s) envolvido(s)</div><div class="detail-cell__value">${escapeHtml((event.courses || []).join(' · ') || '—')}</div></div>
        <div class="detail-cell"><div class="detail-cell__label">Disciplina</div><div class="detail-cell__value">${escapeHtml(event.discipline || '—')}</div></div>
        <div class="detail-cell"><div class="detail-cell__label">Estrutura da aula</div><div class="detail-cell__value">${escapeHtml(structureLabel(event.structure))}</div></div>
        <div class="detail-cell"><div class="detail-cell__label">Carga horária</div><div class="detail-cell__value">${formatDuration(eventDuration(event))}</div></div>
        <div class="detail-cell"><div class="detail-cell__label">Local do evento</div><div class="detail-cell__value">${escapeHtml(event.location || '—')}</div></div>
        <div class="detail-cell detail-cell--wide"><div class="detail-cell__label">Alunos participantes${students.length ? ` (${students.length})` : ''}</div><div class="detail-cell__value">${escapeHtml(students.join(' · ') || '—')}</div></div>
        <div class="detail-cell detail-cell--wide"><div class="detail-cell__label">Síntese da atividade</div><div class="detail-cell__value">${escapeHtml(event.description || 'Sem descrição registrada.')}</div></div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section__head"><h3>Responsáveis e validações</h3><span class="line"></span><span class="count">${signers.length} signatários</span></div>
      ${signers.length ? signers.map(signer => {
        const sig = getSignature(event, signer.key);
        const signed = sig?.status === 'assinado';
        return `<div class="signature-card">
          <div class="signature-card__avatar">${escapeHtml(initials(signer.name))}</div>
          <div class="signature-card__body">
            <div class="signature-card__name">${escapeHtml(signer.name)}</div>
            <div class="signature-card__role">${escapeHtml(signer.role)}${signer.course ? ` · ${escapeHtml(signer.course)}` : ''}</div>
          </div>
          <div class="signature-card__actions">
            <span class="gov-status ${signed ? 'gov-status--signed' : 'gov-status--pending'}">${icon(signed ? 'check-circle' : 'clock')}${signed ? 'gov.br' : 'pendente'}</span>
            <button class="btn btn--sm ${signed ? 'btn--ghost' : 'btn--secondary'}" type="button" data-sign-event="${event.id}" data-sign-key="${escapeHtml(signer.key)}">${signed ? 'Detalhes' : 'Assinar'}</button>
          </div>
        </div>`;
      }).join('') : '<div class="detail-footer-note" style="margin:0">' + icon('alert-circle') + '<span>Nenhum signatário informado. Edite a atividade para incluir professores, coordenação e direção.</span></div>'}
    </div>

    <div class="detail-section">
      <div class="detail-section__head"><h3>Documentos digitalizados</h3><span class="line"></span><span class="count">${docs.length}</span></div>
      ${docs.length ? `<div class="document-list">${docs.map(doc => documentRow(doc)).join('')}</div>` : '<div class="detail-footer-note" style="margin:0">' + icon('file-text') + '<span>Nenhum documento digitalizado anexado.</span></div>'}
    </div>

    <div class="detail-section">
      <div class="detail-section__head"><h3>Comprovação por imagem</h3><span class="line"></span><span class="count">${imgs.length}</span></div>
      ${imgs.length ? `<div class="proof-grid">${imgs.map(img => `
        <button class="proof-thumb" type="button" data-preview-file="${img.id}" data-preview-event="${event.id}" aria-label="Ampliar ${escapeHtml(img.name)}">
          <img data-file-thumb="${img.id}" alt="${escapeHtml(img.name)}">
          <span class="proof-thumb__label">${escapeHtml(img.name)}</span>
        </button>
      `).join('')}</div>` : '<div class="detail-footer-note" style="margin:0">' + icon('image') + '<span>Nenhuma comprovação por imagem anexada.</span></div>'}
    </div>

    <div class="detail-footer-note">
      ${icon('shield')}
      <span>As assinaturas são registradas no Acervo UCM após conclusão no serviço oficial <strong>Assinatura Eletrônica gov.br</strong>. O código de cada signatário consta no comprovante e na folha de validação do relatório.</span>
    </div>
  `;

  openModal({
    content: modalMarkup({
      title: 'Detalhes da atividade',
      subtitle: `${formatDate(event.date, 'full')} · ${timeLabel(event.start)}–${timeLabel(event.end)}`,
      body,
      footer: `
        <button class="btn btn--secondary" type="button" data-close-modal>Fechar</button>
        <div class="spacer"></div>
        <button class="btn btn--primary" type="button" data-edit-event="${event.id}">${icon('edit')}Editar atividade</button>
      `,
      drawer: true
    }),
    drawer: true,
    onMount: (root) => hydrateFileThumbs(root)
  });
}

function documentRow(doc) {
  return `<div class="document-item">
    <div class="document-item__icon">${icon('file-text')}</div>
    <div class="document-item__body">
      <div class="document-item__name">${escapeHtml(doc.name)}</div>
      <div class="document-item__meta">${escapeHtml(fileTypeLabel(doc.name))} · ${formatBytes(doc.size || 0)}${doc.govReceipt ? ' · comprovante gov.br' : ''}</div>
    </div>
    <button class="icon-btn" type="button" data-preview-file="${doc.id}" aria-label="Pré-visualizar documento">${icon('eye', 'icon icon--sm')}</button>
  </div>`;
}

async function hydrateFileThumbs(root = document) {
  const nodes = $$('[data-file-thumb]', root);
  for (const node of nodes) {
    const id = node.getAttribute('data-file-thumb');
    if (!id || node.dataset.loaded) continue;
    node.dataset.loaded = '1';
    try {
      const blob = await getFileBlob(id);
      if (!blob) continue;
      if (isTiff(node.alt || '', blob.type)) {
        node.style.display = 'none';
        continue;
      }
      const url = trackUrl(URL.createObjectURL(blob));
      node.src = url;
    } catch { /* noop */ }
  }
}

/* ============================================================
   File preview
   ============================================================ */
async function openFilePreview(attachmentId, eventId) {
  const event = eventId ? findEvent(eventId) : null;
  const attachment = event?.attachments?.find(a => a.id === attachmentId)
    || state.events.flatMap(e => e.attachments || []).find(a => a.id === attachmentId);
  if (!attachment) return toast('Arquivo não encontrado', '', 'error');
  const ownerEvent = event || state.events.find(e => (e.attachments || []).some(a => a.id === attachmentId));
  let returnToDrawer = Boolean(ownerEvent && activeModal?.backdrop.querySelector('.drawer'));
  const blob = await getFileBlob(attachment.id);
  if (!blob) return toast('Arquivo indisponível', 'O conteúdo deste anexo não está armazenado neste dispositivo.', 'error');

  const ext = extname(attachment.name);
  let body = '';
  let tempUrl = null;
  let modalSize = 'md';

  if (isTiff(attachment.name, attachment.type)) {
    body = `<div class="empty-state" style="padding:40px 20px"><div class="empty-state__icon">${icon('image')}</div><h3>Formato TIFF</h3><p>O navegador não exibe TIFF diretamente. Baixe o arquivo para visualizá-lo em um aplicativo compatível.</p><a class="btn btn--primary" href="${trackUrl(URL.createObjectURL(blob))}" download="${escapeHtml(attachment.name)}">${icon('download')}Baixar arquivo</a></div>`;
    tempUrl = state.objectUrls[state.objectUrls.length - 1];
  } else if (attachment.kind === 'image' || blob.type.startsWith('image/')) {
    modalSize = 'lg';
    tempUrl = trackUrl(URL.createObjectURL(blob));
    body = `<div style="display:flex;justify-content:center;background:var(--paper);border-radius:12px;padding:12px"><img src="${tempUrl}" alt="${escapeHtml(attachment.name)}" style="max-height:70vh;width:auto;border-radius:6px"></div>`;
  } else if (attachment.type === 'application/pdf' || ext === 'pdf') {
    modalSize = 'lg';
    tempUrl = trackUrl(URL.createObjectURL(blob));
    body = `<iframe src="${tempUrl}" title="${escapeHtml(attachment.name)}" style="width:100%;height:70vh;border:1px solid var(--line);border-radius:10px;background:#fff"></iframe>`;
  } else if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) {
    const text = await extractOfficeText(blob, ext).catch(() => '');
    body = text
      ? `<div class="detail-footer-note" style="margin:0 0 12px">${icon('info')}<span>Prévia textual extraída do arquivo. A formatação original é preservada no download.</span></div><div style="white-space:pre-wrap;line-height:1.65;font-size:12px;color:var(--ink-2);max-height:60vh;overflow:auto;padding:18px;border:1px solid var(--line);border-radius:10px;background:var(--surface-2)">${escapeHtml(text)}</div>`
      : `<div class="empty-state" style="padding:40px 20px"><div class="empty-state__icon">${icon('file-text')}</div><h3>Prévia não disponível</h3><p>Este arquivo não pôde ser interpretado no navegador. Baixe-o para visualizar no aplicativo de origem.</p></div>`;
  } else {
    body = `<div class="empty-state" style="padding:40px 20px"><div class="empty-state__icon">${icon('file')}</div><h3>Arquivo anexado</h3><p>Este formato não possui prévia no navegador.</p></div>`;
  }

  openModal({
    content: modalMarkup({
      title: attachment.name,
      subtitle: `${fileTypeLabel(attachment.name)} · ${formatBytes(attachment.size || blob.size || 0)}${event ? ` · ${escapeHtml(event.title)}` : ''}`,
      body,
      footer: `
        <button class="btn btn--secondary" type="button" data-close-modal>Fechar</button>
        <div class="spacer"></div>
        <button class="btn btn--primary" type="button" id="download-preview">${icon('download')}Baixar arquivo</button>
      `,
      size: modalSize
    }),
    onMount: (root) => {
      root.querySelector('#download-preview')?.addEventListener('click', () => downloadBlob(blob, attachment.name));
    },
    onClose: () => {
      if (!returnToDrawer || !ownerEvent) return;
      returnToDrawer = false;
      const id = ownerEvent.id;
      setTimeout(() => openEventDetail(id), 0);
    }
  });
}

/* ============================================================
   New / edit activity wizard
   ============================================================ */
function openEventWizard(eventId = null, options = {}) {
  const existing = eventId ? findEvent(eventId) : null;
  const base = existing ? structuredClone(existing) : createBlankEvent(state.settings);
  if (options.prefill) {
    Object.assign(base, {
      ...base,
      ...options.prefill,
      title: '',
      location: '',
      description: '',
      professors: [{ id: uid('prof'), name: '', email: '' }],
      coordinators: [{ id: uid('coord'), name: '', course: options.prefill.courses?.[0] || state.settings.courses?.[0] || '' }],
      attachments: [],
      signatures: {}
    });
  }
  if (options.date) base.date = options.date;

  let step = 1;
  let attachments = (base.attachments || []).map(a => ({ ...a }));
  const originalAttachmentIds = new Set(attachments.map(a => a.id));
  const removedAttachmentIds = new Set();
  let localUrls = [];

  const body = `
    <div class="wizard-steps" aria-label="Etapas do cadastro">
      <div class="wizard-step is-active" data-step-indicator="1"><span class="wizard-step__num">1</span><span>Identificação</span></div>
      <div class="wizard-line" data-step-line="1"></div>
      <div class="wizard-step" data-step-indicator="2"><span class="wizard-step__num">2</span><span>Responsáveis</span></div>
      <div class="wizard-line" data-step-line="2"></div>
      <div class="wizard-step" data-step-indicator="3"><span class="wizard-step__num">3</span><span>Documentos</span></div>
    </div>
    <div class="event-form-layout">
      <div class="event-form-main">
        <section data-wizard-panel="1">
          <div class="form-section">
            <div class="form-section__head"><span class="form-section__num">01</span><h3>Identificação da atividade</h3><p>Denominação, data e local</p></div>
            <div class="form-grid">
              <div class="field span-2">
                <label for="wizard-title">Denominação do evento <span class="req">*</span></label>
                <input id="wizard-title" data-wizard-field="title" value="${escapeHtml(base.title || '')}" placeholder="Ex.: Aula prática de avaliação funcional no laboratório" autocomplete="off">
              </div>
              <div class="field">
                <label for="wizard-type">Natureza da atividade</label>
                <select id="wizard-type" data-wizard-field="type">
                  ${EVENT_TYPES.map(t => `<option value="${t.id}" ${base.type === t.id ? 'selected' : ''}>${escapeHtml(t.label)}</option>`).join('')}
                </select>
              </div>
              <div class="field">
                <label for="wizard-date">Data do evento <span class="req">*</span></label>
                <input id="wizard-date" type="date" data-wizard-field="date" value="${escapeHtml(base.date || todayISO())}">
              </div>
              <div class="field span-2">
                <label>Horário de início e término <span class="req">*</span></label>
                <div class="time-row">
                  <input type="time" data-wizard-field="start" value="${escapeHtml(base.start || '08:00')}" aria-label="Horário de início">
                  <span>até</span>
                  <input type="time" data-wizard-field="end" value="${escapeHtml(base.end || '12:00')}" aria-label="Horário de término">
                </div>
              </div>
              <div class="field span-2">
                <label for="wizard-location">Local do evento <span class="req">*</span></label>
                <input id="wizard-location" data-wizard-field="location" value="${escapeHtml(base.location || '')}" placeholder="Ex.: Laboratório de Habilidades — Bloco B, sala 204">
              </div>
              <div class="field">
                <label for="wizard-unit">Unidade base de elaboração <span class="req">*</span></label>
                <input id="wizard-unit" data-wizard-field="baseUnit" list="units-list" value="${escapeHtml(base.baseUnit || state.settings.unit || '')}" placeholder="Unidade responsável pelo registro">
                <datalist id="units-list">${state.settings.units.map(u => `<option value="${escapeHtml(u)}"></option>`).join('')}</datalist>
              </div>
              <div class="field">
                <label for="wizard-courses">Curso(s) envolvido(s) <span class="req">*</span></label>
                <input id="wizard-courses" data-wizard-field="courses" value="${escapeHtml((base.courses || []).join(', '))}" placeholder="Ex.: Fisioterapia, Enfermagem">
                <small>Separe mais de um curso por vírgula.</small>
              </div>
              <div class="field">
                <label for="wizard-discipline">Disciplina</label>
                <input id="wizard-discipline" data-wizard-field="discipline" value="${escapeHtml(base.discipline || '')}" placeholder="Ex.: Cinesiologia e Biomecânica" autocomplete="off">
              </div>
              <div class="field">
                <label for="wizard-structure">Estrutura da aula</label>
                <select id="wizard-structure" data-wizard-field="structure">
                  ${CLASS_STRUCTURES.map(s => `<option value="${s.id}" ${(base.structure || 'pratica') === s.id ? 'selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}
                </select>
              </div>
              <div class="field span-2">
                <label for="wizard-description">Síntese da atividade</label>
                <textarea id="wizard-description" data-wizard-field="description" placeholder="Descreva objetivos, participantes, metodologia e resultados relevantes da atividade.">${escapeHtml(base.description || '')}</textarea>
              </div>
              <div class="field span-2">
                <label for="wizard-students">Alunos participantes</label>
                <textarea id="wizard-students" data-wizard-field="students" placeholder="Um nome por linha — ex.: Ana Beatriz Ferreira">${escapeHtml((base.students || []).join('\n'))}</textarea>
                <small>Um nome por linha (também aceita vírgula). O total é exibido no relatório.</small>
              </div>
            </div>
          </div>
        </section>

        <section data-wizard-panel="2" hidden>
          <div class="form-section">
            <div class="form-section__head"><span class="form-section__num">02</span><h3>Professores responsáveis</h3><p>Assinatura gov.br</p></div>
            <div class="repeatable-list" data-list="professors">
              ${(base.professors?.length ? base.professors : [{ id: uid('prof'), name: '', email: '' }]).map(professorRow).join('')}
            </div>
            <button class="add-row-btn" type="button" data-add-row="professors">${icon('plus')}Adicionar professor</button>
          </div>

          <div class="form-section">
            <div class="form-section__head"><span class="form-section__num">03</span><h3>Viso das coordenações</h3><p>Um coordenador por curso</p></div>
            <div class="repeatable-list" data-list="coordinators">
              ${(base.coordinators?.length ? base.coordinators : [{ id: uid('coord'), name: '', course: state.settings.courses?.[0] || '' }]).map(coordinatorRow).join('')}
            </div>
            <button class="add-row-btn" type="button" data-add-row="coordinators">${icon('plus')}Adicionar coordenação</button>
          </div>

          <div class="form-section">
            <div class="form-section__head"><span class="form-section__num">04</span><h3>Direção da unidade</h3><p>Viso institucional</p></div>
            <div class="form-grid">
              <div class="field">
                <label for="wizard-director">Denominação do diretor(a) <span class="req">*</span></label>
                <input id="wizard-director" data-wizard-field="directorName" value="${escapeHtml(base.director?.name || state.settings.director?.name || '')}" placeholder="Nome completo do diretor(a)">
              </div>
              <div class="field">
                <label for="wizard-director-role">Cargo / função</label>
                <input id="wizard-director-role" data-wizard-field="directorRole" value="${escapeHtml(base.director?.role || state.settings.director?.role || 'Diretor(a) da Unidade')}">
              </div>
            </div>
          </div>

          <div class="govbanner" style="margin-top:20px">
            <div class="govbanner__mark">gov.br</div>
            <div class="govbanner__text">
              <strong>Assinatura digital vinculada à Assinatura Eletrônica gov.br</strong>
              <span>Os signatários serão incluídos na folha de validação. A confirmação da assinatura é registrada após a conclusão no serviço oficial do gov.br.</span>
            </div>
            <a class="icon-btn" href="${SIGNATURE_URL}" target="_blank" rel="noopener" aria-label="Abrir Assinatura Eletrônica gov.br">${icon('external-link', 'icon icon--sm')}</a>
          </div>
        </section>

        <section data-wizard-panel="3" hidden>
          <div class="form-section">
            <div class="form-section__head"><span class="form-section__num">05</span><h3>Documentos digitalizados</h3><p>PDF, DOCX, XLSX, PPTX</p></div>
            <div class="upload-grid">
              <div class="upload-column">
                <label class="dropzone" data-dropzone="document">
                  <div class="dropzone__icon">${icon('file-text')}</div>
                  <strong>Adicionar documentos</strong>
                  <span>PDF, DOCX, XLSX, PPTX ou ODT<br>até ${formatBytes(MAX_FILE_SIZE)} por arquivo</span>
                  <input type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods" data-file-input="document">
                </label>
                <div class="file-list" id="document-file-list"></div>
              </div>
              <div class="upload-column">
                <label class="dropzone" data-dropzone="image">
                  <div class="dropzone__icon">${icon('camera')}</div>
                  <strong>Adicionar comprovação por imagem</strong>
                  <span>PNG, JPG, TIFF, WEBP ou BMP<br>registros fotográficos do evento</span>
                  <input type="file" multiple accept=".png,.jpg,.jpeg,.tif,.tiff,.webp,.bmp,.svg" data-file-input="image">
                </label>
                <div class="file-list" id="image-file-list"></div>
              </div>
            </div>
          </div>
          <div id="wizard-document-warning"></div>
          <div class="detail-footer-note">
            ${icon('info')}
            <span>Documentos e imagens serão armazenados neste dispositivo e incluídos no relatório consolidado. Você poderá complementar a documentação posteriormente.</span>
          </div>
        </section>
      </div>
      <aside class="event-form-aside">
        <div class="summary-event" id="wizard-summary"></div>
      </aside>
    </div>
  `;

  const footer = `
    <button class="btn btn--ghost" type="button" data-wizard-cancel>Cancelar</button>
    <div class="spacer"></div>
    <div id="wizard-footer-actions" style="display:flex;gap:9px;align-items:center"></div>
  `;

  const modal = openModal({
    content: modalMarkup({
      title: existing ? 'Editar atividade' : 'Nova atividade acadêmica',
      subtitle: existing ? 'Atualize os dados, documentos e responsáveis pela atividade.' : 'Registre a atividade, as comprovações e as instâncias de validação.',
      body,
      footer,
      size: 'lg',
      bodyClass: 'modal__body--flush'
    }),
    onMount: (root) => bindWizard(root),
    onClose: () => localUrls.forEach(url => { try { URL.revokeObjectURL(url); } catch { /* noop */ } })
  });

  function bindWizard(root) {
    const titleInput = $('#wizard-title', root);
    titleInput.addEventListener('input', () => {
      titleInput.closest('.field')?.classList.remove('field--error');
    });
    root.addEventListener('input', (event) => {
      if (event.target.matches('[data-wizard-field]')) {
        event.target.closest('.field')?.classList.remove('field--error');
        updateWizardSummary(root);
      }
    });
    root.addEventListener('change', (event) => {
      if (event.target.matches('[data-wizard-field]')) updateWizardSummary(root);
      if (event.target.matches('[data-file-input]')) {
        addWizardFiles(root, Array.from(event.target.files || []), event.target.dataset.fileInput);
        event.target.value = '';
      }
    });

    $$('[data-file-input]', root).forEach(input => {
      const zone = input.closest('.dropzone');
      ['dragenter', 'dragover'].forEach(type => zone.addEventListener(type, (event) => {
        event.preventDefault();
        zone.classList.add('is-drag');
      }));
      ['dragleave', 'drop'].forEach(type => zone.addEventListener(type, (event) => {
        event.preventDefault();
        zone.classList.remove('is-drag');
      }));
      zone.addEventListener('drop', (event) => {
        addWizardFiles(root, Array.from(event.dataTransfer?.files || []), input.dataset.fileInput);
      });
    });

    root.addEventListener('click', (event) => {
      const addRow = event.target.closest('[data-add-row]');
      if (addRow) {
        const type = addRow.dataset.addRow;
        const list = $(`[data-list="${type}"]`, root);
        if (type === 'professors') list.insertAdjacentHTML('beforeend', professorRow({ id: uid('prof'), name: '', email: '' }));
        else list.insertAdjacentHTML('beforeend', coordinatorRow({ id: uid('coord'), name: '', course: state.settings.courses?.[0] || '' }));
        updateWizardSummary(root);
        const lastInput = list.lastElementChild?.querySelector('input');
        lastInput?.focus();
        return;
      }
      const removeRow = event.target.closest('[data-remove-row]');
      if (removeRow) {
        const row = removeRow.closest('.repeatable-row');
        const list = row?.parentElement;
        if (list && list.children.length <= 1) {
          list.querySelector('input')?.focus();
          return toast('Mantenha ao menos um registro', 'Você pode editar o registro existente.', 'info', 2500);
        }
        row?.remove();
        updateWizardSummary(root);
        return;
      }
      const removeAttachment = event.target.closest('[data-remove-attachment]');
      if (removeAttachment) {
        const id = removeAttachment.dataset.removeAttachment;
        const item = attachments.find(a => a.id === id);
        if (item && originalAttachmentIds.has(id)) removedAttachmentIds.add(id);
        attachments = attachments.filter(a => a.id !== id);
        renderAttachmentLists(root);
        updateWizardSummary(root);
        return;
      }
      if (event.target.closest('[data-wizard-next]')) {
        if (!validateWizardStep(root, step)) return;
        setStep(step + 1);
      } else if (event.target.closest('[data-wizard-back]')) {
        setStep(step - 1);
      } else if (event.target.closest('[data-wizard-cancel]')) {
        closeModal();
      } else if (event.target.closest('[data-wizard-save]')) {
        const another = event.target.closest('[data-wizard-save]').dataset.wizardSave === 'another';
        saveWizard(root, another);
      }
    });

    renderAttachmentLists(root);
    setStep(1);
    updateWizardSummary(root);
  }

  function setStep(nextStep) {
    step = Math.max(1, Math.min(3, nextStep));
    const root = activeModal?.backdrop;
    if (!root) return;
    $$('[data-wizard-panel]', root).forEach(panel => {
      panel.hidden = Number(panel.dataset.wizardPanel) !== step;
    });
    $$('[data-step-indicator]', root).forEach(ind => {
      const n = Number(ind.dataset.stepIndicator);
      ind.classList.toggle('is-active', n === step);
      ind.classList.toggle('is-done', n < step);
      ind.querySelector('.wizard-step__num').textContent = n < step ? '✓' : String(n);
    });
    $$('[data-step-line]', root).forEach(line => {
      line.classList.toggle('is-done', Number(line.dataset.stepLine) < step);
    });
    const actions = $('#wizard-footer-actions', root);
    if (actions) {
      if (step === 1) {
        actions.innerHTML = `<button class="btn btn--primary" type="button" data-wizard-next>Continuar ${icon('arrow-right')}</button>`;
      } else if (step === 2) {
        actions.innerHTML = `<button class="btn btn--secondary" type="button" data-wizard-back>${icon('arrow-left')}Voltar</button><button class="btn btn--primary" type="button" data-wizard-next>Continuar ${icon('arrow-right')}</button>`;
      } else {
        actions.innerHTML = `<button class="btn btn--secondary" type="button" data-wizard-back>${icon('arrow-left')}Voltar</button><button class="btn btn--secondary" type="button" data-wizard-save="another">Salvar e adicionar outra</button><button class="btn btn--primary" type="button" data-wizard-save="save">${icon('check')}Salvar atividade</button>`;
      }
    }
    $('.event-form-main', root)?.scrollTo({ top: 0, behavior: 'smooth' });
    updateWizardSummary(root);
  }

  function updateWizardSummary(root) {
    const summary = $('#wizard-summary', root);
    if (!summary) return;
    const title = $('#wizard-title', root)?.value.trim() || 'Nova atividade acadêmica';
    const type = typeMeta($('#wizard-type', root)?.value || 'aula-pratica');
    const date = $('#wizard-date', root)?.value;
    const start = root.querySelector('[data-wizard-field="start"]')?.value;
    const end = root.querySelector('[data-wizard-field="end"]')?.value;
    const location = $('#wizard-location', root)?.value.trim();
    const unit = $('#wizard-unit', root)?.value.trim();
    const courses = parseCourses($('#wizard-courses', root)?.value || '');
    const discipline = $('#wizard-discipline', root)?.value.trim();
    const structure = $('#wizard-structure', root)?.value;
    const students = parseStudents($('#wizard-students', root)?.value || '');
    const professorNames = $$('[data-professor-row] input[data-row-name]', root).map(i => i.value.trim()).filter(Boolean);
    const coordinatorNames = $$('[data-coordinator-row] input[data-row-name]', root).map(i => i.value.trim()).filter(Boolean);
    const director = $('#wizard-director', root)?.value.trim();
    const docs = attachments.filter(a => a.kind === 'document').length;
    const imgs = attachments.filter(a => a.kind === 'image').length;
    const signerCount = professorNames.length + coordinatorNames.length + (director ? 1 : 0);
    summary.innerHTML = `
      <div class="summary-event__label">Prévia do registro</div>
      <div class="summary-event__title">${escapeHtml(title)}</div>
      <div class="summary-event__type">${badge(type.label, type.tone === 'outline' ? 'outline' : type.tone)}</div>
      <div class="summary-event__rows">
        <div class="summary-row">${icon('calendar')}<span><strong>${escapeHtml(date ? formatDate(date, 'long') : 'Data a informar')}</strong>${start || end ? `<br>${escapeHtml(timeLabel(start))}–${escapeHtml(timeLabel(end))}` : ''}</span></div>
        <div class="summary-row">${icon('map-pin')}<span>${escapeHtml(location || 'Local a informar')}</span></div>
        <div class="summary-row">${icon('building')}<span>${escapeHtml(unit || 'Unidade base a informar')}</span></div>
        <div class="summary-row">${icon('graduation-cap')}<span>${escapeHtml(courses.join(' · ') || 'Cursos a informar')}</span></div>
        <div class="summary-row">${icon('book-open')}<span>${escapeHtml(discipline || 'Disciplina a informar')}${structure ? ` · ${escapeHtml(structureLabel(structure))}` : ''}</span></div>
        <div class="summary-row">${icon('users')}<span>${students.length ? `${students.length} ${students.length === 1 ? 'aluno participante' : 'alunos participantes'}` : 'Alunos participantes a informar'}</span></div>
        <div class="summary-row">${icon('users')}<span>${signerCount ? `${signerCount} ${signerCount === 1 ? 'signatário' : 'signatários'}` : 'Signatários a informar'}</span></div>
      </div>
      <div class="summary-event__rule"></div>
      <div class="summary-event__label">Documentação</div>
      <div class="summary-check">${icon(docs ? 'check-circle' : 'alert-circle')}${docs} ${docs === 1 ? 'documento' : 'documentos'} digitalizados</div>
      <div class="summary-check">${icon(imgs ? 'check-circle' : 'alert-circle')}${imgs} ${imgs === 1 ? 'imagem' : 'imagens'} de comprovação</div>
      <div class="summary-event__rule"></div>
      <div class="summary-event__note">${icon('shield')}<span>As assinaturas serão solicitadas aos signatários e registradas com vínculo à Assinatura Eletrônica gov.br.</span></div>
    `;
    const warning = $('#wizard-document-warning', root);
    if (warning) {
      warning.innerHTML = (!docs || !imgs)
        ? `<div class="detail-footer-note">${icon('alert-circle')}<span>${!docs && !imgs ? 'Ainda não há documentos nem comprovação por imagem.' : !docs ? 'Ainda não há documento digitalizado anexado.' : 'Ainda não há comprovação por imagem anexada.'} A atividade pode ser salva como pendente e complementada depois.</span></div>`
        : '';
    }
  }

  function addWizardFiles(root, files, kind) {
    let rejected = 0;
    const titleInput = $('#wizard-title', root);
    files.forEach(file => {
      const category = fileCategory(file.name, file.type);
      const allowed = kind === 'image' ? category === 'image' : category === 'document';
      if (!allowed) { rejected++; return; }
      if (file.size > MAX_FILE_SIZE) { rejected++; return; }
      const attachment = {
        id: uid('file'),
        name: file.name,
        size: file.size,
        type: file.type || (kind === 'image' ? 'image/*' : 'application/octet-stream'),
        kind,
        addedAt: new Date().toISOString(),
        blob: file
      };
      attachments.push(attachment);
      if (kind === 'document' && titleInput && !titleInput.value.trim()) {
        titleInput.value = titleFromFilename(file.name);
      }
    });
    if (rejected) toast('Alguns arquivos não foram adicionados', 'Verifique o formato e o limite de 30 MB por arquivo.', 'error');
    renderAttachmentLists(root);
    updateWizardSummary(root);
    if (files.length && !rejected) {
      toast(kind === 'image' ? 'Comprovação adicionada' : 'Documento adicionado', `${files.length} ${files.length === 1 ? 'arquivo' : 'arquivos'} anexado${files.length === 1 ? '' : 's'}.`, 'success', 2400);
    }
  }

  function renderAttachmentLists(root) {
    const docList = $('#document-file-list', root);
    const imageList = $('#image-file-list', root);
    if (docList) docList.innerHTML = attachmentRows(attachments.filter(a => a.kind === 'document'));
    if (imageList) imageList.innerHTML = attachmentRows(attachments.filter(a => a.kind === 'image'));
    hydrateDraftThumbs(root);
  }

  async function hydrateDraftThumbs(root) {
    for (const img of $$('[data-draft-thumb]', root)) {
      const id = img.dataset.draftThumb;
      const attachment = attachments.find(a => a.id === id);
      if (!attachment) continue;
      if (attachment.blob && isTiff(attachment.name, attachment.type)) {
        img.replaceWith(Object.assign(document.createElement('div'), { className: 'file-row__icon file-row__icon--img', innerHTML: icon('image') }));
        continue;
      }
      let blob = attachment.blob;
      if (!blob) blob = await getFileBlob(id);
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      localUrls.push(url);
      img.src = url;
    }
  }

  function validateWizardStep(root, currentStep) {
    const mark = (element, message) => {
      const field = element?.closest('.field');
      if (!field) return;
      field.classList.add('field--error');
      if (!field.querySelector('.field-error')) {
        const error = document.createElement('span');
        error.className = 'field-error';
        error.textContent = message;
        field.appendChild(error);
      }
    };
    if (currentStep === 1) {
      const checks = [
        [$('#wizard-title', root), 'Informe a denominação do evento.'],
        [$('#wizard-date', root), 'Informe a data do evento.'],
        [root.querySelector('[data-wizard-field="start"]'), 'Informe o horário de início.'],
        [root.querySelector('[data-wizard-field="end"]'), 'Informe o horário de término.'],
        [$('#wizard-location', root), 'Informe o local do evento.'],
        [$('#wizard-unit', root), 'Informe a unidade base de elaboração.'],
        [$('#wizard-courses', root), 'Informe ao menos um curso.']
      ];
      let firstInvalid = null;
      checks.forEach(([element, message]) => {
        if (!element) return;
        element.closest('.field')?.querySelector('.field-error')?.remove();
        element.closest('.field')?.classList.remove('field--error');
        if (!element.value.trim()) {
          mark(element, message);
          firstInvalid ||= element;
        }
      });
      if (firstInvalid) {
        firstInvalid.focus();
        firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
        toast('Complete os dados obrigatórios', 'Revise os campos destacados na etapa de identificação.', 'error');
        return false;
      }
    }
    if (currentStep === 2) {
      const professorInputs = $$('[data-professor-row] input[data-row-name]', root);
      const coordinatorInputs = $$('[data-coordinator-row] input[data-row-name]', root);
      const hasProfessor = professorInputs.some(i => i.value.trim());
      const hasCoordinator = coordinatorInputs.some(i => i.value.trim());
      const director = $('#wizard-director', root);
      if (!hasProfessor) {
        professorInputs[0]?.focus();
        toast('Informe o professor responsável', 'A folha de assinaturas precisa de ao menos um docente responsável.', 'error');
        return false;
      }
      if (!hasCoordinator) {
        coordinatorInputs[0]?.focus();
        toast('Informe a coordenação do curso', 'Inclua o nome do coordenador responsável pelo viso.', 'error');
        return false;
      }
      if (!director.value.trim()) {
        director.focus();
        mark(director, 'Informe a denominação do diretor(a).');
        toast('Informe a direção da unidade', 'O visto da direção é obrigatório na consolidação.', 'error');
        return false;
      }
    }
    return true;
  }

  function collectWizard(root) {
    const professors = $$('[data-professor-row]', root).map(row => ({
      id: row.dataset.id || uid('prof'),
      name: row.querySelector('[data-row-name]')?.value.trim() || '',
      email: row.querySelector('[data-row-email]')?.value.trim() || ''
    })).filter(p => p.name);
    const coordinators = $$('[data-coordinator-row]', root).map(row => ({
      id: row.dataset.id || uid('coord'),
      name: row.querySelector('[data-row-name]')?.value.trim() || '',
      course: row.querySelector('[data-row-course]')?.value.trim() || '',
      email: row.querySelector('[data-row-email]')?.value.trim() || ''
    })).filter(c => c.name);
    const event = {
      ...base,
      id: base.id,
      title: $('#wizard-title', root).value.trim(),
      type: $('#wizard-type', root).value,
      date: $('#wizard-date', root).value,
      start: root.querySelector('[data-wizard-field="start"]').value,
      end: root.querySelector('[data-wizard-field="end"]').value,
      location: $('#wizard-location', root).value.trim(),
      baseUnit: $('#wizard-unit', root).value.trim(),
      courses: parseCourses($('#wizard-courses', root).value),
      discipline: $('#wizard-discipline', root).value.trim(),
      structure: $('#wizard-structure', root).value,
      description: $('#wizard-description', root).value.trim(),
      students: parseStudents($('#wizard-students', root).value),
      professors,
      coordinators,
      director: {
        name: $('#wizard-director', root).value.trim(),
        role: $('#wizard-director-role', root).value.trim() || 'Diretor(a) da Unidade',
        email: base.director?.email || ''
      },
      attachments: attachments.map(({ blob, ...meta }) => meta),
      signatures: { ...(base.signatures || {}) },
      createdAt: base.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return event;
  }

  async function saveWizard(root, addAnother = false) {
    if (!validateWizardStep(root, 1) || !validateWizardStep(root, 2)) {
      setStep(!validateWizardStep(root, 1) ? 1 : 2);
      return;
    }
    const event = collectWizard(root);
    if (!event.title || !event.date || !event.start || !event.end || !event.location || !event.baseUnit || !event.courses.length) {
      setStep(1);
      return;
    }
    const saveButtons = $$('[data-wizard-save]', root);
    saveButtons.forEach(btn => { btn.disabled = true; });
    try {
      const newFiles = attachments.filter(a => a.blob);
      for (const file of newFiles) {
        await putFile({ id: file.id, blob: file.blob, name: file.name, type: file.type, size: file.size });
      }
      await saveEvent(event);
      if (removedAttachmentIds.size) await deleteFiles([...removedAttachmentIds]);
      updateEventInState(event);
      closeModal();
      updateShell();
      toast(
        existing ? 'Atividade atualizada' : 'Atividade registrada',
        event.attachments.length ? 'Os documentos e comprovações já integram o acervo.' : 'Você ainda pode adicionar documentos e imagens.',
        'success'
      );
      await renderRoute();
      if (addAnother) {
        setTimeout(() => openEventWizard(null, {
          prefill: {
            date: event.date,
            baseUnit: event.baseUnit,
            courses: event.courses,
            type: event.type,
            director: event.director
          }
        }), 180);
      }
    } catch (error) {
      console.error(error);
      saveButtons.forEach(btn => { btn.disabled = false; });
      toast('Não foi possível salvar', error.message || 'Tente novamente.', 'error');
    }
  }
}

function professorRow(person = {}) {
  return `<div class="repeatable-row" data-professor-row data-id="${escapeHtml(person.id || uid('prof'))}">
    <div class="field"><label class="sr-only">Nome do professor</label><input data-row-name value="${escapeHtml(person.name || '')}" placeholder="Nome completo do professor"></div>
    <div class="field"><label class="sr-only">E-mail do professor</label><input data-row-email type="email" value="${escapeHtml(person.email || '')}" placeholder="E-mail institucional"></div>
    <button class="icon-btn" type="button" data-remove-row aria-label="Remover professor">${icon('trash', 'icon icon--sm')}</button>
  </div>`;
}

function coordinatorRow(coordinator = {}) {
  return `<div class="repeatable-row" data-coordinator-row data-id="${escapeHtml(coordinator.id || uid('coord'))}">
    <div class="field"><label class="sr-only">Nome do coordenador</label><input data-row-name value="${escapeHtml(coordinator.name || '')}" placeholder="Nome do coordenador(a)"></div>
    <div class="field"><label class="sr-only">Curso do coordenador</label><input data-row-course value="${escapeHtml(coordinator.course || '')}" placeholder="Curso"></div>
    <div class="field"><label class="sr-only">E-mail do coordenador</label><input data-row-email type="email" value="${escapeHtml(coordinator.email || '')}" placeholder="E-mail"></div>
    <button class="icon-btn" type="button" data-remove-row aria-label="Remover coordenação">${icon('trash', 'icon icon--sm')}</button>
  </div>`;
}

function parseCourses(value) {
  return [...new Set(String(value).split(/[,;]/).map(v => v.trim()).filter(Boolean))];
}

function attachmentRows(items) {
  if (!items.length) return `<div class="detail-footer-note" style="margin-top:10px">${icon('paperclip')}<span>Nenhum arquivo anexado nesta categoria.</span></div>`;
  return items.map(item => `<div class="file-row">
    ${item.kind === 'image'
      ? `<img class="file-row__thumb" data-draft-thumb="${item.id}" alt="">`
      : `<div class="file-row__icon">${icon('file-text')}</div>`}
    <div class="file-row__body">
      <div class="file-row__name">${escapeHtml(item.name)}</div>
      <div class="file-row__meta">${escapeHtml(fileTypeLabel(item.name))} · ${formatBytes(item.size || 0)}</div>
    </div>
    <button class="icon-btn file-row__remove" type="button" data-remove-attachment="${item.id}" aria-label="Remover ${escapeHtml(item.name)}">${icon('x', 'icon icon--sm')}</button>
  </div>`).join('');
}

/* ============================================================
   Signature workflow
   ============================================================ */
function openSignatureModal(eventId, signerKey, options = {}) {
  const event = findEvent(eventId);
  if (!event) return toast('Atividade não encontrada', '', 'error');
  const signer = getEventSigners(event).find(s => s.key === signerKey);
  if (!signer) return toast('Signatário não encontrado', '', 'error');
  const signature = getSignature(event, signerKey);

  if (signature?.status === 'assinado') {
    return openSignedDetails(event, signer, signature, options);
  }

  const body = `
    <div class="govbanner">
      <div class="govbanner__mark">gov.br</div>
      <div class="govbanner__text">
        <strong>Assinatura eletrônica oficial</strong>
        <span>Abra o serviço oficial, entre com sua conta gov.br e conclua a assinatura. Depois, registre abaixo o comprovante ou código de verificação.</span>
      </div>
      <a class="btn btn--sm btn--secondary" href="${SIGNATURE_URL}" target="_blank" rel="noopener">${icon('external-link')}Abrir serviço oficial</a>
    </div>

    <div class="signature-card" style="margin-top:16px">
      <div class="signature-card__avatar">${escapeHtml(initials(signer.name))}</div>
      <div class="signature-card__body">
        <div class="signature-card__name">${escapeHtml(signer.name)}</div>
        <div class="signature-card__role">${escapeHtml(signer.role)}${signer.course ? ` · ${escapeHtml(signer.course)}` : ''}</div>
      </div>
      <span class="gov-status gov-status--pending">${icon('clock')}pendente</span>
    </div>

    <div class="form-grid" style="margin-top:18px">
      <div class="field">
        <label for="sign-cpf">CPF do signatário <span class="req">*</span></label>
        <input id="sign-cpf" inputmode="numeric" placeholder="000.000.000-00" data-sign-field="cpf" autocomplete="off">
        <small>Usado apenas para compor o registro de identificação no relatório.</small>
      </div>
      <div class="field">
        <label for="sign-code">Código de verificação gov.br</label>
        <input id="sign-code" placeholder="Ex.: XXXX-XXXX-XXXX" data-sign-field="code" autocomplete="off">
      </div>
      <div class="field span-2">
        <label for="sign-receipt">Comprovante de assinatura</label>
        <input id="sign-receipt" type="file" accept=".pdf,.png,.jpg,.jpeg" data-sign-field="receipt">
        <small>Anexe o comprovante emitido pela Assinatura Eletrônica gov.br (PDF ou imagem). Você também pode informar apenas o código de verificação.</small>
      </div>
    </div>

    <label class="checkline" style="margin-top:16px">
      <input type="checkbox" data-sign-field="confirm">
      <span>Confirmo que a assinatura foi concluída no serviço oficial Assinatura Eletrônica gov.br pelo signatário identificado acima.</span>
    </label>

    <div class="detail-footer-note">
      ${icon('info')}
      <span>O Acervo UCM não realiza autenticação gov.br diretamente. O registro local documenta a conclusão da assinatura e os dados do comprovante para fins de consolidação institucional.</span>
    </div>
  `;

  openModal({
    content: modalMarkup({
      title: 'Registrar assinatura gov.br',
      subtitle: `${signer.name} · ${signer.role}`,
      body,
      footer: `
        <button class="btn btn--secondary" type="button" data-close-modal>Cancelar</button>
        <div class="spacer"></div>
        <button class="btn btn--primary" type="button" id="confirm-signature">${icon('shield')}Registrar assinatura</button>
      `,
      size: 'md'
    }),
    onMount: (root) => {
      const cpf = root.querySelector('[data-sign-field="cpf"]');
      cpf.addEventListener('input', () => { cpf.value = maskCpf(cpf.value); });
      root.querySelector('#confirm-signature').addEventListener('click', async () => {
        const button = root.querySelector('#confirm-signature');
        const cpfValue = root.querySelector('[data-sign-field="cpf"]').value;
        const code = root.querySelector('[data-sign-field="code"]').value.trim();
        const receipt = root.querySelector('[data-sign-field="receipt"]').files?.[0];
        const confirmed = root.querySelector('[data-sign-field="confirm"]').checked;
        if (cpfValue.replace(/\D/g, '').length !== 11) {
          toast('CPF incompleto', 'Informe os 11 dígitos do CPF do signatário.', 'error');
          root.querySelector('[data-sign-field="cpf"]').focus();
          return;
        }
        if (!code && !receipt) {
          toast('Comprovação da assinatura necessária', 'Informe o código de verificação ou anexe o comprovante emitido pelo gov.br.', 'error');
          return;
        }
        if (!confirmed) {
          toast('Confirmação necessária', 'Marque a confirmação de conclusão da assinatura no gov.br.', 'error');
          return;
        }
        button.disabled = true;
        button.textContent = 'Registrando…';
        try {
          let receiptMeta = null;
          if (receipt) {
            if (receipt.size > MAX_FILE_SIZE) throw new Error('O comprovante excede o limite de 30 MB.');
            const fileId = uid('file');
            await putFile({ id: fileId, blob: receipt, name: receipt.name, type: receipt.type, size: receipt.size });
            receiptMeta = {
              id: fileId, name: receipt.name, size: receipt.size,
              type: receipt.type, kind: fileCategory(receipt.name, receipt.type) === 'image' ? 'image' : 'document',
              addedAt: new Date().toISOString(), govReceipt: true
            };
          }
          const nextSignature = {
            status: 'assinado',
            method: 'gov.br',
            signedAt: new Date().toISOString(),
            code: code || verificationCode(event.id + signerKey + Date.now()),
            signerName: signer.name,
            cpfMasked: cpfLastDigits(cpfValue),
            receiptAttachmentId: receiptMeta?.id || null
          };
          const updated = {
            ...event,
            attachments: [...(event.attachments || []), ...(receiptMeta ? [receiptMeta] : [])],
            signatures: { ...(event.signatures || {}), [signerKey]: nextSignature },
            updatedAt: new Date().toISOString()
          };
          await saveEvent(updated);
          updateEventInState(updated);
          closeModal();
          updateShell();
          toast('Assinatura registrada', `${signer.name} · ${nextSignature.code}`, 'success');
          if (typeof options.onSuccess === 'function') options.onSuccess(updated);
          else await renderRoute();
        } catch (error) {
          console.error(error);
          button.disabled = false;
          button.innerHTML = `${icon('shield')}Registrar assinatura`;
          toast('Não foi possível registrar', error.message || 'Tente novamente.', 'error');
        }
      });
    }
  });
}

function openSignedDetails(event, signer, signature, options = {}) {
  const receipt = (event.attachments || []).find(a => a.id === signature.receiptAttachmentId);
  const body = `
    <div class="signature-card" style="border-color:#cfe3d7;background:linear-gradient(120deg,var(--green-soft),var(--surface))">
      <div class="signature-card__avatar" style="background:#dceee4;color:var(--green)">${escapeHtml(initials(signer.name))}</div>
      <div class="signature-card__body">
        <div class="signature-card__name">${escapeHtml(signer.name)}</div>
        <div class="signature-card__role">${escapeHtml(signer.role)}${signer.course ? ` · ${escapeHtml(signer.course)}` : ''}</div>
      </div>
      <span class="gov-status gov-status--signed">${icon('check-circle')}assinado</span>
    </div>
    <div class="signature-detail-grid">
      <div class="signature-detail-cell"><div class="signature-detail-cell__label">Data e hora</div><div class="signature-detail-cell__value">${new Date(signature.signedAt).toLocaleString('pt-BR')}</div></div>
      <div class="signature-detail-cell"><div class="signature-detail-cell__label">Método</div><div class="signature-detail-cell__value">Assinatura Eletrônica gov.br</div></div>
      <div class="signature-detail-cell"><div class="signature-detail-cell__label">CPF</div><div class="signature-detail-cell__value">${escapeHtml(signature.cpfMasked || '—')}</div></div>
      <div class="signature-detail-cell"><div class="signature-detail-cell__label">Código de verificação</div><div class="signature-detail-cell__value mono">${escapeHtml(signature.code || '—')}</div></div>
      <div class="signature-detail-cell" style="grid-column:span 2"><div class="signature-detail-cell__label">Atividade</div><div class="signature-detail-cell__value">${escapeHtml(event.title)} · ${escapeHtml(formatDate(event.date, 'short'))}</div></div>
    </div>
    ${receipt ? `<div class="document-list" style="margin-top:14px">${documentRow(receipt)}</div>` : ''}
    <div class="detail-footer-note">
      ${icon('shield')}
      <span>O código acima identifica a assinatura registrada no Acervo UCM. A validade oficial deve ser confirmada no serviço Assinatura Eletrônica gov.br.</span>
    </div>
  `;
  openModal({
    content: modalMarkup({
      title: 'Assinatura registrada',
      subtitle: `${signer.name} · ${signer.role}`,
      body,
      footer: `
        <button class="btn btn--secondary" type="button" data-close-modal>Fechar</button>
        <div class="spacer"></div>
        <button class="btn btn--danger btn--sm" type="button" id="remove-signature">${icon('trash')}Remover registro</button>
        <a class="btn btn--primary" href="${SIGNATURE_URL}" target="_blank" rel="noopener">${icon('external-link')}Abrir serviço oficial</a>
      `,
      size: 'md'
    }),
    onMount: (root) => {
      root.querySelector('#remove-signature').addEventListener('click', () => {
        confirmAction({
          title: 'Remover assinatura?',
          message: 'O registro local de assinatura será removido desta atividade. O comprovante anexado será mantido no acervo.',
          confirmLabel: 'Remover assinatura',
          onConfirm: async () => {
            const signatures = { ...(event.signatures || {}) };
            delete signatures[signer.key];
            const updated = { ...event, signatures, updatedAt: new Date().toISOString() };
            await saveEvent(updated);
            updateEventInState(updated);
            updateShell();
            toast('Registro removido', 'A assinatura voltará a constar como pendente.', 'info');
            if (typeof options.onSuccess === 'function') options.onSuccess(updated);
            else await renderRoute();
          }
        });
      });
    }
  });
}

/* ============================================================
   Consolidation page
   ============================================================ */
async function renderConsolidationPage(container) {
  ensureReportSelection();
  const selected = selectedReportEvents();
  const config = state.reportConfig;
  const allIds = state.events.map(e => e.id);
  const selectedIds = new Set(config.selectedIds || []);
  const allSelected = allIds.length > 0 && allIds.every(id => selectedIds.has(id));
  const reportHours = selected.reduce((sum, e) => sum + eventDuration(e), 0);

  container.innerHTML = `
    ${demoBanner()}
    ${pageHead({
      eyebrow: 'Relatório institucional · composição',
      title: 'Consolidação do relatório',
      subtitle: 'Selecione as atividades, defina a apresentação e revise o documento final antes de imprimir ou salvar em PDF.',
      actions: `
        <button class="btn btn--secondary" type="button" data-action="print-report">${icon('printer')}Imprimir / PDF</button>
        <button class="btn btn--primary" type="button" data-action="refresh-preview">${icon('refresh')}Atualizar prévia</button>
      `
    })}

    <div class="consolidation-layout">
      <div class="builder">
        <section class="card builder-card">
          <div class="card__head" style="margin-bottom:13px">
            <div><h2 class="card__title" style="font-size:19px">Configuração</h2><p class="card__sub">Documento e escopo da consolidação</p></div>
            <span class="badge badge--wine">${selected.length} selecionada${selected.length === 1 ? '' : 's'}</span>
          </div>
          <div class="builder-section" style="margin-top:0;padding-top:0;border-top:0">
            <div class="field">
              <label for="report-title">Título do relatório</label>
              <input id="report-title" value="${escapeHtml(config.title)}" data-report-field="title">
            </div>
            <div class="field" style="margin-top:11px">
              <label for="report-subtitle">Subtítulo</label>
              <input id="report-subtitle" value="${escapeHtml(config.subtitle)}" data-report-field="subtitle">
            </div>
            <div class="field" style="margin-top:11px">
              <label for="report-intro">Apresentação</label>
              <textarea id="report-intro" data-report-field="intro" style="min-height:75px">${escapeHtml(config.intro)}</textarea>
            </div>
          </div>
          <div class="builder-section">
            <div class="builder-section__title">${icon('layout-grid')}Estrutura do documento</div>
            <label class="option-row"><input type="checkbox" data-report-option="includeCover" ${config.includeCover ? 'checked' : ''}><span>Capa institucional</span></label>
            <label class="option-row"><input type="checkbox" data-report-option="includeSummary" ${config.includeSummary ? 'checked' : ''}><span>Panorama e relação consolidada</span></label>
            <label class="option-row"><input type="checkbox" data-report-option="includeImages" ${config.includeImages ? 'checked' : ''}><span>Comprovações por imagem</span></label>
            <label class="option-row"><input type="checkbox" data-report-option="includeDocs" ${config.includeDocs ? 'checked' : ''}><span>Índice de documentos digitalizados</span></label>
            <label class="option-row" title="Cada documento digitalizado é exibido integralmente em páginas próprias do relatório."><input type="checkbox" data-report-option="includeDocPages" ${config.includeDocPages !== false ? 'checked' : ''}><span>Documentos digitalizados na íntegra<small class="option-row__hint">Páginas exclusivas · PDFs completos</small></span></label>
            <label class="option-row"><input type="checkbox" data-report-option="includeSignatures" ${config.includeSignatures ? 'checked' : ''}><span>Folha de assinaturas e vistos</span></label>
          </div>
        </section>

        <section class="card builder-card">
          <div class="builder-section__title" style="margin-top:0">${icon('calendar')}Atividades incluídas</div>
          <div class="event-checklist" id="report-event-checklist">
            ${state.events.length ? state.events.map(event => `<label class="check-event">
              <input type="checkbox" data-report-select="${event.id}" ${selectedIds.has(event.id) ? 'checked' : ''}>
              <div class="check-event__body">
                <div class="check-event__title">${escapeHtml(event.title)}</div>
                <div class="check-event__meta">${escapeHtml(formatDate(event.date, 'short'))} · ${escapeHtml(typeMeta(event.type).label)} · ${escapeHtml(event.baseUnit || '')}</div>
              </div>
            </label>`).join('') : '<div class="detail-footer-note" style="margin-top:10px">' + icon('calendar') + '<span>Nenhuma atividade cadastrada.</span></div>'}
          </div>
          <div class="selection-summary">
            <span><strong>${selected.length}</strong> de ${state.events.length} atividades</span>
            <button class="btn btn--ghost btn--sm" type="button" id="toggle-all-events">${allSelected ? 'Desmarcar todas' : 'Selecionar todas'}</button>
          </div>
          <div class="builder-total" style="margin-top:10px">${icon('clock')}<span><strong>${formatDuration(reportHours, true)}</strong> de carga horária · ${selected.reduce((s, e) => s + eventDocStats(e).docsCount + eventDocStats(e).imagesCount, 0)} comprovações</span></div>
        </section>

        <div class="builder-total">${icon('shield')}<span>O documento final inclui os espaços de assinatura dos professores, o visto das coordenações e a validação da direção.</span></div>
      </div>

      <section class="preview-shell" aria-label="Pré-visualização do relatório">
        <div class="preview-toolbar">
          <span class="preview-toolbar__title">Pré-visualização A4</span>
          <span class="preview-toolbar__status">atualizada</span>
          <div class="spacer"></div>
          <span class="badge badge--outline" id="preview-page-count">—</span>
          <button class="btn btn--secondary btn--sm" type="button" data-action="print-report">${icon('printer')}PDF</button>
        </div>
        <div class="preview-scroll" id="report-preview-scroll">
          <div class="preview-pages" id="report-preview-pages" style="--preview-scale:.66">
            <div class="report-empty" style="min-height:500px">
              ${icon('file-text')}
              <strong>Montando a prévia</strong>
              <span>O documento será atualizado automaticamente com as atividades selecionadas.</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  `;

  bindConsolidationEvents(container);
  await refreshReportPreview();
  requestAnimationFrame(updatePreviewScale);
}

function bindConsolidationEvents(container) {
  const schedule = debounce(() => {
    persistReportConfig();
    refreshReportPreview();
  }, 260);

  $$('[data-report-field]', container).forEach(input => {
    input.addEventListener('input', () => {
      state.reportConfig[input.dataset.reportField] = input.value;
      schedule();
    });
  });
  $$('[data-report-option]', container).forEach(input => {
    input.addEventListener('change', () => {
      state.reportConfig[input.dataset.reportOption] = input.checked;
      persistReportConfig();
      refreshReportPreview();
    });
  });
  $$('[data-report-select]', container).forEach(input => {
    input.addEventListener('change', () => {
      const selected = new Set(state.reportConfig.selectedIds || []);
      if (input.checked) selected.add(input.dataset.reportSelect);
      else selected.delete(input.dataset.reportSelect);
      state.reportConfig.selectedIds = state.events.map(e => e.id).filter(id => selected.has(id));
      persistReportConfig();
      updateReportSelectionUI(container);
      refreshReportPreview();
    });
  });
  $('#toggle-all-events', container)?.addEventListener('click', () => {
    const allSelected = state.reportConfig.selectedIds?.length === state.events.length;
    state.reportConfig.selectedIds = allSelected ? [] : state.events.map(e => e.id);
    $$('[data-report-select]', container).forEach(input => { input.checked = !allSelected; });
    persistReportConfig();
    updateReportSelectionUI(container);
    refreshReportPreview();
  });
  window.addEventListener('resize', updatePreviewScale, { passive: true });
}

function updateReportSelectionUI(container) {
  const selected = selectedReportEvents();
  const badge = $('.builder .card__head .badge', container);
  if (badge) badge.textContent = `${selected.length} selecionada${selected.length === 1 ? '' : 's'}`;
  const summary = $('.selection-summary strong', container);
  if (summary) summary.textContent = selected.length;
  const button = $('#toggle-all-events', container);
  if (button) button.textContent = selected.length === state.events.length ? 'Desmarcar todas' : 'Selecionar todas';
  const total = $('.builder-total strong', container);
  if (total) total.textContent = formatDuration(selected.reduce((s, e) => s + eventDuration(e), 0), true);
}

async function refreshReportPreview() {
  const pagesRoot = $('#report-preview-pages');
  if (!pagesRoot) return;
  const token = ++state.previewToken;
  const events = selectedReportEvents();
  const config = state.reportConfig;
  const status = $('.preview-toolbar__status');
  const setStatus = text => { if (status && status.isConnected) status.textContent = text; };
  setStatus('atualizando…');
  try {
    const result = await buildReport({ events, settings: state.settings, config });
    if (token !== state.previewToken || !pagesRoot.isConnected) return;
    pagesRoot.innerHTML = result.pages.map((html, i) => `
      <div class="preview-page-wrap" style="--preview-scale:.66">
        ${html}
        <div class="preview-page-number">Página ${i + 1} de ${result.meta.totalPages}</div>
      </div>
    `).join('');
    const count = $('#preview-page-count');
    if (count) count.textContent = `${result.meta.totalPages} ${result.meta.totalPages === 1 ? 'página' : 'páginas'}`;
    setStatus('atualizada');
    updatePreviewScale();
  } catch (error) {
    console.error(error);
    setStatus('erro na prévia');
    pagesRoot.innerHTML = `<div class="report-empty" style="min-height:400px">${icon('alert-triangle')}<strong>Não foi possível montar a prévia</strong><span>${escapeHtml(error.message || 'Tente novamente.')}</span></div>`;
  }
}

function updatePreviewScale() {
  const scroller = $('#report-preview-scroll');
  const pages = $('#report-preview-pages');
  if (!scroller || !pages) return;
  const available = scroller.clientWidth - 48;
  const scale = Math.min(0.78, Math.max(0.34, available / 794));
  pages.style.setProperty('--preview-scale', scale.toFixed(3));
  $$('.preview-page-wrap', pages).forEach(wrap => wrap.style.setProperty('--preview-scale', scale.toFixed(3)));
}

async function printReport() {
  const events = selectedReportEvents();
  if (!events.length) return toast('Nenhuma atividade selecionada', 'Marque ao menos uma atividade para gerar o relatório.', 'info');
  const button = document.querySelector('[data-action="print-report"]');
  if (button) button.disabled = true;
  try {
    const result = await buildReport({ events, settings: state.settings, config: state.reportConfig });
    printRoot.innerHTML = result.html;
    await document.fonts?.ready;
    setTimeout(() => {
      window.print();
      window.addEventListener('afterprint', () => { printRoot.innerHTML = ''; }, { once: true });
      if (button) button.disabled = false;
    }, 250);
  } catch (error) {
    console.error(error);
    toast('Não foi possível preparar a impressão', error.message || 'Tente novamente.', 'error');
    if (button) button.disabled = false;
  }
}

/* ============================================================
   Signatures page
   ============================================================ */
async function renderSignaturesPage(container) {
  const rows = allSigners(state.events);
  const signed = rows.filter(r => r.signature?.status === 'assinado').length;
  const pending = rows.length - signed;
  const coordinators = rows.filter(r => r.signer.kind === 'coordenador');
  const signedCoordinators = coordinators.filter(r => r.signature?.status === 'assinado').length;
  const filtered = rows.filter(row => {
    if (state.signatureFilter === 'pending') return row.signature?.status !== 'assinado';
    if (state.signatureFilter === 'signed') return row.signature?.status === 'assinado';
    return true;
  });
  const grouped = groupBy(filtered, row => row.event.id);
  const eventsById = Object.fromEntries(state.events.map(e => [e.id, e]));
  const eventIds = sortEvents(filtered.map(r => r.event), 'desc').map(e => e.id);
  const uniqueEventIds = [...new Set(eventIds)];

  container.innerHTML = `
    ${demoBanner()}
    ${pageHead({
      eyebrow: 'Validação institucional · assinaturas',
      title: 'Assinaturas e vistos',
      subtitle: 'Acompanhe as assinaturas dos professores, os vistos das coordenações e a validação da direção.',
      actions: `<a class="btn btn--primary" href="#/consolidacao">${icon('file-text')}Consolidar relatório</a>`
    })}

    <div class="signature-summary-grid">
      <div class="sig-summary sig-summary--green"><div class="sig-summary__label">Assinaturas concluídas</div><div class="sig-summary__value">${signed} <small>de ${rows.length}</small></div></div>
      <div class="sig-summary sig-summary--wine"><div class="sig-summary__label">Pendentes</div><div class="sig-summary__value">${pending}</div></div>
      <div class="sig-summary"><div class="sig-summary__label">Coordenações validadas</div><div class="sig-summary__value">${signedCoordinators} <small>de ${coordinators.length}</small></div></div>
      <div class="sig-summary"><div class="sig-summary__label">Atividades com pendência</div><div class="sig-summary__value">${new Set(rows.filter(r => r.signature?.status !== 'assinado').map(r => r.event.id)).size}</div></div>
    </div>

    <div class="govbanner" style="margin-bottom:16px">
      <div class="govbanner__mark">gov.br</div>
      <div class="govbanner__text">
        <strong>Assinatura digital vinculada à Assinatura Eletrônica gov.br</strong>
        <span>O registro no Acervo UCM documenta a conclusão da assinatura oficial. Abra o serviço, entre com a conta gov.br, assine o documento e registre o código ou comprovante.</span>
      </div>
      <a class="btn btn--secondary btn--sm" href="${SIGNATURE_URL}" target="_blank" rel="noopener">${icon('external-link')}Abrir Assinatura Eletrônica gov.br</a>
    </div>

    <div class="sig-toolbar">
      <div class="filter-chips" style="margin:0">
        <button class="filter-chip ${state.signatureFilter === 'all' ? 'is-active' : ''}" data-sig-filter="all">Todas <span>${rows.length}</span></button>
        <button class="filter-chip ${state.signatureFilter === 'pending' ? 'is-active' : ''}" data-sig-filter="pending">Pendentes <span>${pending}</span></button>
        <button class="filter-chip ${state.signatureFilter === 'signed' ? 'is-active' : ''}" data-sig-filter="signed">Concluídas <span>${signed}</span></button>
      </div>
      <div class="spacer"></div>
      <span class="badge badge--outline">${filtered.length} registros exibidos</span>
    </div>

    ${uniqueEventIds.length ? uniqueEventIds.map(eventId => {
      const event = eventsById[eventId] || grouped[eventId]?.[0]?.event;
      if (!event) return '';
      const members = sortSigners(grouped[eventId] || []);
      const stats = signatureStats(event);
      return `<section class="sig-event-group">
        <div class="sig-event-group__head">
          <div class="sig-event-group__date">${escapeHtml(formatDate(event.date, 'numeric').slice(0, 2))}<span>${escapeHtml(formatDate(event.date, 'numeric').slice(3, 5))}</span></div>
          <div class="sig-event-group__title">${escapeHtml(event.title)}<div class="sig-event-group__meta">${escapeHtml(typeMeta(event.type).label)} · ${escapeHtml(event.baseUnit || '')}</div></div>
          ${badge(`${stats.signed}/${stats.total} assinadas`, stats.pending ? 'amber' : 'green', true)}
        </div>
        <div class="sig-event-group__body">
          ${members.map(({ signer, signature }) => {
            const isSigned = signature?.status === 'assinado';
            return `<div class="sig-row">
              <div class="sig-row__avatar" style="${isSigned ? 'background:var(--green-soft);color:var(--green)' : ''}">${escapeHtml(initials(signer.name))}</div>
              <div class="sig-row__body">
                <div class="sig-row__name">${escapeHtml(signer.name)}</div>
                <div class="sig-row__role">${escapeHtml(signer.role)}${signer.course ? ` · ${escapeHtml(signer.course)}` : ''}</div>
              </div>
              <div class="sig-row__right">
                ${isSigned
                  ? `<div class="sig-row__date"><strong>${new Date(signature.signedAt).toLocaleDateString('pt-BR')}</strong>${escapeHtml(signature.code || '')}</div><span class="gov-status gov-status--signed">${icon('check-circle')}assinado</span>`
                  : `<span class="gov-status gov-status--pending">${icon('clock')}pendente</span>`}
                <button class="btn btn--sm ${isSigned ? 'btn--ghost' : 'btn--secondary'}" type="button" data-sign-event="${event.id}" data-sign-key="${escapeHtml(signer.key)}">${isSigned ? 'Detalhes' : 'Assinar'}</button>
              </div>
            </div>`;
          }).join('')}
        </div>
      </section>`;
    }).join('') : emptyState({
      iconName: 'signature',
      title: state.signatureFilter === 'all' ? 'Nenhum signatário cadastrado' : 'Nenhum registro neste filtro',
      description: state.signatureFilter === 'all' ? 'Inclua professores, coordenações e direção nas atividades para gerar a folha de validações.' : 'Altere o filtro para visualizar as demais assinaturas.',
      action: '<a class="btn btn--primary btn--sm" href="#/eventos">Abrir atividades</a>'
    })}
  `;

  $$('[data-sig-filter]', container).forEach(button => button.addEventListener('click', () => {
    state.signatureFilter = button.dataset.sigFilter;
    renderRoute();
  }));
}

/* ============================================================
   Settings page
   ============================================================ */
async function renderSettingsPage(container) {
  const settings = state.settings;
  const demoCount = state.events.filter(e => e.demo).length;
  container.innerHTML = `
    ${demoBanner()}
    ${pageHead({
      eyebrow: 'Sistema · preferências institucionais',
      title: 'Configurações',
      subtitle: 'Ajuste a identidade institucional, as unidades, os cursos e as opções de armazenamento do acervo.',
      actions: `<button class="btn btn--primary" type="button" id="save-settings-top">${icon('check')}Salvar alterações</button>`
    })}
    <div class="settings-grid">
      <div>
        <section class="card settings-card">
          <div class="settings-card__head"><h2>Identidade institucional</h2><p>Dados utilizados na capa e nos documentos consolidados.</p></div>
          <form id="settings-form">
            <div class="form-grid">
              <div class="field span-2"><label for="set-institution">Instituição</label><input id="set-institution" data-setting="institution" value="${escapeHtml(settings.institution)}"></div>
              <div class="field"><label for="set-unit">Unidade padrão</label><input id="set-unit" data-setting="unit" value="${escapeHtml(settings.unit)}"></div>
              <div class="field"><label for="set-coordinator">Identificação da coordenação</label><input id="set-coordinator" data-setting="coordinatorName" value="${escapeHtml(settings.coordinatorName || 'Coordenação Acadêmica')}"></div>
              <div class="field"><label for="set-director">Diretor(a) padrão</label><input id="set-director" data-setting="directorName" value="${escapeHtml(settings.director?.name || '')}" placeholder="Nome completo"></div>
              <div class="field"><label for="set-director-role">Cargo da direção</label><input id="set-director-role" data-setting="directorRole" value="${escapeHtml(settings.director?.role || 'Diretor(a) da Unidade')}"></div>
              <div class="field span-2"><label for="set-units">Unidades cadastradas</label><textarea id="set-units" data-setting="units">${escapeHtml((settings.units || []).join('\n'))}</textarea><small>Uma unidade por linha.</small></div>
              <div class="field span-2"><label for="set-courses">Cursos cadastrados</label><textarea id="set-courses" data-setting="courses">${escapeHtml((settings.courses || []).join('\n'))}</textarea><small>Um curso por linha. Serão sugeridos no cadastro de atividades.</small></div>
              <div class="field span-2"><label for="set-footer">Texto de rodapé institucional</label><input id="set-footer" data-setting="reportFooter" value="${escapeHtml(settings.reportFooter || '')}"></div>
            </div>
            <div class="settings-actions"><button class="btn btn--primary" type="submit">${icon('check')}Salvar configurações</button></div>
          </form>
        </section>

        <section class="card settings-card danger-zone">
          <div class="settings-card__head"><h2>Dados do acervo</h2><p>Gerencie o armazenamento local das atividades e comprovações.</p></div>
          <div class="stack">
            <div class="row-between"><div><strong style="font-size:11.5px">Dados de demonstração</strong><p>${demoCount ? `${demoCount} atividades de exemplo com documentos, imagens e assinaturas.` : 'Nenhum dado de demonstração ativo.'}</p></div><button class="btn btn--secondary btn--sm" type="button" data-action="clear-demo" ${demoCount ? '' : 'disabled'}>${icon('trash')}Limpar</button></div>
            <div class="divider"></div>
            <div class="row-between"><div><strong style="font-size:11.5px">Backup do acervo</strong><p>Exporte atividades, configurações e arquivos em um arquivo JSON.</p></div><button class="btn btn--secondary btn--sm" type="button" data-action="export-backup">${icon('download')}Exportar</button></div>
            <div class="divider"></div>
            <div class="row-between"><div><strong style="font-size:11.5px">Apagar todas as atividades</strong><p>Remove definitivamente eventos, documentos, imagens e assinaturas deste dispositivo.</p></div><button class="btn btn--danger btn--sm" type="button" data-action="clear-all">${icon('trash')}Apagar</button></div>
          </div>
        </section>
      </div>

      <div>
        <section class="card settings-card about-card">
          <img class="brand__logo" src="assets/ucam-logo.png" alt="Universidade Candido Mendes">
          <h2>Acervo UCM</h2>
          <p>Aplicação de consolidação de atividades acadêmicas desenvolvida para o registro de aulas práticas, projetos de extensão e visitas programadas.</p>
          <div class="about-card__line"></div>
          <p>Documentos aceitos: PDF, DOCX, XLSX, PPTX. Comprovações: PNG, JPG, TIFF, WEBP. Assinaturas vinculadas à Assinatura Eletrônica gov.br.</p>
          <div class="about-card__line"></div>
          <div class="about-card__meta"><span>Versão 1.0</span><span>Armazenamento local</span></div>
        </section>
        <section class="card settings-card" style="margin-top:16px">
          <div class="settings-card__head"><h2 style="font-size:20px">Privacidade</h2></div>
          <div class="detail-footer-note" style="margin:0">${icon('lock')}<span>Os dados permanecem no navegador deste dispositivo. Nenhum documento é enviado automaticamente a servidores externos. O acesso à Assinatura Eletrônica gov.br ocorre somente quando você escolhe abrir o serviço oficial.</span></div>
        </section>
        <section class="card settings-card" style="margin-top:16px">
          <div class="settings-card__head"><h2 style="font-size:20px">Assinatura Eletrônica gov.br</h2><p>O Acervo UCM registra a confirmação; a assinatura é concluída no serviço oficial.</p></div>
          <div class="stack">
            <a class="btn btn--primary btn--sm" href="${SIGNATURE_URL}" target="_blank" rel="noopener noreferrer">${icon('external-link')}Abrir serviço oficial</a>
            <a class="btn btn--secondary btn--sm" href="${SIGNATURE_API_DOCS}" target="_blank" rel="noopener noreferrer">${icon('file-text')}Documentação oficial da API</a>
            <p style="margin:0;color:var(--muted);font-size:10.5px;line-height:1.6">A assinatura é feita com a conta gov.br (nível prata ou ouro). A integração automática por API é restrita a órgãos e entidades públicas, exige Login Único e credenciais de servidor; este aplicativo estático não armazena credenciais nem assina documentos.</p>
          </div>
        </section>
      </div>
    </div>
  `;

  $('#settings-form', container)?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveSettingsFromPage(container);
  });
  $('#save-settings-top', container)?.addEventListener('click', () => saveSettingsFromPage(container));
}

async function saveSettingsFromPage(container) {
  const read = (name) => container.querySelector(`[data-setting="${name}"]`)?.value ?? '';
  const units = read('units').split('\n').map(v => v.trim()).filter(Boolean);
  const courses = read('courses').split('\n').map(v => v.trim()).filter(Boolean);
  if (!read('institution').trim()) return toast('Instituição obrigatória', 'Informe o nome da instituição.', 'error');
  if (!units.length) return toast('Unidades obrigatórias', 'Cadastre ao menos uma unidade.', 'error');
  if (!courses.length) return toast('Cursos obrigatórios', 'Cadastre ao menos um curso.', 'error');
  const next = {
    ...state.settings,
    institution: read('institution').trim(),
    unit: read('unit').trim(),
    coordinatorName: read('coordinator').trim(),
    director: {
      name: read('director').trim(),
      role: read('directorRole').trim() || 'Diretor(a) da Unidade'
    },
    units,
    courses,
    reportFooter: read('footer').trim()
  };
  try {
    await persistSettings(next);
    state.settings = next;
    updateShell();
    toast('Configurações salvas', 'As alterações serão aplicadas aos próximos eventos e relatórios.', 'success');
  } catch (error) {
    console.error(error);
    toast('Não foi possível salvar', error.message || 'Tente novamente.', 'error');
  }
}

async function exportBackup() {
  try {
    toast('Preparando backup', 'Isso pode levar alguns segundos se houver arquivos grandes.', 'info', 2800);
    const files = [];
    for (const event of state.events) {
      for (const attachment of event.attachments || []) {
        const blob = await getFileBlob(attachment.id);
        if (!blob) continue;
        files.push({
          id: attachment.id,
          name: attachment.name,
          type: attachment.type || blob.type,
          size: attachment.size || blob.size,
          data: await blobToDataURL(blob)
        });
      }
    }
    const backup = {
      app: 'Acervo UCM',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      events: state.events,
      files
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `acervo-ucam-backup-${todayISO()}.json`);
    toast('Backup exportado', `${state.events.length} atividades e ${files.length} arquivos incluídos.`, 'success');
  } catch (error) {
    console.error(error);
    toast('Não foi possível exportar', error.message || 'Tente novamente.', 'error');
  }
}

async function removeDemoData() {
  confirmAction({
    title: 'Limpar dados de demonstração?',
    message: 'Todas as atividades de exemplo, imagens, documentos e assinaturas correspondentes serão removidos. Seus registros próprios não serão afetados.',
    confirmLabel: 'Limpar exemplos',
    onConfirm: async () => {
      const removed = await clearDemoEvents(state.events);
      state.events = state.events.filter(e => !e.demo);
      state.reportConfig.selectedIds = (state.reportConfig.selectedIds || []).filter(id => state.events.some(e => e.id === id));
      persistReportConfig();
      updateShell();
      toast('Dados de exemplo removidos', `${removed.length} atividades excluídas do acervo.`, 'info');
      await renderRoute();
    }
  });
}

async function removeAllData() {
  confirmAction({
    title: 'Apagar todo o acervo?',
    message: 'Esta ação remove definitivamente todas as atividades, documentos, imagens e assinaturas armazenadas neste dispositivo. Não é possível desfazer.',
    confirmLabel: 'Apagar todo o acervo',
    onConfirm: async () => {
      await clearAllEvents();
      state.events = [];
      state.reportConfig.selectedIds = [];
      persistReportConfig();
      updateShell();
      toast('Acervo apagado', 'As configurações institucionais foram preservadas.', 'info');
      await renderRoute();
    }
  });
}

/* ============================================================
   Help
   ============================================================ */
function openHelp() {
  const body = `
    <div class="stack">
      <div class="govbanner">
        <div class="govbanner__mark">1</div>
        <div class="govbanner__text"><strong>Registre a atividade</strong><span>Informe denominação, data, horários, local, unidade base e cursos. A mesma data pode receber várias atividades.</span></div>
      </div>
      <div class="govbanner">
        <div class="govbanner__mark">2</div>
        <div class="govbanner__text"><strong>Inclua as comprovações</strong><span>Anexe documentos digitalizados (PDF, DOCX, XLSX, PPTX) e registros fotográficos (PNG, JPG, TIFF).</span></div>
      </div>
      <div class="govbanner">
        <div class="govbanner__mark">3</div>
        <div class="govbanner__text"><strong>Complete as assinaturas</strong><span>Professores assinam pela Assinatura Eletrônica gov.br; coordenações e direção registram seus vistos na folha de validação.</span></div>
      </div>
      <div class="detail-footer-note">
        ${icon('file-text')}
        <span>Na tela de Consolidação, selecione as atividades e gere o relatório final em PDF com capa, panorama, fichas, comprovações e folha de assinaturas.</span>
      </div>
    </div>
  `;
  openModal({
    content: modalMarkup({
      title: 'Como usar o Acervo UCM',
      subtitle: 'Um fluxo simples para consolidar atividades acadêmicas.',
      body,
      footer: `
        <a class="btn btn--secondary" href="${SIGNATURE_URL}" target="_blank" rel="noopener">${icon('external-link')}Assinatura Eletrônica gov.br</a>
        <div class="spacer"></div>
        <button class="btn btn--primary" type="button" data-close-modal>Entendi</button>
      `,
      size: 'md'
    })
  });
}

/* ============================================================
   Global event wiring & boot
   ============================================================ */
function bindGlobalEvents() {
  document.addEventListener('click', async (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (actionEl) {
      const action = actionEl.dataset.action;
      if (action === 'new-event') { event.preventDefault(); openEventWizard(); return; }
      if (action === 'toggle-sidebar') { event.preventDefault(); openSidebar(); return; }
      if (action === 'clear-demo') { event.preventDefault(); removeDemoData(); return; }
      if (action === 'clear-filters') {
        state.filters = { q: '', type: 'all', unit: 'all', status: 'all', view: state.filters.view };
        await renderRoute();
        return;
      }
      if (action === 'print-report') { event.preventDefault(); printReport(); return; }
      if (action === 'refresh-preview') { event.preventDefault(); refreshReportPreview(); return; }
      if (action === 'open-help') { event.preventDefault(); openHelp(); return; }
      if (action === 'open-pending') {
        event.preventDefault();
        state.signatureFilter = 'pending';
        if (state.route === 'assinaturas') await renderRoute();
        else location.hash = '#/assinaturas';
        return;
      }
      if (action === 'export-backup') { event.preventDefault(); exportBackup(); return; }
      if (action === 'clear-all') { event.preventDefault(); removeAllData(); return; }
      if (action === 'reload') { location.reload(); return; }
    }

    const signEl = event.target.closest('[data-sign-event]');
    if (signEl) {
      event.preventDefault();
      event.stopPropagation();
      openSignatureModal(signEl.dataset.signEvent, signEl.dataset.signKey);
      return;
    }
    const editEl = event.target.closest('[data-edit-event]');
    if (editEl) {
      event.preventDefault();
      event.stopPropagation();
      closeModal();
      openEventWizard(editEl.dataset.editEvent);
      return;
    }
    const deleteEl = event.target.closest('[data-delete-event]');
    if (deleteEl) {
      event.preventDefault();
      event.stopPropagation();
      const target = findEvent(deleteEl.dataset.deleteEvent);
      if (!target) return;
      confirmAction({
        title: 'Excluir atividade?',
        message: `A atividade “${escapeHtml(target.title)}” e todos os seus documentos, imagens e assinaturas serão removidos definitivamente.`,
        confirmLabel: 'Excluir atividade',
        onConfirm: async () => {
          await deleteEvent(target);
          state.events = state.events.filter(e => e.id !== target.id);
          state.reportConfig.selectedIds = (state.reportConfig.selectedIds || []).filter(id => id !== target.id);
          persistReportConfig();
          updateShell();
          toast('Atividade excluída', 'O registro foi removido do acervo.', 'info');
          await renderRoute();
        }
      });
      return;
    }
    const reportEl = event.target.closest('[data-report-event]');
    if (reportEl) {
      event.preventDefault();
      event.stopPropagation();
      closeModal();
      state.reportConfig.selectedIds = [reportEl.dataset.reportEvent];
      persistReportConfig();
      location.hash = '#/consolidacao';
      return;
    }
    const previewEl = event.target.closest('[data-preview-file]');
    if (previewEl) {
      event.preventDefault();
      event.stopPropagation();
      openFilePreview(previewEl.dataset.previewFile, previewEl.dataset.previewEvent);
      return;
    }
    const openEl = event.target.closest('[data-open-event]');
    if (openEl) {
      event.preventDefault();
      openEventDetail(openEl.dataset.openEvent);
    }
  });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      const input = $('#global-search-input');
      input?.focus();
      input?.select();
      return;
    }
    if (event.key === 'Escape') {
      if (activeModal) closeModal();
      else closeSidebar();
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && document.activeElement?.matches('.event-card[data-open-event]')) {
      event.preventDefault();
      openEventDetail(document.activeElement.dataset.openEvent);
    }
  });

  $('#global-search')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = $('#global-search-input');
    const q = input.value.trim();
    if (!q) return;
    state.filters.q = q;
    if (state.route === 'eventos') await renderRoute();
    else location.hash = '#/eventos';
  });

  window.addEventListener('hashchange', async () => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    await navigate();
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(updatePreviewScale, 130);
  }, { passive: true });

  document.getElementById('sidebar-overlay')?.addEventListener('click', closeSidebar);
}

async function boot() {
  try {
    const { events, settings, demoSeeded } = await initializeStore();
    state.events = events;
    state.settings = settings;
    state.demoSeeded = demoSeeded;
    ensureReportSelection();
    state.route = currentRouteFromHash();
    renderShell();
    bindGlobalEvents();
    await renderRoute();
    state.initialized = true;
    if (!location.hash) history.replaceState(null, '', '#/painel');
  } catch (error) {
    console.error(error);
    appRoot.innerHTML = `<div style="min-height:100vh;display:grid;place-items:center;padding:30px;background:var(--paper)">
      <div style="max-width:480px;text-align:center">
        <img src="assets/ucam-logo.png" alt="Universidade Candido Mendes" style="width:230px;margin:0 auto 30px">
        <h1 style="font-size:30px">Não foi possível iniciar o Acervo UCM</h1>
        <p style="color:var(--muted);margin-top:10px">${escapeHtml(error.message || 'Verifique se o navegador permite o armazenamento local.')}</p>
        <button class="btn btn--primary" style="margin-top:20px" onclick="location.reload()">Tentar novamente</button>
      </div>
    </div>`;
  }
}

boot();
