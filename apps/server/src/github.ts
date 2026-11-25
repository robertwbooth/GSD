export interface GitHubConfig {
  token: string;
  /** "owner/repo" */
  repo: string;
  apiBase?: string;
}

export interface IssueInput {
  title: string;
  body: string;
  labels: string[];
}

export async function createIssue(cfg: GitHubConfig, issue: IssueInput, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(`${cfg.apiBase ?? "https://api.github.com"}/repos/${cfg.repo}/issues`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "gsd-feedback",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify(issue),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { number: number; html_url: string };
  return { number: json.number, url: json.html_url };
}
