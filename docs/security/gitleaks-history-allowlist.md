# Gitleaks: histórico de credenciais revogadas

Este allowlist cobre somente quatro fingerprints históricos detectados pelo scan Git completo em 2026-10-22. Os valores não são reproduzidos neste documento.

| Commit | Arquivo/linha | Regra | Disposição |
|---|---|---|---|
| `029ab4e0019ab4b668f6eda5f70360a55cd23b82` | `.github/workflows/ci.yml:38` | `generic-api-key` | Credencial Auth0 histórica; consta como rotacionada na remediação de segurança anterior. |
| `73ece95b287dec652bc5bc06958e07b68a31fbe2` | `.env.local:3` | `generic-api-key` | Client ID Auth0 histórico; mantido no histórico Git, não deve ser reutilizado. |
| `73ece95b287dec652bc5bc06958e07b68a31fbe2` | `.env.local:4` | `generic-api-key` | Client secret Auth0 histórico; consta como rotacionado na remediação de segurança anterior. |
| `73ece95b287dec652bc5bc06958e07b68a31fbe2` | `.env.local:5` | `generic-api-key` | Segredo de sessão Auth0 histórico; consta como rotacionado na remediação de segurança anterior. |

## Escopo e controles

- `.gitleaksignore` usa fingerprints exatos (commit, arquivo, regra e linha), não regra global, regex ou caminho inteiro.
- O scan do checkout atual continua obrigatório e não usa estes fingerprints históricos para ignorar novos valores em novos commits.
- O scan de histórico continua ativo; qualquer ocorrência nova tem fingerprint diferente e falha o gate.
- Não registrar valores, hashes dos segredos ou trechos de linha em CI.
- Se qualquer uma das credenciais antigas voltar a ser aceita pelo provedor, reabrir a remediação e revogar imediatamente; o allowlist não é evidência de validade/revogação do provedor.
