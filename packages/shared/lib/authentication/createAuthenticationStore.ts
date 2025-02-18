import { decodeUtf8Base64, encodeUtf8Base64 } from '@proton/crypto/lib/utils';

import {
    LOCAL_ID_KEY,
    MAILBOX_PASSWORD_KEY,
    PERSIST_SESSION_KEY,
    SSO_PATHS,
    TRUST_SESSION_KEY,
    UID_KEY,
    isSSOMode,
} from '../constants';
import { stripLeadingAndTrailingSlash } from '../helpers/string';
import { getBasename, getLocalIDFromPathname, stripLocalBasenameFromPathname } from './pathnameHelper';
import { getPersistedSession } from './persistedSessionStorage';

const getIsSSOPath = (pathname: string) => {
    const strippedPathname = `/${stripLeadingAndTrailingSlash(pathname)}`;
    return Object.values(SSO_PATHS).some((path) => strippedPathname.startsWith(path));
};

export const getSafePath = (url: string) => {
    try {
        const { pathname, hash, search } = new URL(url, window.location.origin);
        if (getIsSSOPath(pathname)) {
            return '';
        }
        return `${stripLeadingAndTrailingSlash(stripLocalBasenameFromPathname(pathname))}${search}${hash}`;
    } catch (e: any) {
        return '';
    }
};

const getPath = (basename: string | undefined, oldUrl: string, requestedPath?: string) => {
    return [basename || '', `/${getSafePath(requestedPath || '/') || getSafePath(oldUrl)}`].join('');
};

interface AuthData {
    UID: string | undefined;
    localID: number | undefined;
    basename: string | undefined;
}

const defaultAuthData = {
    UID: undefined,
    localID: undefined,
    basename: undefined,
};

const getInitialState = (mode: 'sso' | 'standalone', oldUID?: string, oldLocalID?: number): AuthData => {
    if (mode === 'standalone') {
        return {
            UID: oldUID,
            localID: undefined,
            basename: undefined,
        };
    }
    const { pathname } = window.location;
    if (getIsSSOPath(pathname)) {
        // Special routes which should never be logged in
        return defaultAuthData;
    }
    const localID = getLocalIDFromPathname(pathname);
    if (localID === undefined) {
        return defaultAuthData;
    }
    const persistedSession = getPersistedSession(localID);
    // Current session is active and actual
    if (persistedSession && (oldUID === undefined || (persistedSession.UID === oldUID && localID === oldLocalID))) {
        return {
            UID: persistedSession.UID,
            localID,
            basename: getBasename(localID),
        };
    }
    return defaultAuthData;
};

interface Arguments {
    mode?: 'sso' | 'standalone';
    initialAuth?: boolean;
    store: {
        set: (key: string, value: any) => void;
        get: (key: string) => any;
    };
    onUID?: (UID: string | undefined) => void;
}

const createAuthenticationStore = ({
    mode = isSSOMode ? 'sso' : 'standalone',
    initialAuth,
    store: { set, get },
    onUID,
}: Arguments) => {
    const setUID = (UID: string | undefined) => {
        set(UID_KEY, UID);
        onUID?.(UID);
    };
    const getUID = (): string => get(UID_KEY);

    const setPassword = (password: string | undefined) => {
        if (password === undefined) {
            set(MAILBOX_PASSWORD_KEY, password);
            return;
        }
        set(MAILBOX_PASSWORD_KEY, encodeUtf8Base64(password));
    };
    const getPassword = () => {
        const value: string | undefined = get(MAILBOX_PASSWORD_KEY);
        if (value === undefined) {
            return '';
        }
        return decodeUtf8Base64(value);
    };

    const getLocalID = () => get(LOCAL_ID_KEY);

    const setLocalID = (LocalID: number | undefined) => {
        set(LOCAL_ID_KEY, LocalID);
    };

    const hasSession = () => !!getUID();

    const setPersistent = (persist: boolean | undefined) => set(PERSIST_SESSION_KEY, persist);
    // Keep old default behavior
    const getPersistent = () => get(PERSIST_SESSION_KEY) ?? true;

    const setTrusted = (trusted: boolean | undefined) => set(TRUST_SESSION_KEY, trusted);
    const getTrusted = () => get(TRUST_SESSION_KEY) ?? false;

    const initialUID = getUID();
    let initialAuthData: AuthData =
        initialAuth === false ? defaultAuthData : getInitialState(mode, initialUID, getLocalID());
    let basename = initialAuthData.basename;

    // Ensure the store is up-to-date
    setUID(initialAuthData?.UID);

    const login = ({
        UID: newUID,
        keyPassword,
        LocalID: newLocalID,
        persistent,
        trusted,
        path,
    }: {
        UID: string;
        keyPassword?: string;
        LocalID: number;
        persistent: boolean;
        trusted: boolean;
        path?: string;
    }) => {
        setUID(newUID);
        setPassword(keyPassword);
        setPersistent(persistent);
        setTrusted(trusted);

        if (newLocalID !== undefined && mode === 'sso') {
            setLocalID(newLocalID);
            basename = getBasename(newLocalID);
        } else {
            setLocalID(undefined);
            basename = undefined;
        }

        return getPath(basename, window.location.href, path);
    };

    const logout = () => {
        setUID(undefined);
        setPassword(undefined);
        setPersistent(undefined);
        setLocalID(undefined);
        setTrusted(undefined);
        basename = undefined;
    };

    return {
        getUID,
        setUID,
        setLocalID,
        getLocalID,
        hasSession,
        setPassword,
        getPassword,
        setPersistent,
        getPersistent,
        setTrusted,
        getTrusted,
        logout,
        login,
        mode,
        get UID() {
            return getUID();
        },
        get localID() {
            return getLocalID();
        },
        get basename() {
            return basename;
        },
        get ready(): boolean {
            return Boolean(initialAuthData.UID && initialUID);
        },
    };
};

export type AuthenticationStore = ReturnType<typeof createAuthenticationStore>;

export default createAuthenticationStore;
