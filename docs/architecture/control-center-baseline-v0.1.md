# IAM Platform Control Center — Baseline v0.1

**Status:** baseline funcional inicial para discovery e implementação  
**Data:** 2026-10-20  
**Branch de documentação:** `docs/control-center-baseline-v0.1`

## Objetivo

Estabelecer o ponto de partida para evoluir a IAM Platform para um Control Center operacional que consolide administração, diagnóstico, execução de testes, evidências, segurança e release. Esta baseline é uma proposta arquitetural; não afirma que os módulos descritos já estejam implementados.

## Princípios

1. Evidências verificáveis antes de conclusões.
2. Identidade separada de autorização; negação por padrão.
3. O backend é responsável por validar permissões; a interface não é uma fronteira de segurança.
4. Nenhum segredo é exibido nos dashboards ou gravado em logs.
5. Não executar operações destrutivas em produção sem autorização explícita.
6. Não declarar testes, deployments ou integrações como validados sem resultados reais.
7. Reutilizar contratos e módulos existentes antes de introduzir novas abstrações.
8. Separar dados reais, dados simulados e estados ainda não verificados.

## Arquitetura funcional proposta

1. **Context** — commit, deployment, ambiente, configuração efetiva e identidade da execução.
2. **Runtime Explorer** — saúde dos serviços, dependências, logs, erros, traces e correlation IDs.
3. **Test Runner** — catálogo de testes, execução autorizada e resultados reproduzíveis.
4. **Evidence Engine** — metadados de execução, relatórios, artefatos, hashes e proveniência.
5. **Diagnostics Center** — health checks, falhas de integração, hipóteses e causas confirmadas.
6. **Clarim Console** — integração proposta para sinais, alertas e correlação; o papel real do Clarim deve ser confirmado por inspeção.
7. **Admin Dashboard** — identidades, tenants, roles, permissões e operações administrativas protegidas.
8. **Security & Audit Center** — findings, eventos de segurança, alterações privilegiadas e trilhas de auditoria.
9. **Delivery & Release Center** — GitHub, GitHub Actions, Vercel, gates, smoke tests e rollback.
10. **Control Center** — visão operacional unificada alimentada pelos módulos anteriores.

## Contrato mínimo de evidência

Cada execução deve, quando aplicável, registrar:

- `execution_id`
- `test_id` ou `procedure_id`
- `commit_sha`
- `deployment_id`
- `environment`
- `started_at` e `finished_at`
- `status`: `passed`, `failed`, `blocked` ou `not_run`
- referências para logs, traces e artefatos
- hash de integridade do artefato, quando aplicável
- executor/serviço e `correlation_id`

Os metadados podem residir no PostgreSQL/Neon; artefatos maiores devem usar armazenamento adequado e referências protegidas. Hashes isolados não tornam uma trilha de auditoria imutável: acesso, retenção e proteção contra adulteração também são necessários.

## Estado inicial observado no repositório

Inspeção de arquivos da branch `main` em 2026-10-20:

- Repositório: `alexoaraujo83/iam-platform`; branch padrão `main`.
- Monorepo pnpm; Node.js `>=24.0.0`; pnpm `12.12.1`.
- Pacotes de domínio, identidade, autorização e banco estão descritos no README.
- Existe uma API HTTP inicial em `apps/api`, incluindo `GET /health` e contexto de tenant.
- Existe pacote Web Next.js/React com SDK Auth0.
- O README declara a interface administrativa pendente.
- O workflow `.github/workflows/ci.yml` define verificações de secrets, auditoria de dependências, typecheck, lint, build e testes.
- A documentação declara que a API ainda não foi validada com banco de produção e provedor de identidade de destino.
- O papel e as capacidades reais do Clarim ainda precisam ser descobertos.

Esses itens são observações de código/documentação; não comprovam o estado de produção, nem que os workflows mais recentes passaram.

## Plano de execução

### Fase 1 — Discovery

- Mapear estrutura real de `apps/web`, `apps/api` e `packages/*`.
- Identificar rotas, autenticação, autorização, componentes e testes existentes.
- Consultar estado recente de CI e PRs.
- Verificar Vercel, Neon e Auth0 com integrações autorizadas, sem revelar secrets.
- Identificar o componente Clarim e seus contratos reais.
- Produzir matriz de gaps, riscos, evidências e dependências.

### Fase 2 — Contratos compartilhados

- Definir modelo de execução, estados, correlation IDs e proveniência.
- Definir contratos de leitura para Context e Runtime.
- Definir persistência e retenção de metadados e artefatos.
- Especificar controle de acesso aos dashboards e ações operacionais.

### Fase 3 — Test Runner e Evidence Engine

- Catalogar testes existentes antes de criar novos.
- Vincular resultados a commit, ambiente e deployment.
- Preservar logs e relatórios de forma protegida.
- Incluir testes de autorização negativa e smoke tests apropriados.
- Impedir execução destrutiva não autorizada em produção.

### Fase 4 — Diagnóstico e Clarim

- Integrar health checks, eventos e logs disponíveis.
- Correlacionar falhas por serviço, execução e correlation ID.
- Distinguir hipótese, causa confirmada e evidência insuficiente.

### Fase 5 — Admin e Security

- Implementar administração conforme o domínio real.
- Aplicar autorização no backend e registrar ações privilegiadas.
- Exibir findings e eventos sem vazar tokens, segredos ou dados desnecessários.

### Fase 6 — Control Center e Release

- Construir indicadores derivados de fontes reais.
- Exibir frescor dos dados e estados de falha/indisponibilidade.
- Integrar gates de release e validação pós-deployment.
- Documentar rollback e critérios de prontidão.

## Critérios de aceitação

- Dados simulados são claramente rotulados; métricas desconhecidas não são inventadas.
- Cada estado operacional informa fonte e horário da última verificação.
- Resultados são rastreáveis a commit, ambiente e execução.
- Testes e operações administrativas são autorizados no backend.
- Evidências são protegidas contra acesso indevido.
- Testes negativos de autenticação/autorização são reproduzíveis.
- Nenhuma mudança de produção é declarada validada sem verificação real.
- A implementação preserva a arquitetura existente salvo justificativa técnica documentada.

## Próxima ação

Concluir o discovery da estrutura Web/API/packages, do CI e das integrações. Só então selecionar o primeiro incremento de código, priorizando Context + Runtime + Test Runner + Evidence Engine, sem reescrever o núcleo IAM.

## Gate de identidade real do banco em runtime (implementação nesta PR; ainda não implantada)

O endpoint protegido `GET /v1/tenants/{tenant}/control-center/runtime` consulta a mesma pool PostgreSQL usada pela API e retorna evidência sanitizada de:

- `current_user` — deve ser `iam_app_runtime`;
- `current_database()` — deve ser `iam_platform`;
- `current_setting('neon.branch_id', true)`;
- `current_setting('neon.project_id', true)`.

A resposta inclui `databaseIdentity.verified` e o check crítico `database.identity`. A API responde HTTP 503 se a role, o projeto, a branch ou a configuração esperada estiver ausente/incorreta. O endpoint não retorna host, URL de conexão, senha, token nem erro bruto do driver e continua protegido pela permissão `iam.control_center.read`.

Configuração não secreta exigida por ambiente:

- Development: `IAM_EXPECTED_NEON_BRANCH_ID=br-super-term-b6dt6vec`
- Preview: `IAM_EXPECTED_NEON_BRANCH_ID=br-sweet-firefly-b6mr92zu`
- Production: `IAM_EXPECTED_NEON_BRANCH_ID=br-soft-butterfly-b6i5d7bm`
- Todos: `IAM_EXPECTED_NEON_PROJECT_ID=curly-fog-91868394`

Essas variáveis foram cadastradas no projeto Vercel da API para deployments futuros; elas não alteram o ambiente de deployments já existentes. A quota de deployment atualmente bloqueia a implantação do código e a confirmação via endpoint permanece pendente.

A role legada `iam_runtime` ainda possui atributos privilegiados e membership em `neon_superuser` nos três ambientes. Não a alterar até que o endpoint prove a identidade efetiva da pool API e exista plano de migração/rollback revisado.
