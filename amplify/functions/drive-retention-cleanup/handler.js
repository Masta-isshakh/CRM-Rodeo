import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
const TRASH_RETENTION_DAYS = Math.max(1, Number(process.env.DRIVE_TRASH_RETENTION_DAYS ?? 30));
const LINK_RETENTION_DAYS = Math.max(1, Number(process.env.DRIVE_LINK_RETENTION_DAYS ?? 15));
async function configureClient() {
    const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env);
    Amplify.configure(resourceConfig, libraryOptions);
    return generateClient();
}
export const handler = async () => {
    const bucketName = String(process.env.FILE_STORAGE_BUCKET ?? "").trim();
    const s3 = new S3Client({});
    const now = Date.now();
    const trashBefore = now - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const linkBefore = now - LINK_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const stats = {
        filesPurged: 0,
        linksRevoked: 0,
        linksDeleted: 0,
        errors: 0,
    };
    try {
        const client = await configureClient();
        const filesRes = await client.models.FileShareItem.list({ limit: 5000 });
        const files = (filesRes?.data ?? []);
        for (const row of files) {
            if (!row?.id || !row?.isDeleted)
                continue;
            const deletedAtMs = Date.parse(String(row.deletedAt ?? ""));
            if (!Number.isFinite(deletedAtMs) || deletedAtMs > trashBefore)
                continue;
            try {
                if (!row.isFolder && bucketName && row.storagePath) {
                    await s3.send(new DeleteObjectCommand({
                        Bucket: bucketName,
                        Key: String(row.storagePath),
                    }));
                }
                await client.models.FileShareItem.delete({ id: row.id });
                stats.filesPurged += 1;
            }
            catch {
                stats.errors += 1;
            }
        }
        const linksRes = await client.models.DriveShareLink.list({ limit: 5000 });
        const links = (linksRes?.data ?? []);
        for (const link of links) {
            if (!link?.id)
                continue;
            const expiresAtMs = Date.parse(String(link.expiresAt ?? ""));
            const revokedAtMs = Date.parse(String(link.revokedAt ?? ""));
            try {
                if (!link.revokedAt && Number.isFinite(expiresAtMs) && expiresAtMs <= now) {
                    await client.models.DriveShareLink.update({
                        id: link.id,
                        revokedAt: new Date().toISOString(),
                    });
                    stats.linksRevoked += 1;
                }
                const oldRevoked = Number.isFinite(revokedAtMs) && revokedAtMs <= linkBefore;
                const oldExpired = Number.isFinite(expiresAtMs) && expiresAtMs <= linkBefore;
                if (oldRevoked || oldExpired) {
                    await client.models.DriveShareLink.delete({ id: link.id });
                    stats.linksDeleted += 1;
                }
            }
            catch {
                stats.errors += 1;
            }
        }
    }
    catch {
        stats.errors += 1;
    }
    return stats;
};
