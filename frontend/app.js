const API = '/api';
const tabs = {
  resumo: ['Resumo', 'VISÃO GERAL'],
  vendas: ['Vendas', 'RECEITAS'],
  pagamentos: ['Costureiras', 'PRODUÇÃO'],
  compras: ['Insumos', 'DESPESAS'],
  estoque: ['Estoque', 'INVENTÁRIO']
};

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

let state = { vendas: [], pagamentos: [], compras: [], estoque: [], costureiras: [], log: [] };
let user = JSON.parse(localStorage.getItem('atelier_user') || 'null');
let authToken = localStorage.getItem('atelier_token');
let tab = 'resumo';
let weekStart = monday(new Date());
const today = dateValue(new Date());
let reportStart = today;
let reportEnd = today;

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

async function request(path, options = {}) {
  const response = await fetch(API + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
    }
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
  return data;
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

async function submitAuth(event) {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.target));
  const mode = values.name ? 'register' : 'login';

  if (mode === 'register' && String(values.password || '') !== String(values.confirmPassword || '')) {
    return authCard('register', 'As senhas não coincidem.');
  }

  try {
    const payload = mode === 'register' ? { name: values.name, email: values.email, password: values.password } : { email: values.email, password: values.password };
    const data = await request(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(payload) });

    authToken = data.token;
    user = data.user;
    state = data.state;

    localStorage.setItem('atelier_token', authToken);
    localStorage.setItem('atelier_user', JSON.stringify(user));
    render();
  } catch (error) {
    authCard(mode, error.message);
  }
}

function logout() {
  localStorage.removeItem('atelier_token');
  localStorage.removeItem('atelier_user');
  authToken = null;
  user = null;
  render();
}

function render() {
  if (loginDisabledForTests) {
    $('#auth-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');
    user = { id: 'demo-user', name: 'Usuário Teste', email: 'teste@atelie.local' };
    authToken = 'demo-token';
    if (!state || !Array.isArray(state.estoque) || !Array.isArray(state.vendas) || !Array.isArray(state.pagamentos) || !Array.isArray(state.compras) || !Array.isArray(state.costureiras) || !Array.isArray(state.log)) {
      state = {
        vendas: [],
        pagamentos: [],
        compras: [],
        estoque: [],
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

  $('#user-box').innerHTML = `<strong>${esc(user.name)}</strong>${esc(user.email)}`;
  $('#nav').innerHTML = Object.entries(tabs)
    .map(([key, [label]]) => `<button class="nav-item ${key === tab ? 'active' : ''}" data-tab="${key}"><span>${({ resumo: '◈', vendas: '↗', pagamentos: '✦', compras: '⊙', estoque: '□' })[key]}</span>${label}</button>`)
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

function summary() {
  const sales = state.vendas.filter(x => inDateRange(x.data));
  const pay = state.pagamentos.filter(x => inDateRange(x.data));
  const buy = state.compras.filter(x => inDateRange(x.data));
  const revenue = total(sales);
  const cost = total(pay) + total(buy);
  const balance = revenue - cost;

  return `
    <div class="metrics">
      <div class="metric"><span class="metric-label">Receita do período</span><div class="metric-value positive">${money(revenue)}</div></div>
      <div class="metric"><span class="metric-label">A pagar às costureiras</span><div class="metric-value">${money(total(pay.filter(x => !x.pago)))}</div></div>
      <div class="metric"><span class="metric-label">Insumos</span><div class="metric-value">${money(total(buy))}</div></div>
      <div class="metric"><span class="metric-label">Resultado líquido</span><div class="metric-value ${balance < 0 ? 'negative' : 'positive'}">${money(balance)}</div></div>
    </div>
    <div class="grid-2">
      <section class="panel">
        <div class="panel-heading"><strong>Movimentações recentes</strong><small>${sales.length + pay.length + buy.length} registros</small></div>
        ${recentRows([
          ...sales.map(x => ({ ...x, type: 'Venda', label: x.forma })),
          ...pay.map(x => ({ ...x, type: 'Costureira', label: x.costureira })),
          ...buy.map(x => ({ ...x, type: 'Insumo', label: x.item }))
        ].sort((a, b) => new Date(b.data || b.em || 0) - new Date(a.data || a.em || 0)).slice(0, 6))}
      </section>
      <section class="panel">
        <div class="panel-heading"><strong>Estoque baixo</strong></div>
        ${state.estoque.filter(x => x.qtd <= x.min).map(x => `
          <div class="row">
            <div class="row-main"><strong>${esc(x.nome)}</strong><small>Mínimo: ${x.min}${x.updatedBy ? ` · ${editorBadge(x)}` : ''}</small></div>
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
            <strong>${esc(x.item || x.costureira || x.forma || 'Lançamento')}</strong>
            <small>${formatDate(new Date(x.data + 'T12:00:00'))} ${x.obs ? '· ' + esc(x.obs) : ''}${x.updatedBy ? ` · ${editorBadge(x)}` : ''}</small>
          </div>
          <span class="row-value">${money(x.valor)}</span>
          <button class="icon-button" data-delete="${kind}:${x.id}">×</button>
        </div>
      `).join('') || '<div class="list-empty">Nenhum lançamento nesta semana.</div>'}
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
    estoque: () => `
      <section class="panel">
        <div class="panel-heading"><strong>Novo produto</strong><small>${state.estoque.length} itens cadastrados</small></div>
        <form class="form-grid" data-add="estoque">
          ${field('Produto', 'nome')}
          ${field('Quantidade', 'qtd', 'number', '0')}
          ${field('Estoque mínimo', 'min', 'number', '0')}
          <label class="field">Tamanho
            <select name="tamanho" required>
              <option value="">Selecione</option>
              <option value="PP">PP</option>
              <option value="P">P</option>
              <option value="M">M</option>
              <option value="G">G</option>
              <option value="GG">GG</option>
              <option value="XL">XL</option>
            </select>
          </label>
          <label class="field">Foto do modelo<input name="foto" type="file" accept="image/*"></label>
          <button class="primary">Adicionar</button>
        </form>
      </section>
      <section class="panel">
        <div class="panel-heading"><strong>Inventário</strong></div>
        ${state.estoque.map(x => `
          <div class="row inventory-item">
            <div class="inventory-thumb-wrap">
              ${x.foto ? `<img class="inventory-thumb" src="${x.foto}" alt="${esc(x.nome)}">` : '<div class="inventory-thumb placeholder">Sem foto</div>'}
            </div>
            <div class="row-main">
              <strong class="${x.qtd <= x.min ? 'stock-low' : ''}">${esc(x.nome)}</strong>
              <small>Tamanho: ${esc(x.tamanho || '—')} · Mínimo: ${x.min} · atualizado ${formatDate(new Date(x.contado || today + 'T12:00:00'))}${x.updatedBy ? ` · ${editorBadge(x)}` : ''}</small>
            </div>
            <button class="secondary" data-stock="${x.id}:-1">−</button>
            <strong>${x.qtd}</strong>
            <button class="secondary" data-stock="${x.id}:1">+</button>
            <button class="icon-button" data-delete="estoque:${x.id}">×</button>
          </div>
        `).join('') || '<div class="list-empty">Cadastre o primeiro produto.</div>'}
      </section>
    `
  };
}

const field = (label, name, type = 'text', value = '') => `<label class="field">${label}<input name="${name}" type="${type}" value="${value}" ${type === 'number' ? 'step="0.01"' : ''} required></label>`;
const views = viewsFor();

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Não foi possível carregar a imagem.'));
    reader.readAsDataURL(file);
  });
}

async function save() {
  try {
    await request('/state', { method: 'PUT', body: JSON.stringify(state) });
  } catch (error) {
    showToast(error.message);
  }
}

function bindActions() {
  document.querySelectorAll('[data-add]').forEach(form => {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const type = form.dataset.add;
      const fileInput = form.querySelector('input[type="file"]');
      let foto = '';

      if (fileInput && fileInput.files && fileInput.files[0]) {
        const file = fileInput.files[0];
        foto = await fileToDataUrl(file);
      }

      const values = Object.fromEntries(new FormData(form));
      const item = stampEditor({
        id: crypto.randomUUID(),
        ...values,
        foto,
        valor: Number(values.valor || 0),
        qtd: Number(values.qtd || 0),
        min: Number(values.min || 0),
        data: values.data || today,
        em: new Date().toISOString()
      });

      if (type === 'estoque') item.contado = today;
      if (type === 'compras') item.item = values.item;

      state[type].push(item);
      await save();
      render();
      showToast('Registro adicionado.');
    });
  });

  document.querySelectorAll('[data-delete]').forEach(button => {
    button.addEventListener('click', async () => {
      const [type, id] = button.dataset.delete.split(':');
      state[type] = state[type].filter(item => item.id !== id);
      await save();
      render();
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
      await save();
      render();
    });
  });
}

(async function init() {
  if (authToken && user) {
    try {
      state = await request('/state');
    } catch {
      logout();
    }
  }

  render();
})();
