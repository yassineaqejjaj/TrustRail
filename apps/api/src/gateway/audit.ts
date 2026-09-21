import type { Db } from "@trustrail/db";
import { auditEvents } from "@trustrail/db";
import { newId } from "@trustrail/db";

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
