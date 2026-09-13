/**
 * Runs before any application module is imported.
 *
 * ORDER_SAGA_WORKER_ENABLED must be set here rather than inside the harness:
 * OrdersModule reads it at module-definition time (it decides whether
 * @nestjs/bullmq opens a Redis connection for the @Processor), and ES module
 * evaluation happens before any test body runs.
 *
 * Every other test setting is applied in createTestHarness, where it can be
 * overridden per suite.
 */
process.env.ORDER_SAGA_WORKER_ENABLED = 'false';
