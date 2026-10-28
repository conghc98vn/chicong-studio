import {open, mkdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {migrateFeedbackSchema} from './feedback-schema.mjs';

// The ledger belongs outside the application database/backup directory. It
// contains identifiers only and must be backed up independently by operators.
const validId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
async function append(file, record) {
 const handle = await open(file, 'a', 0o600);
 try { await handle.writeFile(JSON.stringify(record) + '\n'); await handle.sync(); }
 finally { await handle.close(); }
}

export async function initializeDeletionLedger(file) {
 await mkdir(path.dirname(file), {recursive: true, mode: 0o700});
 const handle = await open(file, 'wx', 0o600);
 try { await handle.writeFile(JSON.stringify({type:'ledger', version:1, createdAt:new Date().toISOString()}) + '\n'); await handle.sync(); }
 finally { await handle.close(); }
}

export async function readDeletionLedger(file) {
 const raw = await readFile(file, 'utf8');
 if (!raw.endsWith('\n')) throw Error('Deletion ledger is incomplete; keep feedback blocked');
 const rows = raw.trimEnd().split('\n').map(line => JSON.parse(line));
 if (rows[0]?.type !== 'ledger' || rows[0]?.version !== 1) throw Error('Invalid deletion ledger');
 const intents = new Map();
 for (const row of rows.slice(1)) {
  if (!['intent','applied'].includes(row.type) || !validId(row.handoverId) || typeof row.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(row.requestId) || !Number.isFinite(Date.parse(row.at))) throw Error('Invalid deletion ledger entry');
  if (row.type === 'intent') {
   if (intents.has(row.requestId) && intents.get(row.requestId).handoverId !== row.handoverId) throw Error('Conflicting deletion request');
   intents.set(row.requestId, row);
  } else if (intents.get(row.requestId)?.handoverId !== row.handoverId) throw Error('Deletion acknowledgement without intent');
 }
 return [...intents.values()];
}

export async function purgeHandover({db, ledgerFile, handoverId}) {
 if (!validId(handoverId)) throw Error('Invalid handover ID');
 await readDeletionLedger(ledgerFile); // Never replace a missing independent ledger.
 const requestId = randomUUID();
 await append(ledgerFile, {type:'intent',requestId,handoverId,at:new Date().toISOString()});
 // ON DELETE CASCADE covers revisions, receipts, notifications and album links.
 // Callers must have stopped/drained all application processes before this call.
 await db.transaction(tx => tx.run('DELETE FROM handovers WHERE id=?', [handoverId]));
 await append(ledgerFile, {type:'applied',requestId,handoverId,at:new Date().toISOString()});
 return {requestId, handoverId, purged:true};
}

export async function reconcileFeedbackDeletions({db, ledgerFile, release = false}) {
 const intents = await readDeletionLedger(ledgerFile);
 await db.transaction(async tx => {
  if (release && (await tx.get("SELECT value FROM settings WHERE key='feedback_restore_preparation_incomplete'"))?.value === 'true') throw Error('Raw restore preparation is incomplete; rerun prepare-restored before releasing feedback');
  for (const {handoverId} of intents) await tx.run('DELETE FROM handovers WHERE id=?', [handoverId]);
  if (release) await tx.run("DELETE FROM settings WHERE key='feedback_restore_pending'");
 });
 return {reconciled: intents.length, released: release};
}

// Raw database restores bypass media-backup's row transformations. Persist the
// startup gate first, then prepare all feedback rows in one transaction. If a
// schema/ledger/write error occurs, data changes roll back but the gate stays.
// Call only offline with every API and dispatcher stopped and both pauses set.
export async function prepareRestoredFeedback({db, ledgerFile}) {
 await db.transaction(async tx => {
  await tx.run("INSERT INTO settings(key,value) VALUES('feedback_restore_pending','true') ON CONFLICT(key) DO UPDATE SET value='true'");
  await tx.run("INSERT INTO settings(key,value) VALUES('feedback_restore_preparation_incomplete','true') ON CONFLICT(key) DO UPDATE SET value='true'");
 });
 await readDeletionLedger(ledgerFile);
 return db.transaction(async tx => {
  // An older raw backup has the base tables but no feedback tables. Do not run
  // application initialization, unrelated migrations, defaults, or workers.
  await migrateFeedbackSchema(tx);
  const at = new Date().toISOString();
  const handovers = await tx.all('SELECT id,invitation_state FROM handovers');
  for (const handover of handovers) {
   await tx.run("UPDATE handovers SET invitation_state=?,invitation_nonce=?,handover_version=handover_version+1,operation_key=NULL,operation_hash=NULL,operation_result=NULL,updated_at=? WHERE id=?", [handover.invitation_state === 'unissued' ? 'unissued' : 'revoked',randomUUID().replaceAll('-',''),at,handover.id]);
  }
  const suppressed = await tx.run("UPDATE feedback_notifications SET state='suppressed',claim_id=NULL,lease_until=0,next_attempt_at=0,suppressed_reason='restored_requires_review',suppressed_at=?,updated_at=? WHERE state<>'accepted_by_provider'", [at,at]);
  await tx.run("DELETE FROM settings WHERE key='feedback_restore_preparation_incomplete'");
  return {prepared:true,handovers:handovers.length,suppressed:Number(suppressed.changes),released:false};
 });
}
