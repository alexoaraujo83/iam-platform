# PR #1 — catálogo de auditoria técnica

- Repositório: `alexoaraujo83/iam-platform`
- Pull request: [#1](https://github.com/alexoaraujo83/iam-platform/pull/1)
- Escopo: fundação do MVP de IAM independente de provedor
- Status da auditoria: implementação revisada; execução de CI nº 103 aprovada no commit `b5dc44246aa947ab802bca626969a43c0978364d`, incluindo instalação congelada, verificação de tipos, build de produção, testes da API/unidade e testes de integração de RLS com PostgreSQL 16.
- Status de mesclagem: manter aberto; não mesclar como parte desta auditoria.

## Inventário de arquivos

| Área | Arquivos / finalidade |
|---|---|
| Workspace e cadeia de ferramentas | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.npmrc`, `.gitignore`, `tsconfig.base.json`, `vitest.config.ts` |
| CI e higiene de dependências | `.github/workflows/ci.yml`, `.github/dependabot.yml`, `.env.example` |
| API | `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/src/app.ts`, `apps/api/src/app.test.ts`, `apps/api/src/server.ts`, `apps/api/src/oidc-error.ts`, `apps/api/src/oidc-error.test.ts` |
| Contratos | `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/index.ts`, `packages/contracts/src/index.test.ts` |
| Identidade | `packages/identity/package.json`, `packages/identity/tsconfig.json`, `packages/identity/src/index.ts`, `packages/identity/src/index.test.ts`, `packages/identity/src/bearer-token.ts`, `packages/identity/src/bearer-token.test.ts` |
| Autorização | `packages/authorization/package.json`, `packages/authorization/tsconfig.json`, `packages/authorization/src/index.ts`, `packages/authorization/src/index.test.ts` |
| Banco de dados e isolamento entre tenants | `packages/database/package.json`, `packages/database/tsconfig.json`, `packages/database/README.md`, `packages/database/src/index.ts`, `packages/database/src/membership-resolution.ts`, `packages/database/src/membership-resolution.test.ts`, `packages/database/src/authenticated-tenant.ts`, `packages/database/src/authenticated-tenant.test.ts`, `packages/database/migrations/0001_identity_tenancy.sql`, `packages/database/tests/rls.integration.test.ts` |
| Documentação de arquitetura e segurança | `README.md`, `docs/architecture/overview.md`, `docs/decisions/ADR-0001-provider-independent-domain.md`, `docs/security/threat-model.md`, `docs/audits/pr-1-catalog.md` |

## Controles implementados observados

- Contratos independentes de provedor separam a identidade verificada de associação ao tenant, funções e permissões.
- A verificação OIDC usa issuer/audience/JWKS configurados, configuração HTTPS, lista de permissões de algoritmos assimétricos, validação de claims e verificação de assinatura.
- A análise do cabeçalho Bearer rejeita credenciais malformadas ou múltiplas.
- O RBAC adota negação por padrão (*deny by default*) e correspondência exata de permissões.
- As operações de tenant são compostas em uma transação explícita, com resolução de associação, autorização, rollback e liberação da conexão.
- A migração do PostgreSQL habilita ENABLE e FORCE RLS nas tabelas com escopo de tenant; a CI testa uma função de execução restrita no PostgreSQL 16.
- O resolvedor em tempo de execução associa um issuer/subject verificado a uma associação local ativa e às permissões persistidas.
- As respostas da API evitam cache e definem `X-Content-Type-Options: nosniff`; erros inesperados são sanitizados.
- A CI exige instalação congelada de dependências, verificação de tipos, build e testes; o Dependabot está configurado para npm e GitHub Actions.

## Achados e encaminhamentos

| ID | Severidade | Achado | Encaminhamento / evidência |
|---|---|---|---|
| IAM-PR1-001 | Alta | O servidor da API convertia todas as exceções do verificador OIDC em `invalid_access_token`, fazendo com que indisponibilidades de rede/JWKS fossem reportadas como falhas de autenticação do cliente (401). | Corrigido em `apps/api/src/server.ts`: falhas reconhecidas de validação de token são mapeadas para `invalid_access_token`; erros remotos de JWKS/rede (`TypeError`) são mapeados para `identity_provider_unavailable`; falhas desconhecidas continuam sendo erros do servidor. |
| IAM-PR1-002 | Média | A API não diferenciava indisponibilidade do provedor de identidade de falhas internas inesperadas. | Foi adicionado mapeamento sanitizado para HTTP 503 em `apps/api/src/app.ts`, teste de regressão HTTP em `apps/api/src/app.test.ts` e documentação no README. `apps/api/src/oidc-error.ts` contém testes diretos para credenciais inválidas, falhas remotas de JWKS, erros de rede e exceções inesperadas. |
| IAM-PR1-003 | Média | Os testes HTTP da API estavam anteriormente excluídos do padrão raiz de inclusão do Vitest. | `vitest.config.ts` foi corrigido para incluir `apps/**/*.test.ts` e `packages/**/*.test.ts`; execuções posteriores da CI aprovaram a suíte da API. |
| IAM-PR1-004 | Média | A rota de tenant aceitava strings arbitrárias no caminho antes de consultar o resolvedor. | A validação do formato UUID e um teste de regressão fazem a rota retornar 400 antes de qualquer operação do resolvedor/banco de dados. |
| IAM-PR1-005 | Baixa | A classificação HTTP de token inválido comparava anteriormente a mensagem de erro inteira, falhando quando havia um sufixo de diagnóstico. | A classificação agora usa o prefixo estável do código de erro; a cobertura de regressão passou na CI. |
| IAM-PR1-006 | Alta | O resolvedor em tempo de execução consulta `principals`, `external_identities` e `permissions`; a função restrita de execução na CI precisava de concessões SELECT sem expor mapeamentos de identidade entre tenants. | A migração aplica ENABLE/FORCE RLS a `principals` e `external_identities`, restringindo as leituras aos principais com associação ativa no tenant definido no contexto da transação. A função de execução de testes recebe acesso somente SELECT a essas tabelas e a `permissions`. Os testes de integração verificam a visibilidade por tenant e o resolvedor de associações sob a função restrita. A execução nº 103 da CI passou: https://github.com/alexoaraujo83/iam-platform/actions/runs/38313627685. |

## Etapas pendentes — não comprovadas pela CI deste PR

1. Validar com um provedor OIDC real configurado e uma instância PostgreSQL do ambiente de implantação.
2. Verificar as concessões do banco de dados em tempo de execução e as políticas RLS no ambiente de destino, incluindo todas as tabelas com escopo de tenant.
3. Implementar gravação/leitura/retenção de auditoria durável e alertas/métricas operacionais.
4. Implementar e revisar os fluxos administrativos e o ciclo de vida de identidades/associações antes de declarar prontidão para produção.
5. Revisar o diff final do PR e as verificações obrigatórias atuais antes de qualquer mesclagem; manter o PR aberto, a menos que a mesclagem seja solicitada explicitamente. Um comentário técnico do autor do PR não equivale a uma aprovação independente.

## Limites das evidências

A CI usa uma instância PostgreSQL 16 efêmera e fixtures locais/geradas para assinatura. A aprovação na CI comprova apenas os cenários automatizados cobertos; não comprova disponibilidade do provedor de identidade em produção, políticas do banco de dados de produção, segurança da implantação ou prontidão operacional.
