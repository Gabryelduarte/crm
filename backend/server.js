const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateUserRegistration } = require('./logic');

const PORT = process.env.PORT || 3333;
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'frontend');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const DEMO_USER = { id: 'demo-user', name: 'Usuário Teste', email: 'teste@atelie.local' };
const DEFAULT_STATE = { vendas: [], pagamentos: [], compras: [], outrosGastos: [], estoque: [], costureiras: [], log: [] };
const sessions = new Map();

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ users: [], states: {} }, null, 2));

const readDb = () => JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const writeDb = db => fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS' }); res.end(JSON.stringify(body)); };
const body = req => new Promise((resolve, reject) => { let raw = ''; req.on('data', chunk => raw += chunk); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('JSON invalido')); } }); });
const hash = (password, salt = crypto.randomBytes(16).toString('hex')) => ({ salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') });
const token = () => crypto.randomBytes(32).toString('hex');
const userFrom = req => { const value = req.headers.authorization || ''; return sessions.get(value.replace('Bearer ', '')); };
const firebaseUserFrom = req => { const value = req.headers.authorization || ''; const auth = value.replace('Bearer ', ''); if (!auth.startsWith('firebase:')) return null; const uid = auth.replace('firebase:', ''); return { id: uid, name: 'Usuário Firebase', email: `${uid}@firebase.local` }; };
const serve = (req, res) => { const requested = req.url === '/' ? '/index.html' : req.url; const file = path.normalize(path.join(PUBLIC, requested)); if (!file.startsWith(PUBLIC)) return res.writeHead(403).end(); fs.readFile(file, (err, data) => { if (err) return res.writeHead(404).end('Not found'); const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }; res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(data); }); };

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (!req.url.startsWith('/api/')) return serve(req, res);
  try {
    if (req.method === 'GET' && req.url === '/api/health') return json(res, 200, { ok: true, service: 'controle-confeccao-api' });
    if (req.method === 'POST' && req.url === '/api/auth/register') {
      const payload = await body(req);
      const registration = validateUserRegistration(payload);
      if (!registration.ok) return json(res, 400, { error: registration.error });

      const db = readDb(); const normalized = registration.email;
      if (db.users.some(user => user.email === normalized)) return json(res, 409, { error: 'Este e-mail ja esta cadastrado.' });

      const credentials = hash(payload.password);
      const user = { id: crypto.randomUUID(), name: String(payload.name).trim(), email: normalized, ...credentials };
      db.users.push(user);
      db.states[user.id] = { vendas: [], pagamentos: [], compras: [], estoque: [], costureiras: [], log: [] };
      writeDb(db);

      const auth = token(); sessions.set(auth, user); return json(res, 201, { token: auth, user: { id: user.id, name: user.name, email: user.email }, state: db.states[user.id] });
    }
    if (req.method === 'POST' && req.url === '/api/auth/login') {
      const { email, password } = await body(req); const db = readDb(); const user = db.users.find(item => item.email === String(email || '').trim().toLowerCase());
      if (!user || !crypto.timingSafeEqual(Buffer.from(user.hash, 'hex'), Buffer.from(hash(password, user.salt).hash, 'hex'))) return json(res, 401, { error: 'E-mail ou senha incorretos.' });
      const auth = token(); sessions.set(auth, user); return json(res, 200, { token: auth, user: { id: user.id, name: user.name, email: user.email }, state: db.states[user.id] });
    }
    const demoRequest = req.headers.authorization === 'Bearer demo-token';
    const user = demoRequest ? DEMO_USER : (userFrom(req) || firebaseUserFrom(req));
    if (!user) return json(res, 401, { error: 'Sessao expirada.' });
    if (req.method === 'GET' && req.url === '/api/state') {
      const db = readDb();
      if (!db.states[user.id]) db.states[user.id] = JSON.parse(JSON.stringify(DEFAULT_STATE));
      writeDb(db);
      return json(res, 200, db.states[user.id]);
    }
    if (req.method === 'PUT' && req.url === '/api/state') {
      const db = readDb();
      if (!db.states[user.id]) db.states[user.id] = JSON.parse(JSON.stringify(DEFAULT_STATE));
      db.states[user.id] = await body(req);
      writeDb(db);
      return json(res, 200, db.states[user.id]);
    }
    return json(res, 404, { error: 'Rota nao encontrada.' });
  } catch (error) { return json(res, 500, { error: error.message }); }
});
server.listen(PORT, () => console.log(`Controle da Confeccao em http://localhost:${PORT}`));
