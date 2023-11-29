import { type ReactNode } from 'react';
import { Provider, type TypedUseSelectorHook } from 'react-redux';

import type { Action } from '@reduxjs/toolkit';
import type { AnyAction, Store } from 'redux';

import { ProtonStoreContext, baseUseDispatch, baseUseSelector } from './sharedContext';
import type { SharedStore } from './sharedStore';

type UseProtonDispatch = SharedStore['dispatch'];
type SharedState = ReturnType<SharedStore['getState']>;

export interface ProtonStoreProviderProps<S = any, A extends Action = AnyAction> {
    store: Store<S, A>;
    children: ReactNode;
}

export const ProtonStoreProvider = ({ children, store }: ProtonStoreProviderProps) => {
    return (
        <Provider context={ProtonStoreContext} store={store}>
            {children}
        </Provider>
    );
};

export let useDispatch: () => UseProtonDispatch = baseUseDispatch;
export let useSelector: TypedUseSelectorHook<SharedState> = baseUseSelector;
