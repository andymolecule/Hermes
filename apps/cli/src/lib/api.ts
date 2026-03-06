export async function fetchApiJson<T>(pathname: string): Promise<T> {
  const apiUrl = process.env.HERMES_API_URL;
  if (!apiUrl) {
    throw new Error("HERMES_API_URL is required for API requests.");
  }

  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}${normalizedPath}`);
  if (!response.ok) {
    throw new Error(`API request failed (${response.status}): ${await response.text()}`);
  }

  return (await response.json()) as T;
}
