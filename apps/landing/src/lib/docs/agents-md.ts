/**
 * `/agents.md` — how to drive Nixploy as an agent.
 *
 * Deliberately opinionated about what *not* to do: the failure mode for an
 * agent on a PaaS is not that it cannot find a tool, it is that it stops
 * production while investigating, or redeploys three times because it was
 * polling a list instead of waiting for an outcome.
 */
export const AGENTS_MD = `# Driving Nixploy as an agent

Nixploy is a self-hosted PaaS. An agent can read its state, deploy, and
diagnose failures. Every surface below dispatches through the same routers, so
the organization scope, the capability checks and the audit trail apply to all
of them equally — there is no back door, and nothing an agent can reach that a
human with the same API key could not.

## Connect

**MCP (preferred).** Streamable HTTP at \`https://<your-panel>/api/mcp\`, with
your API key in an \`x-api-key\` header.

\`\`\`json
{
  "mcpServers": {
    "nixploy": {
      "type": "http",
      "url": "https://panel.example.com/api/mcp",
      "headers": { "x-api-key": "nxp_..." }
    }
  }
}
\`\`\`

**REST.** \`GET|POST https://<your-panel>/api/<router>.<procedure>\`, same
header. The OpenAPI document is at \`/api/openapi.json\` and Swagger at
\`/swagger\`.

**CLI.** \`npm i -g @nixploy/cli\`, then
\`nixploy auth login --url https://panel.example.com --api-key nxp_...\`. Every
command takes \`--json\`.

## The four tools worth knowing first

Most of what an agent wants is one call, not a loop:

- \`get_service_runtime_summary\` — status, Swarm task counts, domains, the last
  deployments and the last timeline events. Start here.
- \`get_service_events\` — the answer to *why did it restart?*: tasks that died,
  out-of-memory kills, drift corrected outside Nixploy, and config changes with
  who made them. The deployment list only knows about deploys.
- \`deploy_and_wait\` — deploy and block until it finishes, returning the
  failing pipeline step, the log tail, the URLs and the live task counts. Use
  this instead of \`deploy_service\` plus polling. It waits up to 55 s; if
  \`done\` is false, call it again with the same \`deploymentId\`.
- \`explain_last_failure\` — the most recent failed deployment of a service,
  with Deploy Copilot's diagnosis when Copilot is configured.

## Read the annotations

Every tool carries \`readOnlyHint\`, \`destructiveHint\` and \`idempotentHint\`.
They are declared by hand, not inferred from names, and they mean what they
say:

- \`readOnlyHint: true\` — safe to call while investigating.
- \`destructiveHint: true\` — interrupts service or removes something
  (\`stop_service\`, \`remove_domain\`, \`rollback_deployment\`,
  \`cancel_deployment\`). Ask a human first.
- \`idempotentHint: false\` — calling twice does it twice. \`deploy_service\`
  queues a second build; a retry after a timeout is not free.

## Rules of engagement

1. **Diagnose before you change anything.** The timeline and the runtime
   summary answer most questions without touching the service.
2. **Never stop, roll back or cancel without being asked.** All three are
   marked destructive precisely so you do not have to guess.
3. **A timeout is not a failure.** If \`deploy_and_wait\` returns with
   \`done: false\`, the deploy is still running. Wait again on the same id —
   deploying again queues a second build that fights the first for the queue.
4. **Quote your evidence.** Give the event or log line and its timestamp. A
   confident wrong diagnosis costs an operator more than "I cannot tell from
   this log".
5. **Secrets do not come back out.** Environment values are encrypted at rest
   and redacted on read; \`get_env\` returns keys. Do not ask an operator to
   paste a token into a chat to work around that.

## Prompts

The MCP server ships two: \`troubleshoot_service\` and
\`explain_failed_deploy\`. Both are investigation plans, in the order that
answers fastest.

## Resources

- \`nixploy://service/{applicationId}\` — a service's current state as JSON.
- \`nixploy://deployment/{deploymentId}/log\` — a build log, truncated to its
  tail.

## Further reading

- <https://nixploy.com/llms.txt> — the documentation index
- <https://nixploy.com/llms-full.txt> — all of it in one file
- <https://nixploy.com/api> — the API catalog
`;
