import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

import {
  buildProfileFingerprint,
  type ChainRuntimeProfile,
  type ProfileFingerprint
} from '../chain/profile.js';
import {
  VERIFICATION_LEVELS,
  type VerificationLevel
} from '../kernel/verification.js';

export const ARTIFACT_KINDS = [
  'identity',
  'negotiation',
  'workflow',
  'job',
  'receipt',
  'evidence',
  'session',
  'user-operation',
  'service-result',
  'cache',
  'deployment',
  'audit'
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

const recordIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const artifactKindSchema = z.enum(ARTIFACT_KINDS);
const verificationLevelSchema = z.enum(VERIFICATION_LEVELS);
const storedRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    profileFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    namespace: z.string().min(1),
    kind: artifactKindSchema,
    id: z.string().regex(recordIdPattern),
    revision: z.number().int().positive(),
    verificationLevel: verificationLevelSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    payload: z.json()
  })
  .strict();

export interface StoredRecord<T extends JsonValue = JsonValue> {
  readonly schemaVersion: 1;
  readonly profileFingerprint: string;
  readonly namespace: string;
  readonly kind: ArtifactKind;
  readonly id: string;
  readonly revision: number;
  readonly verificationLevel: VerificationLevel;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly payload: T;
}

export interface CreateRecordInput<T extends JsonValue> {
  readonly kind: ArtifactKind;
  readonly id: string;
  readonly verificationLevel: VerificationLevel;
  readonly payload: T;
}

export interface UpdateRecordInput<T extends JsonValue> extends CreateRecordInput<T> {
  readonly expectedRevision: number;
}

export interface ProfileStore {
  readonly identity: ProfileFingerprint;
  create<T extends JsonValue>(input: CreateRecordInput<T>): Promise<StoredRecord<T>>;
  update<T extends JsonValue>(input: UpdateRecordInput<T>): Promise<StoredRecord<T>>;
  get<T extends JsonValue = JsonValue>(
    kind: ArtifactKind,
    id: string
  ): Promise<StoredRecord<T> | null>;
  list<T extends JsonValue = JsonValue>(kind: ArtifactKind): Promise<readonly StoredRecord<T>[]>;
}

export class ProfileStoreError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    code: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = 'ProfileStoreError';
    this.code = code;
    this.details = details;
  }
}

interface StoreOptions {
  readonly profile: ChainRuntimeProfile;
  readonly clock?: () => Date;
}

interface FileStoreOptions extends StoreOptions {
  readonly rootDir: string;
}

function validateId(id: string): void {
  if (!recordIdPattern.test(id)) {
    throw new ProfileStoreError('Store record ID is invalid.', 'store_id_invalid', { id });
  }
}

function validateKind(kind: ArtifactKind): void {
  if (!artifactKindSchema.safeParse(kind).success) {
    throw new ProfileStoreError('Store artifact kind is invalid.', 'store_kind_invalid', { kind });
  }
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function cloneRecord<T extends JsonValue>(record: StoredRecord<T>): StoredRecord<T> {
  return deepFreeze(structuredClone(record));
}

function buildRecord<T extends JsonValue>(
  identity: ProfileFingerprint,
  input: CreateRecordInput<T>,
  revision: number,
  createdAt: string,
  updatedAt: string
): StoredRecord<T> {
  validateKind(input.kind);
  validateId(input.id);
  const parsed = storedRecordSchema.parse({
    schemaVersion: 1,
    profileFingerprint: identity.fingerprint,
    namespace: identity.namespace,
    kind: input.kind,
    id: input.id,
    revision,
    verificationLevel: input.verificationLevel,
    createdAt,
    updatedAt,
    payload: input.payload
  });
  return cloneRecord(parsed as StoredRecord<T>);
}

function assertRecordIdentity(
  record: StoredRecord,
  identity: ProfileFingerprint,
  kind: ArtifactKind,
  id: string
): void {
  if (record.profileFingerprint !== identity.fingerprint) {
    throw new ProfileStoreError(
      'Stored record profile fingerprint does not match the active runtime.',
      'store_profile_mismatch',
      { expected: identity.fingerprint, actual: record.profileFingerprint, kind, id }
    );
  }
  if (record.namespace !== identity.namespace) {
    throw new ProfileStoreError(
      'Stored record namespace does not match the active runtime.',
      'store_namespace_mismatch',
      { expected: identity.namespace, actual: record.namespace, kind, id }
    );
  }
  if (record.kind !== kind || record.id !== id) {
    throw new ProfileStoreError(
      'Stored record path identity does not match its envelope.',
      'store_record_identity_mismatch',
      { expectedKind: kind, actualKind: record.kind, expectedId: id, actualId: record.id }
    );
  }
}

class MemoryProfileStore implements ProfileStore {
  readonly identity: ProfileFingerprint;
  readonly #clock: () => Date;
  readonly #records = new Map<string, StoredRecord>();

  constructor(options: StoreOptions) {
    this.identity = buildProfileFingerprint(options.profile);
    this.#clock = options.clock ?? (() => new Date());
  }

  create<T extends JsonValue>(input: CreateRecordInput<T>): Promise<StoredRecord<T>> {
    try {
      const key = this.#key(input.kind, input.id);
      if (this.#records.has(key)) {
        throw new ProfileStoreError('Store record already exists.', 'store_record_exists', {
          kind: input.kind,
          id: input.id
        });
      }
      const now = this.#clock().toISOString();
      const record = buildRecord(this.identity, input, 1, now, now);
      this.#records.set(key, record);
      return Promise.resolve(cloneRecord(record));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async update<T extends JsonValue>(input: UpdateRecordInput<T>): Promise<StoredRecord<T>> {
    const current = await this.get(input.kind, input.id);
    if (!current) {
      throw new ProfileStoreError('Store record does not exist.', 'store_record_missing', {
        kind: input.kind,
        id: input.id
      });
    }
    if (current.revision !== input.expectedRevision) {
      throw new ProfileStoreError('Store revision conflict.', 'store_revision_conflict', {
        kind: input.kind,
        id: input.id,
        expectedRevision: input.expectedRevision,
        actualRevision: current.revision
      });
    }
    const record = buildRecord(
      this.identity,
      input,
      current.revision + 1,
      current.createdAt,
      this.#clock().toISOString()
    );
    this.#records.set(this.#key(input.kind, input.id), record);
    return cloneRecord(record);
  }

  get<T extends JsonValue = JsonValue>(
    kind: ArtifactKind,
    id: string
  ): Promise<StoredRecord<T> | null> {
    let key: string;
    try {
      key = this.#key(kind, id);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    const record = this.#records.get(key);
    if (!record) return Promise.resolve(null);
    assertRecordIdentity(record, this.identity, kind, id);
    return Promise.resolve(cloneRecord(record as StoredRecord<T>));
  }

  list<T extends JsonValue = JsonValue>(kind: ArtifactKind): Promise<readonly StoredRecord<T>[]> {
    try {
      validateKind(kind);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    const prefix = `${kind}:`;
    const records = [...this.#records.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, record]) => cloneRecord(record as StoredRecord<T>))
      .sort((left, right) => left.id.localeCompare(right.id));
    return Promise.resolve(Object.freeze(records));
  }

  #key(kind: ArtifactKind, id: string): string {
    validateKind(kind);
    validateId(id);
    return `${kind}:${id}`;
  }
}

class FileProfileStore implements ProfileStore {
  readonly identity: ProfileFingerprint;
  readonly #rootDir: string;
  readonly #clock: () => Date;

  constructor(options: FileStoreOptions) {
    this.identity = buildProfileFingerprint(options.profile);
    this.#rootDir = resolve(options.rootDir);
    this.#clock = options.clock ?? (() => new Date());
  }

  async create<T extends JsonValue>(input: CreateRecordInput<T>): Promise<StoredRecord<T>> {
    if (await this.get(input.kind, input.id)) {
      throw new ProfileStoreError('Store record already exists.', 'store_record_exists', {
        kind: input.kind,
        id: input.id
      });
    }
    const now = this.#clock().toISOString();
    const record = buildRecord(this.identity, input, 1, now, now);
    await this.#write(record);
    return cloneRecord(record);
  }

  async update<T extends JsonValue>(input: UpdateRecordInput<T>): Promise<StoredRecord<T>> {
    const current = await this.get(input.kind, input.id);
    if (!current) {
      throw new ProfileStoreError('Store record does not exist.', 'store_record_missing', {
        kind: input.kind,
        id: input.id
      });
    }
    if (current.revision !== input.expectedRevision) {
      throw new ProfileStoreError('Store revision conflict.', 'store_revision_conflict', {
        kind: input.kind,
        id: input.id,
        expectedRevision: input.expectedRevision,
        actualRevision: current.revision
      });
    }
    const record = buildRecord(
      this.identity,
      input,
      current.revision + 1,
      current.createdAt,
      this.#clock().toISOString()
    );
    await this.#write(record);
    return cloneRecord(record);
  }

  async get<T extends JsonValue = JsonValue>(
    kind: ArtifactKind,
    id: string
  ): Promise<StoredRecord<T> | null> {
    const recordPath = this.#recordPath(kind, id);
    let raw: string;
    try {
      raw = await readFile(recordPath, 'utf8');
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      throw new ProfileStoreError('Stored record is not valid JSON.', 'store_record_corrupt', {
        kind,
        id
      });
    }
    const parsed = storedRecordSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new ProfileStoreError(
        'Stored record does not match the envelope schema.',
        'store_record_corrupt',
        { kind, id, issues: parsed.error.issues }
      );
    }
    const record = parsed.data as StoredRecord<T>;
    assertRecordIdentity(record, this.identity, kind, id);
    return cloneRecord(record);
  }

  async list<T extends JsonValue = JsonValue>(
    kind: ArtifactKind
  ): Promise<readonly StoredRecord<T>[]> {
    validateKind(kind);
    const directory = this.#kindDirectory(kind);
    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return Object.freeze([]);
      }
      throw error;
    }
    const ids = entries
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => entry.slice(0, -'.json'.length))
      .sort();
    const records = await Promise.all(ids.map((id) => this.get<T>(kind, id)));
    return Object.freeze(records.filter((record): record is StoredRecord<T> => record !== null));
  }

  #kindDirectory(kind: ArtifactKind): string {
    validateKind(kind);
    return resolve(this.#rootDir, this.identity.namespace, kind);
  }

  #recordPath(kind: ArtifactKind, id: string): string {
    validateId(id);
    return resolve(this.#kindDirectory(kind), `${id}.json`);
  }

  async #write<T extends JsonValue>(record: StoredRecord<T>): Promise<void> {
    const directory = this.#kindDirectory(record.kind);
    const target = this.#recordPath(record.kind, record.id);
    const temporary = resolve(directory, `.${record.id}.${process.pid}.${randomUUID()}.tmp`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600
      });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

export function createMemoryProfileStore(options: StoreOptions): ProfileStore {
  return new MemoryProfileStore(options);
}

export function createFileProfileStore(options: FileStoreOptions): ProfileStore {
  return new FileProfileStore(options);
}
