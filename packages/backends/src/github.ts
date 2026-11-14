import type { ReleaseAsset } from './types.js';

const API = 'https://api.github.com';

interface GithubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface GithubRelease {
  tag_name: string;
  assets: GithubAsset[];
}

function headers(token?: string): Record<string, string> {
  const result: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'ptt-backend-installer',
  };
  if (token) result.authorization = `Bearer ${token}`;
  return result;
}

export async function fetchReleases(
  repo: string,
  options: { token?: string; perPage?: number } = {},
): Promise<GithubRelease[]> {
  const perPage = options.perPage ?? 10;
  const response = await fetch(`${API}/repos/${repo}/releases?per_page=${perPage}`, {
    headers: headers(options.token),
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${repo}`);
  return response.json() as Promise<GithubRelease[]>;
}

export async function fetchReleaseByTag(
  repo: string,
  tag: string,
  options: { token?: string } = {},
): Promise<GithubRelease> {
  const response = await fetch(`${API}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, {
    headers: headers(options.token),
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${repo}@${tag}`);
  return response.json() as Promise<GithubRelease>;
}

export function toAssets(release: GithubRelease): ReleaseAsset[] {
  return release.assets.map((asset) => ({
    name: asset.name,
    url: asset.browser_download_url,
    size: asset.size,
  }));
}
