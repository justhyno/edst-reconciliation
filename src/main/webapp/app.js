/* ============================================================
   Reconciliação EDST × ATM Message Log
   Toda a lógica corre no browser (client-side), sem backend.
============================================================ */

'use strict';

// ── Estado global ──────────────────────────────────────────
let registosA = [];          // registos parseados do Ficheiro A
let registosB = [];          // registos parseados do Ficheiro B (filtrados ACLK)
let resultadoRec = {         // resultado da reconciliação
  matches: [],
  soEmA:   [],
  soEmB:   []
};
let avisos = [];             // mensagens de aviso acumuladas


/* ============================================================
   Leitura assíncrona de ficheiro
============================================================ */

/**
 * Lê um File como texto com o encoding indicado.
 * @param {File} file
 * @param {string} encoding  'utf-8' ou 'windows-1252'
 * @returns {Promise<string>}
 */
function lerFicheiro(file, encoding) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error(`Erro ao ler "${file.name}"`));
    reader.readAsText(file, encoding);
  });
}


/* ============================================================
   Parsing — Ficheiro B (ATM MESSAGE LOG)
============================================================ */

/**
 * Extrai o valor de uma linha "prefixo: valor|".
 * Remove o sufixo "|" e espaços em branco.
 */
function extrairValorLinha(linha) {
  const idx = linha.indexOf(':');
  if (idx === -1) return '';
  let val = linha.substring(idx + 1).trim();
  if (val.endsWith('|')) val = val.slice(0, -1).trim();
  return val;
}

/**
 * Parseia o conteúdo do Ficheiro B (ATM MESSAGE LOG).
 *
 * Formato esperado: blocos de linhas começando em "id: …|"
 * seguidos de campos "1: …|" a "9: …|".
 *
 * Filtro aplicado: apenas registos com campo 6 a começar por "ACLK".
 *
 * @param {string} texto  Conteúdo completo do ficheiro
 * @returns {{ registos: object[], totalBrutos: number, totalAclk: number }}
 */
function parseFicheiroB(texto) {
  const linhas = texto.split(/\r?\n/);
  const todos = [];
  let regActual = null;

  for (const linha of linhas) {
    const lt = linha.trim();
    if (!lt) continue;                              // linha em branco — ignorar

    if (/^id:/i.test(lt)) {
      // Guardar registo anterior antes de começar o próximo
      if (regActual !== null) todos.push(regActual);

      // Iniciar novo registo
      const idCompleto = extrairValorLinha(lt);
      const partes = idCompleto.split('.');         // RRN.CARD.DHMSG
      regActual = {
        id:       idCompleto,
        RRN:      partes[0] || '',
        CARD:     partes[1] || '',
        DHMSG:    partes[2] || '',
        campo_1: '', campo_2: '', campo_3: '',
        campo_4: '', campo_5: '', campo_6: '',
        campo_7: '', campo_8: '', campo_9: ''
      };

    } else if (regActual !== null) {
      // Tentar capturar "N: valor|"
      const m = lt.match(/^(\d+):\s*(.*?)(?:\|)?$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n >= 1 && n <= 9) {
          // Remover "|" residual do valor
          regActual[`campo_${n}`] = m[2].replace(/\|$/, '').trim();
        }
      }
    }
  }

  // Guardar o último registo (não seguido de outro "id:")
  if (regActual !== null) todos.push(regActual);

  // Filtrar: manter apenas campo_6 com prefixo "ACLK"
  const filtrados = todos.filter(r => r.campo_6.startsWith('ACLK'));

  return {
    registos:    filtrados,
    totalBrutos: todos.length,
    totalAclk:   filtrados.length
  };
}


/* ============================================================
   Parsing — Ficheiro A (EDST, largura fixa, 1-indexed)
============================================================ */

/**
 * Parseia o conteúdo do Ficheiro A (EDST, formato fixed-width).
 *
 * Filtros (posições 1-indexed):
 *   - posição 1 === '1'
 *   - posição 7 === '6'
 *
 * Extracção:
 *   - RRN: posições 296–307 (substring(295, 307) em JS 0-indexed)
 *
 * Linhas com menos de 307 caracteres são descartadas silenciosamente.
 *
 * @param {string} texto  Conteúdo completo do ficheiro
 * @returns {{ registos: object[], totalLinhas: number, passaramFiltro: number, descartadasCurtas: number }}
 */
function parseFicheiroA(texto) {
  const linhas = texto.split(/\r?\n/);
  const registos        = [];
  let totalLinhas       = 0;
  let passaramFiltro    = 0;
  let descartadasCurtas = 0;

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];

    // Ignorar linhas completamente vazias sem contar
    if (linha === '') continue;
    totalLinhas++;

    // Filtro de posições (1-indexed → 0-indexed: pos1=linha[0], pos7=linha[6])
    if (linha[0] !== '1' || linha[6] !== '6') continue;

    // Verificar comprimento mínimo para extrair RRN
    if (linha.length < 352) {
      descartadasCurtas++;
      continue;
    }

    passaramFiltro++;
    const rrn = linha.substring(339, 351).trim();   // posições 340–352 (1-indexed)

    registos.push({
      numLinha:      i + 1,   // número de linha no ficheiro original
      RRN:           rrn,
      linhaCompleta: linha
    });
  }

  return { registos, totalLinhas, passaramFiltro, descartadasCurtas };
}


/* ============================================================
   Reconciliação por RRN
============================================================ */

/**
 * Reconcilia os registos de A e B pelo campo RRN.
 *
 * Um RRN em A pode aparecer em vários registos; o mesmo para B.
 * Gera o produto cartesiano para os matches (caso haja duplicados).
 *
 * @param {object[]} regsA
 * @param {object[]} regsB
 * @returns {{ matches: object[], soEmA: object[], soEmB: object[] }}
 */
function reconciliar(regsA, regsB) {
  // Construir mapa RRN → lista de registos para cada ficheiro
  const mapaA = agruparPorRRN(regsA);
  const mapaB = agruparPorRRN(regsB);

  const matches = [];
  const soEmA   = [];
  const soEmB   = [];

  // Percorrer todos os RRNs de A
  for (const [rrn, listaA] of mapaA) {
    if (mapaB.has(rrn)) {
      // Match: cruzar cada registo de A com cada registo de B (geralmente 1×1)
      for (const rA of listaA) {
        for (const rB of mapaB.get(rrn)) {
          matches.push({
            RRN:       rrn,
            CARD:      rB.CARD,
            DHMSG:     rB.DHMSG,
            campo_6:   rB.campo_6,
            campo_9:   rB.campo_9,
            numLinhaA: rA.numLinha,
            OFS:       `AC.LOCKED.EVENTS,VISA/R/PROCESS/1/0/,NBOL.USER/123456/${rB.campo_9}/////,${rB.campo_6}`
          });
        }
      }
    } else {
      // Sem correspondência em B
      for (const rA of listaA) soEmA.push(rA);
    }
  }

  // Registos de B que não têm RRN em A
  for (const [rrn, listaB] of mapaB) {
    if (!mapaA.has(rrn)) {
      for (const rB of listaB) soEmB.push(rB);
    }
  }

  return { matches, soEmA, soEmB };
}

/** Agrupa um array de registos num Map RRN → registos[]. */
function agruparPorRRN(registos) {
  const mapa = new Map();
  for (const r of registos) {
    if (!mapa.has(r.RRN)) mapa.set(r.RRN, []);
    mapa.get(r.RRN).push(r);
  }
  return mapa;
}


/* ============================================================
   Exportar CSV
============================================================ */

/**
 * Gera e faz download de um CSV com separador ";" (compatível Excel PT).
 * Inclui BOM UTF-8 para que o Excel reconheça o encoding.
 *
 * @param {'A'|'B'|'matches'|'soA'|'soB'} tipo
 */
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
    default:
      return;
  }

  const BOM   = '﻿';
  const linhas = [colunas.join(';')];

  for (const row of dados) {
    const campos = colunas.map(c => {
      const val = String(row[c] ?? '');
      // Envolver em aspas se contiver separador, aspas ou newline
      if (val.includes(';') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    });
    linhas.push(campos.join(';'));
  }

  const csv  = BOM + linhas.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = nomeFicheiro;
  a.click();
  URL.revokeObjectURL(url);
}


/* ============================================================
   Renderização das tabelas
============================================================ */

/** Cria um <td> simples (com classe opcional). */
function td(texto, className) {
  const el = document.createElement('td');
  if (className) el.className = className;
  el.textContent = texto ?? '';
  return el;
}

/** Cria um <td> truncado a 80 chars com title = texto completo. */
function tdTruncado(texto) {
  const el = document.createElement('td');
  el.className = 'mono';
  el.title     = texto;
  el.textContent = texto.length > 80 ? texto.substring(0, 80) + '…' : texto;
  return el;
}

/** Limpa um tbody e anexa um DocumentFragment. */
function preencherTabela(tbodyId, frag) {
  const el = document.getElementById(tbodyId);
  el.innerHTML = '';
  el.appendChild(frag);
}

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


/* ============================================================
   Diagnóstico e avisos
============================================================ */

function mostrarDebug(info) {
  const itens = [
    { label: 'Total linhas em A',           valor: info.totalLinhasA      },
    { label: 'Passaram filtro (pos1=1, pos7=6)', valor: info.passaramFiltro  },
    { label: 'Descartadas (linha curta)',    valor: info.descartadasCurtas  },
    { label: 'Registos brutos em B',        valor: info.totalBrutosB       },
    { label: 'Registos B com ACLK',         valor: info.totalAclkB         },
    { label: 'Matches',                     valor: info.nMatches           },
    { label: 'Só em A',                     valor: info.nSoA               },
    { label: 'Só em B',                     valor: info.nSoB               }
  ];

  document.getElementById('debugGrid').innerHTML = itens.map(it =>
    `<div class="debug-item">
       <span class="debug-label">${it.label}</span>
       <span class="debug-value">${it.valor ?? '—'}</span>
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

function adicionarAviso(msg) {
  avisos.push(msg);
}

function mostrarAvisos() {
  const panel = document.getElementById('avisosPanel');
  const lista  = document.getElementById('avisosList');

  if (avisos.length === 0) {
    panel.hidden = true;
    return;
  }

  lista.innerHTML = avisos.map(a => `<li>${escHtml(a)}</li>`).join('');
  panel.hidden = false;
}

/** Escapa caracteres especiais de HTML para uso seguro em innerHTML. */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


/* ============================================================
   Sistema de tabs
============================================================ */

/**
 * Inicializa as tabs dentro de um container específico.
 * Escopo explícito evita que tabs de módulos distintos se interfiram.
 * @param {HTMLElement} container
 */
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
   Handler principal — Processar e Reconciliar
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

  // Aviso para ficheiros grandes (> 50 MB)
  const limite = 50 * 1024 * 1024;
  if (fileA.size > limite) adicionarAviso(`Ficheiro A tem ${(fileA.size / 1024 / 1024).toFixed(1)} MB — o processamento pode ser lento.`);
  if (fileB.size > limite) adicionarAviso(`Ficheiro B tem ${(fileB.size / 1024 / 1024).toFixed(1)} MB — o processamento pode ser lento.`);

  const btn = document.getElementById('btnProcessar');
  btn.disabled    = true;
  btn.textContent = 'A processar…';

  try {
    const encoding = usarWin1252 ? 'windows-1252' : 'utf-8';

    // Ler ambos os ficheiros em paralelo
    const [textoA, textoB] = await Promise.all([
      lerFicheiro(fileA, encoding),
      lerFicheiro(fileB, encoding)
    ]);

    // Parsear
    const resultA = parseFicheiroA(textoA);
    const resultB = parseFicheiroB(textoB);

    registosA = resultA.registos;
    registosB = resultB.registos;

    // Reconciliar
    resultadoRec = reconciliar(registosA, registosB);

    const info = {
      totalLinhasA:      resultA.totalLinhas,
      passaramFiltro:    resultA.passaramFiltro,
      descartadasCurtas: resultA.descartadasCurtas,
      totalBrutosB:      resultB.totalBrutos,
      totalAclkB:        resultB.totalAclk,
      nMatches:          resultadoRec.matches.length,
      nSoA:              resultadoRec.soEmA.length,
      nSoB:              resultadoRec.soEmB.length
    };

    // Renderizar todas as tabelas
    renderTabelaB(registosB);
    renderTabelaA(registosA, resultA.descartadasCurtas);
    renderTabelaMatches(resultadoRec.matches);
    renderTabelaSoA(resultadoRec.soEmA);
    renderTabelaSoB(resultadoRec.soEmB);

    mostrarDebug(info);
    mostrarRecCounts(info);
    mostrarAvisos();

    document.getElementById('resultados').hidden = false;

  } catch (err) {
    adicionarAviso(`Erro durante o processamento: ${err.message}`);
    mostrarAvisos();
    console.error(err);
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Processar e Reconciliar';
  }
}


/* ============================================================
   Copiar comando para a área de transferência
============================================================ */

/**
 * Copia o conteúdo do atributo data-cmd do botão para o clipboard.
 * Chamado inline no HTML (onclick).
 * @param {HTMLButtonElement} btn
 */
function copiarComando(btn) {
  const cmd = btn.dataset.cmd;
  navigator.clipboard.writeText(cmd).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓';
    btn.classList.add('copiado');
    setTimeout(() => {
      btn.textContent = orig;
      btn.classList.remove('copiado');
    }, 1800);
  }).catch(() => {
    // Fallback para browsers sem clipboard API (ex: file://)
    const ta = document.createElement('textarea');
    ta.value = cmd;
    ta.style.position = 'fixed';
    ta.style.opacity  = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    btn.textContent = '✓';
    btn.classList.add('copiado');
    setTimeout(() => {
      btn.textContent = '⎘';
      btn.classList.remove('copiado');
    }, 1800);
  });
}


/* ============================================================
   MÓDULO 2 — Reconciliação processed.EDST
============================================================ */

// ── Estado global — módulo 2 ───────────────────────────────
let registosC = [];
let registosD = [];
let resultadoRecProcessed = { matches: [], soEmC: [], soEmD: [] };
let transaccoesDuplicadas = [];   // secção especial "Transacções"


/**
 * Parseia um ficheiro processed.EDST.
 *
 * Formato: cada transacção começa numa linha com prefixo "request",
 * seguida de uma ou mais linhas com prefixo "response".
 *
 * ID da transacção: 12 caracteres a partir da posição 3 (1-indexed)
 * após a palavra "request", ou seja:
 *   linha.substring(9, 21)  em JS 0-indexed
 *   ("request" = 7 chars; posição 3 após = offset 2 = índice 9)
 *
 * @param {string} texto
 * @returns {{ registos: object[], totalRequest: number, totalResponse: number }}
 */
function parseFicheiroProcessed(texto) {
  const linhas = texto.split(/\r?\n/);
  const registos = [];
  let regActual   = null;
  let totalRequest  = 0;
  let totalResponse = 0;

  for (const linha of linhas) {
    const lt = linha.trim();
    if (!lt) continue;

    if (/^request/i.test(lt)) {
      // Guardar transacção anterior antes de iniciar nova
      if (regActual !== null) registos.push(regActual);

      totalRequest++;
      // ID: posição 3 (1-indexed) após "request" → substring(9, 21)
      const id = lt.substring(11, 23).trim();
      regActual = { id, requestLine: lt, responses: [] };

    } else if (/^response/i.test(lt) && regActual !== null) {
      totalResponse++;
      regActual.responses.push(lt);
    }
  }

  // Guardar a última transacção
  if (regActual !== null) registos.push(regActual);

  return { registos, totalRequest, totalResponse };
}


/**
 * Reconcilia dois conjuntos de transacções processed.EDST pelo ID.
 * @param {object[]} regsC
 * @param {object[]} regsD
 * @returns {{ matches: object[], soEmC: object[], soEmD: object[] }}
 */
function reconciliarProcessed(regsC, regsD) {
  const mapaC = agruparPorCampo(regsC, 'id');
  const mapaD = agruparPorCampo(regsD, 'id');

  const matches = [];
  const soEmC   = [];
  const soEmD   = [];

  for (const [id, listaC] of mapaC) {
    if (mapaD.has(id)) {
      for (const rC of listaC) {
        for (const rD of mapaD.get(id)) {
          matches.push({ id, rC, rD });
        }
      }
    } else {
      for (const r of listaC) soEmC.push(r);
    }
  }

  for (const [id, listaD] of mapaD) {
    if (!mapaC.has(id)) {
      for (const r of listaD) soEmD.push(r);
    }
  }

  return { matches, soEmC, soEmD };
}

/** Agrupa registos por um campo arbitrário num Map campo → registos[]. */
function agruparPorCampo(registos, campo) {
  const mapa = new Map();
  for (const r of registos) {
    const chave = r[campo];
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(r);
  }
  return mapa;
}


/* -- Secção especial "Transacções" -------------------------- */

/**
 * Filtra os matches onde:
 *   - resposta D contém "duplicate" (case-insensitive)
 *   - resposta C contém "//1"
 *
 * Extrai de resposta C:
 *   - referencia : 14 chars imediatamente antes de "//1"
 *   - balcao     : 9 chars imediatamente após "CO.CODE:1:1="
 *
 * @param {object[]} matches
 * @returns {object[]}
 */
function extrairTransaccoes(matches) {
  const resultado = [];
  const MARKER_REF  = '//1';
  const MARKER_BAL  = 'CO.CODE:1:1=';

  for (const m of matches) {
    const respD = m.rD.responses[0] || '';
    const respC = m.rC.responses[0] || '';

    if (!respD.toLowerCase().includes('duplicate')) continue;
    if (!respC.includes(MARKER_REF))               continue;

    // Referência: 14 chars antes de "//1"
    const idxRef = respC.indexOf(MARKER_REF);
    const inicio = Math.max(0, idxRef - 14);
    const referencia = respC.substring(inicio, idxRef);

    // Balcão: 9 chars após "CO.CODE:1:1="
    const idxBal = respC.indexOf(MARKER_BAL);
    const balcao = idxBal !== -1
      ? respC.substring(idxBal + MARKER_BAL.length, idxBal + MARKER_BAL.length + 9)
      : '';

    resultado.push({
      id:        m.id,
      referencia: referencia.trim(),
      balcao:    balcao.trim(),
      respostaC: respC,
      respostaD: respD
    });
  }

  return resultado;
}

function renderTabelaTransaccoes(lista) {
  const frag = document.createDocumentFragment();

  for (const r of lista) {
    const tr = document.createElement('tr');
    tr.className = 'row-soA';
    tr.appendChild(td(r.id,        'mono'));
    tr.appendChild(td(r.referencia, 'mono'));
    tr.appendChild(td(r.balcao,    'mono'));
    tr.appendChild(tdTruncado(r.respostaC));
    tr.appendChild(tdTruncado(r.respostaD));
    frag.appendChild(tr);
  }

  preencherTabela('corpoTransaccoes', frag);
  document.getElementById('countTransaccoes').textContent = `${lista.length} transacções`;
}


/* -- Renderização das tabelas do módulo 2 ------------------- */

/** Cria um <td> com as respostas truncadas e tooltip do texto completo. */
function tdRespostas(respostas) {
  const el    = document.createElement('td');
  el.className = 'mono';
  const texto  = respostas.join(';');
  el.title     = texto;                            // tooltip mostra tudo
  el.textContent = texto.length > 120 ? texto.substring(0, 120) + '…' : texto;
  return el;
}

/**
 * Preenche as tabelas simples do módulo 2: ID + resposta única.
 * (Transacções com != 1 resposta já foram filtradas antes.)
 */
function renderTabelaProcessedSimples(tbodyId, countId, registos, labelSufixo) {
  const frag = document.createDocumentFragment();

  for (const r of registos) {
    const tr = document.createElement('tr');
    tr.appendChild(td(r.id, 'mono'));
    tr.appendChild(tdTruncado(r.responses[0]));
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
    tr.appendChild(tdTruncado(m.rC.responses[0]));
    tr.appendChild(tdTruncado(m.rD.responses[0]));
    frag.appendChild(tr);
  }

  preencherTabela('corpoPMatches', frag);
  document.getElementById('countPMatches').textContent = `${matches.length} matches`;
}


/* -- Diagnóstico do módulo 2 -------------------------------- */

function mostrarDebugProcessed(info) {
  const itens = [
    { label: 'Transacções em C',           valor: info.totalRequestC  },
    { label: 'Excluídas C (>1 resposta)',  valor: info.exclC          },
    { label: 'Transacções em D',           valor: info.totalRequestD  },
    { label: 'Excluídas D (>1 resposta)',  valor: info.exclD          },
    { label: 'Matches',                    valor: info.nMatches       },
    { label: 'Só em C',                    valor: info.nSoC           },
    { label: 'Só em D',                    valor: info.nSoD           },
    { label: 'Transacções (duplicate+//1)',valor: info.nTransaccoes   }
  ];

  document.getElementById('debugGridProcessed').innerHTML = itens.map(it =>
    `<div class="debug-item">
       <span class="debug-label">${it.label}</span>
       <span class="debug-value">${it.valor ?? '—'}</span>
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


/* -- Exportar CSV do módulo 2 ------------------------------- */

/** Escapa um valor para CSV (separador ";"). */
function csvEsc(val) {
  const s = String(val ?? '');
  return (s.includes(';') || s.includes('"') || s.includes('\n'))
    ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Gera e faz download do CSV do módulo 2.
 * @param {'C'|'D'|'matches'|'soC'|'soD'} tipo
 */
function exportarCSVProcessed(tipo) {
  const BOM = '﻿';
  let linhas = [], nomeFicheiro = '';

  const linhaSimples = r => [r.id, csvEsc(r.responses[0])].join(';');

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
                  [m.id, csvEsc(m.rC.responses[0]), csvEsc(m.rD.responses[0])].join(';'))];
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

  const blob = new Blob([BOM + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = nomeFicheiro; a.click();
  URL.revokeObjectURL(url);
}


/* -- Handler principal do módulo 2 -------------------------- */

async function processarProcessed() {
  const btn = document.getElementById('btnProcessarProcessed');

  try {
    const inputC = document.getElementById('ficheiroC');
    const inputD = document.getElementById('ficheiroD');

    if (!inputC || !inputD) {
      throw new Error('Elementos de input não encontrados — tente recarregar a página (Ctrl+Shift+R).');
    }

    const fileC = inputC.files[0];
    const fileD = inputD.files[0];

    if (!fileC || !fileD) {
      alert('Selecione ambos os ficheiros (C e D) antes de processar.');
      return;
    }

    btn.disabled    = true;
    btn.textContent = 'A processar…';

    const usarWin1252 = document.getElementById('chkEncoding').checked;
    const encoding    = usarWin1252 ? 'windows-1252' : 'utf-8';

    const [textoC, textoD] = await Promise.all([
      lerFicheiro(fileC, encoding),
      lerFicheiro(fileD, encoding)
    ]);

    const resultC = parseFicheiroProcessed(textoC);
    const resultD = parseFicheiroProcessed(textoD);

    // Manter apenas transacções com exactamente 1 resposta
    const exclC = resultC.registos.filter(r => r.responses.length !== 1).length;
    const exclD = resultD.registos.filter(r => r.responses.length !== 1).length;
    registosC = resultC.registos.filter(r => r.responses.length === 1);
    registosD = resultD.registos.filter(r => r.responses.length === 1);

    resultadoRecProcessed = reconciliarProcessed(registosC, registosD);

    const info = {
      totalRequestC:  resultC.totalRequest,
      totalResponseC: resultC.totalResponse,
      exclC,
      totalRequestD:  resultD.totalRequest,
      totalResponseD: resultD.totalResponse,
      exclD,
      nMatches: resultadoRecProcessed.matches.length,
      nSoC:     resultadoRecProcessed.soEmC.length,
      nSoD:     resultadoRecProcessed.soEmD.length
    };

    renderTabelaProcessedSimples('corpoPC',   'countPC',   registosC,                   'transacções');
    renderTabelaProcessedSimples('corpoPD',   'countPD',   registosD,                   'transacções');
    renderTabelaMatchesProcessed(resultadoRecProcessed.matches);
    renderTabelaProcessedSimples('corpoPSoC', 'countPSoC', resultadoRecProcessed.soEmC, 'só em C');
    renderTabelaProcessedSimples('corpoPSoD', 'countPSoD', resultadoRecProcessed.soEmD, 'só em D');

    // Secção especial: matches com "duplicate" em D e "//1" em C
    transaccoesDuplicadas = extrairTransaccoes(resultadoRecProcessed.matches);
    renderTabelaTransaccoes(transaccoesDuplicadas);
    info.nTransaccoes = transaccoesDuplicadas.length;

    mostrarDebugProcessed(info);
    mostrarRecCountsProcessed(info);

    const secao = document.getElementById('resultadosProcessed');
    secao.hidden = false;
    if (!secao.dataset.tabsInit) {
      initTabs(secao);
      secao.dataset.tabsInit = '1';
    }

    // Download automático do relatório de reconciliação
    exportarCSVProcessed('matches');
    exportarCSVProcessed('soC');
    exportarCSVProcessed('soD');
    exportarCSVProcessed('transaccoes');

  } catch (err) {
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
   Inicialização
============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  // Tabs do módulo 1 são inicializadas aqui; módulo 2 é lazy (ver processarProcessed)
  initTabs(document.getElementById('resultados'));

  document.getElementById('btnProcessar').addEventListener('click', processar);
  document.getElementById('btnProcessarProcessed').addEventListener('click', processarProcessed);

  // Mostrar nome e tamanho do ficheiro selecionado
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
