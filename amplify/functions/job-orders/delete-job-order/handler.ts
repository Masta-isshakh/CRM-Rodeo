import type { Schema } from "../../../data/resource";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

type Handler = (event: any) => Promise<any>;

const ADMIN_GROUP = "Admins";
const POLICY_KEY = "JOB_CARDS";

function safeJsonParse<T>(raw: unknown): T | null {
  try {
    if (raw == null) return null;
    if (typeof raw === "string") {
      const s = raw.trim();
      if (!s) return null;
      return JSON.parse(s) as T;
    }
    return raw as T;
  } catch {
    return null;
  }
}

function normalizeGroupsFromClaims(claims: any): string[] {
  const g = claims?.["cognito:groups"];
  if (!g) return [];
  if (Array.isArray(g)) return g.map(String);
  const parsed = safeJsonParse<any>(g);
  if (Array.isArray(parsed)) return parsed.map(String);
  return String(g)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

type EffectivePerms = { canRead: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean; canApprove: boolean };

function emptyPerms(): EffectivePerms {
  return { canRead: false, canCreate: false, canUpdate: false, canDelete: false, canApprove: false };
}

async function resolvePermissions(dataClient: ReturnType<typeof generateClient<Schema>>, groups: string[]): Promise<EffectivePerms> {
  const perms = emptyPerms();
  const normGroups = (groups ?? []).map((x) => String(x || "").trim()).filter(Boolean);
  if (normGroups.includes(ADMIN_GROUP)) {
    return { canRead: true, canCreate: true, canUpdate: true, canDelete: true, canApprove: true };
  }

  const linksRes = await dataClient.models.DepartmentRoleLink.list({ limit: 5000 });
  const roleIds = new Set<string>();
  for (const l of linksRes.data ?? []) {
    const dk = String((l as any).departmentKey ?? "");
    if (dk && normGroups.includes(dk)) {
      const rid = String((l as any).roleId ?? "");
      if (rid) roleIds.add(rid);
    }
  }
  if (!roleIds.size) return perms;

  const polRes = await dataClient.models.RolePolicy.list({ limit: 8000 });
  for (const p of polRes.data ?? []) {
    const rid = String((p as any).roleId ?? "");
    const key = String((p as any).policyKey ?? "");
    if (!rid || !key) continue;
    if (!roleIds.has(rid)) continue;
    if (key !== POLICY_KEY) continue;

    perms.canRead = perms.canRead || Boolean((p as any).canRead);
    perms.canCreate = perms.canCreate || Boolean((p as any).canCreate);
    perms.canUpdate = perms.canUpdate || Boolean((p as any).canUpdate);
    perms.canDelete = perms.canDelete || Boolean((p as any).canDelete);
    perms.canApprove = perms.canApprove || Boolean((p as any).canApprove);
  }

  return perms;
}

export const handler: Handler = async (event) => {
  const id = String((event?.arguments as any)?.id ?? "").trim();
  if (!id) throw new Error("id is required.");

  const claims = event?.identity?.claims ?? {};
  const groups = normalizeGroupsFromClaims(claims);

  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);
  const dataClient = generateClient<Schema>();

  const perms = await resolvePermissions(dataClient, groups);
  if (!perms.canDelete) throw new Error("Not authorized: missing JOB_CARDS canDelete.");

  await dataClient.models.JobOrder.delete({ id } as any);

  return { ok: true, id };
};
