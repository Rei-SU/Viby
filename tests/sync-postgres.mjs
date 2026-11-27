import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

// Install embedded-postgres in a separate scratch directory, then pass that
// directory as the argument. This test always creates a new loopback cluster.
if (!process.argv[2]) throw new Error('Pass the scratch directory containing embedded-postgres.')
const require = createRequire(resolve(process.argv[2], 'package.json'))
const { default: EmbeddedPostgres } = await import(pathToFileURL(require.resolve('embedded-postgres')))
const probe = createServer()
await new Promise((done) => probe.listen(0, '127.0.0.1', done))
const { port } = probe.address()
await new Promise((done) => probe.close(done))
const db = new EmbeddedPostgres({
  port,
  databaseDir: join(mkdtempSync(join(tmpdir(), 'viby-sync-test-')), 'data'),
  persistent: false,
  initdbFlags: ['--locale=C'],
  postgresFlags: ['-h', '127.0.0.1'],
  onLog: () => {}
})
const clients = []
const accountA = '00000000-0000-4000-8000-000000000001'
const accountB = '00000000-0000-4000-8000-000000000002'
const record = (id, patch = {}) => ({
  kind: 'favorite', record_id: id, updated_at: Date.now(), device_id: 'test-device',
  payload: { id, title: id, artist: 'Test', durationSec: 100 }, deleted: false, ...patch
})

async function connect() {
  const client = db.getPgClient('postgres', '127.0.0.1')
  await client.connect()
  clients.push(client)
  return client
}

async function asAccount(client, userId) {
  await client.query('begin')
  await client.query('set local role authenticated')
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId])
}

const push = (client, row) =>
  client.query('select * from public.sync_push($1::jsonb)', [JSON.stringify([row])])

await db.initialise()
await db.start()
try {
  const admin = await connect()
  await admin.query(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to anon, authenticated, service_role;
    create schema realtime;
    create function realtime.topic() returns text language sql stable as
      $$select current_setting('realtime.topic', true)$$;
    create table realtime.messages (extension text);
    alter table realtime.messages enable row level security;
  `)
  const migrations = resolve('supabase/migrations')
  for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
    if (file.endsWith('_harden_sync_writes.sql')) {
      // Match legacy default grants verified on the hosted project.
      await admin.query(`
        grant truncate, references, trigger on public.sync_records to authenticated;
        grant update, usage on sequence public.sync_rev_seq to anon, authenticated;
      `)
    }
    await admin.query(readFileSync(join(migrations, file), 'utf8'))
  }
  await admin.query('insert into auth.users (id) values ($1), ($2)', [accountA, accountB])
  const roles = await admin.query(`
    select
      has_function_privilege('anon', 'public.sync_push(jsonb)', 'EXECUTE') as anon_push,
      has_table_privilege('authenticated', 'public.sync_records', 'TRUNCATE') as truncate,
      has_table_privilege('authenticated', 'public.sync_records', 'INSERT,UPDATE,DELETE') as write,
      has_sequence_privilege('authenticated', 'public.sync_rev_seq', 'UPDATE,USAGE') as sequence,
      has_sequence_privilege('anon', 'public.sync_rev_seq', 'UPDATE,USAGE') as anon_sequence
  `)
  assert.deepEqual(Object.values(roles.rows[0]), [false, false, false, false, false])

  const first = await connect()
  const second = await connect()
  const reader = await connect()
  const other = await connect()
  await asAccount(first, accountA)
  const firstWrite = await push(first, record('first'))
  assert.equal(firstWrite.rowCount, 1)
  await asAccount(second, accountA)
  const secondPid = (await second.query('select pg_backend_pid() as pid')).rows[0].pid
  const secondWrite = push(second, record('second'))
  let waitsForAccount = false
  for (let attempt = 0; attempt < 50 && !waitsForAccount; attempt++) {
    const activity = await admin.query('select wait_event from pg_stat_activity where pid = $1', [secondPid])
    waitsForAccount = activity.rows[0]?.wait_event === 'advisory'
    if (!waitsForAccount) await delay(20)
  }
  assert.equal(waitsForAccount, true, 'same-account writes wait before allocating revisions')

  await asAccount(other, accountB)
  await other.query("set local statement_timeout = '2s'")
  assert.equal((await push(other, record('other'))).rowCount, 1)
  await other.query('commit')
  await asAccount(reader, accountA)
  const visible = (cursor) => reader.query(
    'select record_id, rev from public.sync_records where rev > $1 order by rev', [cursor]
  )
  assert.equal((await visible(0)).rowCount, 0, 'uncommitted or cross-account rows stay invisible')
  await first.query('commit')
  const checkpoint = (await visible(0)).rows
  assert.deepEqual(checkpoint.map((row) => row.record_id), ['first'])
  await secondWrite
  await second.query('commit')
  assert.deepEqual((await visible(checkpoint[0].rev)).rows.map((row) => row.record_id), ['second'])

  const future = Date.now() + 86_400_000
  const clamped = await push(reader, record('future', { updated_at: future }))
  assert.ok(Number(clamped.rows[0].updated_at) < future)
  assert.ok(Number(clamped.rows[0].updated_at) <= Date.now() + 300_000)
  assert.equal((await push(reader, record('first', { updated_at: 0 }))).rowCount, 0)
  assert.equal((await push(reader, record('oversize', { payload: { title: 'x'.repeat(70_000) } }))).rowCount, 0)
  await reader.query('commit')

  await asAccount(reader, accountA)
  await assert.rejects(push(reader, record('wrong-account', { user_id: accountB })), { code: '42501' })
  await reader.query('rollback')

  for (const query of ['delete from public.sync_records', 'truncate public.sync_records',
    'update public.sync_records set rev = 0', "select setval('public.sync_rev_seq', 1)"]) {
    await asAccount(reader, accountA)
    await assert.rejects(reader.query(query), { code: '42501' })
    await reader.query('rollback')
  }

  console.log('PostgreSQL sync checks passed: grants, RLS, concurrent commits, bounds, clock clamp and rejected writes.')
} finally {
  await Promise.allSettled(clients.map((client) => client.end()))
  await db.stop()
}
