import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Boots one in-memory MongoDB replica set for the whole integration run.
 *
 * A replica set rather than a standalone because this codebase depends on
 * multi-document transactions; a single node is enough to enable them.
 */
let replSet: MongoMemoryReplSet | undefined;

export async function setup(): Promise<void> {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  process.env.MONGO_URI = replSet.getUri('canals_test');
}

export async function teardown(): Promise<void> {
  await replSet?.stop();
}
