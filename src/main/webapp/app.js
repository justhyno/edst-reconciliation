/* ============================================================
   Reconciliação EDST × ATM Message Log
   Toda a lógica de parsing e reconciliação corre no servidor
   (Java Servlet). Este ficheiro trata apenas da UI e do fetch.
============================================================ */

'use strict';

/* ── Estado global ─────────────────────────────────────────── */
let registosA = [];
let registosB = [];
let resultadoRec = { matches: [], soEmA: [], soEmB: [] };
let avisos = [];

let registosC = [];
let registosD = [];
let resultadoRecProcessed = { matches: [], soEmC: [], soEmD: [] };
let transaccoesDuplicadas = [];


/* ============================================================
   UI — Progresso
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
   UI — Helpers de renderização
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


/* ============================================================
   Sistema de tabs
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

function renderTabelaB(registos) {
  const frag = document.createDocumentFragment();
  const cols  = ['RRN','CARD','DHMSG','id','campo_2','campo_3','campo_4','campo_6','campo_8','campo_9'];
  for (const r of registos) {
    const tr = document.createElement('tr');
    for (const c of cols) tr.appendChild(td(r[c], 'mono'));
    frag.appendChild(tr);
  }
  preencherTabela('corpoB', frag);
  document.getElementById('countB').textContent = `${registos.length} registos`;
}

function renderTabelaA(registos, descartadas) {
  const frag = document.createDocumentFragment();
  for (const r of registos) {
    const tr = document.createElement('tr');
    tr.appendChild(td(r.numLinha));
    tr.appendChild(td(r.RRN, 'mono'));
    tr.appendChild(tdTruncado(r.linhaCompleta));
    frag.appendChild(tr);
  }
  preencherTabela('corpoA', frag);
  let txt = `${registos.length} registos`;
  if (descartadas > 0) txt += ` · ${descartadas} linha(s) descartada(s) por comprimento insuficiente`;
  document.getElementById('countA').textContent = txt;
}

function renderTabelaMatches(matches) {
  const frag = document.createDocumentFragment();
  const cols  = ['RRN','CARD','DHMSG','campo_6','numLinhaA','OFS'];
  for (const r of matches) {
    const tr = document.createElement('tr');
    tr.className = 'row-match';
    for (const c of cols) tr.appendChild(td(r[c], 'mono'));
    frag.appendChild(tr);
  }
  preencherTabela('corpoMatches', frag);
  document.getElementById('countMatches').textContent = `${matches.length} matches`;
}

function renderTabelaSoA(registos) {
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
  document.getElementById('countSoA').textContent = `${registos.length} só em A`;
}

function renderTabelaSoB(registos) {
  const frag = document.createDocumentFragment();
  const cols  = ['RRN','CARD','DHMSG','campo_6','campo_9'];
  for (const r of registos) {
    const tr = document.createElement('tr');
    tr.className = 'row-soB';
    for (const c of cols) tr.appendChild(td(r[c], 'mono'));
    frag.appendChild(tr);
  }
  preencherTabela('corpoSoB', frag);
  document.getElementById('countSoB').textContent = `${registos.length} só em B`;
}

function mostrarDebug(info) {
  const itens = [
    { label: 'Total linhas em A',               valor: info.totalLinhasA      },
    { label: 'Passaram filtro (pos1=1, pos7=6)', valor: info.passaramFiltro   },
    { label: 'Descartadas (linha curta)',         valor: info.descartadasCurtas },
    { label: 'Registos brutos em B',             valor: info.totalBrutosB      },
    { label: 'Registos B com ACLK',              valor: info.totalAclkB        },
    { label: 'Matches',                          valor: info.nMatches           },
    { label: 'Só em A',                          valor: info.nSoA               },
    { label: 'Só em B',                          valor: info.nSoB               }
  ];
  document.getElementById('debugGrid').innerHTML = itens.map(it =>
    `<div class="debug-item">
       <span class="debug-label">${it.label}</span>
       <span class="debug-value">${it.valor != null ? it.valor : '—'}</span>
     </div>`
  ).join('');
  document.getElementById('debugPanel').hidden = false;
}

function mostrarRecCounts(info) {
  document.getElementById('recCounts').innerHTML =
    `<div class="rec-stat">
       <span class="rec-stat-label">Matches</span>
       <span class="rec-stat-value v-match">${info.nMatches}</span>
     </div>
     <div class="rec-stat">
       <span class="rec-stat-label">Só em A</span>
       <span class="rec-stat-value v-soA">${info.nSoA}</span>
     </div>
     <div class="rec-stat">
       <span class="rec-stat-label">Só em B</span>
       <span class="rec-stat-value v-soB">${info.nSoB}</span>
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
   Módulo 1 — Exportar CSV
============================================================ */

function exportarCSV(tipo) {
  let dados = [], colunas = [], nomeFicheiro = '';
  switch (tipo) {
    case 'B':
      colunas      = ['RRN','CARD','DHMSG','id','campo_2','campo_3','campo_4','campo_6','campo_8','campo_9'];
      dados        = registosB;
      nomeFicheiro = 'ficheiroB_parseado.csv';
      break;
    case 'A':
      colunas      = ['numLinha','RRN','linhaCompleta'];
      dados        = registosA;
      nomeFicheiro = 'ficheiroA_filtrado.csv';
      break;
    case 'matches':
      colunas      = ['RRN','CARD','DHMSG','campo_6','campo_9','numLinhaA','OFS'];
      dados        = resultadoRec.matches;
      nomeFicheiro = 'reconciliacao_matches.csv';
      break;
    case 'soA':
      colunas      = ['numLinha','RRN','linhaCompleta'];
      dados        = resultadoRec.soEmA;
      nomeFicheiro = 'reconciliacao_so_em_A.csv';
      break;
    case 'soB':
      colunas      = ['RRN','CARD','DHMSG','campo_6','campo_9'];
      dados        = resultadoRec.soEmB;
      nomeFicheiro = 'reconciliacao_so_em_B.csv';
      break;
    default: return;
  }
  const BOM    = '﻿';
  const linhas = [colunas.join(';')];
  for (const row of dados) {
    const campos = colunas.map(c => {
      const val = String(row[c] != null ? row[c] : '');
      return (val.includes(';') || val.includes('"') || val.includes('\n'))
        ? `"${val.replace(/"/g, '""')}"` : val;
    });
    linhas.push(campos.join(';'));
  }
  downloadBlob(BOM + linhas.join('\r\n'), nomeFicheiro);
}


/* ============================================================
   Módulo 1 — Handler principal (fetch → servidor Java)
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

    mostrarProgresso('A carregar resultados…', 90);
    const data = await resp.json();

    registosA    = data.registosA;
    registosB    = data.registosB;
    resultadoRec = { matches: data.matches, soEmA: data.soEmA, soEmB: data.soEmB };

    ocultarProgresso();

    renderTabelaB(registosB);
    renderTabelaA(registosA, data.debug.descartadasCurtas);
    renderTabelaMatches(resultadoRec.matches);
    renderTabelaSoA(resultadoRec.soEmA);
    renderTabelaSoB(resultadoRec.soEmB);

    mostrarDebug(data.debug);
    mostrarRecCounts(data.debug);
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

function renderTabelaProcessedSimples(tbodyId, countId, registos, labelSufixo) {
  const frag = document.createDocumentFragment();
  for (const r of registos) {
    const tr = document.createElement('tr');
    tr.appendChild(td(r.id, 'mono'));
    tr.appendChild(tdTruncado(r.resposta));
    frag.appendChild(tr);
  }
  preencherTabela(tbodyId, frag);
  document.getElementById(countId).textContent = `${registos.length} ${labelSufixo}`;
}

function renderTabelaMatchesProcessed(matches) {
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
  document.getElementById('countPMatches').textContent = `${matches.length} matches`;
}

function renderTabelaTransaccoes(lista) {
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
  document.getElementById('countTransaccoes').textContent = `${lista.length} transacções`;
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
       <span class="debug-value">${it.valor != null ? it.valor : '—'}</span>
     </div>`
  ).join('');
  document.getElementById('debugPanelProcessed').hidden = false;
}

function mostrarRecCountsProcessed(info) {
  document.getElementById('recCountsProcessed').innerHTML =
    `<div class="rec-stat">
       <span class="rec-stat-label">Matches</span>
       <span class="rec-stat-value v-match">${info.nMatches}</span>
     </div>
     <div class="rec-stat">
       <span class="rec-stat-label">Só em C</span>
       <span class="rec-stat-value v-soA">${info.nSoC}</span>
     </div>
     <div class="rec-stat">
       <span class="rec-stat-label">Só em D</span>
       <span class="rec-stat-value v-soB">${info.nSoD}</span>
     </div>`;
}


/* ============================================================
   Módulo 2 — Exportar CSV
============================================================ */

function csvEsc(val) {
  const s = String(val != null ? val : '');
  return (s.includes(';') || s.includes('"') || s.includes('\n'))
    ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportarCSVProcessed(tipo) {
  const BOM = '﻿';
  let linhas = [], nomeFicheiro = '';

  const linhaSimples = r => [r.id, csvEsc(r.resposta)].join(';');

  switch (tipo) {
    case 'C':
      nomeFicheiro = 'processedEDST_ficheiroC.csv';
      linhas = ['ID;Resposta', ...registosC.map(linhaSimples)];
      break;
    case 'D':
      nomeFicheiro = 'processedEDST_ficheiroD.csv';
      linhas = ['ID;Resposta', ...registosD.map(linhaSimples)];
      break;
    case 'matches':
      nomeFicheiro = 'processedEDST_matches.csv';
      linhas = ['ID;Resposta_C;Resposta_D',
                ...resultadoRecProcessed.matches.map(m =>
                  [m.id, csvEsc(m.respostaC), csvEsc(m.respostaD)].join(';'))];
      break;
    case 'soC':
      nomeFicheiro = 'processedEDST_so_em_C.csv';
      linhas = ['ID;Resposta', ...resultadoRecProcessed.soEmC.map(linhaSimples)];
      break;
    case 'soD':
      nomeFicheiro = 'processedEDST_so_em_D.csv';
      linhas = ['ID;Resposta', ...resultadoRecProcessed.soEmD.map(linhaSimples)];
      break;
    case 'transaccoes':
      nomeFicheiro = 'processedEDST_transaccoes.csv';
      linhas = ['ID;Referencia;Balcao;Resposta_C;Resposta_D',
                ...transaccoesDuplicadas.map(r =>
                  [r.id, csvEsc(r.referencia), csvEsc(r.balcao),
                   csvEsc(r.respostaC), csvEsc(r.respostaD)].join(';'))];
      break;
    default: return;
  }
  downloadBlob(BOM + linhas.join('\r\n'), nomeFicheiro);
}


/* ============================================================
   Módulo 2 — Handler principal (fetch → servidor Java)
============================================================ */

async function processarProcessed() {
  const btn = document.getElementById('btnProcessarProcessed');

  try {
    const inputC = document.getElementById('ficheiroC');
    const inputD = document.getElementById('ficheiroD');

    if (!inputC || !inputD) {
      throw new Error('Elementos de input não encontrados — tente recarregar a página.');
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

    mostrarProgresso('A carregar resultados…', 90);
    const data = await resp.json();

    registosC             = data.registosC;
    registosD             = data.registosD;
    resultadoRecProcessed = { matches: data.matches, soEmC: data.soEmC, soEmD: data.soEmD };
    transaccoesDuplicadas = data.transaccoes;

    ocultarProgresso();

    renderTabelaProcessedSimples('corpoPC',   'countPC',   registosC,                          'transacções');
    renderTabelaProcessedSimples('corpoPD',   'countPD',   registosD,                          'transacções');
    renderTabelaMatchesProcessed(resultadoRecProcessed.matches);
    renderTabelaProcessedSimples('corpoPSoC', 'countPSoC', resultadoRecProcessed.soEmC, 'só em C');
    renderTabelaProcessedSimples('corpoPSoD', 'countPSoD', resultadoRecProcessed.soEmD, 'só em D');
    renderTabelaTransaccoes(transaccoesDuplicadas);

    mostrarDebugProcessed(data.debug);
    mostrarRecCountsProcessed(data.debug);

    const secao = document.getElementById('resultadosProcessed');
    secao.hidden = false;
    if (!secao.dataset.tabsInit) {
      initTabs(secao);
      secao.dataset.tabsInit = '1';
    }

    exportarCSVProcessed('matches');
    exportarCSVProcessed('soC');
    exportarCSVProcessed('soD');
    exportarCSVProcessed('transaccoes');

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
   Copiar comando DBTools
============================================================ */

function copiarComando(btn) {
  const cmd = btn.dataset.cmd;
  navigator.clipboard.writeText(cmd).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓';
    btn.classList.add('copiado');
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
   Utilitário — download de Blob como ficheiro
============================================================ */

function downloadBlob(texto, nomeFicheiro) {
  const blob = new Blob([texto], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = nomeFicheiro; a.click();
  URL.revokeObjectURL(url);
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
