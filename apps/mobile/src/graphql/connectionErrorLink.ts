import { ApolloLink, Observable } from '@apollo/client';
import { getMainDefinition } from '@apollo/client/utilities';
import {
  describePosConnectionFailure,
  isPosBusinessError,
  posTransportError,
} from '../../../../packages/pos-client-core/src/connectionFailure';

/** Keep extensions/path intact: callers still use server codes and variant selection. */
export function connectionErrorLink() {
  return new ApolloLink((operation, forward) => new Observable(observer => {
    const definition = getMainDefinition(operation.query);
    const mutation = definition.kind === 'OperationDefinition' && definition.operation === 'mutation';
    const subscription = forward(operation).subscribe({
      next: result => {
        if (result.errors != null && (!Array.isArray(result.errors)
          || result.errors.some(error => !error || typeof error.message !== 'string'))) {
          observer.error(posTransportError({ code: 'INVALID_RESPONSE', httpStatus: 200 }, mutation));
          return;
        }
        if (!result.errors?.length && (!result.data || typeof result.data !== 'object'
          || Array.isArray(result.data) || Object.keys(result.data).length === 0)) {
          observer.error(posTransportError({ code: 'INVALID_RESPONSE', httpStatus: 200 }, mutation));
          return;
        }
        observer.next({
          ...result,
          ...(result.errors?.length ? { errors: result.errors.map(error => ({
            ...error,
            message: isPosBusinessError(error.extensions?.code) ? error.message
              : describePosConnectionFailure({ ...error, httpStatus: 200 }, mutation).message,
          })) } : {}),
        });
      },
      error: error => observer.error(posTransportError(error, mutation)),
      complete: () => observer.complete(),
    });
    return () => subscription.unsubscribe();
  }));
}
