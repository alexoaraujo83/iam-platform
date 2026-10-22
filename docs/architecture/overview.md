# Visão geral da arquitetura

## Limites do MVP

- Adaptadores de identidade verificam credenciais externas e normalizam sujeitos autenticados em identidades internas (*principals*).
- O domínio de identidade armazena identidades internas, tenants, associações e registros de aplicações.
- A autorização avalia permissões explícitas com base em contexto de tenant validado; por padrão, nega.
- A evolução das políticas começa com RBAC de correspondência exata. ABAC e versionamento de políticas são extensões separadas e testáveis.
- A auditoria registra decisões relevantes para segurança e alterações administrativas com IDs de correlação.
- A API/interface administrativa consome os mesmos serviços de domínio e políticas de autorização.

## Independência de provedor

A camada de domínio não deve importar SDK do Auth0, Keycloak, Cognito ou de qualquer outro provedor. Um adaptador OIDC é responsável por validar emissor/audiência, assinatura, expiração e validade temporal, lista fixa de algoritmos e configuração confiável de JWKS. O adaptador mapeia o par (emissor, sujeito) para uma identidade interna. As declarações do provedor não são a fonte de verdade para autorização.

## Invariantes de isolamento entre tenants

1. O identificador de tenant no token é um seletor, não uma prova de associação.
2. Resolver no banco uma associação ativa entre a identidade autenticada e o tenant solicitado.
3. Construir o contexto do tenant no servidor; nunca aceitar como autoridade uma função enviada pelo cliente.
4. Aplicar escopo de tenant a todos os caminhos de acesso a dados; usar PostgreSQL RLS como defesa adicional.
5. As funções de banco usadas em runtime não podem ser superusuárias nem ter `BYPASSRLS`.
6. Ausência de identidade, tenant, associação ou contexto de política resulta em negação.

## Limites de módulos propostos

contracts, identity, tenancy, authorization, applications, audit, api, admin-web, worker, sdk-typescript.

## Fora do escopo da primeira entrega

SAML, SCIM, linguagem complexa de políticas, herança automática de funções, administradores entre tenants, faturamento e declarações de conformidade de produção. Inclua esses recursos somente com modelos de ameaças e testes de regressão.
