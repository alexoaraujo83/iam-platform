# Livro mestre de evidências — IAM Platform

Última consolidação de evidências externas: **2026-10-22**. A comparação de refs nesta versão foi executada por leitura da API GitHub; os SHAs e contagens abaixo são snapshots daquele instante. Este documento é a fonte única de verdade para o estado operacional dos gates. Cada registro é limitado ao ambiente, execução e SHA explicitamente identificados.

## Regras de validade

1. Um PASS só vale para o SHA exato executado. Se o head da PR, a base relevante ou o código implantado mudar, o gate correspondente precisa ser revalidado.
2. Registrar: controle, ambiente, SHA, timestamp UTC, URL da execução/artefato, resultado, limitações e próxima ação.
3. `READY` na Vercel significa deployment pronta; não é prova de fluxo OAuth, autorização nem aceite de Production.
4. Testes unitários, fixtures sintéticas ou PostgreSQL descartável não substituem E2E com provedor e banco de destino.
5. Nunca anexar access tokens, cookies, client secrets, connection strings, claims brutos ou outros segredos. Use resultados redigidos, IDs de execução e hashes.

## Evidências observadas em 22/10/2026

| Controle | Ambiente/origem | SHA ou identificador | Timestamp UTC | Resultado | Limitações/próximo passo |
|---|---|---|---|---|---|
| GitHub Actions CI — PR #51 | `feat/auth-evidence-report` | `ace2be5980b3c9ecac6003f0c3996bf9e2611779`; [run 39855902375](https://github.com/alexoaraujo83/iam-platform/actions/runs/39855902375) | `2026-10-22T21:17:27Z` (atualização/conclusão registrada) | PASS para esse SHA | Não prova o head da PR #53 (`fe4576aa...`) nem o `main` atual. |
| Vercel Web deployment `dpl_2FZvJzuetkqZfrM7fnynFrd6ZcH1` | Preview / branch `feat/auth-evidence-report` | `ace2be5980b3c9ecac6003f0c3996bf9e2611779` | `2026-10-22T21:16:31Z` | READY | Não equivale a Production nem inclui commits posteriores. |
| Vercel API deployment `dpl_BB1UF86Giq1vQhsMAWamurw2UvPJ` | Preview / branch `feat/auth-evidence-report` | `ace2be5980b3c9ecac6003f0c3996bf9e2611779` | `2026-10-22T21:16:31Z` | READY | Diferente do head atual da PR #53; o E2E de bootstrap não pode ser marcado PASS até deployment do código integrado e teste live. |
| GitHub Actions CI — PR #54 | `chore/security-workflow-docs-cleanup-20261022` | `b65311f4ad7bf301126fddbf14f541303fb0024c`; [run 39866464188](https://github.com/alexoaraujo83/iam-platform/actions/runs/39866464188) | `2026-10-22T22:40:02Z` | PASS | Exatamente o SHA registrado; uma atualização posterior do próprio ledger requer novo CI e nova conferência. |
| Vercel Web — PR #54 | Preview branch `chore/security-workflow-docs-cleanup-20261022` | `b65311f4ad7bf301126fddbf14f541303fb0024c`; [deployment `dpl_J1ntBjhQYkDiKUzPeWCE6Cs6X4BC`](https://vercel.com/alexoaraujo83-8387s-projects/iam-platform-web/J1ntBjhQYkDiKUzPeWCE6Cs6X4BC) | `2026-10-22T22:38:43.711Z` (criação) | READY | Check Vercel verde para esse SHA; deployment Preview não é produção nem prova E2E Auth0. |
| Vercel API — PR #54 | Preview branch `chore/security-workflow-docs-cleanup-20261022` | `b65311f4ad7bf301126fddbf14f541303fb0024c`; [deployment `dpl_Bk5GECYE9G636gkFkQdYbv5WJf6T`](https://vercel.com/alexoaraujo83-8387s-projects/iam-platform-api/Bk5GECYE9G636gkFkQdYbv5WJf6T) | `2026-10-22T22:38:43.668Z` (criação) | READY | Check Vercel verde para esse SHA; deployment Preview não comprova bootstrap Auth0→Neon. |
| GitHub Actions CI — PR #54 final lockfile/workflow/docs snapshot | `chore/security-workflow-docs-cleanup-20261022` | `b885a5cf44c61eab680273d3e190459a800ecb85`; [run 39867161053](https://github.com/alexoaraujo83/iam-platform/actions/runs/39867161053) | `2026-10-22T22:45:46Z` | PASS | Exact tested SHA. Includes cleanup of the duplicate root npm lockfile; it does not establish Auth0 E2E or database-role remediation. |
| Vercel Web — PR #54 final lockfile/workflow/docs snapshot | Preview branch `chore/security-workflow-docs-cleanup-20261022` | `b885a5cf44c61eab680273d3e190459a800ecb85`; [deployment `dpl_FvPDqvLJ6f1nRB8UbbTppfe2pg8m`](https://vercel.com/alexoaraujo83-8387s-projects/iam-platform-web/FvPDqvLJ6f1nRB8UbbTppfe2pg8m) | `2026-10-22T22:46:31.539Z` (observed READY) | READY | Vercel status success for this SHA; deployment is Preview, not Production. |
| Vercel API — PR #54 final lockfile/workflow/docs snapshot | Preview branch `chore/security-workflow-docs-cleanup-20261022` | `b885a5cf44c61eab680273d3e190459a800ecb85`; [deployment `dpl_Auv7Buy6Axm6fEV4xjG65Hbd4Qaz`](https://vercel.com/alexoaraujo83-8387s-projects/iam-platform-api/Auv7Buy6Axm6fEV4xjG65Hbd4Qaz) | `2026-10-22T22:46:31.539Z` (observed READY) | READY | Vercel status success for this SHA; build readiness does not prove Auth0 provisioning E2E. |
| Auth0 — allowlists | Tenant `iam-platform.us.auth0.com`; aplicativo Regular Web | Configuração lida no painel em 22/10/2026 | Não fornecido pela leitura | CONFERIDO | Callback: `https://iam-platform-web.vercel.app/auth/callback`, `https://iam-platform-web-preview.vercel.app/auth/callback`, `http://localhost:3000/auth/callback`. Logout e Web Origins usam os três origins correspondentes, sem curingas. |
| Vercel Web — variáveis não secretas | Development / Preview / Production | Inventário lido em 22/10/2026 | Não exposto no registro da variável | COERENTE nos valores conferidos | `AUTH0_DOMAIN=iam-platform.us.auth0.com`, `AUTH0_AUDIENCE=https://iam-platform-api` e `APP_BASE_URL` correspondem aos três origins. Valores secretos não foram lidos. |
| Vercel API — OIDC | Development / Preview / Production | Inventário lido em 22/10/2026 | Não exposto no registro da variável | COERENTE nos valores conferidos | `OIDC_ISSUER=https://iam-platform.us.auth0.com/`, `OIDC_AUDIENCE=https://iam-platform-api`, `OIDC_JWKS_URI=https://iam-platform.us.auth0.com/.well-known/jwks.json`, `OIDC_ALLOWED_ALGORITHMS=RS256`. |
| Provisionamento de identidade | Web/API Vercel | `IAM_IDENTITY_BOOTSTRAP_ENABLED=false` em todos os targets observados; `IDENTITY_PROVISIONER_DATABASE_URL` apenas em Preview da API | 22/10/2026 | FAIL-CLOSED preservado | Não habilitar antes do E2E real com código integrado e verificação de role/branch/projeto Neon. |
| Token expirado — diagnóstico live | Web Preview | `IAM_DIAGNOSTICS_EXPIRED_ACCESS_TOKEN` está cadastrada, mas a bateria não aceita a fixture como JWT válido no estado reportado anteriormente | Evidência pendente | NOT CONFIGURED | Corrigir fixture de teste no ambiente isolado e provar rejeição HTTP real, sem armazenar token de produção. |
| Verificação runtime do banco | GitHub Actions → ambiente `neon-<target>` | `.github/workflows/verify-runtime-security.yml` | Preencher na próxima execução | DISPATCHED ON DEMAND | Executar em cada ambiente separadamente e registrar URL, SHA e resultado. Um PASS em Development não prova Preview/Production. |



## Sinais de observabilidade e configuração ainda não aceitos como gate aprovado

- A página Control Center consultada em `2026-10-22T21:30:28.985Z` reportou um probe positivo HTTP 200 e membership ativo confirmado no PostgreSQL, mas o SHA exato da Web/API não foi capturado nessa leitura. Tratar como sinal histórico, não como PASS vinculado ao head atual.
- A página ainda exibe `Live telemetry not connected` e módulos `DESIGNED · NOT VERIFIED`. Não declarar observabilidade operacional até cada card usar uma fonte real, com timestamp, origem e tratamento explícito de dado ausente.
- O token expirado continua `NOT CONFIGURED`: a fixture em Preview não é um JWT válido. Testes criptográficos de CI não substituem a rejeição live HTTP 401.
- Uma aplicação Auth0 Regular Web está configurada com allowlists explícitas para localhost, Preview e Production, sem curingas. A variável `AUTH0_CLIENT_ID` do Vercel Web cobre os três targets; clientes Auth0 separados por ambiente não foram comprovados nem criados nesta execução. Revisar a política de isolamento antes de considerar esse requisito encerrado.
- `AUTH0_ISSUER_BASE_URL` e `AUTH0_JWKS_URL` permanecem no inventário Web, agora identificadas por comentários como configuração legada não consumida pelo SDK v4. Não foram removidas porque a ferramenta Vercel disponível não expõe operação de exclusão; a remoção depende de revisão de rollback.

## Política de lockfiles e dependências

- O root declara `packageManager: pnpm@12.12.1`, o CI executa `pnpm install --frozen-lockfile`, e a pesquisa no repositório não encontrou `npm ci` nem referências de código ao `package-lock.json`. A PR #54 remove o `package-lock.json` raiz, mantendo `pnpm-lock.yaml` como fonte única para instalação reproduzível.
- A definição de TypeScript continua por workspace: root `7.0.2`, Web `^5.9.3`. Não foi feita atualização unificada nem alterado o lockfile pnpm nesta PR; é necessário confirmar a matriz de suporte de `typescript-eslint`, ESLint, Next.js e os scripts de cada workspace antes de convergir versões.
- Resultado esperado após o merge: nenhuma instalação npm paralela; `pnpm install --frozen-lockfile`, typecheck, lint, testes e build devem continuar passando no SHA da PR e no SHA resultante após integração.

## Bloqueios abertos

| Prioridade | Bloqueio | Evidência necessária |
|---|---|---|
| P0 | Role legada `iam_runtime` com privilégios elevados e associação herdada | Provar a identidade efetiva usada pela API; validar correção de privilégios/associação em branch isolada antes de qualquer mudança de Production. |
| P1 | `public.schema_migrations` não encontrado nas branches consultadas | Confirmar se há mecanismo alternativo autoritativo; caso contrário, introduzir controle reproduzível de migrations. |
| P1 | Snapshots automáticos sem cronograma explícito nas três branches consultadas | Definir RPO/RTO, política, snapshot e restore testado em branch isolada. |
| P1 | E2E Auth0/Web/API completo | Login, callback/state/code, persistência da sessão, logout, token válido/expirado, falha de provedor/JWKS, provisionamento idempotente e negação sem membership, com resultados por SHA/UTC. |
| P1 | Cliente Auth0 por ambiente | Decidir e implementar a separação Web Preview/Production se exigida pela política de isolamento; validar callback/logout/Web Origins no cliente correspondente e provar com E2E. |
| P1 | Cadeia de PRs | Comparações read-only em 2026-10-22: #46 vs `main` divergiu (14 exclusivos na feature / 19 em main; merge base `586041e9...`); #53 vs `main` divergiu (80/19; mesmo merge base); #19 vs `main` divergiu (69 exclusivos na feature / 97 em main; merge base `eacc71e9...`). A cadeia #46→#47→#48→#49→#50→#51 está internamente ordenada nos compares (0 atrás), mas o diff #51 é cumulativo e reporta 44 commits exclusivos. | Revisar o diff completo e reconciliar #46 primeiro. Não fazer force-push ou rebase automático; sincronizar descendentes um por vez e rodar CI/Preview no SHA novo. Para #19/#53, inspecionar separadamente o grande delta antes de empilhar. Manter Draft. |

## Modelo obrigatório para novos registros

| Campo | Valor |
|---|---|
| Controle | `<nome estável do gate>` |
| Ambiente | `development`, `preview` ou `production` |
| SHA testado/implantado | `<40 caracteres>` |
| Execução/artefato | `<URL Actions/deployment>` |
| Executado em UTC | `YYYY-MM-DDTHH:mm:ssZ` |
| Resultado | `PASS`, `FAIL`, `BLOCKED` ou `NOT CONFIGURED` |
| Limitações | `<cobertura ausente/dependências>` |
| Próxima ação | `<ação para encerrar o gate>` |
