# Atelie Operations

Aplicacao de controle financeiro e operacional para confeccoes.

## Estrutura

- `frontend/`: interface, estilos e regras de apresentacao.
- `backend/`: API HTTP, autenticacao e persistencia dos dados.
- `backend/data/db.json`: banco local criado automaticamente na primeira execucao.

## Executar

Instale o Node.js 18 ou superior e, na pasta do projeto, rode:

```powershell
npm start
```

Abra `http://localhost:3333` no navegador.

A API disponibiliza `GET /api/health`, `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/state` e `PUT /api/state`.
