import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, reload, sendEmailVerification, updateProfile } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { arrayRemove, arrayUnion, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { auth, db } from './firebase.js';

const OWNER_UID = 'oY9FFDljQeOvHpgiQENHoGX3pzo2';

const tabs = {
  resumo: ['Resumo', 'VISÃO GERAL'],
  vendas: ['Vendas', 'RECEITAS'],
  emProducao: ['Em produção', 'ACOMPANHAMENTO'],
  pagamentos: ['Costureiras', 'PRODUÇÃO'],
  compras: ['Insumos', 'DESPESAS'],
  outrosGastos: ['Outros gastos', 'DESPESAS EXTRAS'],
  estoque: ['Estoque', 'INVENTÁRIO'],
  custosFabricacao: ['Custo de fabricação', 'PRODUTOS'],
  admin: ['Acessos', 'ADMINISTRAÇÃO']
};

const tamanhos = ['PP', 'P', 'M', 'G', 'GG', 'XL'];
const productionStatuses = ['Aguardando', 'Em produção', 'Concluído'];
const $ = selector => document.querySelector(selector);
const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const total = (items, key = 'valor') => items.reduce((sum, item) => sum + Number(item[key] || 0), 0);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const formatDate = date => date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
const dateValue = date => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const monday = date => {
  const copy = new Date(date);
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const loginDisabledForTests = false;

let state = { vendas: [], emProducao: [], pagamentos: [], compras: [], outrosGastos: [], estoque: [], custosFabricacao: [], costureiras: [], log: [] };
let loadedStateUserId = null;
let sharedEmails = [];
let user = JSON.parse(localStorage.getItem('atelier_user') || 'null');
let authToken = localStorage.getItem('atelier_token');
let tab = 'resumo';
let stockSizeFilter = '';
let editingStockModel = '';
let weekStart = monday(new Date());
const today = dateValue(new Date());
let reportStart = today;
let reportEnd = today;

onAuthStateChanged(auth, async (firebaseUser) => {
  if (firebaseUser) {
    user = {
      id: firebaseUser.uid,
      name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Usuário',
      email: firebaseUser.email || ''
    };
    authToken = `firebase:${firebaseUser.uid}`;
    localStorage.setItem('atelier_token', authToken);
    localStorage.setItem('atelier_user', JSON.stringify(user));
    if (firebaseUser.uid !== OWNER_UID && !firebaseUser.emailVerified) {
      emailVerificationCard(firebaseUser);
      return;
    }
    if (loadedStateUserId !== firebaseUser.uid) {
      state = normalizeState({}).state;
      sharedEmails = [];
      try {
        await loadState();
      } catch (error) {
        console.error('Erro ao carregar espaço compartilhado:', error);
        showToast(error.code === 'permission-denied'
          ? 'Esta conta ainda não recebeu acesso ao painel.'
          : 'Não foi possível carregar os dados compartilhados.');
        await logout();
        return;
      }
    }
  } else {
    user = null;
    authToken = null;
    loadedStateUserId = null;
    sharedEmails = [];
    state = normalizeState({}).state;
    localStorage.removeItem('atelier_token');
    localStorage.removeItem('atelier_user');
  }
  render();
});

const weekEnd = () => new Date(+weekStart + 6 * 86400000);
const inWeek = value => value >= dateValue(weekStart) && value <= dateValue(weekEnd());
const formatPeriod = (start, end) => {
  if (!start || !end) return 'Selecione um período';
  const first = new Date(start + 'T12:00:00');
  const last = new Date(end + 'T12:00:00');
  if (start === end) return formatDate(first);
  return `${formatDate(first)} a ${formatDate(last)}`;
};
const inDateRange = value => {
  if (!value) return false;
  if (!reportStart || !reportEnd) return true;
  return value >= reportStart && value <= reportEnd;
};
const stampEditor = item => ({ ...item, updatedBy: user?.name || 'Sistema', updatedAt: new Date().toISOString() });
const editorBadge = item => item?.updatedBy ? `<span class="edited-tag">Editado por ${esc(item.updatedBy)}</span>` : '';
const productKey = name => String(name || '').trim().toLocaleLowerCase('pt-BR');
const stockUnitValue = item => Number(item.valorUnitario || 0) + (String(item.tamanho || '').toUpperCase() === 'XL' ? 10 : 0);

function normalizeState(value) {
  const normalized = {
    vendas: [], emProducao: [], pagamentos: [], compras: [], outrosGastos: [], estoque: [],
    custosFabricacao: [], costureiras: [], log: [], ...value
  };
  normalized.emProducao = Array.isArray(normalized.emProducao) ? normalized.emProducao : [];
  normalized.emProducao = normalized.emProducao.map(item => ({
    ...item,
    status: productionStatuses.includes(item.status) ? item.status : 'Em produção'
  }));
  normalized.outrosGastos = Array.isArray(normalized.outrosGastos) ? normalized.outrosGastos : [];
  normalized.estoque = Array.isArray(normalized.estoque) ? normalized.estoque : [];
  normalized.custosFabricacao = Array.isArray(normalized.custosFabricacao) ? normalized.custosFabricacao : [];
  const knownProducts = new Set(normalized.custosFabricacao.map(item => productKey(item.nome)));
  let changed = false;

  normalized.estoque = normalized.estoque.map(item => {
    const hasLegacyCosts = ['custoFabricacao', 'valorPeca', 'valorDesconto']
      .some(key => Object.prototype.hasOwnProperty.call(item, key));
    if (!hasLegacyCosts) return item;

    changed = true;
    const key = productKey(item.nome);
    const hasCost = [item.custoFabricacao, item.valorPeca, item.valorDesconto]
      .some(value => Number(value || 0) > 0);
    if (key && hasCost && !knownProducts.has(key)) {
      normalized.custosFabricacao.push({
        id: crypto.randomUUID(),
        nome: item.nome,
        custoFabricacao: Number(item.custoFabricacao || 0),
        valorPeca: Number(item.valorPeca || 0),
        valorDesconto: Number(item.valorDesconto || 0),
        updatedBy: item.updatedBy,
        updatedAt: item.updatedAt
      });
      knownProducts.add(key);
    }

    const { custoFabricacao, valorPeca, valorDesconto, ...stockItem } = item;
    return stockItem;
  });

  return { state: normalized, changed };
}

async function loadState() {
  const userId = user?.id;
  if (!userId) return;

  const stateRef = doc(db, 'userStates', OWNER_UID);
  const snapshot = await getDoc(stateRef);
  if (user?.id !== userId) return;

  if (snapshot.exists()) {
    state = normalizeState(snapshot.data().state || {}).state;
  } else if (userId === OWNER_UID) {
    state = normalizeState({}).state;
    await setDoc(stateRef, {
      ownerUid: OWNER_UID,
      state,
      updatedAt: serverTimestamp()
    });
  } else {
    throw new Error('Espaço compartilhado não encontrado.');
  }

  if (userId === OWNER_UID) {
    const accessRef = doc(db, 'userStates', OWNER_UID, 'access', 'permissions');
    const accessSnapshot = await getDoc(accessRef);
    sharedEmails = accessSnapshot.exists() && Array.isArray(accessSnapshot.data().memberEmails)
      ? accessSnapshot.data().memberEmails
      : [];
    if (!accessSnapshot.exists()) {
      await setDoc(accessRef, {
        ownerUid: OWNER_UID,
        memberEmails: [],
        updatedAt: serverTimestamp()
      });
    }
  }

  loadedStateUserId = userId;
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

function authCard(mode = 'login', error = '') {
  const register = mode === 'register';
  $('#auth-card').innerHTML = `
    <span class="eyebrow">${register ? 'PRIMEIRO ACESSO' : 'BEM-VINDO DE VOLTA'}</span>
    <h2>${register ? 'Crie seu espaço' : 'Entre no seu painel'}</h2>
    <p>${register ? 'Organize a operação do seu ateliê.' : 'Acompanhe o que importa hoje.'}</p>
    <form id="auth-form">
      ${register ? '<label class="field">Nome<input name="name" autocomplete="name" required></label>' : ''}
      <label class="field">E-mail<input name="email" type="email" autocomplete="email" required></label>
      <label class="field">Senha<input name="password" type="password" minlength="6" autocomplete="current-password" required></label>
      ${register ? '<label class="field">Confirmar senha<input name="confirmPassword" type="password" minlength="6" autocomplete="new-password" required></label>' : ''}
      <div class="auth-error">${esc(error)}</div>
      <button class="primary">${register ? 'Criar conta' : 'Entrar'}</button>
    </form>
    <button id="auth-switch" class="secondary">${register ? 'Já tenho uma conta' : 'Criar uma conta'}</button>
  `;

  $('#auth-form').addEventListener('submit', submitAuth);
  $('#auth-switch').addEventListener('click', () => authCard(register ? 'login' : 'register'));
}

function emailVerificationCard(firebaseUser) {
  $('#auth-view').classList.remove('hidden');
  $('#app-view').classList.add('hidden');
  $('#auth-card').innerHTML = `
    <span class="eyebrow">VERIFICAÇÃO NECESSÁRIA</span>
    <h2>Confirme seu e-mail</h2>
    <p>O acesso compartilhado exige um endereço verificado.</p>
    <div class="auth-error"></div>
    <button class="primary" data-resend-verification>Reenviar confirmação</button>
    <button class="secondary" data-refresh-verification>Já confirmei</button>
    <button class="secondary" data-sign-out>Sair da conta</button>
  `;
  $('#auth-card [data-resend-verification]').addEventListener('click', async () => {
    try {
      await sendEmailVerification(firebaseUser);
      showToast('E-mail de confirmação enviado.');
    } catch {
      showToast('Não foi possível enviar a confirmação.');
    }
  });
  $('#auth-card [data-refresh-verification]').addEventListener('click', async () => {
    try {
      await reload(firebaseUser);
      if (auth.currentUser?.emailVerified) location.reload();
      else showToast('O e-mail ainda não foi confirmado.');
    } catch {
      showToast('Não foi possível atualizar a confirmação.');
    }
  });
  $('#auth-card [data-sign-out]').addEventListener('click', logout);
}

async function submitAuth(event) {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.target));
  const mode = values.name ? 'register' : 'login';

  if (mode === 'register' && String(values.password || '') !== String(values.confirmPassword || '')) {
    return authCard('register', 'As senhas não coincidem.');
  }

  try {
    const credential = mode === 'register'
      ? await createUserWithEmailAndPassword(auth, String(values.email).trim(), String(values.password))
      : await signInWithEmailAndPassword(auth, String(values.email).trim(), String(values.password));

    if (mode === 'register' && values.name) {
      await updateProfile(credential.user, { displayName: String(values.name).trim() });
      try {
        await sendEmailVerification(credential.user);
      } catch (error) {
        console.warn('Não foi possível enviar a confirmação do e-mail:', error);
      }
    }

    user = {
      id: credential.user.uid,
      name: credential.user.displayName || String(values.name || '').trim() || credential.user.email?.split('@')[0] || 'Usuário',
      email: credential.user.email || String(values.email).trim()
    };
    authToken = `firebase:${credential.user.uid}`;
    localStorage.setItem('atelier_token', authToken);
    localStorage.setItem('atelier_user', JSON.stringify(user));
    state = normalizeState(state && Array.isArray(state.estoque) ? state : {}).state;
    render();
  } catch (error) {
    authCard(mode, error.message || 'Não foi possível concluir o login.');
  }
}

async function logout() {
  try {
    await signOut(auth);
  } catch (error) {
    console.warn('Erro ao sair do Firebase:', error);
  } finally {
    localStorage.removeItem('atelier_token');
    localStorage.removeItem('atelier_user');
    authToken = null;
    user = null;
    render();
  }
}

function render() {
  if (loginDisabledForTests) {
    $('#auth-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');
    user = { id: 'demo-user', name: 'Usuário Teste', email: 'teste@atelie.local' };
    authToken = 'demo-token';
    if (!state || !Array.isArray(state.estoque) || !Array.isArray(state.vendas) || !Array.isArray(state.emProducao) || !Array.isArray(state.pagamentos) || !Array.isArray(state.compras) || !Array.isArray(state.outrosGastos) || !Array.isArray(state.costureiras) || !Array.isArray(state.log)) {
      state = {
        vendas: [],
        emProducao: [],
        pagamentos: [],
        compras: [],
        outrosGastos: [],
        estoque: [],
        custosFabricacao: [],
        costureiras: [],
        log: []
      };
    }
  }

  if (!loginDisabledForTests && (!authToken || !user)) {
    $('#auth-view').classList.remove('hidden');
    $('#app-view').classList.add('hidden');
    authCard();
    return;
  }

  if (loginDisabledForTests) {
    $('#auth-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');
  } else {
    $('#auth-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');
  }

  $('#user-box').innerHTML = `
    <strong>${esc(user.name)}</strong><span>${esc(user.email)}</span>
    ${user.id === OWNER_UID ? `<button class="secondary profile-access" data-tab="admin">Administração</button>` : ''}
  `;
  $('#nav').innerHTML = Object.entries(tabs).filter(([key]) => key !== 'admin')
    .map(([key, [label]]) => `<button class="nav-item ${key === tab ? 'active' : ''}" data-tab="${key}"><span>${({ resumo: '◈', vendas: '↗', emProducao: '✂', pagamentos: '✦', compras: '⊙', outrosGastos: '＋', estoque: '□', custosFabricacao: 'R$' })[key]}</span>${label}</button>`)
    .join('');

  document.querySelectorAll('[data-tab]').forEach(button => {
    button.addEventListener('click', () => {
      tab = button.dataset.tab;
      render();
    });
  });

  $('#section-kicker').textContent = tabs[tab][1];
  $('#page-title').textContent = tabs[tab][0];
  $('#week-label').innerHTML = `
    <label>De <input type="date" name="report-start" value="${reportStart || today}"></label>
    <label>Até <input type="date" name="report-end" value="${reportEnd || today}"></label>
  `;

  document.querySelectorAll('input[name="report-start"], input[name="report-end"]').forEach(input => {
    input.addEventListener('change', event => {
      const { name, value } = event.target;
      if (name === 'report-start') reportStart = value || today;
      if (name === 'report-end') reportEnd = value || today;
      if (reportStart > reportEnd) {
        const [start, end] = [reportStart, reportEnd];
        reportStart = end;
        reportEnd = start;
      }
      render();
    });
  });

  $('#logout').addEventListener('click', logout);
  $('#app').innerHTML = views[tab]();
  bindActions();
}

function sundayChart() {
  const selectedMonth = new Date(`${(reportStart || today).slice(0, 7)}-01T12:00:00`);
  const sundays = [];
  const cursor = new Date(selectedMonth);

  while (cursor.getMonth() === selectedMonth.getMonth()) {
    if (cursor.getDay() === 0) sundays.push(dateValue(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  const points = sundays.map(date => {
    const sales = total(state.vendas.filter(x => x.data === date));
    const pay = total(state.pagamentos.filter(x => x.data === date));
    const buy = total(state.compras.filter(x => x.data === date));
    const other = total(state.outrosGastos.filter(x => x.data === date));
    return { date, sales, pay, buy, other, balance: sales - pay - buy - other };
  });
  const max = Math.max(1, ...points.map(point => Math.max(point.sales, point.pay, point.buy, point.other)));

  return `
    <section class="panel sunday-chart-panel">
      <div class="panel-heading"><strong>Domingos do mês</strong><small>${formatPeriod(`${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}-01`, `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}-${new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 0).getDate()}`)}</small></div>
      <div class="chart-legend"><span><i class="chart-key sales"></i>Vendas</span><span><i class="chart-key pay"></i>Costureiras</span><span><i class="chart-key buy"></i>Insumos</span><span><i class="chart-key other"></i>Outros gastos</span></div>
      <div class="sunday-chart">
        ${points.map(point => `
          <div class="sunday-column">
            <div class="sunday-bars">
              <span class="chart-bar sales" style="height:${point.sales / max * 100}%" title="Vendas: ${money(point.sales)}"></span>
              <span class="chart-bar pay" style="height:${point.pay / max * 100}%" title="Costureiras: ${money(point.pay)}"></span>
              <span class="chart-bar buy" style="height:${point.buy / max * 100}%" title="Insumos: ${money(point.buy)}"></span>
              <span class="chart-bar other" style="height:${point.other / max * 100}%" title="Outros gastos: ${money(point.other)}"></span>
            </div>
            <strong>Dom ${point.date.slice(8, 10)}</strong>
            <small class="${point.balance < 0 ? 'negative' : 'positive'}">${money(point.balance)}</small>
          </div>
        `).join('') || '<div class="list-empty">Nenhum domingo encontrado no mês.</div>'}
      </div>
    </section>
  `;
}

function summary() {
  const sales = state.vendas.filter(x => inDateRange(x.data));
  const pay = state.pagamentos.filter(x => inDateRange(x.data));
  const buy = state.compras.filter(x => inDateRange(x.data));
  const otherExpenses = state.outrosGastos.filter(x => inDateRange(x.data));
  const revenue = total(sales);
  const cost = total(pay) + total(buy) + total(otherExpenses);
  const balance = revenue - cost;

  return `
    <div class="metrics">
      <div class="metric"><span class="metric-label">Receita do período</span><div class="metric-value positive">${money(revenue)}</div></div>
      <div class="metric"><span class="metric-label">A pagar às costureiras</span><div class="metric-value">${money(total(pay.filter(x => !x.pago)))}</div></div>
      <div class="metric"><span class="metric-label">Insumos</span><div class="metric-value">${money(total(buy))}</div></div>
      <div class="metric"><span class="metric-label">Outros gastos</span><div class="metric-value">${money(total(otherExpenses))}</div></div>
      <div class="metric"><span class="metric-label">Resultado líquido</span><div class="metric-value ${balance < 0 ? 'negative' : 'positive'}">${money(balance)}</div></div>
    </div>
    ${sundayChart()}
    <div class="grid-2">
      <section class="panel">
        <div class="panel-heading"><strong>Movimentações recentes</strong><small>${sales.length + pay.length + buy.length + otherExpenses.length} registros</small></div>
        ${recentRows([
          ...sales.map(x => ({ ...x, type: 'Venda', label: x.forma })),
          ...pay.map(x => ({ ...x, type: 'Costureira', label: x.costureira })),
          ...buy.map(x => ({ ...x, type: 'Insumo', label: x.item })),
          ...otherExpenses.map(x => ({ ...x, type: 'Outro gasto', label: x.categoria }))
        ].sort((a, b) => new Date(b.data || b.em || 0) - new Date(a.data || a.em || 0)).slice(0, 6))}
      </section>
      <section class="panel">
        <div class="panel-heading"><strong>Estoque baixo</strong></div>
        ${state.estoque.filter(x => x.qtd <= x.min).map(x => `
          <div class="row">
            <div class="row-main"><strong>${esc(x.nome)}</strong><small>${esc(x.tamanho || 'Sem tamanho')} · Mínimo: ${x.min}${x.updatedBy ? ` · ${editorBadge(x)}` : ''}</small></div>
            <strong class="negative">${x.qtd} un.</strong>
          </div>
        `).join('') || '<div class="list-empty">Tudo certo por aqui.</div>'}
      </section>
    </div>
  `;
}

function recentRows(items) {
  return items.map(x => `
    <div class="row">
      <div class="row-main">
        <strong>${esc(x.type)}</strong>
        <small>${esc(x.label)} · ${x.data ? formatDate(new Date(x.data + 'T12:00:00')) : ''}${x.updatedBy ? ` · ${editorBadge(x)}` : ''}</small>
      </div>
      <strong>${money(x.valor)}</strong>
    </div>
  `).join('') || '<div class="list-empty">Nenhuma movimentação nesta semana.</div>';
}

function transactionView(kind, title, fields, items) {
  return `
    <section class="panel">
      <div class="panel-heading"><strong>Novo lançamento</strong><small>${title}</small></div>
      <form class="form-grid" data-add="${kind}">${fields}<button class="primary">Adicionar</button></form>
    </section>
    <section class="panel">
      <div class="panel-heading"><strong>Histórico</strong><strong>${money(total(items))}</strong></div>
      ${items.slice().sort((a, b) => b.data.localeCompare(a.data)).map(x => `
        <div class="row">
          <div class="row-main">
            <strong>${esc(x.item || x.costureira || x.forma || x.categoria || 'Lançamento')}</strong>
            <small>${formatDate(new Date(x.data + 'T12:00:00'))} ${x.obs ? '· ' + esc(x.obs) : ''}${x.updatedBy ? ` · ${editorBadge(x)}` : ''}</small>
          </div>
          <span class="row-value">${money(x.valor)}</span>
          <button class="icon-button" data-delete="${kind}:${x.id}">×</button>
        </div>
      `).join('') || '<div class="list-empty">Nenhum lançamento nesta semana.</div>'}
    </section>
  `;
}

const inventoryCsvColumns = [
  ['id', 'ID'], ['nome', 'Produto'], ['tamanho', 'Tamanho'], ['qtd', 'Quantidade'],
  ['min', 'Estoque mínimo'], ['valorUnitario', 'Valor unitário'], ['data', 'Data do cadastro'],
  ['em', 'Criado em'], ['contado', 'Última contagem'], ['updatedBy', 'Editado por'], ['updatedAt', 'Atualizado em']
];

function csvCell(value) {
  const text = String(value ?? '');
  const safeText = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

function exportInventoryCsv(items) {
  const rows = [inventoryCsvColumns.map(([, label]) => csvCell(label)).join(';')];
  items.forEach(item => rows.push(inventoryCsvColumns.map(([key]) => csvCell(item[key])).join(';')));
  return `\uFEFF${rows.join('\r\n')}`;
}

function parseCsvRows(text) {
  const source = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell === '') {
      quoted = true;
    } else if (character === ';') {
      row.push(cell);
      cell = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some(value => value.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error('A planilha contém aspas sem fechamento.');
  row.push(cell);
  if (row.some(value => value.trim() !== '')) rows.push(row);
  return rows;
}

function spreadsheetDate(value, rowNumber) {
  const text = String(value || '').trim();
  if (!text) return today;
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) {
    const brazilianDate = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
    if (!brazilianDate) throw new Error(`Data inválida na linha ${rowNumber}.`);
    match = [text, brazilianDate[3], brazilianDate[2], brazilianDate[1]];
    if (match[1].length <= 2) match[1] = `20${match[1]}`;
  }
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (date.getFullYear() !== Number(year) || date.getMonth() + 1 !== Number(month) || date.getDate() !== Number(day)) {
    throw new Error(`Data inválida na linha ${rowNumber}.`);
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseInventoryCsv(text, currentInventory) {
  const rows = parseCsvRows(text);
  if (!rows.length) throw new Error('A planilha está vazia.');
  const headers = rows[0].map(value => value.trim().toLocaleLowerCase('pt-BR'));
  const expectedHeaders = inventoryCsvColumns.map(([, label]) => label.toLocaleLowerCase('pt-BR'));
  if (headers.length !== expectedHeaders.length || expectedHeaders.some((header, index) => headers[index] !== header)) {
    throw new Error('Use uma planilha exportada pela tela de Estoque, sem alterar os cabeçalhos.');
  }

  const existingByKey = new Map(currentInventory.map(item => [`${productKey(item.nome)}|${String(item.tamanho).toUpperCase()}`, item]));
  const seen = new Set();
  return rows.slice(1).map((values, index) => {
    const rowNumber = index + 2;
    if (values.length !== expectedHeaders.length) throw new Error(`Quantidade de colunas incorreta na linha ${rowNumber}.`);
    const entry = Object.fromEntries(inventoryCsvColumns.map(([key], columnIndex) => [key, values[columnIndex].trim()]));
    const nome = entry.nome.replace(/^'(?=[\s]*[=+@-])/, '').trim();
    const tamanho = entry.tamanho.toUpperCase();
    const quantity = Number(entry.qtd.replace(',', '.'));
    const minimum = Number(entry.min.replace(',', '.'));
    const unitPrice = Number(entry.valorUnitario.replace(',', '.'));
    const key = `${productKey(nome)}|${tamanho}`;

    if (!nome || !tamanhos.includes(tamanho)) throw new Error(`Produto ou tamanho inválido na linha ${rowNumber}.`);
    if (!Number.isInteger(quantity) || quantity < 0 || !Number.isInteger(minimum) || minimum < 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error(`Quantidade, mínimo ou valor inválido na linha ${rowNumber}.`);
    }
    if (seen.has(key)) throw new Error(`O produto ${nome} (${tamanho}) aparece mais de uma vez.`);
    seen.add(key);

    const existing = existingByKey.get(key);
    return {
      id: entry.id || crypto.randomUUID(),
      nome,
      tamanho,
      qtd: quantity,
      min: minimum,
      valorUnitario: unitPrice,
      data: spreadsheetDate(entry.data, rowNumber),
      em: entry.em || new Date().toISOString(),
      contado: spreadsheetDate(entry.contado, rowNumber),
      updatedBy: entry.updatedBy.replace(/^'(?=[\s]*[=+@-])/, ''),
      updatedAt: entry.updatedAt || new Date().toISOString(),
      foto: existing?.foto || ''
    };
  });
}

function inventoryView() {
  const products = new Map();
  const visibleStock = stockSizeFilter
    ? state.estoque.filter(item => String(item.tamanho || '').toUpperCase() === stockSizeFilter)
    : state.estoque;
  visibleStock.forEach(item => {
    const key = productKey(item.nome);
    if (!products.has(key)) products.set(key, []);
    products.get(key).push(item);
  });
  const sizeOrder = new Map(tamanhos.map((size, index) => [size, index]));
  const pieceCount = visibleStock.reduce((sum, item) => sum + Number(item.qtd || 0), 0);
  const inventoryValue = visibleStock.reduce((sum, item) => sum + Number(item.qtd || 0) * stockUnitValue(item), 0);

  return `
    <section class="panel">
      <div class="panel-heading"><strong>Novo produto</strong><small>${products.size} modelos cadastrados</small></div>
      <form class="form-grid" data-add="estoque">
        ${field('Produto', 'nome')}
        ${field('Estoque mínimo por tamanho', 'min', 'number', '0')}
        <label class="field">Valor base por peça (XL + R$ 10)<input name="valorUnitario" type="number" min="0" step="0.01" value="0" required></label>
        <div class="size-quantity-grid">
          ${tamanhos.map(size => `<label class="field">${size}<input name="qtd_${size}" type="number" min="0" step="1" value="0" required></label>`).join('')}
        </div>
        <label class="field">Foto do modelo<input name="foto" type="file" accept="image/*"></label>
        <button class="primary">Adicionar ao estoque</button>
      </form>
    </section>
    <section class="panel">
      <div class="panel-heading inventory-heading">
        <strong>Inventário</strong>
        <div class="inventory-heading-actions">
          <div class="inventory-backup-actions">
            <button class="secondary" type="button" data-export-inventory>Baixar planilha</button>
            <label class="secondary inventory-import-button">Importar planilha<input type="file" accept=".csv,text/csv" data-import-inventory></label>
          </div>
          <small class="inventory-backup-note">A planilha não inclui fotos.</small>
          <label class="inventory-size-filter">Filtrar tamanho
            <select name="stock-size-filter" aria-label="Filtrar estoque por tamanho">
              <option value="" ${stockSizeFilter ? '' : 'selected'}>Todos</option>
              ${tamanhos.map(size => `<option value="${size}" ${stockSizeFilter === size ? 'selected' : ''}>${size}</option>`).join('')}
            </select>
          </label>
        </div>
      </div>
      <div class="inventory-value-report">
        <div><small>${stockSizeFilter ? `Valor total em ${stockSizeFilter}` : 'Valor total das roupas em estoque'}</small><strong>${money(inventoryValue)}</strong></div>
        <div><small>Peças disponíveis</small><strong>${pieceCount}</strong></div>
      </div>
      ${[...products.entries()].map(([, items]) => {
        const model = items[0];
        const sizes = items.slice().sort((a, b) => (sizeOrder.get(a.tamanho) ?? 99) - (sizeOrder.get(b.tamanho) ?? 99));
        const allModelSizes = state.estoque
          .filter(item => productKey(item.nome) === productKey(model.nome))
          .map(item => String(item.tamanho || '').toUpperCase());
        const missingSizes = tamanhos.filter(size => !allModelSizes.includes(size));
        return `
          <div class="row inventory-item">
            <div class="inventory-thumb-wrap">
              ${model.foto ? `<img class="inventory-thumb" src="${model.foto}" alt="${esc(model.nome)}">` : '<div class="inventory-thumb placeholder">Sem foto</div>'}
            </div>
            <div class="inventory-model">
              <strong>${esc(model.nome)}</strong>
              <small>Modelo · ${items.reduce((sum, item) => sum + Number(item.qtd || 0), 0)} peças</small>
              <button class="secondary inventory-edit-toggle" type="button" data-toggle-stock-edit="${esc(model.nome)}">${editingStockModel === productKey(model.nome) ? 'Cancelar edição' : 'Editar'}</button>
              <form class="inventory-model-edit ${editingStockModel === productKey(model.nome) ? '' : 'hidden'}" data-edit-stock-model>
                <input type="hidden" name="originalName" value="${esc(model.nome)}">
                <label class="field">Adicionar tamanho
                  <select name="tamanho">
                    <option value="">Não adicionar tamanho</option>
                    ${missingSizes.map(size => `<option value="${size}">${size}</option>`).join('')}
                  </select>
                </label>
                <label class="field">Trocar nome<input name="nome" value="${esc(model.nome)}" required></label>
                <label class="field">Alterar valor base por peça (XL + R$ 10)<input name="valorUnitario" type="number" min="0" step="0.01" value="${Number(model.valorUnitario || 0)}" required></label>
                <button class="secondary" type="submit">Salvar alterações</button>
              </form>
              <div class="stock-size-list">
                ${sizes.map(item => `
                  <div class="stock-size-row">
                    <strong>${esc(item.tamanho || '—')}</strong>
                    <span class="${item.qtd <= item.min ? 'stock-low' : ''}">${item.qtd} un.</span>
                    <span class="stock-unit-price" title="Valor unitário aplicado">${money(stockUnitValue(item))}/un.</span>
                    <small>Mín. ${item.min}</small>
                    <div class="stock-size-actions">
                      <button class="secondary" title="Diminuir ${esc(item.tamanho)}" aria-label="Diminuir ${esc(item.tamanho)} de ${esc(item.nome)}" data-stock="${item.id}:-1">−</button>
                      <button class="secondary" title="Aumentar ${esc(item.tamanho)}" aria-label="Aumentar ${esc(item.tamanho)} de ${esc(item.nome)}" data-stock="${item.id}:1">+</button>
                      <button class="icon-button" title="Remover tamanho ${esc(item.tamanho)}" aria-label="Remover tamanho ${esc(item.tamanho)} de ${esc(item.nome)}" data-delete="estoque:${item.id}">×</button>
                    </div>
                  </div>
                `).join('')}
              </div>
              <small>${formatDate(new Date((model.contado || today) + 'T12:00:00'))}${model.updatedBy ? ` · ${editorBadge(model)}` : ''}</small>
            </div>
          </div>
        `;
      }).join('') || `<div class="list-empty">${stockSizeFilter ? `Nenhuma peça no tamanho ${stockSizeFilter}.` : 'Cadastre o primeiro produto.'}</div>`}
    </section>
  `;
}

function manufacturingCostsView() {
  return `
    <section class="panel">
      <div class="panel-heading"><strong>Custos e valores do produto</strong><small>Cadastro independente do estoque</small></div>
      <form class="form-grid" data-add="custosFabricacao">
        ${field('Produto', 'nome')}
        ${field('Custo de fabricação', 'custoFabricacao', 'number', '0')}
        ${field('Valor da peça', 'valorPeca', 'number', '0')}
        ${field('Valor com desconto', 'valorDesconto', 'number', '0')}
        <button class="primary">Salvar custos</button>
      </form>
    </section>
    <section class="panel">
      <div class="panel-heading"><strong>Produtos cadastrados</strong><small>${state.custosFabricacao.length} modelos</small></div>
      ${state.custosFabricacao.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map(item => `
        <div class="row">
          <div class="row-main">
            <strong>${esc(item.nome)}</strong>
            <small>Custo: ${money(item.custoFabricacao)} · Peça: ${money(item.valorPeca)} · Desconto: ${money(item.valorDesconto)}${item.updatedBy ? ` · ${editorBadge(item)}` : ''}</small>
          </div>
          <button class="icon-button" title="Remover custos" aria-label="Remover custos de ${esc(item.nome)}" data-delete="custosFabricacao:${item.id}">×</button>
        </div>
      `).join('') || '<div class="list-empty">Cadastre os custos do primeiro produto.</div>'}
    </section>
  `;
}

function productionView() {
  const productNames = [...new Set([
    ...state.estoque.map(item => item.nome),
    ...state.custosFabricacao.map(item => item.nome)
  ].filter(Boolean))];
  const activeItems = state.emProducao.filter(item => item.status !== 'Concluído');
  const activePieces = activeItems.reduce((sum, item) => sum + Number(item.qtd || 0), 0);
  const delayedItems = activeItems.filter(item => item.previsao && item.previsao < today);

  return `
    <section class="panel">
      <div class="panel-heading"><strong>Adicionar à produção</strong><small>${state.emProducao.length} ordens registradas</small></div>
      <form class="form-grid production-form" data-add="emProducao">
        <label class="field">Produto<input name="nome" list="production-products" autocomplete="off" required></label>
        <datalist id="production-products">${productNames.map(name => `<option value="${esc(name)}">`).join('')}</datalist>
        <label class="field">Quantidade<input name="qtd" type="number" min="1" step="1" required></label>
        ${field('Costureira', 'costureira')}
        ${field('Início', 'dataInicio', 'date', today)}
        <label class="field">Previsão de entrega<input name="previsao" type="date"></label>
        <label class="field">Etapa
          <select name="status" required>${productionStatuses.map(status => `<option value="${status}" ${status === 'Em produção' ? 'selected' : ''}>${status}</option>`).join('')}</select>
        </label>
        <button class="primary">Adicionar à produção</button>
      </form>
    </section>
    <div class="metrics production-metrics">
      <div class="metric"><span class="metric-label">Ordens em aberto</span><div class="metric-value">${activeItems.length}</div></div>
      <div class="metric"><span class="metric-label">Peças em aberto</span><div class="metric-value">${activePieces}</div></div>
      <div class="metric"><span class="metric-label">Atrasadas</span><div class="metric-value ${delayedItems.length ? 'negative' : 'positive'}">${delayedItems.length}</div></div>
    </div>
    <div class="production-board">
      ${productionStatuses.map(status => {
        const items = state.emProducao
          .filter(item => item.status === status)
          .slice()
          .sort((a, b) => (a.previsao || '9999-12-31').localeCompare(b.previsao || '9999-12-31'));
        return `
          <section class="panel production-lane">
            <div class="panel-heading">
              <strong>${status}</strong>
              <small>${items.length} ordens · ${items.reduce((sum, item) => sum + Number(item.qtd || 0), 0)} peças</small>
            </div>
            ${items.map(item => {
              const isDelayed = item.status !== 'Concluído' && item.previsao && item.previsao < today;
              return `
                <article class="production-card">
                  <div class="production-card-heading">
                    <strong>${esc(item.nome)}</strong>
                    <button class="icon-button" title="Remover da produção" aria-label="Remover ${esc(item.nome)} da produção" data-delete="emProducao:${item.id}">×</button>
                  </div>
                  <div class="production-card-details">
                    <span>${Number(item.qtd || 0)} peças</span>
                    <span>${esc(item.costureira || 'Sem costureira')}</span>
                    ${item.dataInicio ? `<span>Início: ${formatDate(new Date(item.dataInicio + 'T12:00:00'))}</span>` : ''}
                    ${item.previsao ? `<span class="${isDelayed ? 'negative' : ''}">${isDelayed ? 'Atrasada · ' : 'Entrega: '}${formatDate(new Date(item.previsao + 'T12:00:00'))}</span>` : ''}
                  </div>
                  <label class="production-status-field">Atualizar etapa
                    <select data-production-status="${item.id}" aria-label="Etapa de ${esc(item.nome)}">
                      ${productionStatuses.map(option => `<option value="${option}" ${option === item.status ? 'selected' : ''}>${option}</option>`).join('')}
                    </select>
                  </label>
                </article>
              `;
            }).join('') || '<div class="list-empty">Nenhuma ordem nesta etapa.</div>'}
          </section>
        `;
      }).join('')}
    </div>
  `;
}

function adminView() {
  if (user?.id !== OWNER_UID) return '<section class="panel"><div class="list-empty">Somente o administrador pode gerenciar acessos.</div></section>';

  return `
    <section class="panel">
      <div class="panel-heading"><strong>Compartilhar painel</strong><small>Contas com e-mail verificado poderão visualizar e editar os dados</small></div>
      <form class="form-grid" data-share-member>
        <label class="field">E-mail da conta<input name="memberEmail" type="email" autocomplete="off" required></label>
        <button class="primary">Liberar acesso</button>
      </form>
    </section>
    <section class="panel">
      <div class="panel-heading"><strong>Acessos liberados</strong><small>${sharedEmails.length} contas</small></div>
      ${sharedEmails.map(email => `
        <div class="row">
          <div class="row-main"><strong>${esc(email)}</strong><small>Conta com acesso de edição</small></div>
          <button class="icon-button" title="Revogar acesso" aria-label="Revogar acesso de ${esc(email)}" data-revoke-member="${esc(email)}">×</button>
        </div>
      `).join('') || '<div class="list-empty">Nenhum acesso compartilhado.</div>'}
    </section>
  `;
}

function viewsFor() {
  return {
    resumo: summary,
    vendas: () => transactionView(
      'vendas',
      'Vendas da feira',
      field('Data', 'data', 'date', today) + field('Valor', 'valor', 'number') + '<label class="field">Forma<select name="forma"><option>Pix</option><option>Dinheiro</option><option>Cartão</option></select></label>' + field('Observação', 'obs'),
      state.vendas.filter(x => inWeek(x.data))
    ),
    emProducao: productionView,
    pagamentos: () => transactionView(
      'pagamentos',
      'Pagamento de produção',
      field('Costureira', 'costureira', 'text', '') + field('Data', 'data', 'date', today) + field('Valor', 'valor', 'number') + field('Observação', 'obs'),
      state.pagamentos.filter(x => inWeek(x.data))
    ),
    compras: () => transactionView(
      'compras',
      'Compras e materiais',
      field('Data', 'data', 'date', today) + field('Item', 'item') + field('Fornecedor', 'fornecedor') + field('Valor', 'valor', 'number'),
      state.compras.filter(x => inWeek(x.data))
    ),
    outrosGastos: () => transactionView(
      'outrosGastos',
      'Despesas diversas',
      '<label class="field">Categoria<select name="categoria" required><option value="">Selecione</option><option>Ajudante</option><option>Alimentação</option><option>Combustível</option></select></label>' + field('Data', 'data', 'date', today) + field('Valor', 'valor', 'number') + field('Observação', 'obs'),
      state.outrosGastos.filter(x => inWeek(x.data))
    ),
    estoque: inventoryView,
    custosFabricacao: manufacturingCostsView,
    admin: adminView
  };
}

const field = (label, name, type = 'text', value = '') => `<label class="field">${label}<input name="${name}" type="${type}" value="${value}" ${type === 'number' ? 'step="0.01"' : ''} required></label>`;
const views = viewsFor();

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, 640 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('Não foi possível processar a imagem.'));
          return;
        }
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.65));
      };
      image.onerror = () => reject(new Error('Não foi possível carregar a imagem.'));
      image.src = String(reader.result || '');
    };
    reader.onerror = () => reject(new Error('Não foi possível carregar a imagem.'));
    reader.readAsDataURL(file);
  });
}

async function save() {
  if (!user?.id || loadedStateUserId !== user.id) {
    showToast('Os dados ainda não foram carregados. Tente novamente.');
    return false;
  }

  if (new TextEncoder().encode(JSON.stringify(state)).length > 850000) {
    showToast('Os dados excedem o limite seguro do Firestore. Reduza as fotos ou os registros.');
    return false;
  }

  try {
    await setDoc(doc(db, 'userStates', OWNER_UID), {
      ownerUid: OWNER_UID,
      state,
      updatedAt: serverTimestamp()
    });
    return true;
  } catch (error) {
    console.error('Erro ao salvar dados no Firestore:', error);
    showToast(error.code === 'permission-denied'
      ? 'O Firestore negou o acesso. Verifique as regras publicadas.'
      : 'Não foi possível salvar. Verifique sua conexão e tente novamente.');
    return false;
  }
}

function bindActions() {
  document.querySelector('[data-export-inventory]')?.addEventListener('click', () => {
    const content = exportInventoryCsv(state.estoque);
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `estoque-${today}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Planilha do estoque baixada. Fotos não são incluídas.');
  });

  document.querySelector('[data-import-inventory]')?.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const importedInventory = parseInventoryCsv(await file.text(), state.estoque);
      const confirmed = window.confirm(
        `A planilha contém ${importedInventory.length} linhas. Ela substituirá todo o estoque atual. Continuar?`
      );
      if (!confirmed) return;

      const previousInventory = state.estoque;
      state.estoque = importedInventory;
      if (!await save()) {
        state.estoque = previousInventory;
        render();
        return;
      }
      render();
      showToast('Estoque restaurado da planilha.');
    } catch (error) {
      showToast(error.message || 'Não foi possível importar a planilha.');
    } finally {
      event.target.value = '';
    }
  });

  document.querySelectorAll('[data-toggle-stock-edit]').forEach(button => {
    button.addEventListener('click', () => {
      const modelName = productKey(button.dataset.toggleStockEdit);
      editingStockModel = editingStockModel === modelName ? '' : modelName;
      render();
    });
  });

  document.querySelectorAll('[data-edit-stock-model]').forEach(form => {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      const originalName = String(values.originalName || '').trim();
      const nome = String(values.nome || '').trim();
      const valorUnitario = Number(values.valorUnitario);
      const tamanho = String(values.tamanho || '').toUpperCase();
      const modelItems = state.estoque.filter(item => productKey(item.nome) === productKey(originalName));

      if (!modelItems.length || !nome || !Number.isFinite(valorUnitario) || valorUnitario < 0) {
        showToast('Informe um nome e um valor válidos para o modelo.');
        return;
      }
      if (state.estoque.some(item => productKey(item.nome) === productKey(nome) && productKey(item.nome) !== productKey(originalName))) {
        showToast('Já existe outro modelo com esse nome.');
        return;
      }
      if (tamanho && (!tamanhos.includes(tamanho) || modelItems.some(item => String(item.tamanho || '').toUpperCase() === tamanho))) {
        showToast('O tamanho selecionado já existe ou é inválido para o modelo.');
        return;
      }

      const previousInventory = state.estoque.map(item => ({ ...item }));
      modelItems.forEach(item => {
        item.nome = nome;
        item.valorUnitario = valorUnitario;
        Object.assign(item, stampEditor(item));
      });

      if (tamanho) {
        const model = modelItems[0];
        state.estoque.push(stampEditor({
          id: crypto.randomUUID(),
          nome,
          tamanho,
          qtd: 0,
          min: Number(model.min || 0),
          valorUnitario,
          foto: modelItems.find(item => item.foto)?.foto || '',
          data: today,
          em: new Date().toISOString(),
          contado: today
        }));
      }

      if (!await save()) {
        state.estoque = previousInventory;
        return;
      }
      editingStockModel = '';
      stockSizeFilter = '';
      render();
      showToast(tamanho ? `${tamanho} adicionado e modelo atualizado.` : 'Modelo atualizado.');
    });
  });

  document.querySelector('[data-share-member]')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (user?.id !== OWNER_UID) return;

    const form = event.currentTarget;
    const email = String(new FormData(form).get('memberEmail') || '').trim().toLowerCase();
    if (!email || email === user.email.toLowerCase()) {
      showToast('Informe o e-mail de outra conta.');
      return;
    }

    try {
      await updateDoc(doc(db, 'userStates', OWNER_UID, 'access', 'permissions'), {
        memberEmails: arrayUnion(email),
        updatedAt: serverTimestamp()
      });
      sharedEmails = [...new Set([...sharedEmails, email])];
      render();
      showToast('Acesso liberado para este e-mail.');
    } catch (error) {
      console.error('Erro ao liberar acesso:', error);
      showToast('Não foi possível liberar o acesso.');
    }
  });

  document.querySelectorAll('[data-revoke-member]').forEach(button => {
    button.addEventListener('click', async () => {
      if (user?.id !== OWNER_UID) return;
      const email = button.dataset.revokeMember;
      try {
        await updateDoc(doc(db, 'userStates', OWNER_UID, 'access', 'permissions'), {
          memberEmails: arrayRemove(email),
          updatedAt: serverTimestamp()
        });
        sharedEmails = sharedEmails.filter(memberEmail => memberEmail !== email);
        render();
        showToast('Acesso revogado.');
      } catch (error) {
        console.error('Erro ao revogar acesso:', error);
        showToast('Não foi possível revogar o acesso.');
      }
    });
  });

  document.querySelectorAll('[data-add]').forEach(form => {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const type = form.dataset.add;
      const fileInput = form.querySelector('input[type="file"]');
      let foto = '';

      if (fileInput && fileInput.files && fileInput.files[0]) {
        const file = fileInput.files[0];
        try {
          foto = await fileToDataUrl(file);
        } catch (error) {
          showToast(error.message || 'Não foi possível processar a imagem.');
          return;
        }
      }

      const values = Object.fromEntries(new FormData(form));
      if (type === 'emProducao') {
        const nome = String(values.nome || '').trim();
        const qtd = Number(values.qtd);
        const dataInicio = values.dataInicio || today;
        if (!nome || !Number.isInteger(qtd) || qtd < 1) {
          showToast('Informe um produto e uma quantidade válida.');
          return;
        }
        if (values.previsao && values.previsao < dataInicio) {
          showToast('A previsão de entrega não pode ser anterior à data de início.');
          return;
        }

        state.emProducao.push(stampEditor({
          id: crypto.randomUUID(),
          nome,
          qtd,
          costureira: String(values.costureira || '').trim(),
          dataInicio,
          previsao: values.previsao || '',
          status: productionStatuses.includes(values.status) ? values.status : 'Em produção'
        }));
        if (!await save()) {
          state.emProducao.pop();
          return;
        }
        render();
        showToast('Ordem adicionada à produção.');
        return;
      }

      if (type === 'estoque') {
        const quantities = tamanhos
          .map(size => [size, Number(values[`qtd_${size}`] || 0)])
          .filter(([, quantity]) => quantity > 0);
        if (!quantities.length) {
          showToast('Informe a quantidade de pelo menos um tamanho.');
          return;
        }

        quantities.forEach(([size, quantity]) => {
          const existing = state.estoque.find(item => productKey(item.nome) === productKey(values.nome) && item.tamanho === size);
          if (existing) {
            existing.qtd = Number(existing.qtd || 0) + quantity;
            existing.min = Number(values.min || 0);
            existing.valorUnitario = Number(values.valorUnitario || 0);
            existing.foto = foto || existing.foto || '';
            existing.contado = today;
            Object.assign(existing, stampEditor(existing));
          } else {
            state.estoque.push(stampEditor({
              id: crypto.randomUUID(),
              nome: String(values.nome).trim(),
              tamanho: size,
              qtd: quantity,
              min: Number(values.min || 0),
              valorUnitario: Number(values.valorUnitario || 0),
              foto,
              data: today,
              em: new Date().toISOString(),
              contado: today
            }));
          }
        });
        if (!await save()) return;
        render();
        showToast('Estoque atualizado.');
        return;
      }

      if (type === 'custosFabricacao') {
        const existing = state.custosFabricacao.find(item => productKey(item.nome) === productKey(values.nome));
        const costValues = {
          nome: String(values.nome).trim(),
          custoFabricacao: Number(values.custoFabricacao || 0),
          valorPeca: Number(values.valorPeca || 0),
          valorDesconto: Number(values.valorDesconto || 0)
        };
        if (existing) Object.assign(existing, stampEditor({ ...existing, ...costValues }));
        else state.custosFabricacao.push(stampEditor({ id: crypto.randomUUID(), ...costValues }));
        if (!await save()) return;
        render();
        showToast('Custos salvos.');
        return;
      }

      const item = stampEditor({
        id: crypto.randomUUID(),
        ...values,
        foto,
        valor: Number(values.valor || 0),
        custoFabricacao: Number(values.custoFabricacao || 0),
        valorPeca: Number(values.valorPeca || 0),
        valorDesconto: Number(values.valorDesconto || 0),
        qtd: Number(values.qtd || 0),
        min: Number(values.min || 0),
        data: values.data || today,
        em: new Date().toISOString()
      });

      if (type === 'estoque') item.contado = today;
      if (type === 'compras') item.item = values.item;

      state[type].push(item);
      if (!await save()) return;
      render();
      showToast('Registro adicionado.');
    });
  });

  document.querySelectorAll('[data-delete]').forEach(button => {
    button.addEventListener('click', async () => {
      const [type, id] = button.dataset.delete.split(':');
      state[type] = state[type].filter(item => item.id !== id);
      if (!await save()) return;
      render();
    });
  });

  document.querySelectorAll('[data-production-status]').forEach(select => {
    select.addEventListener('change', async event => {
      const item = state.emProducao.find(record => record.id === event.currentTarget.dataset.productionStatus);
      const nextStatus = event.currentTarget.value;
      if (!item || !productionStatuses.includes(nextStatus)) return;

      const previousItem = { ...item };
      item.status = nextStatus;
      Object.assign(item, stampEditor(item));
      if (!await save()) {
        Object.assign(item, previousItem);
        render();
        return;
      }
      render();
      showToast('Etapa da produção atualizada.');
    });
  });

  document.querySelectorAll('[data-stock]').forEach(button => {
    button.addEventListener('click', async () => {
      const [id, delta] = button.dataset.stock.split(':');
      const item = state.estoque.find(x => x.id === id);
      if (!item) return;

      item.qtd = Math.max(0, item.qtd + Number(delta));
      item.contado = today;
      Object.assign(item, stampEditor(item));
      if (!await save()) return;
      render();
    });
  });

  document.querySelector('[name="stock-size-filter"]')?.addEventListener('change', event => {
    stockSizeFilter = event.target.value;
    render();
  });
}

(async function init() {
  render();
})();
