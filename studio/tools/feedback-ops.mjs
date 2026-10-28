#!/usr/bin/env node
// Offline operator tool. Never loads .env or starts mail/network workers.
import path from 'node:path';
import {realpath,access} from 'node:fs/promises';
import {openDatabase} from '../server/db.mjs';
import {initializeDeletionLedger,purgeHandover,reconcileFeedbackDeletions,prepareRestoredFeedback} from '../server/handover-privacy.mjs';

const [command,...args] = process.argv.slice(2), options = {};
for (let i=0; i<args.length; i+=2) {
 if (!/^--[a-z-]+$/.test(args[i]) || !args[i+1] || args[i+1].startsWith('--')) throw Error('Use --option value');
 options[args[i].slice(2)] = args[i+1];
}
let db;
try {
 if (!['init-ledger','purge','reconcile','prepare-restored'].includes(command)) throw Error('Commands: init-ledger --ledger ABS_PATH; purge --ledger ABS_PATH --handover ID --data-dir DIR --processes-stopped yes; prepare-restored --ledger ABS_PATH --data-dir DIR --processes-stopped yes; reconcile --ledger ABS_PATH --data-dir DIR --processes-stopped yes --ledger-reviewed yes --secret-rotated yes');
 if (!options.ledger || !path.isAbsolute(options.ledger)) throw Error('Use an absolute --ledger path outside the application backup/data directory');
 if (command === 'init-ledger') { await initializeDeletionLedger(options.ledger); console.log('Independent deletion ledger initialized. Back it up separately.'); }
 else {
  if (!options['data-dir']) throw Error('Select --data-dir explicitly');
  // Check resolved filesystem locations: a symlink outside the data directory
  // can still put the supposedly independent ledger inside the backup tree.
  const dataDir = await realpath(path.resolve(options['data-dir']));
  const ledgerFile = await realpath(options.ledger);
  if (!path.relative(dataDir, ledgerFile).startsWith('..'+path.sep)) throw Error('Deletion ledger must be outside the data directory');
  if (options['processes-stopped'] !== 'yes' || process.env.FEEDBACK_API_PAUSED !== 'true' || process.env.FEEDBACK_NOTIFICATIONS_PAUSED !== 'true') throw Error('Stop/drain every app and dispatcher; set both FEEDBACK_API_PAUSED=true and FEEDBACK_NOTIFICATIONS_PAUSED=true');
  if (command === 'reconcile' && (options['ledger-reviewed'] !== 'yes' || options['secret-rotated'] !== 'yes')) throw Error('Confirm the independently retained ledger is complete and a new FEEDBACK_LINK_SECRET is deployed to every instance before releasing restored data');
  if (!process.env.DATABASE_URL) await access(path.join(dataDir,'studio.sqlite'));
  db = await openDatabase(dataDir, {url:process.env.DATABASE_URL || null, initialize:false});
  let result;
  if (command === 'purge') result = await purgeHandover({db, ledgerFile, handoverId:options.handover});
  else if (command === 'prepare-restored') result = await prepareRestoredFeedback({db,ledgerFile});
  else {
   result = await reconcileFeedbackDeletions({db,ledgerFile,release:true});
  }
  console.log(JSON.stringify(result));
 }
} catch (error) { console.error('FEEDBACK_OPERATION_FAILED:', error.message); process.exitCode=1; }
finally { await db?.close(); }
