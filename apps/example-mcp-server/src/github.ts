const MAX_GITHUB_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface GitHubCommitQuery {
  owner: string;
  repo: string;
  sha?: string;
  author?: string;
  since?: string;
  until?: string;
  page: number;
  perPage: number;
}

export async function listGitHubCommits(
  input: GitHubCommitQuery,
  request: typeof fetch = fetch,
): Promise<unknown[]> {
  const url = new URL(
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/commits`,
    "https://api.github.com",
  );
  if (input.sha) url.searchParams.set("sha", input.sha);
  if (input.author) url.searchParams.set("author", input.author);
  if (input.since) url.searchParams.set("since", input.since);
  if (input.until) url.searchParams.set("until", input.until);
  url.searchParams.set("page", String(input.page));
  url.searchParams.set("per_page", String(input.perPage));
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "tasklattice-example-mcp",
    "x-github-api-version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await request(url, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_GITHUB_RESPONSE_BYTES) {
    throw new Error("GitHub commit response exceeded the 2 MiB limit.");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_GITHUB_RESPONSE_BYTES) {
    throw new Error("GitHub commit response exceeded the 2 MiB limit.");
  }
  if (!response.ok) {
    throw new Error(`GitHub list commits returned HTTP ${response.status}.`);
  }
  const payload = JSON.parse(text) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error("GitHub list commits returned an invalid payload.");
  }
  return payload;
}
