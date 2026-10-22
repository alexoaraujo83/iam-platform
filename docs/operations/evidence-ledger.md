# Livro mestre de evidências — IAM Platform

Última consolidação de evidências externas: **2026-10-22**. Este documento é a fonte única de verdade para o estado operacional dos gates. Cada registro é limitado ao ambiente, execução e SHA explicitamente identificados.

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
| Auth0 — allowlists | Tenant `iam-platform.us.auth0.com`; aplicativo Regular Web | Configuração lida no painel em 22/10/2026 | Não fornecido pela leitura | CONFERIDO | Callback: `https://iam-platform-web.vercel.app/auth/callback`, `https://iam-platform-web-preview.vercel.app/auth/callback`, `http://localhost:3000/auth/callback`. Logout e Web Origins usam os três origins correspondentes, sem curingas. |
| Vercel Web — variáveis não secretas | Development / Preview / Production | Inventário lido em 22/10/2026 | Não exposto no registro da variável | COERENTE nos valores conferidos | `AUTH0_DOMAIN=iam-platform.us.auth0.com`, `AUTH0_AUDIENCE=https://iam-platform-api` e `APP_BASE_URL` correspondem aos três origins. Valores secretos não foram lidos. |
| Vercel API — OIDC | Development / Preview / Production | Inventário lido em 22/10/2026 | Não exposto no registro da variável | COERENTE nos valores conferidos | `OIDC_ISSUER=https://iam-platform.us.auth0.com/`, `OIDC_AUDIENCE=https://iam-platform-api`, `OIDC_JWKS_URI=https://iam-platform.us.auth0.com/.well-known/jwks.json`, `OIDC_ALLOWED_ALGORITHMS=RS256`. |
| Provisionamento de identidade | Web/API Vercel | `IAM_IDENTITY_BOOTSTRAP_ENABLED=false` em todos os targets observados; `IDENTITY_PROVISIONER_DATABASE_URL` apenas em Preview da API | 22/10/2026 | FAIL-CLOSED preservado | Não habilitar antes do E2E real com código integrado e verificação de role/branch/projeto Neon. |
| Token expirado — diagnóstico live | Web Preview | `IAM_DIAGNOSTICS_EXPIRED_ACCESS_TOKEN` está cadastrada, mas a bateria não aceita a fixture como JWT válido no estado reportado anteriormente | Evidência pendente | NOT CONFIGURED | Corrigir fixture de teste no ambiente isolado e provar rejeição HTTP real, sem armazenar token de produção. |
| Verificação runtime do banco | GitHub Actions → ambiente `neon-<target>` | `.github/workflows/verify-runtime-security.yml` | Preencher na próxima execução | DISPATCHED ON DEMAND | Executar em cada ambiente separadamente e registrar URL, SHA e resultado. Um PASS em Development não prova Preview/Production. |

## Bloqueios abertos

| Prioridade | Bloqueio | Evidência necessária |
|---|---|---|
| P0 | Role legada `iam_runtime` com privilégios elevados e associação herdada | Provar a identidade efetiva usada pela API; validar correção de privilégios/associação em branch isolada antes de qualquer mudança de Production. |
| P1 | `public.schema_migrations` não encontrado nas branches consultadas | Confirmar se há mecanismo alternativo autoritativo; caso contrário, introduzir controle reproduzível de migrations. |
| P1 | Snapshots automáticos sem cronograma explícito nas três branches consultadas | Definir RPO/RTO, política, snapshot e restore testado em branch isolada. |
| P1 | E2E Auth0/Web/API completo | Login, callback/state/code, persistência da sessão, logout, token válido/expirado, falha de provedor/JWKS, provisionamento idempotente e negação sem membership, com resultados por SHA/UTC. |
| P1 | Cadeia de PRs | Revalidar base/head/diff cumulativo e checks no SHA atual; manter Draft até concluir os gates requeridos. |

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
