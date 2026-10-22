# IAM Platform

Base de Gerenciamento de Identidade e Acesso (IAM) independente de provedor para aplicações multi-inquilino (*multi-tenant*).

## Princípios

- Autenticação de identidade é separada de autorização.
- Adaptadores OIDC normalizam identidades verificadas; declarações (*claims*) do provedor não são a fonte de verdade do domínio.
- Associação ao tenant e permissões são respaldadas pelo banco de dados.
- A autorização nega por padrão.
- O RLS do PostgreSQL é uma camada adicional de defesa, não substitui a autorização da aplicação.
- Afirmações de segurança exigem testes reproduzíveis e evidências registradas.

## Escopo atual

Este repositório contém contratos compartilhados de domínio, avaliador RBAC de correspondência exata, pacote de verificação OIDC/JWT, migração de esquema PostgreSQL e testes RLS, resolução de associação baseada no banco e um auxiliar que mantém operações do tenant autenticado na mesma transação com escopo RLS. O auxiliar exige um avaliador explícito de autorização e não executa operações protegidas sem a permissão necessária. Existe uma API HTTP inicial em `apps/api`, com endpoint de saúde e rota de contexto do tenant. Há testes HTTP, mas a API ainda não foi implantada nem validada com banco de produção ou provedor de identidade de destino. A interface administrativa ainda está pendente. Um gravador transacional de auditoria, migração append-only e SQL de verificação da implantação foram implementados; ainda falta integrar a auditoria a todos os fluxos sensíveis e verificar a implantação de destino. A API possui limites de HTTP/banco e encerramento gracioso, controles que ainda precisam ser verificados após a implantação.

## Pré-requisitos

- Node.js 24 (compatível com CI; `engines.node` exige `>=24.0.0`)
- pnpm 12.12.1 (fixado em `packageManager` e no CI)

## Comandos

- `pnpm install --frozen-lockfile` — instalação reproduzível das dependências
- `pnpm typecheck` — verificação de tipos
- `pnpm test` — testes

## Estrutura

- `packages/contracts`: contratos de domínio independentes de provedor
- `packages/identity`: verificação de JWT OIDC usando emissor/JWKS confiáveis configurados
- `packages/authorization`: avaliador de permissões exatas com negação por padrão
- `packages/database`: esquema PostgreSQL, testes RLS, resolução de associação e transação de tenant autenticado
- `apps/api`: API HTTP, endpoint de contexto do tenant com OIDC e testes de negação HTTP
- `docs/architecture`: limites arquiteturais e invariantes de multi-tenancy
- `docs/identity/auth0-reference.md`: configuração de referência OIDC do Auth0, contrato de testes independente de provedor e verificação explícita de plano/recursos
- `docs/security`: modelo inicial de ameaças e controles de segurança obrigatórios

## Limites do verificador OIDC

O verificador valida assinatura criptográfica, emissor e audiência configurados, expiração, declarações obrigatórias de sujeito e emissão, e uma lista fixa de algoritmos assimétricos permitidos. O emissor e os endpoints JWKS devem usar HTTPS. A URL JWKS é configuração confiável do servidor e nunca pode ser derivada de dados da requisição ou de token não verificado. O verificador retorna somente identidade normalizada de emissor/sujeito; não infere associação a tenant, funções ou permissões.

Os testes unitários usam chaves de assinatura geradas e um resolvedor JWKS local. Descoberta do emissor real, comportamento de JWKS remoto em cada provedor de destino, mapeamento de identidade no banco e autenticação ponta a ponta da API ainda exigem validação de integração.

## API HTTP

`apps/api` expõe `GET /health` e `GET /v1/tenants/:tenantId/context`. O segundo endpoint exige token de acesso Bearer, valida-o usando emissor/audiência/JWKS OIDC configurados no servidor, resolve associação ativa e permissão `iam.context.read` na mesma transação PostgreSQL com escopo RLS e retorna somente o contexto normalizado do tenant. Credenciais ausentes retornam `401`; tokens inválidos retornam `401`; associação ausente ou permissão negada retorna `403`; indisponibilidade remota de OIDC/JWKS retorna `503` sanitizado; falhas inesperadas retornam `500` sanitizado. Configure `DATABASE_URL`, `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URI` e, opcionalmente, `OIDC_ALLOWED_ALGORITHMS` (padrão `RS256`). `PORT` usa `3000` por padrão. Copie `.env.example` para a configuração local e nunca versione credenciais reais. Os testes HTTP cobrem saúde, credenciais malformadas, negação por associação/permissão, tokens inválidos, erros sanitizados e rotas desconhecidas; eles não substituem testes de integração OIDC/PostgreSQL ponta a ponta.

## Transação de tenant autenticado

Use `withAuthenticatedTenant` do pacote de banco para verificar um token antes de obter conexão, resolver a associação ativa e permissões derivadas do banco, e informar uma permissão exigida explícita junto do avaliador compartilhado de autorização que nega por padrão. Consultas protegidas executam na mesma transação explícita em que o contexto RLS do tenant foi definido, e o callback não é chamado sem autorização. Associação ausente resulta em falha segura. O auxiliar é uma primitiva de composição, não uma API HTTP implantada nem um serviço de sessão.

## Evidências de RLS do PostgreSQL

A suíte de integração do CI aplica a migração ao PostgreSQL 16 e verifica que a função de runtime de teste não é superusuária nem possui `BYPASSRLS`, que a ausência de contexto de tenant não retorna linhas desse tenant, que cada tenant vê somente suas próprias linhas, que inserções entre tenants falham com SQLSTATE `42501` e que atualizações entre tenants não alteram a associação de outro tenant. Essa evidência limita-se ao banco efêmero do CI e não comprova implantação de produção nem cobertura de todas as tabelas.

## Segurança

Nunca inclua segredos no controle de versão. Uma declaração de tenant não comprova associação. Não implante até que a integração HTTP/sessão em runtime, validação com provedor real e banco de implantação, testes abrangentes de migração/RLS, auditoria durável e controles operacionais estejam implementados e revisados.

## Operações de produção

Consulte o [manual de prontidão para produção](docs/operations/production-readiness-runbook.md) para testes OIDC com provedor real, verificação PostgreSQL/RLS no destino, requisitos de auditoria durável, procedimentos de implantação/recuperação e registro de evidências. O manual deixa explícito que sucesso no CI não é evidência de produção. OIDC/JWKS real, validação do banco de implantação, auditoria durável e teste de restauração continuam bloqueadores de release até serem registrados como aprovados.

## Governança de entrega

O trabalho é proposto por pull requests. Acompanhe cada item separando descoberta, implementação, teste, integração e operação; não promova o status sem evidências.
