import test from 'node:test';
import assert from 'node:assert/strict';
import {benchmarkDriveMetadata} from './drive-performance.bench.mjs';

for (const count of [500,5000]) {
  test(`${count} unchanged Drive photos use paginated metadata without per-photo API calls`,async () => {
    const report = await benchmarkDriveMetadata(count,{hooks:{beforeRun:async ({kind,files}) => {
      // A non-content Drive version bump is an inventory observation, never a
      // new imported rendition or an excuse to rewrite imported provenance.
      if (kind === 'apply') for (const file of files) file.version = '2';
    },afterApply:async ({db,job}) => {
      const sources = await db.all('SELECT imported_version,imported_generation FROM drive_source_files');
      assert.ok(sources.every(source => source.imported_version === '1' && Number(source.imported_generation) === 1));
      assert.equal(Number((await db.get('SELECT catalog_revision FROM albums')).catalog_revision),count);
      assert.equal(Number((await db.get("SELECT COUNT(*) AS count FROM drive_sync_job_items WHERE job_id=? AND action='unchanged' AND status='applied'",[job.id])).count),count);
    }}});
    assert.equal(report.apply.file_gets,0);
    assert.equal(report.apply.membership_pages,0);
    assert.equal(report.apply.list_pages,Math.ceil(count/1000));
    assert.equal(report.apply.folder_gets,4);
    assert.equal(report.apply.batches,1);
    assert.equal(report.apply.downloads,0);
    assert.ok(report.apply.queries < 500,JSON.stringify(report));
    assert.ok(report.apply.rows < count*6,JSON.stringify(report));
  });
}
