# Provedor de referência Auth0 (OIDC)

Status: especificação de configuração do provedor de referência para IAM Platform. O adaptador e o contrato de CI continuam independentes de fornecedor. Este documento não comprova que um tenant Auth0 já tenha sido criado ou configurado.

## Decisão e limites do plano gratuito (verificado em 2026-10-12)

Usar um **tenant Auth0 dedicado ao IAM Platform**, separado do tenant do TMS, para que registros de aplicações, callbacks, usuários de teste, Organizations, Actions e segredos não acoplem os projetos.

O plano gratuito do Auth0 lista aplicações/APIs compatíveis com OIDC, até 25.000 usuários ativos mensais e até **5 Organizations**. Contudo, a página pública de preços não inclui os fatores de MFA de Pro/Enterprise no plano gratuito; fatores listados para planos pagos não devem ser considerados disponíveis após o fim de um período de avaliação. Portanto:

- O plano gratuito é aceitável para login/validação de tokens OIDC e um fluxo de referência de Organization, dentro do limite de cinco.
- Não afirmar nem exigir MFA aplicado pelo Auth0 no plano gratuito. Se MFA for requisito de release, usar um plano que inclua explicitamente o fator necessário ou implementar e verificar independentemente outro recurso de MFA. Não simular MFA confiando em uma declaração do cliente.
- Organizations no plano gratuito servem apenas para roteamento/integração inicial. O IAM Platform continua sendo a autoridade para associação ao tenant, RBAC/ABAC, avaliação de políticas e auditoria.
- Evitar validar domínio personalizado se isso exigir cartão de crédito; usar o domínio padrão do Auth0.
- Conferir o painel e os preços oficiais antes de depender de cotas ou recursos. Um controle visível durante a avaliação não prova que o recurso continuará disponível no plano gratuito.

## Criar a configuração de referência

Criar um **tenant novo** no painel Auth0 com nome exclusivo disponível para IAM Platform. Não reutilizar o tenant do TMS nem colocar credenciais no GitHub. Usar a região/domínio reais exibidos pelo Auth0; não presumir o domínio com base neste documento.

1. Registrar o domínio e o emissor exato (`https://<dominio-do-tenant>/`) na configuração privada da implantação.
2. Criar uma API/servidor de recursos chamado “IAM Platform API”. Definir um identificador de audiência estável e específico do ambiente (por exemplo, `https://iam-platform-api-dev` no desenvolvimento). Usar exatamente esse identificador em `OIDC_AUDIENCE`.
3. Criar uma aplicação Regular Web Application para o cliente web. Começar apenas com URLs locais durante o desenvolvimento; adicionar callbacks, logout e origens reais somente quando as URLs implantadas forem conhecidas. Nunca usar curingas em callbacks ou origens.
4. Manter o cliente web e o servidor de recursos da API separados. Configurar a API para emitir tokens de acesso JWT para sua audiência; a API valida o token de acesso, não um ID token.
5. Usar Universal Login e uma conexão de banco/passkey/social permitida conforme apropriado. Não incluir segredos em SPA pública. Guardar qualquer segredo de cliente confidencial somente no gerenciador de segredos do servidor.
6. Para o teste básico no plano gratuito, criar uma Organization de teste (dentro do limite de cinco) e um usuário de teste. Tratar `org_id` somente como contexto de roteamento; vincular a identidade verificada (iss, sub) a uma associação interna por meio de fluxo IAM auditável.
7. Manter credenciais de administração do tenant e da Management API fora da configuração normal de runtime. O CI não deve depender de um cliente amplo da Management API, salvo se uma automação separada, com privilégio mínimo, for aprovada deliberadamente.

## Configuração de runtime

Usar segredos/configuração de implantação confiáveis, nunca parâmetros da requisição ou declarações de token não verificadas:

~~~dotenv
OIDC_ISSUER=https://<dominio-real-do-tenant>/
OIDC_AUDIENCE=<identificador-exato-da-api-neste-ambiente>
OIDC_JWKS_URI=https://<dominio-real-do-tenant>/.well-known/jwks.json
OIDC_ALLOWED_ALGORITHMS=RS256
~~~

Os valores entre sinais angulares são marcadores e devem ser substituídos pelos valores reais do painel. Desenvolvimento, homologação e produção devem ter configuração explícita por ambiente. Nunca colocar segredos de cliente, tokens da Management API, material de assinatura ou tokens reais neste arquivo ou no controle de versão.

## Contrato de verificação

O adaptador deve validar assinatura usando o JWKS configurado, emissor exato, audiência esperada da API, expiração, declarações obrigatórias e lista fixa de algoritmos assimétricos. Deve falhar de forma segura diante de tokens malformados/expirados, divergência de emissor/audiência, JWKS indisponível ou configuração inválida. Cache/rotação de JWKS e falhas remotas precisam de testes de integração do provedor; testes unitários devem usar chaves locais geradas e não exigir conta Auth0 nem rede.

Após validar o token, mapear (iss, sub) para uma identidade interna e resolver associação ativa e permissões no PostgreSQL dentro da transação que define o contexto RLS local do tenant. Nunca aceitar associação ou permissões apenas com base nas declarações do token. Nunca usar e-mail como chave estável de identidade.

## MFA, Organizations e políticas de acesso

- Segundo a comparação pública atual, o plano gratuito não é base válida para exigir MFA aplicado pelo Auth0. Comportamentos disponíveis apenas durante a avaliação devem ser considerados indisponíveis após a migração para o plano gratuito.
- Até que um mecanismo MFA com evidência verificável de garantia esteja configurado e testado, operações sensíveis que exijam MFA devem ser negadas ou permanecer explicitamente fora do escopo; não alegar proteção por MFA.
- Manter decisões de política aplicáveis pelo IAM Platform mesmo se MFA, Organizations, RBAC ou Actions do Auth0 não estiverem disponíveis.
- Não presumir que um token de acesso OIDC genérico prova que houve MFA. Quando um fluxo MFA compatível for habilitado, definir requisitos de elevação de autenticação no servidor e testar que garantia ausente/insuficiente resulta em negação.
- O contexto de login de Organization é entrada para roteamento de identidade, não o banco canônico de tenants. Vincular identidade externa verificada a um tenant por fluxo de associação explícito e auditável.
- Não depender de RBAC por organização, proteção avançada contra ataques, transmissão de logs de auditoria ou outros recursos pagos sem confirmar disponibilidade e custo.

## Matriz de testes independente de provedor

A suíte normal de CI não deve chamar Auth0 nem exigir credenciais do provedor. Deve cobrir adulteração de assinatura, emissor/audiência inválidos, expiração, declarações ausentes, algoritmos não suportados, sujeito vazio, identidade desconhecida, associação ausente/inativa, permissão ausente, negação entre tenants e falhas de provedor/JWKS com falha segura. Uma suíte separada e opcional de smoke/integration pode usar tenant Auth0 de teste dedicado e credenciais de curta duração fornecidas por secrets do CI. Não tornar chamadas externas bem-sucedidas pré-requisito para testes unitários locais.

Uma segunda implementação OIDC (por exemplo, realm de teste Keycloak local) deverá executar o mesmo contrato de testes para detectar suposições específicas do Auth0.

## Lista de evidências

Registrar os itens aplicáveis no registro de evidências de implantação/release. Não marcar a integração como operacional até que sejam comprovados:

- [ ] Tenant Auth0 dedicado ao IAM Platform criado; domínio, região e emissor reais registrados.
- [ ] Servidor de recursos/API criado; audiência exata registrada.
- [ ] Listas permitidas de callback/logout/origem contêm apenas URLs exatas necessárias.
- [ ] Configuração pública não contém segredos; credenciais confidenciais ficam fora do controle de versão.
- [ ] URL JWKS responde e um token de acesso real tem emissor e audiência esperados.
- [ ] Token válido funciona; assinatura, emissor, audiência, expiração e sujeito inválidos falham de forma segura.
- [ ] Identidade desconhecida, associação ausente/inativa, permissão ausente e acesso entre tenants são negados.
- [ ] Organizations foi testado dentro do limite gratuito; o banco IAM continua canônico.
- [ ] Disponibilidade de MFA foi registrada explicitamente. Se indisponível no plano gratuito, nenhuma operação é apresentada como verificada por MFA.
- [ ] Teste de implantação foi registrado separadamente das evidências unitárias/CI.

## Referências

- [Preços Auth0 (oficial)](https://auth0.com/pt/pricing)
- [Política de limites de entidades Auth0](https://auth0.com/docs/troubleshoot/customer-support/operational-policies/entity-limit-policy)
- [Configurar Organizations no Auth0](https://auth0.com/docs/manage-users/organizations/create-first-organization)
- [Documentação de MFA do Auth0](https://auth0.com/docs/secure/multi-factor-authentication)
