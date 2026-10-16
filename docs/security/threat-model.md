# Modelo inicial de ameaças

Status: rascunho; deve ser revisado antes do uso em produção.

| Ameaça | Controle obrigatório | Evidência de verificação |
|---|---|---|
| JWT forjado ou com escopo incorreto | Validar assinatura, lista fixa de algoritmos, emissor, audiência, expiração e `not-before` | Testes negativos de tokens |
| Acesso a dados de outro tenant | Resolver associação ativa; contexto de tenant construído no servidor; PostgreSQL RLS | Testes de integração de leitura/escrita entre tenants |
| Elevação de privilégios | Permissões derivadas do banco; negação por padrão; funções não controladas pelo cliente | Testes da matriz de autorização |
| Substituição do provedor de identidade / *confused deputy* | Configuração explícita de emissor para provedor e vínculo com audiência | Testes de emissor/audiência incorretos |
| Repetição / evento duplicado | Chaves de idempotência e restrições únicas para efeitos colaterais | Teste de integração de repetição |
| Adulteração de auditoria | Interface de aplicação somente para acréscimo; permissões restritas no banco; política de exportação/retenção | Testes de permissões e integridade |
| Vazamento de segredos | Nenhum segredo em código, logs, fixtures ou bundles do navegador | Varredura de segredos e testes de logs |
| Troca insegura de tenant | Revalidar associação a cada requisição ou limite confiável de sessão | Testes negativos de troca de tenant |

## Controles de segurança obrigatórios

- Nunca usar decodificação de JWT como substituto da verificação.
- Nunca aceitar URLs JWKS arbitrárias fornecidas pelo usuário.
- Nunca inferir associação ou função a partir de declarações não confiáveis do token.
- Nunca marcar um controle de segurança como aprovado sem evidência reproduzível.
- Manter segredos de produção fora do repositório e dos logs do CI.
