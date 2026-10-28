import {randomUUID} from 'node:crypto';

const liveStates = ['queued', 'running', 'retry_wait'];
const finishStates = ['awaiting_review', 'completed', 'completed_with_errors', 'canceled', 'failed'];
const failure = (code, message) => Object.assign(new Error(message), {code, status: 409});
const lock = db => db.cloud ? ' FOR UPDATE' : '';
const encode = value => JSON.stringify(value ?? {});
const decode = value => value ? JSON.parse(value) : null;

function expose(row) {
  if (!row) return null;
  return {...row, payload: decode(row.payload_json), manifest: decode(row.manifest_json), progress: decode(row.progress_json)};
}

export function createDriveJobStore({db, ...options}) {
  return createDriveJobs(db, options);
}

export function createDriveJobs(db, {now = Date.now, leaseMs = 60000, maxAttempts = 5} = {}) {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('Invalid Drive queue lease or retry policy');
  }

  async function enqueue(input, transaction) {
    if (!['check', 'preview', 'apply'].includes(input.kind)) throw failure('DRIVE_JOB_INVALID', 'Invalid job kind');
    if (typeof input.requestKey !== 'string' || !input.requestKey || input.requestKey.length > 200) {
      throw failure('DRIVE_JOB_INVALID', 'A bounded request key is required');
    }
    const operation = async tx => {
      // Read identity first, then follow the shared album -> connection -> link
      // ordering. No job row is locked while waiting for an album.
      const identity = input.mappingId ? await tx.get('SELECT * FROM drive_album_links WHERE id = ?', [input.mappingId]) : null;
      if (input.mappingId && !identity) throw failure('DRIVE_MAPPING_MISSING', 'Drive mapping does not exist');
      const album = identity ? await tx.get('SELECT * FROM albums WHERE id = ?' + lock(tx), [identity.album_id]) : null;
      const connectionId = identity?.connection_id || input.connectionId;
      const connection = await tx.get('SELECT * FROM drive_connections WHERE id = ?' + lock(tx), [connectionId]);
      const mapping = identity ? await tx.get('SELECT * FROM drive_album_links WHERE id = ?' + lock(tx), [identity.id]) : null;
      if (!connection) throw failure('DRIVE_CONNECTION_MISSING', 'Drive connection does not exist');
      const fingerprint = JSON.stringify([connection.id, mapping?.id || null, input.kind,
        input.previewId || null, input.approvalId || null, encode(input.payload)]);
      const receipt = await tx.get('SELECT * FROM drive_job_requests WHERE request_key = ?', [input.requestKey]);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw failure('DRIVE_REQUEST_CONFLICT', 'Request key was used for different input');
        return expose(await tx.get('SELECT * FROM drive_sync_jobs WHERE id = ?', [receipt.job_id]));
      }
      const remember = async job => {
        await tx.run('INSERT INTO drive_job_requests(request_key,job_id,fingerprint,created_at) VALUES(?,?,?,?)',
          [input.requestKey, job.id, fingerprint, now()]);
        return expose(job);
      };
      const previous = await tx.get('SELECT * FROM drive_sync_jobs WHERE request_key = ?', [input.requestKey]);
      if (previous) {
        if (previous.connection_id !== connection.id || previous.mapping_id !== (mapping?.id || null) || previous.kind !== input.kind ||
            previous.preview_id !== (input.previewId || null) || previous.approval_id !== (input.approvalId || null) || previous.payload_json !== encode(input.payload)) {
          throw failure('DRIVE_REQUEST_CONFLICT', 'Request key was used for a different job');
        }
        return remember(previous);
      }
      if (input.kind !== 'check' && (!mapping || connection.status !== 'active' || mapping.state !== 'attached' || !mapping.enabled || album?.status === 'archived')) {
        throw failure('DRIVE_DISABLED', 'Connection or album sync is disabled');
      }
      let approval;
      if (input.approvalId) {
        approval = await tx.get('SELECT * FROM drive_sync_approvals WHERE id = ?' + lock(tx), [input.approvalId]);
        if (!approval || approval.invalidated_at != null || approval.mapping_id !== mapping?.id || approval.preview_id !== input.previewId) {
          throw failure('DRIVE_APPROVAL_INVALID', 'Approval does not authorize this preview and album');
        }
        if (approval.job_id) return remember(await tx.get('SELECT * FROM drive_sync_jobs WHERE id = ?', [approval.job_id]));
        if (approval.connection_generation !== connection.generation || approval.mapping_generation !== mapping.generation ||
            approval.catalog_revision !== album.catalog_revision || approval.selection_revision !== album.selection_revision ||
            approval.submission_generation !== album.submission_generation) {
          throw failure('DRIVE_APPROVAL_STALE', 'Gallery changed after this approval was recorded');
        }
      }
      if (mapping) {
        const current = await tx.get("SELECT * FROM drive_sync_jobs WHERE mapping_id = ? AND kind = ? AND status IN ('queued','running','retry_wait') ORDER BY created_at LIMIT 1", [mapping.id, input.kind]);
        if (current) {
          if (current.approval_id !== (input.approvalId || null) || current.preview_id !== (input.previewId || null) || current.payload_json !== encode(input.payload)) {
            throw failure('DRIVE_JOB_ACTIVE', 'A job with different input is active');
          }
          return remember(current);
        }
      }
      const timestamp = now();
      const values = [randomUUID(), connection.id, mapping?.id || null, input.kind, input.requestKey,
        connection.generation, mapping?.generation ?? null, input.previewId || null, input.approvalId || null,
        album?.catalog_revision ?? null, album?.selection_revision ?? null, album?.submission_generation ?? null,
        encode(input.payload), timestamp, timestamp, timestamp];
      await tx.run(`INSERT INTO drive_sync_jobs
        (id,connection_id,mapping_id,kind,request_key,connection_generation,mapping_generation,
        preview_id,approval_id,expected_catalog_revision,expected_selection_revision,expected_submission_generation,
        payload_json,available_at,created_at,updated_at) VALUES (${values.map(() => '?').join(',')})`, values);
      if (approval) await tx.run('UPDATE drive_sync_approvals SET job_id = ? WHERE id = ?', [values[0], approval.id]);
      return remember(await tx.get('SELECT * FROM drive_sync_jobs WHERE id = ?', [values[0]]));
    };
    return transaction ? operation(transaction) : db.transaction(operation);
  }

  async function claim(owner) {
    if (typeof owner !== 'string' || !owner || owner.length > 200) throw new Error('Worker identity is required');
    try {
      return await db.transaction(async tx => {
      const timestamp = now();
      // Crashes consume a retry; ordinary cooperative batch yields do not.
      await tx.run(`UPDATE drive_sync_jobs SET status = 'failed', error_code = 'retry_exhausted',
        lease_owner = NULL, lease_until = NULL, finished_at = ?, updated_at = ?, fence = fence + 1
        WHERE attempt >= ? AND ((status = 'running' AND lease_until <= ?) OR status IN ('queued','retry_wait'))`,
      [timestamp, timestamp, maxAttempts, timestamp]);
      const row = await tx.get(`SELECT jobs.* FROM drive_sync_jobs jobs
        JOIN drive_connections connection ON connection.id = jobs.connection_id
        LEFT JOIN drive_album_links mapping ON mapping.id = jobs.mapping_id
        LEFT JOIN albums album ON album.id = mapping.album_id
        WHERE jobs.cancel_requested = 0 AND jobs.attempt < ?
          AND ((jobs.status IN ('queued','retry_wait') AND jobs.available_at <= ?)
            OR (jobs.status = 'running' AND jobs.lease_until <= ?))
          AND (jobs.kind = 'check' OR (connection.status = 'active' AND mapping.state = 'attached'
            AND mapping.enabled = 1 AND album.status <> 'archived'))
          AND NOT EXISTS (SELECT 1 FROM drive_sync_jobs other WHERE other.mapping_id = jobs.mapping_id
            AND other.id <> jobs.id AND other.status = 'running')
        ORDER BY jobs.available_at, jobs.created_at, jobs.id LIMIT 1${tx.cloud ? ' FOR UPDATE OF jobs SKIP LOCKED' : ''}`,
      [maxAttempts, timestamp, timestamp]);
      if (!row) return null;
      await tx.run(`UPDATE drive_sync_jobs SET status = 'running', attempt = attempt + 1,
        lease_owner = ?, lease_until = ?, fence = fence + 1, updated_at = ? WHERE id = ?`,
      [owner, timestamp + leaseMs, timestamp, row.id]);
      return expose(await tx.get('SELECT * FROM drive_sync_jobs WHERE id = ?', [row.id]));
      });
    } catch (error) {
      // Two PostgreSQL claimers may see separate queued jobs for one mapping.
      // The unique running-mapping index arbitrates without a long-lived lock.
      if (error.code === '23505' && error.constraint === 'drive_one_running_mapping') return null;
      throw error;
    }
  }

  async function assertLease(tx, lease, {allowCanceled = false} = {}) {
    const row = await tx.get('SELECT * FROM drive_sync_jobs WHERE id = ?' + lock(tx), [lease.id]);
    if (!row || row.status !== 'running' || row.lease_owner !== lease.lease_owner || row.fence !== lease.fence || Number(row.lease_until) <= now() || (!allowCanceled && row.cancel_requested)) {
      throw failure('DRIVE_LEASE_LOST', 'Drive job lease is no longer valid');
    }
    return row;
  }

  async function heartbeat(lease) {
    return db.transaction(async tx => {
      await assertLease(tx, lease);
      const timestamp = now();
      await tx.run('UPDATE drive_sync_jobs SET lease_until = ?, updated_at = ? WHERE id = ?', [timestamp + leaseMs, timestamp, lease.id]);
      return expose(await tx.get('SELECT * FROM drive_sync_jobs WHERE id = ?', [lease.id]));
    });
  }

  async function finish(lease, {status = 'completed', progress, manifest, errorCode = null} = {}, transaction) {
    if (!finishStates.includes(status)) throw new Error('Invalid finished job status');
    const operation = async tx => {
      const row = await assertLease(tx, lease, {allowCanceled: status === 'canceled'});
      const timestamp = now();
      await tx.run(`UPDATE drive_sync_jobs SET status = ?, progress_json = ?, manifest_json = ?, error_code = ?,
        lease_owner = NULL, lease_until = NULL, updated_at = ?, finished_at = ? WHERE id = ?`,
      [status, progress === undefined ? row.progress_json : encode(progress), manifest === undefined ? row.manifest_json : encode(manifest), errorCode, timestamp, timestamp, row.id]);
      return expose(await tx.get('SELECT * FROM drive_sync_jobs WHERE id = ?', [row.id]));
    };
    return transaction ? operation(transaction) : db.transaction(operation);
  }

  async function retry(lease, {errorCode = 'temporary_failure', delayMs} = {}) {
    return db.transaction(async tx => {
      const row = await assertLease(tx, lease);
      if (row.attempt >= maxAttempts) return finish(lease, {status: 'failed', errorCode}, tx);
      const delay = delayMs ?? Math.min(300000, 1000 * 2 ** (row.attempt - 1)) * (0.8 + Math.random() * 0.4);
      if (!Number.isFinite(delay) || delay < 0 || delay > 86400000) throw new Error('Invalid retry delay');
      const timestamp = now();
      await tx.run(`UPDATE drive_sync_jobs SET status = 'retry_wait', error_code = ?, available_at = ?,
        lease_owner = NULL, lease_until = NULL, updated_at = ? WHERE id = ?`,
      [errorCode, timestamp + Math.ceil(delay), timestamp, row.id]);
      return expose(await tx.get('SELECT * FROM drive_sync_jobs WHERE id = ?', [row.id]));
    });
  }

  async function release(lease, {progress, delayMs = 1} = {}) {
    if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 86400000) throw new Error('Invalid yield delay');
    return db.transaction(async tx => {
      const row = await assertLease(tx, lease);
      const timestamp = now();
      await tx.run(`UPDATE drive_sync_jobs SET status = 'queued', attempt = attempt - 1, available_at = ?,
        progress_json = ?, lease_owner = NULL, lease_until = NULL, updated_at = ? WHERE id = ?`,
      [timestamp + Math.ceil(delayMs), progress === undefined ? row.progress_json : encode(progress), timestamp, row.id]);
      return expose(await tx.get('SELECT * FROM drive_sync_jobs WHERE id = ?', [row.id]));
    });
  }

  async function cancel(jobId, transaction) {
    const operation = async tx => {
      const row = await tx.get('SELECT * FROM drive_sync_jobs WHERE id = ?' + lock(tx), [jobId]);
      if (!row) return null;
      if (!liveStates.includes(row.status) && row.status !== 'awaiting_review') return expose(row);
      const timestamp = now();
      // Cancellation revokes publish permission immediately. It does not erase
      // the media writer journal or pretend the process has already stopped.
      await tx.run(`UPDATE drive_sync_jobs SET cancel_requested = 1, status = 'canceled', fence = fence + 1,
        lease_owner = NULL, lease_until = NULL, updated_at = ?, finished_at = ? WHERE id = ?`, [timestamp, timestamp, row.id]);
      await tx.run('UPDATE drive_sync_approvals SET invalidated_at = ? WHERE preview_id = ? OR job_id = ?', [timestamp, row.id, row.id]);
      return expose(await tx.get('SELECT * FROM drive_sync_jobs WHERE id = ?', [row.id]));
    };
    return transaction ? operation(transaction) : db.transaction(operation);
  }

  async function putItems(lease, input, transaction) {
    if (!Array.isArray(input) || input.length > 1000) throw new Error('A job item batch must contain at most 1000 files');
    const operation = async tx => {
      await assertLease(tx, lease);
      const timestamp = now();
      const rows = [];
      for (const item of input) {
        const fileId = item.fileId ?? item.file_id;
        if (typeof fileId !== 'string' || !fileId || typeof item.action !== 'string') throw new Error('Invalid Drive job item');
        const values = [item.id || randomUUID(), lease.id, fileId, item.action, item.version == null ? null : String(item.version), item.checksum ?? null,
          item.sourceGeneration ?? item.source_generation ?? null, item.ingestOperationId ?? item.ingest_operation_id ?? null,
          item.source_json ?? encode(item.source), item.result_json ?? (item.result === undefined ? null : encode(item.result)),
          item.status || 'pending', item.errorCode ?? item.error_code ?? null, timestamp, timestamp];
        rows.push(values);
      }
      // Stay below SQLite's older 999-parameter limit while avoiding one
      // database round trip for every file in a 5,000-image inventory.
      for (let offset = 0; offset < rows.length; offset += 64) {
        const batch = rows.slice(offset, offset + 64);
        // Restarting an inventory never overwrites a committed item receipt.
        await tx.run(`INSERT INTO drive_sync_job_items
          (id,job_id,file_id,action,version,checksum,source_generation,ingest_operation_id,source_json,result_json,status,error_code,created_at,updated_at)
          VALUES ${batch.map(values => '(' + values.map(() => '?').join(',') + ')').join(',')}
          ON CONFLICT(job_id,file_id) DO NOTHING`, batch.flat());
      }
    };
    return transaction ? operation(transaction) : db.transaction(operation);
  }

  async function items(jobId, {offset = 0, limit = 100} = {}) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid job item page');
    return db.all('SELECT * FROM drive_sync_job_items WHERE job_id = ? ORDER BY file_id LIMIT ? OFFSET ?', [jobId, limit, offset]);
  }

  async function schedule({intervalMs = 900000, limit = 100, enabled = false} = {}) {
    if (!enabled) return [];
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 60000) throw new Error('Invalid Drive schedule interval');
    const due = await db.all(`SELECT mapping.id FROM drive_album_links mapping
      JOIN drive_connections connection ON connection.id = mapping.connection_id JOIN albums album ON album.id = mapping.album_id
      WHERE mapping.enabled = 1 AND mapping.state = 'attached' AND connection.status = 'active'
        AND album.status <> 'archived' AND mapping.next_run_at IS NOT NULL AND mapping.next_run_at <= ?
      ORDER BY mapping.next_run_at LIMIT ?`, [now(), Math.min(1000, Math.max(1, limit))]);
    const queued = [];
    for (const entry of due) {
      const result = await db.transaction(async tx => {
        const identity = await tx.get('SELECT * FROM drive_album_links WHERE id = ?', [entry.id]);
        const album = await tx.get('SELECT id,status FROM albums WHERE id = ?' + lock(tx), [identity.album_id]);
        const connection = await tx.get('SELECT * FROM drive_connections WHERE id = ?' + lock(tx), [identity.connection_id]);
        const mapping = await tx.get('SELECT * FROM drive_album_links WHERE id = ?' + lock(tx), [entry.id]);
        // The due scan is only a hint: archiving can commit before these locks.
        // Skip it here so enqueue cannot abort scheduling unrelated albums.
        if (album.status === 'archived' || !mapping.enabled || mapping.state !== 'attached' || connection.status !== 'active' || mapping.next_run_at == null || Number(mapping.next_run_at) > now()) return null;
        const active = await tx.get("SELECT id FROM drive_sync_jobs WHERE mapping_id = ? AND status IN ('queued','running','retry_wait') LIMIT 1", [entry.id]);
        if (active) return null;
        const job = await enqueue({mappingId: entry.id, kind: 'apply', requestKey: `schedule:${entry.id}:${mapping.generation}:${mapping.next_run_at}`, payload: {scheduled: true}}, tx);
        await tx.run('UPDATE drive_album_links SET next_run_at = ?, updated_at = ? WHERE id = ?', [now() + intervalMs, now(), entry.id]);
        return job;
      });
      if (result) queued.push(result);
    }
    return queued;
  }

  return {enqueue, claim, heartbeat, assertLease, checkFence: assertLease, finish, retry, release, cancel, putItems, items, schedule,
    get: async jobId => expose(await db.get('SELECT * FROM drive_sync_jobs WHERE id = ?', [jobId]))};
}
