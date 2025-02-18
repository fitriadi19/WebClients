import type { Action } from 'redux';

import { merge } from '@proton/pass/utils/object/merge';

export type WithSynchronousClientAction<T = Action> = T & { meta: { sync: true } };

export const isClientSynchronousAction = <T extends Action>(action?: T): action is WithSynchronousClientAction<T> =>
    (action as any)?.meta?.sync === true;

const withSynchronousClientAction = <T extends object>(action: T): WithSynchronousClientAction<T> =>
    merge(action, { meta: { sync: true as const } });

export default withSynchronousClientAction;
