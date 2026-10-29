export const INQUIRY_NOTIFICATION_TABLES = ['inquiry_notifications'];

export async function migrateInquiryNotificationSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS inquiry_notifications(
      id TEXT PRIMARY KEY,
      inquiry_id TEXT NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('studio','client')),
      recipient TEXT,
      state TEXT NOT NULL CHECK(state IN ('pending','processing','retry_wait','blocked_config','failed','accepted_by_provider','suppressed')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
      next_attempt_at BIGINT NOT NULL DEFAULT 0,
      lease_until BIGINT NOT NULL DEFAULT 0,
      claim_id TEXT,
      provider_reference TEXT,
      error_code TEXT,
      suppressed_reason TEXT,
      suppressed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(inquiry_id,kind),
      CHECK(recipient IS NOT NULL OR state IN ('blocked_config','suppressed'))
    );
    CREATE INDEX IF NOT EXISTS inquiry_notifications_queue ON inquiry_notifications(state,next_attempt_at,lease_until);
    CREATE INDEX IF NOT EXISTS inquiry_notifications_inquiry ON inquiry_notifications(inquiry_id);
  `);
  if (db.cloud) await db.exec('ALTER TABLE inquiry_notifications ENABLE ROW LEVEL SECURITY;');
  if (!db.cloud) {
    for (const event of ['INSERT', 'UPDATE']) {
      await db.exec(`CREATE TRIGGER IF NOT EXISTS inquiry_notifications_integer_${event.toLowerCase()} BEFORE ${event} ON inquiry_notifications WHEN typeof(NEW.attempts)<>'integer' BEGIN SELECT RAISE(ABORT,'Inquiry notification attempts must be integers'); END;`);
    }
  }
}
