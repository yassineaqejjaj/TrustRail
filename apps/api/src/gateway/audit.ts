import type { Db } from "../db/client.js";
import { auditEvents } from "../db/schema.js";
import { newId } from "../db/ids.js";

export async function writeAuditEvent(
  db: Db,
  organizationId: string,
  actorType: "user" | "agent" | "system",
  actorId: string | null,
  event: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await db.insert(auditEvents).values({
    id: newId("auditEvent"),
    organizationId,
    actorType,
    actorId,
    event,
    metadata,
  });
}
