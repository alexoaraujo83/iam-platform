# IAM Control Center — Plano de Reconstrução

**Estado:** baseline inicial; implementação e validação operacional ainda pendentes.
**Branch:** `rebuild/iam-control-center-baseline`
**Base inspecionada:** `main` em `58926e8a952ed353a48353d9fc768b2291637dce`
**Repositório canônico atual:** `alexoaraujo83/iam-platform`

## 1. Decisão de reconstrução

Não apagar nem substituir o repositório atual. O código existente contém contratos IAM, verificação OIDC/JWT, avaliação RBAC, banco/RLS, API HTTP inicial, testes e documentação de segurança. A reconstrução deve reutilizar componentes somente após revisão e evidência; não é uma reescrita cega nem uma declaração de que a aplicação já está funcional.

A interface administrativa do Control Center ainda é um item pendente conforme o README da base inspecionada. A API e o banco também não devem ser tratados como operacionalmente comprovados só porque existem testes ou deploys.

## 2. Baseline conhecido

| Área | Estado inicial conhecido | Próxima verificação |
|---|---|---|
| Repositório | `main` existe; histórico deve ser preservado | confirmar HEAD, PRs abertos, CI no SHA atual |
| Monorepo | pnpm 12.12.1; Node >=24 | instalação frozen, scripts e lockfile |
| Contratos | `packages/contracts` | validar contratos usados pela UI e API |
| Identidade | `packages/identity`, OIDC/JWT | testes negativos e E2E com Auth0 real |
| Autorização | `packages/authorization`, negação por padrão | provar permissões no servidor |
| Banco | `packages/database`, migrations e RLS | aplicar em DB descartável, grants efetivos, isolamento e rollback |
| API | `apps/api` com health e contexto de tenant | integração real API + Auth0 + Neon |
| Web | `apps/web` | avaliar estrutura e recuperar a UI Control Center sem duplicar rotas |
| Auditoria | primitives e migration append-only existentes | provar integração nos fluxos sensíveis e leitura/escrita por runtime |
| GitHub Actions | CI e workflows de segurança/Neon existentes | executar/revisar no SHA da branch e classificar cada falha |
| Vercel | projetos Web/API previamente existentes | verificar deploy e limites atuais sem bypass nem alteração de SSO |
| Auth0 | configuração de referência existente | login/callback/sessão/logout e falhas com usuário de Preview |
| Produção | não presumir prontidão | não executar migrations nem ativar produção sem aprovação e evidências |

## 3. Arquitetura-alvo do Control Center

- **Web:** Next.js/React, interface administrativa responsiva, estados de carregamento/erro/vazio e acessibilidade.
- **API:** contratos de domínio independentes de provedor; autenticação OIDC no servidor.
- **Persistência:** PostgreSQL/Neon; identidade externa representada por `(iss, sub)`, memberships e permissões respaldadas no banco.
- **Autorização:** negar por padrão; verificar membership ativa e permissão no servidor; tenant nunca confiado apenas por claim recebido.
- **Isolamento:** transação com contexto de tenant e RLS como defesa adicional; runtime sem superuser e sem `BYPASSRLS`.
- **Auditoria:** eventos append-only para operações sensíveis; não registrar tokens nem segredos.
- **Operação:** health/readiness, diagnósticos sanitizados, logs sem segredos e evidência ligada ao SHA/ambiente.

## 4. Ordem obrigatória de execução

1. **MASTER CONTROLLER:** confirmar HEAD, branches, PRs, Issues, checks e bloqueios atuais.
2. **INVENTÁRIO:** mapear rotas Web/API, packages, scripts, migrations, workflows, ambientes e integrações.
3. **EVIDENCE LEDGER:** registrar cada controle como E0–E4, com link/execução/SHA/ambiente.
4. **ANÁLISE:** rastrear cada recurso ponta a ponta: requisito → UI → API → autorização → banco → teste → deploy.
5. **CLASSIFICAÇÃO:** priorizar P0–P3 e separar defeitos de código de bloqueios externos.
6. **CORREÇÃO:** mudanças pequenas e isoladas; não rebasear branches divergentes automaticamente.
7. **TESTES:** lint, typecheck, testes unitários, integração PostgreSQL/RLS, testes de autorização e E2E real.
8. **REVISÃO:** revisar diff, dependências, segurança, compatibilidade e regressões.
9. **DEPLOY PREVIEW:** manter SSO da Vercel; nunca contornar limites ou marcar redirect de proteção como sucesso.
10. **PRÓXIMO BLOQUEIO:** avançar apenas com evidência atual e registrar o que ainda depende de intervenção humana.

## 5. Gates de segurança

- Nenhum token, segredo ou credencial real em arquivos, logs ou evidências.
- Nenhum grant de tenant, membership ou role automático durante criação de identidade.
- Nenhuma migration em produção antes de revisão, teste isolado, rollback e aprovação.
- Nenhum merge/Ready for Review enquanto faltarem gates exigidos.
- CI aprovado em SHA antigo não comprova o SHA atual.
- Configuração existente não comprova integração; deploy existente não comprova operação.
- Bloqueios externos devem ser descritos com status e evidência; não mascarar como PASS.

## 6. Critérios de aceite do Control Center

1. UI permite navegar pelos recursos realmente implementados e apresenta estados de erro de forma segura.
2. Login, callback, sessão e logout funcionam com Auth0 real em Preview.
3. API rejeita token ausente/inválido/expirado e falha de provedor de forma sanitizada.
4. Membership ausente, permissão ausente e tenant cruzado são negados.
5. RLS e grants efetivos são comprovados com a identidade de runtime real.
6. Auditoria durável é comprovada nos fluxos sensíveis selecionados.
7. CI e build passam no SHA candidato.
8. Preview é validado sem desativar SSO ou contornar limites.
9. Documentação e Evidence Ledger correspondem ao estado observado.
10. Produção permanece bloqueada até aprovação de todos os gates de release.

## 7. Primeiro trabalho executável

- Atualizar o inventário a partir do HEAD real e dos PRs/checks atuais.
- Inspecionar a rota Web do Control Center e sua integração com a API; preservar a implementação correta.
- Produzir matriz requisito–componente–teste–evidência.
- Corrigir primeiro os bloqueios P0/P1 reproduzíveis.
- Não afirmar que o projeto foi reconstruído ou está funcional até que os gates acima sejam comprovados.
