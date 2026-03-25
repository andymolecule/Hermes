interface ExactCountResponse {
  count: number | null;
  error: { message: string } | null;
}

export async function executeExactCount(
  request: PromiseLike<ExactCountResponse>,
  failureMessage: string,
) {
  const { count, error } = await request;
  if (error) {
    throw new Error(`${failureMessage}: ${error.message}`);
  }
  return count ?? 0;
}
