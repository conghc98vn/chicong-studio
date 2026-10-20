import test from 'node:test';
import assert from 'node:assert/strict';
import {createDriveJobs} from '../server/drive-jobs.mjs';
import {driveFixture} from './drive-test-fixture.mjs';

test('Drive requests deduplicate durably, isolate keys and coalesce apply jobs', async () => {
  const fixture = await driveFixture();
  try {
    const jobs = createDriveJobs(fixture.db);
    const first = await jobs.enqueue({mappingId: 'mapping', kind: 'apply', requestKey: 'first'});
    assert.equal((await jobs.enqueue({mappingId: 'mapping', kind: 'apply', requestKey: 'first'})).id, first.id);
    assert.equal((await jobs.enqueue({mappingId: 'mapping', kind: 'apply', requestKey: 'another'})).id, first.id);
    await assert.rejects(jobs.enqueue({mappingId: 'mapping', kind: 'preview', requestKey: 'first'}), {code: 'DRIVE_REQUEST_CONFLICT'});
    const lease = await jobs.claim('worker-a');
    await jobs.finish(lease);
    const restarted = createDriveJobs(fixture.db);
    assert.equal((await restarted.enqueue({mappingId: 'mapping', kind: 'apply', requestKey: 'first'})).id, first.id);
    assert.equal((await restarted.enqueue({mappingId: 'mapping', kind: 'apply', requestKey: 'another'})).id, first.id);
    await assert.rejects(restarted.enqueue({mappingId: 'mapping', kind: 'apply', requestKey: 'another', payload: {reimportIntentId: 'changed'}}), {code: 'DRIVE_REQUEST_CONFLICT'});
    assert.notEqual((await restarted.enqueue({mappingId: 'mapping', kind: 'apply', requestKey: 'new'})).id, first.id);
  } finally {
    await fixture.close();
  }
});

test('Lease expiration fences the old process and cancellation preserves item receipts', async () => {
  const fixture = await driveFixture();
  let timestamp = 10000;
  try {
    const jobs = createDriveJobs(fixture.db, {now: () => timestamp, leaseMs: 1000});
    await jobs.enqueue({mappingId: 'mapping', kind: 'preview', requestKey: 'fenced'});
    const before = await jobs.claim('old-worker');
    await jobs.putItems(before, [{fileId: 'file', action: 'add', version: '18446744073709551615', sourceGeneration: 2, source: {name: 'ảnh.jpg'}}]);
    timestamp += 1001;
    const after = await jobs.claim('new-worker');
    assert.equal(after.id, before.id);
    assert.equal(after.fence, before.fence + 1);
    await assert.rejects(jobs.heartbeat(before), {code: 'DRIVE_LEASE_LOST'});
    await assert.rejects(jobs.finish(before), {code: 'DRIVE_LEASE_LOST'});
    const item = (await jobs.items(after.id))[0];
    assert.equal(item.version, '18446744073709551615');
    await jobs.putItems(after, [{fileId: 'file', action: 'replace', version: '1'}]);
    assert.equal((await jobs.items(after.id))[0].action, 'add');
    await jobs.cancel(after.id);
    await assert.rejects(fixture.db.transaction(tx => jobs.assertLease(tx, after)), {code: 'DRIVE_LEASE_LOST'});
    assert.equal((await jobs.items(after.id)).length, 1);
    assert.equal(await jobs.claim('next-worker'), null);
  } finally {
    await fixture.close();
  }
});

test('Only one job runs per mapping, while another album can progress', async () => {
  const fixture = await driveFixture();
  try {
    const jobs = createDriveJobs(fixture.db);
    await jobs.enqueue({mappingId: 'mapping', kind: 'preview', requestKey: 'preview'});
    await jobs.enqueue({mappingId: 'mapping', kind: 'apply', requestKey: 'apply'});
    const claims = await Promise.all([jobs.claim('worker-one'), jobs.claim('worker-two')]);
    assert.equal(claims.filter(Boolean).length, 1);
    await fixture.db.run("INSERT INTO albums(id,title,category) VALUES('second','Second','wedding')");
    await fixture.db.run("INSERT INTO drive_album_links(id,connection_id,album_id,folder_id) VALUES('second-map','connection','second','second-folder')");
    await jobs.enqueue({mappingId: 'second-map', kind: 'apply', requestKey: 'second-job'});
    assert.equal((await jobs.claim('worker-three')).mapping_id, 'second-map');
    await jobs.finish(claims.find(Boolean));
    assert.equal((await jobs.claim('worker-four')).mapping_id, 'mapping');
  } finally {
    await fixture.close();
  }
});

test('Batch yields preserve retry budget; retries and crash attempts are bounded', async () => {
  const fixture = await driveFixture();
  let timestamp = 10000;
  try {
    const jobs = createDriveJobs(fixture.db, {now: () => timestamp, maxAttempts: 2, leaseMs: 1000});
    const job = await jobs.enqueue({mappingId: 'mapping', kind: 'apply', requestKey: 'bounded'});
    for (let batch = 0; batch < 8; batch++) {
      const lease = await jobs.claim('worker');
      assert.equal(lease.attempt, 1);
      await jobs.release(lease, {progress: {processed: batch + 1}, delayMs: 0});
    }
    await jobs.retry(await jobs.claim('worker'), {errorCode: 'rate_limited', delayMs: 50});
    assert.equal(await jobs.claim('worker'), null);
    timestamp += 50;
    await jobs.retry(await jobs.claim('worker'), {errorCode: 'rate_limited', delayMs: 0});
    assert.equal((await jobs.get(job.id)).status, 'failed');
    const crashed = await jobs.enqueue({mappingId: 'mapping', kind: 'apply', requestKey: 'crash'});
    await jobs.claim('dead-one');
    timestamp += 1001;
    await jobs.claim('dead-two');
    timestamp += 1001;
    assert.equal(await jobs.claim('replacement'), null);
    assert.equal((await jobs.get(crashed.id)).error_code, 'retry_exhausted');
  } finally {
    await fixture.close();
  }
});

test('Review results stay idle and approval grants exactly one durable apply job', async () => {
  const fixture = await driveFixture();
  try {
    const jobs = createDriveJobs(fixture.db);
    const preview = await jobs.enqueue({mappingId: 'mapping', kind: 'preview', requestKey: 'preview'});
    await jobs.finish(await jobs.claim('worker'), {status: 'awaiting_review', manifest: {files: ['file']}});
    assert.equal(await jobs.claim('worker'), null);
    await fixture.db.run(`INSERT INTO drive_sync_approvals(id,preview_id,album_id,mapping_id,connection_generation,
      mapping_generation,catalog_revision,selection_revision,submission_generation,manifest_json)
      VALUES('approval',?,'album','mapping',1,1,0,0,0,'{}')`, [preview.id]);
    const approved = await jobs.enqueue({mappingId: 'mapping', kind: 'apply', requestKey: 'approve-one', previewId: preview.id, approvalId: 'approval'});
    await jobs.finish(await jobs.claim('worker'));
    assert.equal((await jobs.enqueue({mappingId: 'mapping', kind: 'apply', requestKey: 'approve-again', previewId: preview.id, approvalId: 'approval'})).id, approved.id);
    assert.equal((await fixture.db.get("SELECT job_id FROM drive_sync_approvals WHERE id = 'approval'")).job_id, approved.id);
    await jobs.cancel(preview.id);
    await assert.rejects(jobs.enqueue({mappingId: 'mapping', kind: 'apply', requestKey: 'invalid', previewId: preview.id, approvalId: 'approval'}), {code: 'DRIVE_APPROVAL_INVALID'});
  } finally {
    await fixture.close();
  }
});

test('Scheduler is off by default, coalesces missed intervals and respects disabled mappings', async () => {
  const fixture = await driveFixture();
  let timestamp = 1000000;
  try {
    const jobs = createDriveJobs(fixture.db, {now: () => timestamp});
    await fixture.db.run("UPDATE drive_album_links SET next_run_at = 1 WHERE id = 'mapping'");
    assert.deepEqual(await jobs.schedule(), []);
    const scheduled = await jobs.schedule({enabled: true});
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].kind, 'apply');
    timestamp += 10000000;
    assert.deepEqual(await jobs.schedule({enabled: true}), []);
    await jobs.cancel(scheduled[0].id);
    assert.equal((await jobs.schedule({enabled: true})).length, 1);
    await fixture.db.run("UPDATE drive_album_links SET state = 'paused', enabled = 0, next_run_at = 1");
    assert.deepEqual(await jobs.schedule({enabled: true}), []);
    assert.equal(await jobs.claim('worker'), null);
  } finally {
    await fixture.close();
  }
});

test('A gallery change between approval and enqueue cannot be authorized by the older approval', async () => {
  const fixture = await driveFixture();
  try {
    const jobs = createDriveJobs(fixture.db);
    const preview = await jobs.enqueue({mappingId: 'mapping', kind: 'preview', requestKey: 'preview'});
    await jobs.finish(await jobs.claim('worker'), {status: 'awaiting_review', manifest: {complete: true}});
    await fixture.db.run(`INSERT INTO drive_sync_approvals(id,preview_id,album_id,mapping_id,connection_generation,
      mapping_generation,catalog_revision,selection_revision,submission_generation,manifest_json)
      VALUES('approval',?,'album','mapping',1,1,0,0,0,'{}')`, [preview.id]);
    await fixture.db.run("UPDATE albums SET title = 'Changed after review' WHERE id = 'album'");
    await assert.rejects(jobs.enqueue({mappingId: 'mapping', kind: 'apply', requestKey: 'stale', previewId: preview.id, approvalId: 'approval'}), {code: 'DRIVE_APPROVAL_STALE'});
    assert.equal((await fixture.db.get("SELECT job_id FROM drive_sync_approvals WHERE id = 'approval'")).job_id, null);
    assert.equal((await fixture.db.get("SELECT COUNT(*) AS count FROM drive_sync_jobs WHERE kind = 'apply'")).count, fixture.db.cloud ? '0' : 0);
  } finally {
    await fixture.close();
  }
});
