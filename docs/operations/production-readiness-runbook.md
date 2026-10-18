# Manual operacional de prontidão para produção

Status: **NÃO PRONTO PARA PRODUÇÃO** até que cada controle obrigatório abaixo tenha evidência específica da implantação anexada à release.

Este manual separa evidências do CI de evidências da implantação. Passar em um contêiner PostgreSQL descartável ou em um teste local com chaves geradas não comprova que provedor de identidade, banco de produção, segredos, políticas de rede ou recuperação estejam corretos.

## 1. Configuração e verificação do provedor OIDC

Configurar o provedor somente por variáveis/segredos confiáveis no servidor:

- `OIDC_ISSUER`: identificador exato do emissor nos metadados do provedor; comparar exatamente com o `iss` do token.
- `OIDC_AUDIENCE`: audiência do servidor de recursos esperada no token de acesso (não o ID do cliente, salvo se o contrato do provedor disser explicitamente isso).
- `OIDC_JWKS_URI`: endpoint HTTPS JWKS obtido de metadados confiáveis. Nunca derivar de requisição, cabeçalho JWT ou declaração não verificada.
- `OIDC_ALLOWED_ALGORITHMS`: lista explícita de algoritmos assimétricos aceitos pelo verificador (padrão `RS256`).
- `DATABASE_URL`: valor do gerenciador de segredos para a função de runtime, não para a função proprietária/migradora.

Usar cliente/API OIDC dedicado e não produtivo e testar com token de acesso real emitido para aquela audiência. Registrar provedor, ambiente, data/hora, versão do teste e resultados redigidos; nunca anexar tokens Bearer, chaves privadas ou segredos de cliente.

Casos obrigatórios:

1. Token válido mapeia o par estável (emissor, sujeito) para exatamente uma identidade externa e depois para uma identidade do banco.
2. Assinatura inválida, `kid` desconhecido, algoritmo não suportado, emissor/audiência incorretos, token expirado, `nbf` futuro, declarações obrigatórias ausentes e `iat` futuro são rejeitados.
3. Rotacionar chaves de assinatura: chaves antiga e nova se comportam conforme a política de sobreposição do provedor; IDs de chave desconhecidos falham de forma segura.
4. Indisponibilizar ou causar timeout no JWKS. A autenticação não pode aceitar silenciosamente token não verificável; erros da API devem ser sanitizados e observáveis operacionalmente. Verificar cache e recuperação após retorno do endpoint.
5. Emissores diferentes com o mesmo sujeito não podem resolver para a mesma identidade externa. O sujeito isolado não é uma chave de identidade globalmente única.
6. Testar desvio de relógio e duração do token conforme contrato documentado do provedor.

Um fixture local de chave de assinatura valida somente a lógica do verificador; não satisfaz o controle de provedor real.

## 2. Controle de implantação PostgreSQL

Aplicar primeiro a migração real da release a uma cópia descartável da versão principal do PostgreSQL de destino; depois validar o ambiente de destino com script de verificação aprovado e somente leitura. Usar credenciais distintas para proprietário/migração e aplicação/runtime.

Capturar e revisar:

- Versão do servidor PostgreSQL e registro de migrações; migrações aplicadas uma vez e seguras/repetíveis no caminho suportado.
- Atributos efetivos de função e associações herdadas: função de runtime não é superusuária, não tem `BYPASSRLS`, não é proprietária de tabelas protegidas e não pode assumir função privilegiada.
- `relrowsecurity = true` e `relforcerowsecurity = true` em todas as tabelas protegidas por tenant.
- Permissões de runtime com privilégio mínimo; runtime não pode alterar esquema, desabilitar RLS, mudar políticas ou escrever no histórico de migrações.
- Com contexto transacional de tenant definido, tenant A lê/escreve somente linhas de A; tenant B não lê linhas de A e operações entre tenants de INSERT, UPDATE/reatribuição e DELETE são negadas.
- Ausência ou formato inválido do contexto de tenant, reutilização de conexão após rollback, reutilização de conexões do pool e falhas de transação devem falhar de forma segura, sem vazar estado de tenant.
- Verificar com o login real de runtime, não com proprietário de migração nem superusuário. Preservar SQLSTATE e evidências redigidas.

Não executar sondagens destrutivas em produção. Para destino semelhante à produção, usar tenant de teste dedicado e registros canário aprovados; caso contrário, executar testes de negação de escrita em cópia equivalente à produção e capturar no destino metadados somente leitura de privilégios/RLS efetivos.

Testes PostgreSQL no CI são necessários, mas não constituem evidência da implantação.

## 3. Controles de auditoria durável

O repositório inclui `packages/database/src/audit.ts`, migração append-only (`0002_durable_audit_controls.sql`) e testes unitários/de integração. Antes da produção, integrar `appendAuditEvent` a cada fluxo sensível e persistir eventos relevantes à segurança (resultados de autenticação, mudanças de associação, negações de permissão, administração privilegiada, negações entre tenants e alterações de configuração) em armazenamento PostgreSQL append-only e transacionalmente consistente.

Campos mínimos: ID de evento gerado, data/hora UTC, resultado, ação, identidade autora (nula para eventos não autenticados), tenant (nulo quando ainda não confiável), tipo/ID do alvo, ID de correlação/requisição e metadados mínimos redigidos. Nunca armazenar tokens de acesso, credenciais, cabeçalhos de autorização, segredos ou dados pessoais desnecessários.

- Definir retenção, exportação, revisão de acesso, alertas e responsáveis pela resposta a incidentes.
- A função de runtime pode receber INSERT e, se necessário, SELECT conforme política; não pode UPDATE/DELETE linhas de auditoria nem alterar o esquema de auditoria.
- Verificar restrições, rollback transacional, duplicação/repetição e política explícita de falha segura/falha tolerada quando a escrita da auditoria falhar, por classe de evento.
- Alertar sobre tokens inválidos repetidos, indisponibilidade JWKS, negações entre tenants, falhas de auditoria, falhas de migração e encerramentos inesperados.
- Documentar detecção de adulteração e reconciliação após restauração. A existência de uma tabela não comprova operação de auditoria durável.

## 4. Implantação, encerramento e recuperação

- Injetar segredos pelo gerenciador de segredos da implantação; nenhum segredo no Git, camadas de imagem, bundles do navegador, logs ou artefatos de CI. Exigir TLS no tráfego externo e nas conexões ao banco quando suportado.
- Fixar commit de release revisado e arquivo de lock de dependências; executar instalação congelada, verificação de tipos, build, testes unitários/de integração, simulação de migração, análise de dependências/segurança e varredura de segredos antes da promoção.
- Aplicar migrações com identidade exclusiva de migração antes de direcionar tráfego. Nunca fornecer credenciais de proprietário do esquema ao processo da API.
- Configurar sondagens de prontidão/vida, limites de recursos, timeouts de requisição/conexão, limites do pool, redação de logs, métricas e alertas.
- Em SIGTERM/SIGINT, parar de aceitar novas requisições, permitir conclusão das requisições em andamento dentro de prazo limitado e então fechar o pool PostgreSQL. A escalada não pode deixar o processo bloqueado indefinidamente.
- Fazer backup do banco e da configuração necessária separadamente; definir RPO/RTO, retenção e restrições de acesso. Restaurar em banco isolado e verificar esquema, isolamento de tenants, continuidade da auditoria e inicialização da aplicação antes de considerar a recuperação testada.
- Usar rollout gradual/canário e rollback documentado. Se uma migração não for compatível com versões anteriores, o rollback precisa ser um plano de correção progressiva/restauração, não uma suposição de reversão do código.

## 5. Registro de evidências e decisão de release

Para cada controle, registrar SHA do commit, identificador do ambiente-alvo (nunca credenciais), comando/procedimento, data/hora, resultado, operador, referência de artefato/log e exceção com responsável e validade. Marcar cada controle como `NOT RUN`, `PASS` ou `FAIL`; não inferir aprovação apenas por implementação ou CI.

A prontidão de produção exige aprovação de todos os controles: integração OIDC/JWKS real, verificação PostgreSQL/RLS da implantação, auditoria durável, revisão de segredos/configuração, encerramento gracioso, exercício de backup/restauração, monitoramento/alertas e procedimento de rollback revisado. Até lá, o status da release permanece **BLOQUEADO**.


## CI security gates — evidence required

The required CI workflow runs a Gitleaks scan against the checkout/history and `pnpm audit --audit-level high` against the locked dependency graph. For each release candidate, record the exact commit and successful run URL. A failed or unavailable scan is a release blocker, not a pass. Do not add real credentials to test fixtures; use synthetic values only.

Before production, separately verify GitHub repository-level secret scanning and push protection availability/configuration, because a successful CI scan does not prove those repository settings are enabled. Temporary vulnerability exceptions must identify the affected dependency, severity, mitigation, owner and expiry date; expired exceptions fail the gate.
