# Pacote de banco de dados

Este diretório contém migrações PostgreSQL versionadas, testes de integração de isolamento entre tenants e o limite transacional de tenant autenticado no banco da plataforma IAM.

## Migração 0001

Cria tenants, identidades internas (*principals*), identidades externas OIDC, associações, permissões, funções por tenant, concessões de função, registros de aplicações e eventos de auditoria.

Tabelas pertencentes a tenants usam ENABLE ROW LEVEL SECURITY e FORCE ROW LEVEL SECURITY. A aplicação deve definir `app.tenant_id` localmente à transação somente depois de validar a identidade autenticada e a associação ativa. Nunca usar declaração não confiável do token como prova de associação.

As tabelas globais `principals` e `external_identities` também limitam a visibilidade de leitura por tenant por meio de políticas RLS vinculadas a uma associação ativa no tenant da transação atual. A função de runtime recebe somente SELECT nessas tabelas de identidade e no catálogo global `permissions`; não recebe privilégios de escrita nos registros de identidade. O catálogo de permissões contém definições globais de permissões, não dados de identidade de usuários.

## Resolução de identidade para associação

`src/membership-resolution.ts` mapeia um par (emissor, sujeito) criptograficamente verificado para identidade interna, tenant e associação locais ativos; em seguida, carrega permissões das concessões de função de associações ativas. O ID de tenant solicitado é somente um seletor de escopo RLS; nunca comprova acesso. O resolvedor falha de forma segura quando identidade, tenant ou associação estão ausentes/inativos e rejeita chaves de permissão malformadas.

## Transação de tenant autenticado

`src/authenticated-tenant.ts` compõe verificação do token, resolução de associação, autorização e operação protegida no banco:

1. Validar a permissão exigida e verificar o token de acesso antes de obter conexão com o banco.
2. Iniciar uma transação PostgreSQL explícita.
3. Resolver associação ativa e permissões derivadas do banco, definindo `app.tenant_id` localmente à transação.
4. Chamar o avaliador de autorização fornecido para a permissão exata exigida. Se negar, a operação protegida não é chamada e a transação sofre rollback.
5. Executar o callback da operação protegida no mesmo cliente/transação somente após autorização.
6. Confirmar em caso de sucesso; reverter em associação ausente, negação ou erro; sempre liberar o cliente.

Fornecer um verificador criado a partir de configuração OIDC confiável do servidor (por exemplo, `createOidcVerifier`) e o avaliador compartilhado `authorize`, que nega por padrão, do pacote de autorização. Nunca fornecer declarações JWT apenas decodificadas/não verificadas nem um avaliador que permita tudo. Manter todas as consultas com escopo de tenant dentro do callback; uma configuração RLS local à transação não sobrevive ao commit.

Os testes unitários cobrem resolução de associação e ciclo de vida da transação, incluindo falha de verificação antes de obter conexão, associação ausente, negação RBAC explícita antes da operação protegida, rollback e liberação do cliente. Esses testes não substituem validação ponta a ponta com provedor OIDC real e PostgreSQL.

## Evidências de integração automatizada

O CI do GitHub Actions inicia um serviço PostgreSQL 16 efêmero, aplica esta migração e conecta como função de teste dedicada `iam_runtime`, com `NOSUPERUSER` e `NOBYPASSRLS`. Os testes atuais verificam:

- Ausência de contexto de tenant não expõe linhas de `tenants` ou `memberships`.
- Tenant A lê suas próprias linhas, mas não as de tenant B, inclusive mapeamentos de identidades internas e externas.
- Inserção de associação entre tenants é rejeitada com SQLSTATE `42501`.
- Atualização entre tenants afeta zero linhas e deixa a associação de destino inalterada.
- A função de runtime não é superusuária e não ignora RLS.

Executar esta suíte somente contra banco PostgreSQL descartável, definindo `IAM_DATABASE_INTEGRATION=1`, `DATABASE_URL` (administrador de migração/testes) e `IAM_RUNTIME_DATABASE_URL` (função de runtime de teste). O banco do CI é efêmero; não é evidência de produção.

## Eventos de auditoria durável

`src/audit.ts` exporta `appendAuditEvent(client, event)`. Invocá-lo com a mesma transação/cliente da alteração sensível quando a atomicidade for necessária. Erros de persistência são propagados; os chamadores não devem descartar falhas de auditoria silenciosamente. Não incluir tokens, credenciais, cabeçalhos de autorização ou segredos nos metadados. A migração `0002_durable_audit_controls.sql` adiciona campos limitados de metadados JSON/ID de requisição e bloqueia UPDATE/DELETE com SQLSTATE `42501`; as permissões de runtime devem seguir o privilégio mínimo. Aplicar migrações em ordem usando o proprietário de migração.

## Eventos pré-autenticação/globais

A migração `0004_pre_auth_security_events.sql` cria `global_security_events`, sem colunas de tenant ou ator. `appendPreAuthSecurityEvent` grava apenas ação, resultado, correlação/requisição e metadados mínimos. A função de runtime recebe INSERT, mas não SELECT/UPDATE/DELETE; RLS e FORCE RLS permanecem ativos. Eventos sem tenant confiável nunca devem ser inseridos em `audit_events` com `tenant_id = NULL`; o teste de integração confirma que esse INSERT continua negado.

Antes de conectar esse helper a todos os caminhos de falha de autenticação, definir limites/controle de taxa para evitar amplificação de escrita por tráfego anônimo, alertas para falha de persistência e uma política explícita por classe de evento. Uma falha de auditoria não pode transformar um token inválido em autenticação aceita. A integração em handlers de produção e o teste de ponta a ponta ainda são pendentes.

## Requisitos de implantação

- Aplicar migrações com proprietário dedicado de esquema/migração.
- A função de banco de runtime não pode ser superusuária nem ter `BYPASSRLS`.
- Conceder acesso de runtime explicitamente; esta migração não cria credenciais nem concede privilégios amplos.
- Manter `principals` e `external_identities` atrás de limites de serviço confiáveis no servidor.
- Registros de auditoria com `tenant_id` NULL são reservados a eventos de segurança explicitamente globais e exigem autorização separada na camada de serviço.
- Executar `migrations/verify_runtime_security.sql` como a função real de runtime no banco de destino e preservar a saída como evidência de release.
- Ampliar a cobertura de integração a todas as tabelas com escopo de tenant e validar migrações/concessões de produção antes da produção.
- Validar a migração no banco real da implantação e verificar as permissões de runtime antes de qualquer declaração de prontidão de produção.

Esta migração é uma base inicial de esquema. A validação no CI demonstra comportamento somente em banco de teste efêmero; não prova que RLS esteja habilitado ou configurado corretamente em qualquer ambiente implantado.
