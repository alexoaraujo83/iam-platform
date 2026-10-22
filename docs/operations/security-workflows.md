# Responsabilidades dos workflows

## Matriz operacional

| Workflow | Responsabilidade | Gatilho | Interpretação |
|---|---|---|---|
| `.github/workflows/ci.yml` | Gate de qualidade da PR | PR, push para `main`, execução manual | Instalação congelada, Gitleaks, auditoria de dependências, typecheck, lint, testes e build. O resultado pertence ao SHA executado. |
| `.github/workflows/security-code-quality.yml` | Execução repetível dos scans de segurança e qualidade | Push para `main` nos caminhos configurados e `workflow_dispatch` | Gitleaks, `pnpm audit --audit-level high`, typecheck, lint, testes e build. É suplementar ao CI obrigatório, não substitui os checks de PR nem aprova release sozinho. |
| `.github/workflows/verify-runtime-security.yml` | Auditoria read-only dos privilégios e invariantes do PostgreSQL runtime | Somente `workflow_dispatch` com alvo explícito | Usa o GitHub Environment `neon-development`, `neon-preview` ou `neon-production` e a variável protegida `NEON_DATABASE_URL` do ambiente selecionado. Executa `packages/database/migrations/verify_runtime_security.sql`; não é scanner de código. |

## Regras de operação

- O workflow de banco usa credenciais do ambiente selecionado e deve permanecer independente da auditoria do código.
- A auditoria de banco precisa executar em cada ambiente separadamente; PASS em Development não comprova Preview ou Production.
- CI e scans não provam que Auth0, roles Neon, segredos Vercel ou deployment ativo estejam configurados corretamente.
- Não criar bypass para Vercel SSO, não desativar proteção e não mover PRs para Ready/Merged antes de completar a cadeia de evidências.
- Registrar cada execução em [Livro mestre de evidências](evidence-ledger.md), incluindo SHA exato, timestamp UTC, resultado e limitações.
