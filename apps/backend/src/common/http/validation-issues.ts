import type { ValidationError } from 'class-validator';
import type { PublicValidationIssue } from './public-http-exception.js';

/** Return rule locations only; validator messages and input values are private. */
export function validationIssues(errors: ValidationError[], parent = ''): PublicValidationIssue[] {
  return errors.flatMap((error) => {
    const segment = error.property.replaceAll('~', '~0').replaceAll('/', '~1');
    const path = `${parent}/${segment}`;
    const constraints = Object.keys(error.constraints ?? {});
    const unknown = constraints.includes('whitelistValidation');
    return [
      ...(constraints.length
        ? [
            {
              code: unknown ? 'UNKNOWN_FIELD' : 'INVALID_VALUE',
              path,
              message: unknown ? 'Unknown field' : 'Invalid value',
            },
          ]
        : []),
      ...validationIssues(error.children ?? [], path),
    ];
  });
}
