# Auth0 → Neon: provisionamento seguro de identidade

Status: proposta técnica; nenhuma migração foi aplicada a Neon e nenhum usuário foi sincronizado.

## Invariantes

1. O serviço só recebe `issuer` e `subject` após validação criptográfica do access token pelo verificador OIDC confiável.
2. A chave de identidade é exclusivamente `(issuer, subject)`; email, nome e outros claims não identificam nem vinculam contas.
3. O provisionamento pode criar apenas `principals` e `external_identities`. Nunca cria tenant, membership, role ou permission.
4. Sem membership ativa no tenant solicitado, o fluxo autenticado continua negado. O tenant solicitado é apenas um seletor de escopo, não uma concessão.
5. Produção e Preview não compartilham identidades importadas nem memberships. O primeiro teste usa usuário Auth0 exclusivo de Preview.
6. O runtime normal continua sem INSERT/UPDATE/DELETE em tabelas de identidade e sem BYPASSRLS.

## Limite de privilégio proposto

O provisionamento não deve ser executado com o pool normal da API nem ampliar os grants de `iam_app_runtime`. A implementação deve usar um pool/credencial de provisionamento separado, com permissão apenas para executar uma função SQL estreita. A função deve ter `SECURITY DEFINER`, `search_path` fixo e owner dedicado sem LOGIN, com acesso mínimo às tabelas `principals` e `external_identities`. Revogar EXECUTE de PUBLIC; conceder EXECUTE apenas ao papel de provisionamento dedicado, sem associação de papel que permita ao runtime assumir o owner.

A função deve validar entradas não vazias, fazer a criação de principal/identidade atomicamente, respeitar a unicidade de `(issuer, subject)` sob concorrência e devolver o principal já existente quando houver corrida. Qualquer falha deve abortar a transação sem deixar principal órfão. O papel dedicado não deve poder escrever em `tenants`, `memberships`, `membership_roles`, `roles`, `role_permissions` ou `permissions`.

## Integração de aplicação

- Verificar o JWT antes de chamar o serviço de provisionamento.
- O endpoint/handler de login não pode aceitar issuer/subject fornecidos diretamente pelo cliente.
- A chamada de provisionamento deve usar somente a credencial separada; o pool padrão mantém apenas os privilégios de runtime.
- Após provisionamento, executar normalmente a resolução de membership e autorização RBAC. Uma identidade nova sem membership continua sem acesso.
- Auditoria registra resultado, correlation/request ID e IDs internos mínimos; nunca token, authorization header, claims brutos ou secrets.
- Erros de banco não podem virar login autorizado; o fluxo falha fechado.

## Testes obrigatórios

1. Identidade nova cria exatamente um principal e um mapeamento externo.
2. Identidade existente retorna o mesmo principal, sem duplicatas.
3. Chamadas concorrentes para o mesmo par produzem um único mapeamento e não deixam órfãos.
4. issuer/subject vazios ou só com espaços são rejeitados.
5. Mesmo subject com issuer diferente é identidade distinta; issuer incorreto é rejeitado pelo verificador OIDC antes do provisionamento.
6. Falha de banco faz rollback; nenhuma autorização é concedida.
7. O papel de provisionamento não consegue modificar tenants/memberships/roles/permissions; o runtime normal não consegue executar o provisionamento nem escrever nas tabelas de identidade.
8. Identidade provisionada sem membership continua negada; membership de outro tenant não permite acesso cross-tenant.
9. Testes de integração em branch Neon descartável; comprovar que Preview não altera Production.
10. E2E Preview com usuário de teste exclusivo, sem registrar token; somente depois planejar canário de Production e rollback.

## Gates de implantação

- Não criar credencial de provisionamento nem aplicar migração diretamente em Production nesta etapa.
- Provisionar `iam_identity_provisioner_login` com credencial gerenciada fora do repositório, verificar atributos/memberships efetivos no PostgreSQL e confirmar que o deployment usa a branch Neon Preview. A API ainda precisa integrar esse pool separado antes de ativar o fluxo.
- Executar CI no SHA exato, testes de concorrência/RLS e revisão independente do diff.
- Manter PR em Draft até as evidências acima estarem completas.
