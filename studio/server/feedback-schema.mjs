export const FEEDBACK_TABLES = ['handovers','handover_albums','feedback','feedback_revisions','feedback_request_receipts','feedback_notifications'];
export async function migrateFeedbackSchema(db) {
 // PostgreSQL coerces a numeric literal to INTEGER before CHECK constraints
 // run (3.5 becomes 4). NUMERIC retains the submitted value for validation.
 const ratingType=db.cloud?'NUMERIC':'INTEGER';
 await db.exec(`
 CREATE TABLE IF NOT EXISTS handovers(
 id TEXT PRIMARY KEY,client_name TEXT NOT NULL,title TEXT NOT NULL,service TEXT NOT NULL DEFAULT '',shoot_date TEXT NOT NULL DEFAULT '',delivered_on TEXT NOT NULL DEFAULT '',inquiry_id TEXT REFERENCES inquiries(id) ON DELETE SET NULL,
 delivery_state TEXT NOT NULL DEFAULT 'draft' CHECK(delivery_state IN ('draft','delivered')),delivery_confirmed_at TEXT,archived_at TEXT,
 invitation_state TEXT NOT NULL DEFAULT 'unissued' CHECK(invitation_state IN ('unissued','active','paused','revoked')),invitation_nonce TEXT NOT NULL,issued_at TEXT,notes TEXT NOT NULL DEFAULT '',
 handover_version INTEGER NOT NULL DEFAULT 1 CHECK(handover_version>0),context_version INTEGER NOT NULL DEFAULT 1 CHECK(context_version>0),create_request_key TEXT NOT NULL UNIQUE,create_request_hash TEXT NOT NULL,
 operation_key TEXT,operation_hash TEXT,operation_result TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS handover_albums(handover_id TEXT NOT NULL REFERENCES handovers(id) ON DELETE CASCADE,album_id TEXT NOT NULL UNIQUE REFERENCES albums(id) ON DELETE CASCADE,PRIMARY KEY(handover_id,album_id));
 CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY,handover_id TEXT NOT NULL UNIQUE REFERENCES handovers(id) ON DELETE CASCADE,context_snapshot TEXT NOT NULL,context_version INTEGER NOT NULL CHECK(context_version>0),latest_version INTEGER NOT NULL CHECK(latest_version>0),read_version INTEGER NOT NULL DEFAULT 0 CHECK(read_version>=0 AND read_version<=latest_version),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS feedback_revisions(id TEXT PRIMARY KEY,feedback_id TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,version INTEGER NOT NULL CHECK(version>0),name TEXT NOT NULL,message TEXT NOT NULL,improvement TEXT NOT NULL DEFAULT '',rating_overall ${ratingType} CHECK(rating_overall IS NULL OR (rating_overall BETWEEN 1 AND 5 AND rating_overall=CAST(rating_overall AS INTEGER))),rating_shoot ${ratingType} CHECK(rating_shoot IS NULL OR (rating_shoot BETWEEN 1 AND 5 AND rating_shoot=CAST(rating_shoot AS INTEGER))),rating_product ${ratingType} CHECK(rating_product IS NULL OR (rating_product BETWEEN 1 AND 5 AND rating_product=CAST(rating_product AS INTEGER))),rating_delivery ${ratingType} CHECK(rating_delivery IS NULL OR (rating_delivery BETWEEN 1 AND 5 AND rating_delivery=CAST(rating_delivery AS INTEGER))),form_version INTEGER NOT NULL,criteria_snapshot TEXT NOT NULL,server_saved_at TEXT NOT NULL,UNIQUE(feedback_id,version));
 CREATE TABLE IF NOT EXISTS feedback_request_receipts(handover_id TEXT NOT NULL REFERENCES handovers(id) ON DELETE CASCADE,request_key TEXT NOT NULL,request_hash TEXT NOT NULL,normalization_version INTEGER NOT NULL,form_version INTEGER NOT NULL,result_version INTEGER NOT NULL CHECK(result_version>0),changed INTEGER NOT NULL CHECK(changed IN (0,1)),created_at TEXT NOT NULL,PRIMARY KEY(handover_id,request_key));
 CREATE TABLE IF NOT EXISTS feedback_notifications(id TEXT PRIMARY KEY,feedback_id TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,revision_id TEXT NOT NULL UNIQUE REFERENCES feedback_revisions(id) ON DELETE CASCADE,version INTEGER NOT NULL CHECK(version>0),event_type TEXT NOT NULL CHECK(event_type IN ('new','updated')),recipient TEXT,state TEXT NOT NULL CHECK(state IN ('pending','processing','retry_wait','blocked_config','failed','accepted_by_provider','suppressed')),attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),next_attempt_at BIGINT NOT NULL DEFAULT 0,lease_until BIGINT NOT NULL DEFAULT 0,claim_id TEXT,provider_reference TEXT,error_code TEXT,suppressed_reason TEXT,suppressed_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(feedback_id,version),CHECK(recipient IS NOT NULL OR state IN ('blocked_config','suppressed')));
 CREATE INDEX IF NOT EXISTS handovers_created ON handovers(created_at,id);
 CREATE INDEX IF NOT EXISTS handovers_inquiry ON handovers(inquiry_id);
 CREATE INDEX IF NOT EXISTS feedback_notifications_queue ON feedback_notifications(state,next_attempt_at,lease_until);
 CREATE INDEX IF NOT EXISTS feedback_notifications_feedback ON feedback_notifications(feedback_id);
 `);
 // SQLite INTEGER affinity still accepts fractional REAL values. Guard the
 // version/counter contract on existing tables as well as fresh databases;
 // CREATE TABLE IF NOT EXISTS alone would not upgrade an existing CHECK.
 if(!db.cloud){
  const integerFields={handovers:['handover_version','context_version'],feedback:['context_version','latest_version','read_version'],feedback_revisions:['version','form_version'],feedback_request_receipts:['normalization_version','form_version','result_version'],feedback_notifications:['version','attempts']};
  for(const [table,columns] of Object.entries(integerFields))for(const event of ['INSERT','UPDATE'])await db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_integer_${event.toLowerCase()} BEFORE ${event} ON ${table} WHEN ${columns.map(column=>`typeof(NEW.${column})<>'integer'`).join(' OR ')} BEGIN SELECT RAISE(ABORT,'Feedback versions and counters must be integers'); END;`);
 }
 if(db.cloud)await db.exec(FEEDBACK_TABLES.map(table=>`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`).join('\n'));
}
