import { NextResponse } from "next/server";
import { auth0 } from "../../../../lib/auth0";

const repository = "alexoaraujo83/iam-platform";

function result(status: number, body: unknown) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

async function githubJson(path: string, headers: HeadersInit) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) throw new Error(`github_http_${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

export async function GET() {
  const session = await auth0.getSession();
  if (!session) return result(401, { ok: false, outcome: "login_required" });

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const branch = process.env.VERCEL_GIT_COMMIT_REF?.trim() || "main";

  try {
    const runsPayload = await githubJson(
      `/repos/${repository}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=5`,
      headers,
    );
    const runs = Array.isArray(runsPayload.workflow_runs)
      ? runsPayload.workflow_runs as Array<Record<string, unknown>>
      : [];
    const latest = runs[0];

    if (!latest || typeof latest.id !== "number") {
      return result(200, {
        ok: true,
        branch,
        workflow: null,
        tests: [],
        deployments: [],
        evidence: [],
        outcome: "no_workflow_runs_found",
      });
    }

    const sha = typeof latest.head_sha === "string" ? latest.head_sha : "";
    const [jobsPayload, statusPayload] = await Promise.all([
      githubJson(`/repos/${repository}/actions/runs/${latest.id}/jobs?per_page=100`, headers).catch(() => ({} as Record<string, unknown>)),
      sha ? githubJson(`/repos/${repository}/commits/${encodeURIComponent(sha)}/status`, headers).catch(() => ({})) : Promise.resolve({} as Record<string, unknown>),
    ]);

    const jobs = Array.isArray(jobsPayload.jobs)
      ? jobsPayload.jobs as Array<Record<string, unknown>>
      : [];
    const tests = jobs.flatMap((job) => {
      const steps = Array.isArray(job.steps) ? job.steps as Array<Record<string, unknown>> : [];
      return steps
        .filter((step) => typeof step.name === "string" && /^(test|typecheck|lint|build|audit|scan checked-out source)/i.test(step.name as string))
        .map((step) => ({
          name: step.name,
          status: typeof step.status === "string" ? step.status : "unknown",
          conclusion: typeof step.conclusion === "string" ? step.conclusion : null,
        }));
    });

    const statuses = Array.isArray(statusPayload.statuses)
      ? statusPayload.statuses as Array<Record<string, unknown>>
      : [];
    const deployments = statuses
      .filter((item) => typeof item.context === "string" && /vercel/i.test(item.context as string))
      .map((item) => ({
        context: item.context,
        state: item.state,
        description: item.description ?? null,
        target_url: typeof item.target_url === "string" ? item.target_url : null,
        updated_at: item.updated_at ?? null,
      }));

    const workflow = {
      name: typeof latest.name === "string" ? latest.name : "GitHub Actions",
      status: typeof latest.status === "string" ? latest.status : "unknown",
      conclusion: typeof latest.conclusion === "string" ? latest.conclusion : null,
      html_url: typeof latest.html_url === "string" ? latest.html_url : null,
      head_sha: sha || null,
      head_branch: typeof latest.head_branch === "string" ? latest.head_branch : branch,
      created_at: typeof latest.created_at === "string" ? latest.created_at : null,
      updated_at: typeof latest.updated_at === "string" ? latest.updated_at : null,
    };

    return result(200, {
      ok: true,
      branch,
      workflow,
      tests,
      deployments,
      evidence: [
        ...(workflow.html_url ? [{ label: "GitHub Actions run", url: workflow.html_url, conclusion: workflow.conclusion ?? workflow.status }] : []),
        ...deployments.filter((item) => item.target_url).map((item) => ({
          label: typeof item.context === "string" ? item.context : "Vercel status",
          url: item.target_url,
          conclusion: typeof item.state === "string" ? item.state : "unknown",
        })),
      ],
      vercelApiTokenConfigured: Boolean(process.env.VERCEL_TOKEN?.trim()),
      outcome: "telemetry_loaded",
    });
  } catch {
    return result(200, {
      ok: false,
      branch,
      workflow: null,
      tests: [],
      deployments: [],
      evidence: [],
      outcome: "github_telemetry_unavailable",
    });
  }
}
