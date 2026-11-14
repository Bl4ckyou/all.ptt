const API = 'https://api.github.com';

function headers(token) {
  const result = {
    accept: 'application/vnd.github+json',
    'user-agent': 'ptt-backend-installer',
  };
  if (token) result.authorization = `Bearer ${token}`;
  return result;
}

export async function fetchReleases(repo, { token, perPage = 10 } = {}) {
  const response = await fetch(`${API}/repos/${repo}/releases?per_page=${perPage}`, {
    headers: headers(token),
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${repo}`);
  return response.json();
}

export async function fetchReleaseByTag(repo, tag, { token } = {}) {
  const response = await fetch(`${API}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, {
    headers: headers(token),
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${repo}@${tag}`);
  return response.json();
}

export function toAssets(release) {
  return (release.assets ?? []).map((asset) => ({
    name: asset.name,
    url: asset.browser_download_url,
    size: asset.size,
  }));
}
