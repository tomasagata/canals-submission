import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { DomainExceptionFilter } from './common/filters/domain-exception.filter.js';
import { createValidationPipe } from './common/pipes/create-validation-pipe.js';

/**
 * Every write path in this service - accepting an order, reserving stock,
 * releasing it - depends on a multi-document transaction, which MongoDB only
 * supports on a replica set. Checking once at boot turns an obscure runtime
 * failure on the first request into an explicit, actionable message here.
 */
async function assertReplicaSet(connection: Connection, logger: Logger): Promise<void> {
  const admin = connection.db?.admin();
  if (!admin) return;
  const info = (await admin.command({ hello: 1 })) as { setName?: string };
  if (!info.setName) {
    logger.error(
      'MONGO_URI points at a standalone mongod. Transactions are unavailable, so every order write will fail. ' +
        'Start mongod with --replSet rs0, run rs.initiate(), and append ?replicaSet=rs0&directConnection=true to MONGO_URI.',
    );
    throw new Error('MongoDB is not running as a replica set.');
  }
  logger.log(`Connected to MongoDB replica set '${info.setName}'.`);
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableCors();
  // Required for the queue worker and the outbox relay to shut down cleanly on
  // SIGTERM rather than being killed mid-saga.
  app.enableShutdownHooks();

  await assertReplicaSet(app.get<Connection>(getConnectionToken()), logger);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);
  logger.log(`Listening on port ${port}.`);
}
await bootstrap();
