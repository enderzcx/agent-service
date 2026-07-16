import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ARTIFACT_KINDS,
  createFileProfileStore,
  createMemoryProfileStore,
  type ProfileStore
} from '../../src/storage/profileStore.js';
import type { ProfileStoreError } from '../../src/storage/profileStore.js';
import {
  BOTCHAIN_TESTNET_PROFILE,
  buildProfileFingerprint,
  chainProfileSchema
} from '../../src/chain/profile.js';

const FIXED_TIME = new Date('2026-07-16T10:00:00.000Z');
const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agent-service-store-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

function exerciseStoreContract(
  label: string,
  createStore: () => Promise<ProfileStore>
): void {
  describe(label, () => {
    it('creates, reads, lists, and revision-updates through one profile seam', async () => {
      const store = await createStore();
      const created = await store.create({
        kind: 'job',
        id: 'job-001',
        verificationLevel: 'LOCAL_UNIT',
        payload: { state: 'created' }
      });

      expect(created.revision).toBe(1);
      expect(created.profileFingerprint).toBe(
        buildProfileFingerprint(BOTCHAIN_TESTNET_PROFILE).fingerprint
      );
      await expect(store.get('job', 'job-001')).resolves.toEqual(created);
      await expect(store.list('job')).resolves.toEqual([created]);

      const updated = await store.update({
        kind: 'job',
        id: 'job-001',
        expectedRevision: 1,
        verificationLevel: 'DRY_RUN_SIMULATED',
        payload: { state: 'funding_planned' }
      });
      expect(updated.revision).toBe(2);
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated.updatedAt).toBe(FIXED_TIME.toISOString());
    });

    it('rejects duplicate creates, stale revisions, and traversal ids', async () => {
      const store = await createStore();
      await store.create({
        kind: 'session',
        id: 'session-001',
        verificationLevel: 'LOCAL_UNIT',
        payload: { state: 'planned' }
      });

      await expect(
        store.create({
          kind: 'session',
          id: 'session-001',
          verificationLevel: 'LOCAL_UNIT',
          payload: { state: 'duplicate' }
        })
      ).rejects.toEqual(expect.objectContaining({ code: 'store_record_exists' }));
      await expect(
        store.update({
          kind: 'session',
          id: 'session-001',
          expectedRevision: 0,
          verificationLevel: 'LOCAL_UNIT',
          payload: { state: 'stale' }
        })
      ).rejects.toEqual(expect.objectContaining({ code: 'store_revision_conflict' }));
      await expect(store.get('session', '../escape')).rejects.toEqual(
        expect.objectContaining<Partial<ProfileStoreError>>({ code: 'store_id_invalid' })
      );
    });

    it('supports every persistent surface without a fallback bucket', async () => {
      const store = await createStore();
      for (const kind of ARTIFACT_KINDS) {
        await store.create({
          kind,
          id: `${kind}-001`,
          verificationLevel: 'LOCAL_UNIT',
          payload: { kind }
        });
        await expect(store.get(kind, `${kind}-001`)).resolves.toEqual(
          expect.objectContaining({ kind, id: `${kind}-001` })
        );
      }
    });
  });
}

exerciseStoreContract('memory adapter', () =>
  Promise.resolve(
    createMemoryProfileStore({ profile: BOTCHAIN_TESTNET_PROFILE, clock: () => FIXED_TIME })
  )
);

exerciseStoreContract('atomic file adapter', async () =>
  createFileProfileStore({
    profile: BOTCHAIN_TESTNET_PROFILE,
    rootDir: await temporaryRoot(),
    clock: () => FIXED_TIME
  })
);

describe('ProfileStore isolation', () => {
  it('uses different physical namespaces when a fingerprint field changes', async () => {
    const rootDir = await temporaryRoot();
    const alternateProfile = chainProfileSchema.parse({
      ...BOTCHAIN_TESTNET_PROFILE,
      bundlerUrl: 'https://alternate-bundler.bohr.life/rpc'
    });
    const primary = createFileProfileStore({
      profile: BOTCHAIN_TESTNET_PROFILE,
      rootDir,
      clock: () => FIXED_TIME
    });
    const alternate = createFileProfileStore({
      profile: alternateProfile,
      rootDir,
      clock: () => FIXED_TIME
    });

    await primary.create({
      kind: 'cache',
      id: 'same-id',
      verificationLevel: 'READONLY_RPC',
      payload: { source: 'primary' }
    });
    await alternate.create({
      kind: 'cache',
      id: 'same-id',
      verificationLevel: 'READONLY_RPC',
      payload: { source: 'alternate' }
    });

    await expect(primary.get('cache', 'same-id')).resolves.toEqual(
      expect.objectContaining({ payload: { source: 'primary' } })
    );
    await expect(alternate.get('cache', 'same-id')).resolves.toEqual(
      expect.objectContaining({ payload: { source: 'alternate' } })
    );
    const namespaces = await readdir(rootDir);
    expect(namespaces).toHaveLength(2);
    expect(new Set(namespaces).size).toBe(2);
  });

  it('rejects a file whose embedded fingerprint was tampered', async () => {
    const rootDir = await temporaryRoot();
    const store = createFileProfileStore({
      profile: BOTCHAIN_TESTNET_PROFILE,
      rootDir,
      clock: () => FIXED_TIME
    });
    await store.create({
      kind: 'evidence',
      id: 'evidence-001',
      verificationLevel: 'READONLY_RPC',
      payload: { status: 'observed' }
    });

    const { namespace } = buildProfileFingerprint(BOTCHAIN_TESTNET_PROFILE);
    const recordPath = join(rootDir, namespace, 'evidence', 'evidence-001.json');
    const envelope = JSON.parse(await readFile(recordPath, 'utf8')) as Record<string, unknown>;
    envelope['profileFingerprint'] = `sha256:${'0'.repeat(64)}`;
    await writeFile(recordPath, `${JSON.stringify(envelope)}\n`, 'utf8');

    await expect(store.get('evidence', 'evidence-001')).rejects.toEqual(
      expect.objectContaining({ code: 'store_profile_mismatch' })
    );
  });
});
