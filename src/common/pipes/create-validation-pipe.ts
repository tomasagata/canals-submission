import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';

/**
 * Flattens class-validator's nested ValidationError tree (one entry per
 * field, each carrying its own `children` for nested DTOs) into a flat list
 * of "path: constraint message" strings.
 */
function collectMessages(errors: ValidationError[], parentPath = ''): string[] {
  return errors.flatMap((error) => {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;
    const ownMessages = Object.values(error.constraints ?? {}).map((message) => `${path}: ${message}`);
    const childMessages = error.children?.length ? collectMessages(error.children, path) : [];
    return [...ownMessages, ...childMessages];
  });
}

/**
 * Same ValidationPipe used in both main.ts and the test harness, so
 * class-validator failures return the app's standard
 * `{statusCode, code, message}` shape instead of Nest's default
 * `{statusCode, message: string[], error}`.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors: ValidationError[]) =>
      new BadRequestException({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: collectMessages(errors),
      }),
  });
}
