import {createHash} from 'node:crypto';

// The caller first stops identified processes and retires their writers under a
// valid maintenance lease. No age alone authorizes deleting a writer or object.
export async function reconcileMedia({db, raw, control, lease, providerSettled = false}) {
  await control.assertLease(lease);
  const state = await control.status();
  if (state.writers.length) throw Error('Stop and reconcile active writers first');
  if (!providerSettled) throw Error('Explicit provider-settled confirmation required; HEAD 404 alone is insufficient');
  const used = async (prefix, connection = db) => await connection.get('SELECT id FROM photos WHERE filename=?', [prefix]) || await connection.get("SELECT key FROM settings WHERE key='portrait' AND value=?", [prefix]);
  for (const write of state.unknown) {
    if (write.storage !== raw.identity) throw Error('Write belongs to a different provider');
    let bytes;
    try { bytes = await raw.get(write.key); }
    catch (error) {
      if (!['ENOENT', 'STORAGE_NOT_FOUND'].includes(error.code) && error.storageStatus !== 404) throw error;
    }
    if (bytes && (bytes.length !== Number(write.bytes) || createHash('sha256').update(bytes).digest('hex') !== write.sha256)) throw Error('Object checksum conflict');
    const prefix = write.key.slice(0, 32);
    const referenced = await used(prefix);
    if (!bytes && referenced) throw Error('A referenced object is missing; restore before resolving');
    await control.withLease(lease, async tx => {
    if (await tx.get('SELECT id FROM media_writers LIMIT 1')) throw Error('Stop and reconcile active writers first');
    if (bytes) await tx.run("UPDATE media_writes SET state='stored' WHERE key=?", [write.key]);
    else await tx.run('DELETE FROM media_writes WHERE key=?', [write.key]);
    if (!referenced) {
      const attempt = await tx.get('SELECT state FROM photo_ingest_attempts WHERE candidate_prefix=?', [prefix]);
      const kind = attempt && attempt.state !== 'published' ? 'candidate' : 'retired';
      await tx.run('INSERT INTO photo_cleanup(photo_id,filename,has_download,kind,not_before) VALUES(?,?,1,?,?) ON CONFLICT(photo_id) DO NOTHING', [prefix, prefix, kind, kind === 'candidate' ? 0 : null]);
    }
    });
  }
  let reconciledAttempts = 0;
  const attempts = await db.all("SELECT * FROM photo_ingest_attempts WHERE state IN ('prepared','stored','unknown') ORDER BY created_at");
  for (const attempt of attempts) {
    await control.assertLease(lease);
    if (attempt.storage_identity !== raw.identity) throw Error('Ingest attempt belongs to a different provider');
    if (await used(attempt.candidate_prefix)) throw Error('Referenced ingest attempt has no publication receipt; investigate before recovery');
    if (await db.get("SELECT key FROM media_writes WHERE key LIKE ? AND state<>'stored' LIMIT 1", [attempt.candidate_prefix + '%'])) throw Error('Ingest attempt still has unresolved writes');
    await control.withLease(lease, async tx => {
      if (await tx.get('SELECT id FROM media_writers LIMIT 1')) throw Error('Stop and reconcile active writers first');
      await tx.run("INSERT INTO photo_cleanup(photo_id,filename,has_download,kind,not_before) VALUES(?,?,1,'candidate',0) ON CONFLICT(photo_id) DO NOTHING", [attempt.candidate_prefix, attempt.candidate_prefix]);
      await tx.run("UPDATE photo_ingest_attempts SET state='abandoned',updated_at=? WHERE id=?", [Date.now(), attempt.id]);
    });
    reconciledAttempts++;
  }
  return {reconciled: state.unknown.length, reconciledAttempts};
}
