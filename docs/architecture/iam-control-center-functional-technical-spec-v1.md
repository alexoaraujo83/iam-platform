# IAM Control Center — especificação funcional e técnica

- **Repositório:** `alexoaraujo83/iam-platform`
- **Estado:** proposta para implementação incremental, read-only
- **Versão do documento:** 1.0
- **Branch-alvo:** `docs/control-center-baseline-v0.1`
- **Princípio de release:** este documento não autoriza merge, promoção de deployment ou mutação de recursos de produção.

## 1. Objetivo e limites

O IAM Control Center é uma superfície operacional para consolidar contexto de identidade, estado de runtime e evidências de release. A primeira versão é estritamente **read-only**. Ela não deve executar operações administrativas destrutivas nem inferir prontidão a partir de um único sinal verde.

Fontes reais previstas:
- **GitHub Actions:** estado, conclusão, branch/SHA, timestamps e URL de runs de workflows autorizados.
- **Vercel:** deployments dos projetos `iam-platform-web` e `iam-platform-api`, alvo, estado, branch e commit SHA.
- **Neon/PostgreSQL:** resultado do workflow aprovado de verificação de segurança runtime; nunca consultar nem exibir credenciais.
- **API IAM:** estado de runtime e prontidão do banco via endpoint já definido, sujeito à autorização IAM.
- **Auth0/OIDC:** só apresentar evidência quando a configuração e a validação reais estiverem disponíveis. A existência do SDK ou de documentação não significa integração validada.
- **Clarim:** integração não confirmada; mostrar como “não configurada / evidência indisponível”, sem inventar telemetria.

O Control Center não é, nesta fase, um painel de analytics de negócio. Não criar números de usuários, tenants, sessões, eventos, disponibilidade, latência, cobertura de testes ou taxa de sucesso sem uma fonte real e uma definição verificável.

## 2. Personas e autorização

Toda autorização deve ocorrer no servidor. A UI pode ocultar controles, mas isso não constitui uma barreira de segurança.

| Capacidade | Viewer / Auditor | Operator | IAM Administrator |
|---|---:|---:|---:|
| Ver snapshots de runtime autorizados | Sim | Sim | Sim |
| Ver deployments e workflow runs | Sim | Sim | Sim |
| Ver proveniência e artefatos redigidos | Sim | Sim | Sim |
| Iniciar nova coleta read-only | Não | Sim, se permitido pela policy | Sim |
| Alterar configurações de integração | Não | Não | Fora do escopo v1 |
| Alterar roles, tenants, memberships ou permissões | Não | Não | Fora do escopo v1 |
| Promover/rollback deployment ou mutar banco | Não | Não | Fora do escopo v1 |

Os nomes acima são papéis funcionais propostos, não uma afirmação de que já existem como roles no sistema. O mapeamento deve usar as permissões IAM reais e existentes; não conceder acesso por nome de papel, e-mail ou condição no frontend. A rota de leitura do runtime exige `iam:control_center.read`. Qualquer permissão adicional deve ser definida no catálogo de permissões, revisada e testada antes de uso.

Requisitos de autorização:
1. Validar sessão/token no servidor e autorização IAM em cada request.
2. Aplicar tenant scoping no backend para dados tenant-scoped; não confiar em `tenantId` enviado pelo browser.
3. Negar por padrão: ausência de permissão => HTTP 403; ausência/invalidade de autenticação => HTTP 401.
4. Não revelar existência ou detalhes de tenants a quem não tem acesso.
5. Registrar ações de coleta e futuras mudanças em trilha de auditoria; v1 não executa mutações administrativas.
6. Não retornar tokens, cookies, secrets, connection strings, raw claims, dados pessoais desnecessários ou mensagens brutas de provedores.

## 3. Navegação e telas

### 3.1 Overview

Mostrar somente indicadores derivados de evidências obtidas:
- **Web deployment:** último deployment de produção encontrado para o projeto Web, estado, SHA e timestamp.
- **API deployment:** equivalente para o projeto API.
- **Release consistency:** `CONSISTENT` somente se ambos os deployments forem identificados e seus SHAs forem iguais, ou se existir uma regra de compatibilidade versionada e validada. SHAs diferentes => `DRIFT`; falta de um dos lados => `UNKNOWN`.
- **CI quality:** conclusão do run aplicável ao SHA/branch selecionado, com link para o run. Um run antigo ou de SHA diferente não conta como sucesso para o SHA atual.
- **Runtime database security:** estado do workflow de segurança para o ambiente, branch e SHA explícitos; mostrar escopo e idade da evidência.
- **OIDC/Auth0:** `PASS` somente após teste real de configuração/token no ambiente selecionado. SDK instalado ou documento de referência não é prova.
- **Readiness:** derivado de gates obrigatórios versionados. Qualquer gate obrigatório `FAIL`, `UNKNOWN`, ausente ou expirado impede o estado `READY`.

Cada indicador deve incluir status, texto de explicação, fonte, timestamp da coleta, ambiente, SHA/deployment ID quando aplicável, URL de origem, idade da evidência e validade. O utilizador deve conseguir abrir a fonte original.

### 3.2 Runtime diagnostics

Consumir a rota existente `GET /v1/tenants/:tenantId/control-center/runtime` com a permissão `iam:control_center.read`. Mostrar API runtime, readiness de PostgreSQL, environment/commit/deployment metadata, correlation ID e timestamp. Se a API não retornar dado, não sintetizar um status de saúde.

### 3.3 Deployments

Exibir Web e API separadamente, com histórico real e filtros por ambiente, branch, estado e SHA, desde que a fonte forneça esses campos. Diferenciar `READY` da Vercel de saúde funcional: deployment pronto não prova autenticação, compatibilidade, conectividade com banco ou readiness de negócio.

### 3.4 CI e evidências

Listar workflow runs reais com nome, conclusão, branch/SHA, timestamps, URL e artefatos existentes. Não inferir que os testes passaram quando o run está pendente, foi cancelado, falhou, não corresponde ao commit ou não pôde ser consultado.

### 3.5 Integrações

Cada integração deve indicar `CONNECTED`, `DEGRADED`, `NOT_CONFIGURED` ou `UNKNOWN`, baseado em uma verificação observável. Nunca expor o conteúdo de variáveis de ambiente ou secrets.

### 3.6 Evidence detail

Exibir:
- ID estável da evidência e tipo;
- sistema de origem e URL;
- ambiente e escopo;
- timestamp da observação e intervalo de validade;
- commit SHA/deployment/run ID quando aplicável;
- status e regra de derivação;
- motivo sanitizado de falha ou desconhecimento;
- hash do artefato, se o artefato foi realmente gerado e hasheado.

Não apresentar hash, artefato ou ID de execução inventados para preencher a interface.

## 4. Modelo de estados

### 4.1 Status de evidência

Usar enumeração versionada:
- `PASS`: verificação executada e evidência válida satisfaz a regra.
- `FAIL`: verificação executada e evidência válida viola a regra.
- `NOT_RUN`: a verificação não foi executada.
- `UNKNOWN`: resultado não conclusivo, resposta inválida ou fonte indisponível.
- `STALE`: a evidência existia, mas ultrapassou sua validade.

`STALE`, `UNKNOWN` e `NOT_RUN` nunca podem ser convertidos em `PASS`. Erro de coleta é estado da coleta e não prova, por si só, que o sistema de origem falhou.

### 4.2 Estados de interface

Cada painel independente deve suportar:
- **Initial/loading:** skeleton ou indicador de carregamento; não mostrar zero como placeholder.
- **Refreshing:** preservar dados anteriores claramente rotulados como última coleta, com indicador de atualização.
- **Success:** renderizar os dados reais e a proveniência.
- **Empty/not run:** informar que ainda não há evidência; não desenhar gráficos vazios como se fossem zero.
- **Partial/degraded:** renderizar as fontes disponíveis e marcar individualmente as indisponíveis.
- **Error:** mensagem segura, ação “Tentar novamente” e correlation/request ID quando disponível.
- **Stale:** mostrar última atualização e idade; impedir que a evidência satisfaça gates de release.
- **Unauthorized:** 401/403 com orientação para autenticar/solicitar acesso, sem detalhes protegidos.

Falha em uma integração não deve apagar os dados válidos das demais. Evitar spinner infinito: toda chamada deve terminar em sucesso, erro ou timeout controlado no cliente/servidor. O timeout é parâmetro operacional configurado, não métrica de saúde.

## 5. Indicadores e regras de derivação

| Indicador | Fonte primária | Regra de derivação | Quando não há prova |
|---|---|---|---|
| Estado do deployment | API da Vercel | Estado devolvido para o deployment identificado e ambiente explícito | `UNKNOWN` |
| Alinhamento Web/API | Vercel Web + API | Comparar SHA dos deployments de produção selecionados; regra de compatibilidade aprovada pode substituir igualdade exata | `UNKNOWN` |
| CI para release SHA | GitHub Actions | Run relevante deve corresponder ao SHA e workflow exigidos e ter conclusão `success` | `NOT_RUN` ou `UNKNOWN` |
| Segurança da role runtime | Workflow SQL read-only aprovado | Evidência válida deve reportar role restrita, `BYPASSRLS=false`, RLS/grants esperados e ambiente correspondente | `UNKNOWN` / `STALE` |
| API runtime | Endpoint IAM runtime | Status do check retornado pela API, com timestamp e commit | `UNKNOWN` |
| DB readiness | Endpoint runtime / probe autorizado | Resultado atual da verificação de conectividade/readiness; não inferir apenas pela existência do banco | `UNKNOWN` |
| Auth0/OIDC | Teste real no ambiente | Validação real de issuer, audience, JWKS e fluxo de token conforme contrato | `NOT_RUN` / `UNKNOWN` |
| Audit durability | Testes e verificação operacional | Evidência de escrita/leitura e política de retenção aprovada; não basta existir tabela | `NOT_RUN` / `UNKNOWN` |
| Readiness geral | Regras de release versionadas | `READY` somente se todos os gates obrigatórios estão válidos e `PASS`; caso contrário, `BLOCKED` ou `UNKNOWN` com motivos | Nunca assumir pronto |

### 5.1 Contagens e tendências

Contagens, séries temporais e percentuais só podem ser apresentados se a fonte disponibilizar eventos/observações com janela temporal definida. Definir explicitamente numerador, denominador, janela, deduplicação e timezone. Não estimar valores a partir de capturas parciais ou das últimas N execuções.

Não criar “uptime”, “MTTR”, “taxa de sucesso”, “usuários ativos”, “tenants ativos”, “cobertura” ou “score de segurança” sem telemetria, janela, fórmula, política de missing data e owner documentados. Na v1, preferir estados e links de evidência a gráficos agregados.

## 6. Contrato técnico sugerido

Reutilizar os tipos existentes em `packages/contracts/src/control-center.ts`; estender o contrato com revisão explícita em vez de duplicar tipos na UI. Modelo lógico mínimo:

```ts
type EvidenceStatus = "pass" | "fail" | "not_run" | "unknown" | "stale";

interface EvidenceEnvelope<T> {
  schemaVersion: "1";
  evidenceId: string;
  source: "github_actions" | "vercel" | "neon" | "iam_api" | "auth0";
  observedAt: string;          // ISO-8601 UTC
  validUntil?: string;         // ISO-8601 UTC; policy-driven
  environment: string;
  commitSha?: string;
  deploymentId?: string;
  runId?: string;
  status: EvidenceStatus;
  summary: string;             // sanitized, bounded
  sourceUrl?: string;
  correlationId?: string;
  payload: T;                  // allowlisted schema only
}
```

Este trecho é um contrato-alvo ilustrativo, não uma afirmação de que todos esses campos já existem no código. A implementação deve reconciliá-lo com os tipos atuais e preservar compatibilidade versionada. Valores de `source` devem corresponder apenas a integrações efetivamente implementadas; ausência de integração não cria uma evidência.

### 6.1 Endpoints propostos

Endpoints abaixo são propostas para implementação; não assumir que já existem:
- `GET /v1/tenants/:tenantId/control-center/overview`: snapshot agregado read-only e estados por fonte.
- `GET /v1/tenants/:tenantId/control-center/evidence`: lista paginada de referências de evidência, com filtros allowlisted.
- `GET /v1/tenants/:tenantId/control-center/evidence/:evidenceId`: detalhe redigido da evidência.
- `POST /v1/tenants/:tenantId/control-center/refresh`: opcional e só para operador autorizado; inicia coleta read-only, retorna ID de execução e não aguarda indefinidamente. Não executar workflows arbitrários nem mutações de infraestrutura.

Toda rota deve:
- validar Auth0/session/token e a permissão IAM específica no servidor;
- aplicar isolamento tenant-scoped/RLS conforme o contexto autenticado;
- validar query/body com schemas estritos e limites de paginação;
- gerar/propagar correlation ID;
- sanitizar respostas e logs;
- aplicar rate limit e timeout;
- falhar de modo fechado em erros de autorização;
- nunca aceitar URLs arbitrárias de origem fornecidas pelo utilizador (proteção SSRF);
- devolver status HTTP e envelope de erro consistente, sem stack trace nem erro bruto do provider.

Exemplo de envelope de erro:

```json
{
  "error": {
    "code": "EVIDENCE_SOURCE_UNAVAILABLE",
    "message": "Não foi possível consultar esta fonte.",
    "correlationId": "request-correlation-id"
  }
}
```

O correlation ID do exemplo é ilustrativo, não um ID de execução real.

### 6.2 Camadas

1. **UI:** componentes de estado e proveniência; sem chaves de provedor, lógica de autorização autoritativa ou chamadas diretas a provedores privilegiados.
2. **API/aggregator:** valida permissões, consulta conectores allowlisted, normaliza dados e calcula estados.
3. **Adapters:** clientes tipados para GitHub Actions, Vercel e workflow aprovado de Neon; erros mapeados para códigos sanitizados.
4. **Evidence store:** persistir referências, metadados mínimos e hash de artefato quando real; nunca persistir tokens ou logs brutos por padrão.
5. **Policy engine:** regras de validade e gates versionados por ambiente/release. Alterações de policy passam por revisão e testes.

Evitar chamadas de rede independentes diretamente do browser para GitHub/Vercel/Neon. Não adicionar credenciais de provedor ao bundle client-side.

## 7. Frescor, cache e consistência

- Cada fonte define seu próprio `validUntil` por política documentada; não usar um único TTL arbitrário para todas.
- Evidência expirada deve ser `STALE`, mesmo que o último valor fosse `PASS`.
- Cache pode melhorar latência, mas a UI deve distinguir “última evidência conhecida” de “estado atual verificado”.
- Não comparar dados de ambientes diferentes como se fossem uma mesma release.
- Comparação Web/API deve usar deployments explicitamente selecionados e registrados, não apenas “o último item da lista” sem confirmação de target e branch.
- Falha parcial de provider deve preservar proveniência e timestamp das fontes que responderam.

## 8. Segurança e privacidade

- Menor privilégio e credenciais server-side limitadas a leitura quando possível.
- Usar a role de runtime restrita; não usar `iam_owner` nem a role legada privilegiada para requisições da aplicação.
- Não exibir nem logar connection strings, tokens, secrets, raw claims, payloads de autenticação ou erros não redigidos.
- Aplicar redaction por allowlist, não por tentativa de substituir alguns padrões em strings arbitrárias.
- Não confiar em `tenantId`, papel ou permissões enviados pelo cliente.
- Evidência de um tenant não pode ser consultada por outro tenant sem autorização explícita.
- Retenção de evidências e audit logs deve ser configurada e documentada; não inventar período de retenção.
- Todas as operações de refresh devem ter autorização, rate limit e audit trail; sem ações destrutivas na v1.

## 9. Testes e critérios de aceitação

### Funcionais
- Todos os indicadores exibem fonte, timestamp e regra de derivação.
- O painel mostra dados reais e links para as fontes.
- O Web/API SHA mismatch é exibido como divergência ou unknown conforme a evidência disponível.
- Deploy READY não é rotulado automaticamente como aplicação saudável.
- A ausência de integração Auth0/Clarim ou de workflow produz estado explícito, nunca números inventados.
- Loading, refresh, erro, parcial, vazio, stale e unauthorized são testados.
- Falha de uma fonte não oculta evidência válida de outra.

### Segurança
- Requests sem sessão/token válido retornam 401.
- Requests sem permissão IAM retornam 403.
- Tentativas cross-tenant são negadas e cobertas por teste.
- Payloads de providers malformados e erros brutos são sanitizados.
- Segredos não aparecem em resposta, logs, snapshots, artefatos ou screenshots de teste.
- URLs arbitrárias não podem ser usadas para provocar fetch server-side.
- A coleta read-only não executa SQL writes, deploys, workflow dispatch arbitrário nem alterações de configuração.

### Evidência e integridade
- `PASS` exige resultado positivo explícito, fonte autorizada, ambiente/commit correspondente e validade.
- `FAIL`, `NOT_RUN`, `UNKNOWN` e `STALE` permanecem distintos.
- Run de CI de SHA diferente não valida o release SHA atual.
- Um workflow de segurança valida apenas a conexão, ambiente e SHA que efetivamente testou; não prova automaticamente todas as instâncias.
- Testes unitários cobrem regras de derivação; integração cobre autorização, isolamento e sanitização.
- Toda nova métrica exige fonte, fórmula, janela temporal, missing-data policy, testes e owner documentados.

## 10. Fases de entrega

1. **Fase A — contratos e estados:** consolidar tipos existentes, schemas, enums e regras de validade.
2. **Fase B — runtime diagnostics:** conectar a rota já existente e implementar UI para loading/error/partial/stale/unauthorized.
3. **Fase C — GitHub/Vercel read-only:** consumir runs/deployments reais e reconciliar SHA/ambiente.
4. **Fase D — Neon security evidence:** consumir resultado do workflow aprovado, mantendo explícito o escopo de cada verificação.
5. **Fase E — gates de release:** policy versionada para readiness; nenhum gate obrigatório desconhecido pode passar.
6. **Fase F — Auth0/OIDC e audit:** adicionar apenas depois de testes reais no ambiente-alvo.
7. **Fora do escopo v1:** CRUD administrativo, alterações de RBAC, criação/exclusão de tenants, alteração de banco, deploy/rollback e integração Clarim sem contrato confirmado.

## 11. Fatos atuais que a implementação deve preservar

As verificações de descoberta disponíveis indicam:
- os projetos Vercel Web e API existem;
- foram observados deployments de produção READY em commits diferentes, o que exige checagem de compatibilidade;
- o workflow de segurança runtime em produção passou para a conexão que usou `iam_app_runtime`, mas isso não prova o papel usado por cada instância da API;
- a role legada `iam_runtime` foi observada com privilégios elevados e precisa de revisão separada;
- Auth0 SDK/documentação existem, mas a configuração real de tenant/issuer/audience/JWKS não foi comprovada pela descoberta;
- a integração Clarim não foi confirmada;
- a tabela `permissions` foi verificada como referência global com colunas `id`, `permission_key`, `description`, `created_at`, sem `tenant_id`, e runtime SELECT-only; manter teste de regressão para detectar deriva de schema.

Estes fatos são evidências com escopo e data, não um estado permanente. A UI deve consultar fontes atuais antes de os apresentar como estado presente.

## 12. Definição de pronto

A v1 só pode ser considerada pronta quando:
- cada indicador visível tem uma fonte real, fórmula/regra e timestamp;
- nenhum estado ausente/antigo é promovido a `PASS`;
- todos os estados de UI e os cenários RBAC/cross-tenant são testados;
- conectores falham de forma isolada e segura;
- SHA/ambiente dos dados são preservados;
- não há secrets em respostas/logs;
- a policy de readiness é revisada;
- CI passa para o commit candidato;
- os bloqueios de release continuam visíveis até serem resolvidos com evidência atual.

**Regra final:** se a fonte não comprova um número ou estado, mostrar “não verificado”, “não executado” ou “indisponível” — nunca preencher a lacuna com uma métrica fictícia.
