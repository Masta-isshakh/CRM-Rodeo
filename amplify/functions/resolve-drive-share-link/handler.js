import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
const CORS_HEADERS = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-headers": "content-type",
};
function response(statusCode, payload) {
    return {
        statusCode,
        headers: {
            "content-type": "application/json",
            ...CORS_HEADERS,
        },
        body: JSON.stringify(payload),
    };
}
async function configureClient() {
    const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env);
    Amplify.configure(resourceConfig, libraryOptions);
    return generateClient();
}
export const handler = async (event) => {
    const token = String(event.queryStringParameters?.token ?? "").trim();
    const consume = String(event.queryStringParameters?.consume ?? "0") === "1";
    if (!token) {
        return response(400, { ok: false, reason: "Missing token" });
    }
    const bucketName = String(process.env.FILE_STORAGE_BUCKET ?? "").trim();
    if (!bucketName) {
        return response(500, { ok: false, reason: "Share resolver is not configured" });
    }
    try {
        const client = await configureClient();
        const linksRes = await client.models.DriveShareLink.list({
            filter: { token: { eq: token } },
            limit: 1,
        });
        const link = (linksRes?.data ?? [])[0];
        if (!link?.id) {
            return response(404, { ok: false, reason: "Link not found" });
        }
        if (link.revokedAt) {
            return response(403, { ok: false, reason: "Link revoked" });
        }
        const expiresAtMs = Date.parse(String(link.expiresAt ?? ""));
        if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
            return response(403, { ok: false, reason: "Link expired" });
        }
        const maxDownloads = Number(link.maxDownloads ?? 0);
        const downloadCount = Number(link.downloadCount ?? 0);
        if (maxDownloads > 0 && downloadCount >= maxDownloads) {
            return response(403, { ok: false, reason: "Download limit reached" });
        }
        const fileRes = await client.models.FileShareItem.get({ id: String(link.fileShareItemId ?? "") });
        const file = (fileRes?.data ?? fileRes);
        if (!file?.id || file?.isDeleted || file?.isFolder) {
            return response(404, { ok: false, reason: "File unavailable" });
        }
        if (!consume) {
            return response(200, {
                ok: true,
                displayName: String(link.displayName ?? file.displayName ?? "Shared file"),
                expiresAt: link.expiresAt,
                remainingDownloads: maxDownloads > 0 ? Math.max(0, maxDownloads - downloadCount) : null,
            });
        }
        const expiresInSec = Math.min(600, Math.max(60, Math.floor((expiresAtMs - Date.now()) / 1000)));
        const s3 = new S3Client({});
        const signedUrl = await getSignedUrl(s3, new GetObjectCommand({
            Bucket: bucketName,
            Key: String(file.storagePath ?? ""),
        }), { expiresIn: expiresInSec });
        await client.models.DriveShareLink.update({
            id: link.id,
            downloadCount: downloadCount + 1,
            lastAccessedAt: new Date().toISOString(),
        });
        return response(200, {
            ok: true,
            url: signedUrl,
            displayName: String(link.displayName ?? file.displayName ?? "Shared file"),
            expiresAt: link.expiresAt,
            remainingDownloads: maxDownloads > 0 ? Math.max(0, maxDownloads - (downloadCount + 1)) : null,
        });
    }
    catch (error) {
        return response(500, { ok: false, reason: error?.message || "Resolver failed" });
    }
};
