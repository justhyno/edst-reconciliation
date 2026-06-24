/* ============================================================
   Reconciliação EDST × ATM Message Log
   Parsing e reconciliação correm no servidor Java.
   Este ficheiro trata apenas de UI, fetch e download.
============================================================ */

'use strict';

/* ── Tokens dos últimos processamentos (para download CSV) ── */
let downloadTokenA = null;
let downloadTokenP = null;

/* ── Dados de pré-visualização (máx 500 linhas por tabela) ── */
let registosA = [], registosB = [];
let resultadoRec = { matches: [], soEmA: [], soEmB: [] };
let avisos = [];

let registosC = [], registosD = [];
let resultadoRecProcessed = { matches: [], soEmC: [], soEmD: [] };
let transaccoesDuplicadas = [];


/* ============================================================
   Progresso
============================================================ */

function mostrarProgresso(label, pct) {
  const area = document.getElementById('progressArea');
  area.hidden = false;
  document.getElementById('progressLabel').textContent = label;
  document.getElementById('progressFill').style.width  = pct + '%';
  document.getElementById('progressPct').textContent   = pct + '%';
}

function ocultarProgresso() {
  document.getElementById('progressArea').hidden = true;
}


/* ============================================================
   Helpers de renderização
============================================================ */

function td(texto, className) {
  const el = document.createElement('td');
  if (className) el.className = className;
  el.textContent = texto != null ? texto : '';
  return el;
}

function tdTruncado(texto) {
  texto = texto != null ? String(texto) : '';
  const el = document.createElement('td');
  el.className   = 'mono';
  el.title       = texto;
  el.textContent = texto.length > 80 ? texto.substring(0, 80) + '…' : texto;
  return el;
}

function preencherTabela(tbodyId, frag) {
  const el = document.getElementById(tbodyId);
  el.innerHTML = '';
  el.appendChild(frag);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Formata "500 de 12 345 registos" ou simplesmente "12 345 registos". */
function badgeText(previewLen, totalLen, sufixo) {
  const fmt = n => n.toLocaleString('pt');
  if (previewLen < totalLen)
    return `A mostrar ${fmt(previewLen)} de ${fmt(totalLen)} ${sufixo} — descarregue o CSV para o total`;
  return `${fmt(totalLen)} ${sufixo}`;
}


/* ============================================================
   Tabs
============================================================ */

function initTabs(container) {
  container.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      container.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });
}


/* ============================================================
   Módulo 1 — Renderização
============================================================ */

function renderTabelaB(registos, total) {
  const frag = document.createDocumentFragment();
  const cols  = ['RRN','CARD','DHMSG','id','campo_2','campo_3','campo_4','campo_6','campo_8','campo_9'];
  for (const r of registos) {
    const tr = document.createElement('tr');
    for (const c of cols) tr.appendChild(td(r[c], 'mono'));
    frag.appendChild(tr);
  }
  preencherTabela('corpoB', frag);
  document.getElementById('countB').textContent = badgeText(registos.length, total, 'registos');
}

function renderTabelaA(registos, total, descartadas) {
  const frag = document.createDocumentFragment();
  for (const r of registos) {
    const tr = document.createElement('tr');
    tr.appendChild(td(r.numLinha));
    tr.appendChild(td(r.RRN, 'mono'));
    tr.appendChild(tdTruncado(r.linhaCompleta));
    frag.appendChild(tr);
  }
  preencherTabela('corpoA', frag);
  let txt = badgeText(registos.length, total, 'registos');
  if (descartadas > 0) txt += ` · ${descartadas} descartada(s) por comprimento insuficiente`;
  document.getElementById('countA').textContent = txt;
}

function renderTabelaMatches(matches, total) {
  const frag = document.createDocumentFragment();
  const cols  = ['RRN','CARD','DHMSG','campo_6','numLinhaA','OFS'];
  for (const r of matches) {
    const tr = document.createElement('tr');
    tr.className = 'row-match';
    for (const c of cols) tr.appendChild(td(r[c], 'mono'));
    frag.appendChild(tr);
  }
  preencherTabela('corpoMatches', frag);
  document.getElementById('countMatches').textContent = badgeText(matches.length, total, 'matches');
}

function renderTabelaSoA(registos, total) {
  const frag = document.createDocumentFragment();
  for (const r of registos) {
    const tr = document.createElement('tr');
    tr.className = 'row-soA';
    tr.appendChild(td(r.numLinha));
    tr.appendChild(td(r.RRN, 'mono'));
    tr.appendChild(tdTruncado(r.linhaCompleta));
    frag.appendChild(tr);
  }
  preencherTabela('corpoSoA', frag);
  document.getElementById('countSoA').textContent = badgeText(registos.length, total, 'só em A');
}

function renderTabelaSoB(registos, total) {
  const frag = document.createDocumentFragment();
  const cols  = ['RRN','CARD','DHMSG','campo_6','campo_9'];
  for (const r of registos) {
    const tr = document.createElement('tr');
    tr.className = 'row-soB';
    for (const c of cols) tr.appendChild(td(r[c], 'mono'));
    frag.appendChild(tr);
  }
  preencherTabela('corpoSoB', frag);
  document.getElementById('countSoB').textContent = badgeText(registos.length, total, 'só em B');
}

function mostrarDebug(info) {
  const itens = [
    { label: 'Total linhas em A',               valor: info.totalLinhasA       },
    { label: 'Passaram filtro (pos1=1, pos7=6)', valor: info.passaramFiltro    },
    { label: 'Descartadas (linha curta)',         valor: info.descartadasCurtas },
    { label: 'Registos brutos em B',             valor: info.totalBrutosB       },
    { label: 'Registos B com ACLK',              valor: info.totalAclkB         },
    { label: 'Matches',                          valor: info.nMatches            },
    { label: 'Só em A',                          valor: info.nSoA                },
    { label: 'Só em B',                          valor: info.nSoB                }
  ];
  document.getElementById('debugGrid').innerHTML = itens.map(it =>
    `<div class="debug-item">
       <span class="debug-label">${it.label}</span>
       <span class="debug-value">${it.valor != null ? it.valor.toLocaleString('pt') : '—'}</span>
     </div>`
  ).join('');
  document.getElementById('debugPanel').hidden = false;
}

function mostrarRecCounts(info) {
  document.getElementById('recCounts').innerHTML =
    `<div class="rec-stat">
       <span class="rec-stat-label">Matches</span>
       <span class="rec-stat-value v-match">${info.nMatches.toLocaleString('pt')}</span>
     </div>
     <div class="rec-stat">
       <span class="rec-stat-label">Só em A</span>
       <span class="rec-stat-value v-soA">${info.nSoA.toLocaleString('pt')}</span>
     </div>
     <div class="rec-stat">
       <span class="rec-stat-label">Só em B</span>
       <span class="rec-stat-value v-soB">${info.nSoB.toLocaleString('pt')}</span>
     </div>`;
}

function adicionarAviso(msg) { avisos.push(msg); }

function mostrarAvisos() {
  const panel = document.getElementById('avisosPanel');
  const lista  = document.getElementById('avisosList');
  if (avisos.length === 0) { panel.hidden = true; return; }
  lista.innerHTML = avisos.map(a => `<li>${escHtml(a)}</li>`).join('');
  panel.hidden = false;
}


/* ============================================================
   Módulo 1 — Export CSV (via servidor)
============================================================ */

function exportarCSV(tipo) {
  if (!downloadTokenA) return;
  serverDownload(downloadTokenA, tipo);
}


/* ============================================================
   Módulo 1 — Handler (fetch → servidor Java)
============================================================ */

async function processar() {
  const fileA       = document.getElementById('ficheiroA').files[0];
  const fileB       = document.getElementById('ficheiroB').files[0];
  const usarWin1252 = document.getElementById('chkEncoding').checked;

  avisos = [];

  if (!fileA || !fileB) {
    alert('Selecione ambos os ficheiros antes de processar.');
    return;
  }

  const btn = document.getElementById('btnProcessar');
  btn.disabled    = true;
  btn.textContent = 'A processar…';
  mostrarProgresso('A enviar ficheiros para o servidor…', 20);

  try {
    const form = new FormData();
    form.append('ficheiroA', fileA);
    form.append('ficheiroB', fileB);
    form.append('encoding',  usarWin1252 ? 'windows-1252' : 'utf-8');

    mostrarProgresso('A processar no servidor…', 50);
    const resp = await fetch('api/reconciliar', { method: 'POST', body: form });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }

    mostrarProgresso('A carregar pré-visualização…', 90);
    const data = await resp.json();

    downloadTokenA = data.token;
    registosA      = data.registosA;
    registosB      = data.registosB;
    resultadoRec   = { matches: data.matches, soEmA: data.soEmA, soEmB: data.soEmB };

    const dbg = data.debug;
    ocultarProgresso();

    renderTabelaB(registosB, dbg.totalAclkB);
    renderTabelaA(registosA, dbg.passaramFiltro, dbg.descartadasCurtas);
    renderTabelaMatches(resultadoRec.matches, dbg.nMatches);
    renderTabelaSoA(resultadoRec.soEmA, dbg.nSoA);
    renderTabelaSoB(resultadoRec.soEmB, dbg.nSoB);

    mostrarDebug(dbg);
    mostrarRecCounts(dbg);
    mostrarAvisos();

    document.getElementById('resultados').hidden = false;

  } catch (err) {
    ocultarProgresso();
    adicionarAviso(`Erro durante o processamento: ${err.message}`);
    mostrarAvisos();
    console.error(err);
  } finally {
    ocultarProgresso();
    btn.disabled    = false;
    btn.textContent = 'Processar e Reconciliar';
  }
}


/* ============================================================
   Módulo 2 — Renderização
============================================================ */

function renderTabelaProcessedSimples(tbodyId, countId, registos, total, labelSufixo) {
  const frag = document.createDocumentFragment();
  for (const r of registos) {
    const tr = document.createElement('tr');
    tr.appendChild(td(r.id, 'mono'));
    tr.appendChild(tdTruncado(r.resposta));
    frag.appendChild(tr);
  }
  preencherTabela(tbodyId, frag);
  document.getElementById(countId).textContent = badgeText(registos.length, total, labelSufixo);
}

function renderTabelaMatchesProcessed(matches, total) {
  const frag = document.createDocumentFragment();
  for (const m of matches) {
    const tr = document.createElement('tr');
    tr.className = 'row-match';
    tr.appendChild(td(m.id, 'mono'));
    tr.appendChild(tdTruncado(m.respostaC));
    tr.appendChild(tdTruncado(m.respostaD));
    frag.appendChild(tr);
  }
  preencherTabela('corpoPMatches', frag);
  document.getElementById('countPMatches').textContent = badgeText(matches.length, total, 'matches');
}

function renderTabelaTransaccoes(lista, total) {
  const frag = document.createDocumentFragment();
  for (const r of lista) {
    const tr = document.createElement('tr');
    tr.className = 'row-soA';
    tr.appendChild(td(r.id,         'mono'));
    tr.appendChild(td(r.referencia, 'mono'));
    tr.appendChild(td(r.balcao,     'mono'));
    tr.appendChild(tdTruncado(r.respostaC));
    tr.appendChild(tdTruncado(r.respostaD));
    frag.appendChild(tr);
  }
  preencherTabela('corpoTransaccoes', frag);
  document.getElementById('countTransaccoes').textContent = badgeText(lista.length, total, 'transacções');
}

function mostrarDebugProcessed(info) {
  const itens = [
    { label: 'Transacções em C',            valor: info.totalRequestC },
    { label: 'Excluídas C (>1 resposta)',   valor: info.exclC         },
    { label: 'Transacções em D',            valor: info.totalRequestD },
    { label: 'Excluídas D (>1 resposta)',   valor: info.exclD         },
    { label: 'Matches',                     valor: info.nMatches       },
    { label: 'Só em C',                     valor: info.nSoC           },
    { label: 'Só em D',                     valor: info.nSoD           },
    { label: 'Transacções (duplicate+//1)', valor: info.nTransaccoes   }
  ];
  document.getElementById('debugGridProcessed').innerHTML = itens.map(it =>
    `<div class="debug-item">
       <span class="debug-label">${it.label}</span>
       <span class="debug-value">${it.valor != null ? it.valor.toLocaleString('pt') : '—'}</span>
     </div>`
  ).join('');
  document.getElementById('debugPanelProcessed').hidden = false;
}

function mostrarRecCountsProcessed(info) {
  document.getElementById('recCountsProcessed').innerHTML =
    `<div class="rec-stat">
       <span class="rec-stat-label">Matches</span>
       <span class="rec-stat-value v-match">${info.nMatches.toLocaleString('pt')}</span>
     </div>
     <div class="rec-stat">
       <span class="rec-stat-label">Só em C</span>
       <span class="rec-stat-value v-soA">${info.nSoC.toLocaleString('pt')}</span>
     </div>
     <div class="rec-stat">
       <span class="rec-stat-label">Só em D</span>
       <span class="rec-stat-value v-soB">${info.nSoD.toLocaleString('pt')}</span>
     </div>`;
}


/* ============================================================
   Módulo 2 — Export CSV (via servidor)
============================================================ */

function exportarCSVProcessed(tipo) {
  if (!downloadTokenP) return;
  /* "matches" em módulo 2 usa o tipo "matchesP" no servidor para não colidir */
  const typeMap = { C:'C', D:'D', matches:'matchesP', soC:'soC', soD:'soD', transaccoes:'transaccoes' };
  const t = typeMap[tipo];
  if (t) serverDownload(downloadTokenP, t);
}


/* ============================================================
   Módulo 2 — Handler (fetch → servidor Java)
============================================================ */

async function processarProcessed() {
  const btn = document.getElementById('btnProcessarProcessed');

  try {
    const inputC = document.getElementById('ficheiroC');
    const inputD = document.getElementById('ficheiroD');

    if (!inputC || !inputD) {
      throw new Error('Elementos de input não encontrados — recarregue a página.');
    }

    const fileC = inputC.files[0];
    const fileD = inputD.files[0];

    if (!fileC || !fileD) {
      alert('Selecione ambos os ficheiros (C e D) antes de processar.');
      return;
    }

    btn.disabled    = true;
    btn.textContent = 'A processar…';
    mostrarProgresso('A enviar ficheiros para o servidor…', 20);

    const usarWin1252 = document.getElementById('chkEncoding').checked;
    const form = new FormData();
    form.append('ficheiroC', fileC);
    form.append('ficheiroD', fileD);
    form.append('encoding',  usarWin1252 ? 'windows-1252' : 'utf-8');

    mostrarProgresso('A processar no servidor…', 50);
    const resp = await fetch('api/reconciliar-processed', { method: 'POST', body: form });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }

    mostrarProgresso('A carregar pré-visualização…', 90);
    const data = await resp.json();

    downloadTokenP        = data.token;
    registosC             = data.registosC;
    registosD             = data.registosD;
    resultadoRecProcessed = { matches: data.matches, soEmC: data.soEmC, soEmD: data.soEmD };
    transaccoesDuplicadas = data.transaccoes;

    const dbg = data.debug;
    const totalC = dbg.totalRequestC - dbg.exclC;
    const totalD = dbg.totalRequestD - dbg.exclD;

    ocultarProgresso();

    renderTabelaProcessedSimples('corpoPC',   'countPC',   registosC,                         totalC,        'transacções');
    renderTabelaProcessedSimples('corpoPD',   'countPD',   registosD,                         totalD,        'transacções');
    renderTabelaMatchesProcessed(resultadoRecProcessed.matches,                                dbg.nMatches);
    renderTabelaProcessedSimples('corpoPSoC', 'countPSoC', resultadoRecProcessed.soEmC,        dbg.nSoC,      'só em C');
    renderTabelaProcessedSimples('corpoPSoD', 'countPSoD', resultadoRecProcessed.soEmD,        dbg.nSoD,      'só em D');
    renderTabelaTransaccoes(transaccoesDuplicadas,                                             dbg.nTransaccoes);

    mostrarDebugProcessed(dbg);
    mostrarRecCountsProcessed(dbg);

    const secao = document.getElementById('resultadosProcessed');
    secao.hidden = false;
    if (!secao.dataset.tabsInit) {
      initTabs(secao);
      secao.dataset.tabsInit = '1';
    }

    /* Auto-download dos CSVs via servidor — espaçados para não serem bloqueados */
    setTimeout(() => exportarCSVProcessed('matches'),     200);
    setTimeout(() => exportarCSVProcessed('soC'),         500);
    setTimeout(() => exportarCSVProcessed('soD'),         800);
    setTimeout(() => exportarCSVProcessed('transaccoes'), 1100);

  } catch (err) {
    ocultarProgresso();
    console.error('[processarProcessed]', err);
    alert(`Erro ao processar ficheiros C/D:\n${err.message}`);
  } finally {
    if (btn) {
      btn.disabled    = false;
      btn.textContent = 'Processar e Reconciliar';
    }
  }
}


/* ============================================================
   Download helper
============================================================ */

function serverDownload(token, type) {
  const a = document.createElement('a');
  a.href = 'api/download?token=' + encodeURIComponent(token) + '&type=' + encodeURIComponent(type);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}


/* ============================================================
   Copiar comando DBTools
============================================================ */

function copiarComando(btn) {
  const cmd = btn.dataset.cmd;
  navigator.clipboard.writeText(cmd).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓'; btn.classList.add('copiado');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copiado'); }, 1800);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = cmd; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
    btn.textContent = '✓'; btn.classList.add('copiado');
    setTimeout(() => { btn.textContent = '⎘'; btn.classList.remove('copiado'); }, 1800);
  });
}


/* ============================================================
   Inicialização
============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  initTabs(document.getElementById('resultados'));

  document.getElementById('btnProcessar').addEventListener('click', processar);
  document.getElementById('btnProcessarProcessed').addEventListener('click', processarProcessed);

  function bindFileInfo(inputId, infoId) {
    document.getElementById(inputId).addEventListener('change', function () {
      const el = document.getElementById(infoId);
      if (this.files[0]) {
        const mb = (this.files[0].size / 1024 / 1024).toFixed(2);
        el.textContent = `${this.files[0].name}  (${mb} MB)`;
      } else {
        el.textContent = 'Nenhum ficheiro selecionado';
      }
    });
  }

  bindFileInfo('ficheiroA', 'infoA');
  bindFileInfo('ficheiroB', 'infoB');
  bindFileInfo('ficheiroC', 'infoC');
  bindFileInfo('ficheiroD', 'infoD');
});
