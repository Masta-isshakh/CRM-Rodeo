import { fetchAuthSession } from "aws-amplify/auth";

export async function getUserGroups(): Promise<string[]> {
  const session = await fetchAuthSession();
  const payload = session.tokens?.accessToken?.payload as any;
  const groups = payload?.["cognito:groups"];
  if (Array.isArray(groups)) return groups;
  return [];
}
