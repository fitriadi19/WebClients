import { browserLocalStorage, browserSessionStorage } from '@proton/pass/lib/extension/storage';
import type {
    GetItems,
    LocalStoreData,
    LocalStoreKeys,
    RemoveItems,
    SessionStoreData,
    SessionStoreKeys,
    SetItems,
    Storage,
    StorageInterface,
    StorageKeys,
} from '@proton/pass/types';
import noop from '@proton/utils/noop';

type StorageState = { storageFull: boolean };

export interface ExtensionStorage<T, K extends StorageKeys<T>> extends Storage<T> {
    getItems: GetItems<T, K[]>;
    setItems: SetItems<T>;
    removeItems: RemoveItems<T>;
}

export const createStorageService = () => {
    const localStorage = browserLocalStorage as StorageInterface<LocalStoreData>;
    const sessionStorage = browserSessionStorage as StorageInterface<SessionStoreData>;

    const state: StorageState = { storageFull: false };

    const handleStorageError = <T extends (...args: any[]) => Promise<any>>(fn: T) =>
        ((...args) =>
            fn(...args)
                .then((res) => {
                    state.storageFull = false;
                    return res;
                })
                .catch((err) => {
                    if (err instanceof Error) {
                        const message = err.message.toLowerCase();
                        if (
                            err.name === 'QuotaExceededError' ||
                            message.includes('quota') ||
                            message.includes('storage')
                        ) {
                            state.storageFull = true;
                        }
                    }

                    throw err;
                })) as T;

    const local: ExtensionStorage<LocalStoreData, LocalStoreKeys> = {
        getItem: (key) => localStorage.getItem(key).catch(() => null),
        getItems: (keys) => localStorage.getItems(keys).catch(() => ({})),
        setItem: handleStorageError(localStorage.setItem),
        setItems: handleStorageError(localStorage.setItems),
        removeItem: (key) => localStorage.removeItem(key).catch(noop),
        removeItems: (keys) => localStorage.removeItems(keys).catch(noop),
        clear: () => localStorage.clear().catch(noop),
    };

    const session: ExtensionStorage<SessionStoreData, SessionStoreKeys> = {
        getItem: (key) =>
            sessionStorage
                .getItem(key)
                .then((value) => value ?? null)
                .catch(() => null),
        getItems: (keys) => sessionStorage.getItems(keys).catch(() => ({})),
        setItem: (key, value) => sessionStorage.setItem(key, value).catch(noop),
        setItems: (items) => sessionStorage.setItems(items).catch(noop),
        removeItem: (key) => sessionStorage.removeItem(key).catch(noop),
        removeItems: (keys) => sessionStorage.removeItems(keys).catch(noop),
        clear: () => sessionStorage.clear().catch(noop),
    };

    return { local, session, getState: () => state };
};

export type StorageService = ReturnType<typeof createStorageService>;
