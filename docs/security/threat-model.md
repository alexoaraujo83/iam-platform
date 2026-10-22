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
| Vazamento de segredos | Nenhum segredo em código, logs, fixtures ou bundles do navegador | Varredura Gitleaks no CI e testes de logs; controles de repositório devem ser verificados separadamente |
| Troca insegura de tenant | Revalidar associação a cada requisição ou limite confiável de sessão | Testes negativos de troca de tenant |

## Controles de segurança obrigatórios

- Nunca usar decodificação de JWT como substituto da verificação.
- Nunca aceitar URLs JWKS arbitrárias fornecidas pelo usuário.
- Nunca inferir associação ou função a partir de declarações não confiáveis do token.
- Nunca marcar um controle de segurança como aprovado sem evidência reproduzível.
- Manter segredos de produção fora do repositório e dos logs do CI.


## Evidência de CI e exceções

- O workflow de CI executa Gitleaks sobre os arquivos do checkout e executa `pnpm audit --audit-level high` sobre o lockfile. A cobertura de todo o histórico Git ainda não foi demonstrada e permanece pendente de uma revisão de baseline histórica. Um controle só é considerado executado quando o job correspondente conclui com sucesso no commit avaliado.
- Um alerta não deve ser ignorado por simples comentário. Confirmar se é real, remover/rotacionar credenciais reais imediatamente e, para vulnerabilidades aceitas temporariamente, registrar pacote/intervalo afetado, justificativa, mitigação, responsável e data de expiração em uma exceção revisável.
- Essas verificações de CI não provam que a proteção de push, secret scanning do GitHub ou a configuração de segurança do ambiente implantado estão habilitados. Verificar e registrar esses controles separadamente antes da produção.


## Registro canônico de evidências

O estado operacional dos controles está em [`docs/operations/evidence-ledger.md`](../operations/evidence-ledger.md). Este modelo define controles obrigatórios; não é, por si só, prova de aplicação ou deployment. Cada aprovação deve indicar ambiente, SHA exato, execução/artefato verificável, timestamp UTC, resultado e limitações. Um PASS de CI em SHA anterior é histórico, não PASS para um head mais novo. Este modelo continua em rascunho até revisão e aceite explícitos para uma release.
