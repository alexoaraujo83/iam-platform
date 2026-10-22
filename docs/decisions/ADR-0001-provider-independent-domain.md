# ADR-0001: Domínio de identidade independente de provedor

- Status: aceito como direção do MVP
- Data: 2026-10-12

## Contexto

A plataforma deve ser reutilizável por aplicações futuras e não pode vincular regras de autorização ou associações de tenant a um único fornecedor de identidade.

## Decisão

Usar OIDC como protocolo de integração, não como modelo interno de domínio. Normalizar um par verificado (emissor, sujeito) em uma identidade interna; manter associações, permissões, relações com tenants e eventos de auditoria no banco da plataforma. Adaptadores específicos de cada provedor implementam verificação e mapeamento de declarações por trás de interfaces.

## Consequências

- Integrações de provedores podem ser substituídas sem reescrever a autorização de domínio.
- Emissor, audiência, JWKS e algoritmos permitidos devem ser configurados no servidor.
- Vinculação de contas e migração de sujeitos exigem fluxos explícitos e auditados.
- A plataforma não deve afirmar que SAML, SCIM ou qualquer adaptador funciona até que esteja implementado e testado.
