import { c } from 'ttag';

import type { CreateNotificationOptions } from '@proton/components/containers';
import { SESSION_LOCK_CODE } from '@proton/pass/lib/api/utils';
import type { Maybe, MaybeNull, MaybePromise } from '@proton/pass/types';
import { type Api, SessionLockStatus } from '@proton/pass/types';
import { NotificationKey } from '@proton/pass/types/worker/notification';
import { pipe, tap } from '@proton/pass/utils/fp/pipe';
import { asyncLock } from '@proton/pass/utils/fp/promises';
import { withCallCount } from '@proton/pass/utils/fp/with-call-count';
import { logger } from '@proton/pass/utils/logger';
import { getEpoch } from '@proton/pass/utils/time/epoch';
import { revoke } from '@proton/shared/lib/api/auth';
import { getApiError, getApiErrorMessage } from '@proton/shared/lib/api/helpers/apiErrorHelper';
import { queryUnlock } from '@proton/shared/lib/api/user';
import { PASS_APP_NAME } from '@proton/shared/lib/constants';
import { srpAuth } from '@proton/shared/lib/srp';
import noop from '@proton/utils/noop';

import { type RefreshSessionData } from '../api/refresh';
import {
    type ConsumeForkPayload,
    type RequestForkOptions,
    type RequestForkResult,
    consumeFork,
    requestFork,
} from './fork';
import {
    type AuthSession,
    type PersistedAuthSession,
    encryptPersistedSession,
    encryptPersistedSessionWithKey,
    isValidSession,
    resumeSession,
} from './session';
import type { SessionLock } from './session-lock';
import {
    checkSessionLock,
    createSessionLock,
    deleteSessionLock,
    forceSessionLock,
    unlockSession,
} from './session-lock';
import { type AuthStore } from './store';

export type AuthResumeOptions = {
    /** `forceLock` will locally lock the session upon resuming */
    forceLock?: boolean;
    /** If `true`, session resuming should be retried */
    retryable?: boolean;
};

export interface AuthServiceConfig {
    api: Api;
    /** Store holding the active session data */
    authStore: AuthStore;
    /** The in-memory session is used to store the session data securely.
     * It allows resuming a session without any API calls to re-authenticate.
     * In most cases you can omit the implementation and rely on the `authStore` */
    getMemorySession?: () => MaybePromise<any>;
    /** The persisted session will be parsed and decrypted to extract the
     * session data. Requires an API call to retrieve the local key. */
    getPersistedSession: (localID: Maybe<number>) => MaybePromise<MaybeNull<PersistedAuthSession>>;
    /**  Implement any service initialization logic in this hook. Should return
     * a boolean flag indicating wether user was authorized or not. */
    onInit: (options: AuthResumeOptions) => Promise<boolean>;
    /** Called when authorization sequence starts: this can happen when consuming a
     * session fork or when trying to resume a session. */
    onAuthorize?: () => void;
    /** Called whenever a user is successfully authenticated. This can happen
     * after consuming a fork or resuming a session.  */
    onAuthorized?: (userID: string, localID: Maybe<number>) => void;
    /** Called whenever a user is unauthenticated. This will be triggered any time
     * the `logout` function is called (either via user action or when an inactive
     * session is detected). The `broadcast` flag indicates wether we should
     * broadcast the unauthorized session to other clients. */
    onUnauthorized?: (userID: Maybe<string>, localID: Maybe<number>, broadcast: boolean) => void;
    /** Called immediately after a fork has been successfully consumed. At this
     * point the user is not fully logged in yet. */
    onForkConsumed?: (session: AuthSession, state: string) => MaybePromise<void>;
    /** Called when a fork could not be successfully consumed. This can happen
     * if the fork data is invalid */
    onForkInvalid?: () => void;
    /** Handle the result of a fork request call. Can be used to redirect the
     * user automatically when requesting a fork from account. */
    onForkRequest?: (result: RequestForkResult) => void;
    /** Called when an invalid persistent session error is thrown during a
     * session resuming sequence. */
    onSessionInvalid?: () => void;
    /* Called when no persisted session or in-memory session can be used to
     * resume a session. */
    onSessionEmpty?: () => void;
    /** Called when a session is locked either through user action or when a
     * locked session is detected. The `broadcast` flag indicates wether we should
     * broadcast the locked session to other clients. */
    onSessionLocked?: (localID: Maybe<number>, broadcast: boolean) => void;
    /** Callback when session lock is created, updated or deleted */
    onSessionLockUpdate?: (data: SessionLock, broadcast: boolean) => MaybePromise<void>;
    /** Called with the `sessionLockToken` when session is successfully unlocked */
    onSessionUnlocked?: (sessionLockToken: string) => void;
    /** Implement encrypted local session persistence using this hook. Called on every
     * successful consumed fork or unlocked session. */
    onSessionPersist?: (encryptedSession: string) => MaybePromise<void>;
    /** Called when resuming the session failed for any reason excluding inactive
     * session error. */
    onSessionFailure?: (options: AuthResumeOptions) => void;
    /** Called when session tokens have been refreshed. The`broadcast` flag indicates
     * wether we should broadcast the refresh session data to other clients. */
    onSessionRefresh?: (localId: Maybe<number>, data: RefreshSessionData, broadcast: boolean) => MaybePromise<void>;
    /** Implement how you want to handle notifications emitted from the service */
    onNotification?: (notification: CreateNotificationOptions) => void;
}

export const createAuthService = (config: AuthServiceConfig) => {
    const { api, authStore } = config;

    const authService = {
        init: asyncLock(async (options: AuthResumeOptions) => {
            logger.info(`[AuthService] Initialization start`);
            return config.onInit(options).catch((err) => {
                logger.warn(`[AuthService] Initialization failure`, err);
                return false;
            });
        }),

        /** Stores the initial configuration object passed to the
         * auth service factory function. Useful if you want to trigger
         * certain handlers outside of the auth service flow. */
        config,

        login: async (session: AuthSession) => {
            config.onAuthorize?.();

            try {
                if (!isValidSession(session)) {
                    authStore.clear();
                    throw new Error('invalid session');
                }

                authStore.setSession(session);
                await api.reset();

                const lockStatus = authStore.getLockStatus() ?? (await authService.checkLock()).status;
                const locked = lockStatus === SessionLockStatus.LOCKED;
                const hasToken = session.sessionLockToken !== undefined;
                const needsToken = lockStatus === SessionLockStatus.REGISTERED && !hasToken;

                if (locked || needsToken) {
                    logger.info(`[AuthService] Detected locked session [locked=${locked},token=${hasToken}]`);
                    await authService.lock({ soft: true, broadcast: false });
                    return false;
                }
            } catch {
                logger.warn(`[AuthService] Logging in session failed`);
                config.onNotification?.({ text: c('Warning').t`Your session could not be resumed.` });
                config?.onSessionFailure?.({ forceLock: true, retryable: true });
                return false;
            }

            logger.info(`[AuthService] User is authorized`);
            config.onAuthorized?.(authStore.getUserID()!, authStore.getLocalID());

            return true;
        },

        logout: async (options: { soft: boolean; broadcast?: boolean }) => {
            logger.info(`[AuthService] User is not authorized`);

            const localID = authStore.getLocalID();
            const userID = authStore.getUserID();

            if (!options?.soft) await api({ ...revoke(), silent: true }).catch(noop);

            await api.reset();
            authStore.clear();
            authService.resumeSession.resetCount();

            config.onUnauthorized?.(userID, localID, options.broadcast ?? true);

            return true;
        },

        consumeFork: async (payload: ConsumeForkPayload, apiUrl?: string): Promise<boolean> => {
            try {
                config.onAuthorize?.();
                const session = await consumeFork({ api, payload, apiUrl });
                await config.onForkConsumed?.(session, payload.state);

                const loggedIn = await authService.login(session);
                const locked = authStore.getLockStatus() === SessionLockStatus.LOCKED;

                /** Persist the session only on successful login. If the forked session is
                 * locked, persist eitherway to avoid requiring a new fork consumption if
                 * user does not unlock immediately (reset api state for persisting). */
                if (locked) await api.reset();
                if (loggedIn || locked) await authService.persistSession();

                return loggedIn;
            } catch (error: unknown) {
                const reason = error instanceof Error ? ` (${getApiErrorMessage(error) ?? error?.message})` : '';
                config.onNotification?.({ text: c('Warning').t`Your session could not be authorized.` + reason });
                config.onForkInvalid?.();
                await authService.logout({ soft: true, broadcast: false });

                return false;
            }
        },

        requestFork: (options: RequestForkOptions): RequestForkResult => {
            const result = requestFork(options);
            config.onForkRequest?.(result);

            return result;
        },

        /** Creates a session lock. Automatically updates the authentication
         * store and immediately persists the session on success. */
        createLock: async (lockCode: string, ttl: number) => {
            const sessionLockToken = await createSessionLock(lockCode, ttl);

            authStore.setLockToken(sessionLockToken);
            authStore.setLockTTL(ttl);
            authStore.setLockStatus(SessionLockStatus.REGISTERED);
            void config.onSessionLockUpdate?.({ status: SessionLockStatus.REGISTERED, ttl }, true);

            void authService.persistSession();
        },

        /** Deletes a registered session lock. Requires the session lock code.
         * Immediately persists the session on success. */
        deleteLock: async (lockCode: string) => {
            await deleteSessionLock(lockCode);

            authStore.setLockToken(undefined);
            authStore.setLockTTL(undefined);
            authStore.setLockStatus(SessionLockStatus.NONE);
            void config.onSessionLockUpdate?.({ status: SessionLockStatus.NONE }, true);

            void authService.persistSession();
        },

        lock: async (options: { soft: boolean; broadcast?: boolean }): Promise<void> => {
            logger.info(`[AuthService] Locking session [soft: ${options.soft}]`);
            config.onSessionLocked?.(authStore.getLocalID(), options.broadcast ?? false);

            if (authStore.getLockStatus() !== SessionLockStatus.LOCKED && !options?.soft) {
                await forceSessionLock().catch(noop);
            }

            authStore.setLockStatus(SessionLockStatus.LOCKED);
            authStore.setLockToken(undefined);
            authStore.setLockLastExtendTime(undefined);
        },

        unlock: async (pin: string): Promise<void> => {
            try {
                logger.info(`[AuthService] Unlocking session`);
                await api.reset();

                const sessionLockToken = await unlockSession(pin).catch(async (error) => {
                    /** When unlocking the session, if the lock was unregistered by
                     * another client we will hit a 400 response with the 300008 response
                     * code. At this point we can login the user without requiring to unlock.
                     * FIXME: BE should reply a custom error code. */
                    const { code, status } = getApiError(error);
                    if (code === SESSION_LOCK_CODE && status === 400) {
                        config.onNotification?.({
                            key: NotificationKey.SESSION_LOCK,
                            text: c('Error').t`Your PIN code was removed by another ${PASS_APP_NAME} client`,
                        });
                        return undefined;
                    }
                    throw error;
                });

                authStore.setLockToken(sessionLockToken);

                await authService.checkLock();
                await authService.persistSession();
                const loggedIn = await authService.login(authStore.getSession());

                if (loggedIn && sessionLockToken) config.onSessionUnlocked?.(sessionLockToken);
            } catch (error) {
                logger.warn(`[AuthService] Session unlock failure`, error);
                throw error; /** error is thrown for clients to consume */
            }
        },

        /* Calling this function when a lock is registered and active
         * will extend the lock by resetting the ttl server-side */
        checkLock: async () => {
            logger.info('[AuthService] Checking session lock status');
            const lock = await checkSessionLock();

            authStore.setLockStatus(lock.status);
            authStore.setLockTTL(lock.ttl);
            authStore.setLockLastExtendTime(getEpoch());

            void config.onSessionLockUpdate?.(lock, false);
            return lock;
        },

        persistSession: async () => {
            try {
                logger.info('[AuthService] Persisting session');
                const encryptedSession = await encryptPersistedSession({ api, authStore });
                await config.onSessionPersist?.(encryptedSession);
            } catch (error) {
                logger.warn(`[AuthService] Persisting session failure`, error);
            }
        },

        resumeSession: withCallCount(
            pipe(
                async (localID: Maybe<number>, options: AuthResumeOptions): Promise<boolean> => {
                    try {
                        const memorySession = await config.getMemorySession?.();
                        const persistedSession = await config.getPersistedSession(localID);

                        /** If we have an in-memory decrypted AuthSession - use it to
                         * login without making any other API requests. Authorizing
                         * from in-memory session does not account for force lock, rather
                         * when locking the in-memory session should be cleared */
                        if (memorySession && isValidSession(memorySession)) {
                            logger.info(`[Worker::Auth] Resuming in-memory session [lock=${options.forceLock}]`);
                            return await authService.login(memorySession);
                        }

                        /** If we have no persisted session to resume from, exit early */
                        if (!persistedSession) {
                            logger.info(`[AuthService] No persisted session found`);
                            config.onSessionEmpty?.();
                            return false;
                        }

                        logger.info(`[AuthService] Resuming persisted session [lock=${options.forceLock ?? false}]`);

                        /** Partially configure the auth store before resume sequence. `keyPassword`
                         * and `sessionLockToken` are still encrypted at this point */
                        config.onAuthorize?.();
                        authStore.setSession(persistedSession);
                        await api.reset();

                        const { session, sessionKey } = await resumeSession({
                            api,
                            authStore,
                            persistedSession,
                            onSessionInvalid: config.onSessionInvalid,
                        });

                        logger.info(`[AuthService] Session successfuly resumed`);

                        /* on `forceLock: true` remove the `sessionLockToken` from the
                         * session result to trigger an auth lock during the login sequence.
                         * Re-persist the session without the `sessionLockToken` in order
                         * to ensure the `forceLock` effect propagates to future resumes. */
                        if (session.sessionLockToken && options?.forceLock) {
                            delete session.sessionLockToken;
                            const encryptedSession = await encryptPersistedSessionWithKey(session, sessionKey);
                            await config?.onSessionPersist?.(encryptedSession);
                        }

                        return await authService.login(session);
                    } catch (error: unknown) {
                        if (error instanceof Error) {
                            const message = getApiErrorMessage(error) ?? error?.message;
                            const reason = message ? ` (${message})` : '';
                            const text = c('Warning').t`Your session could not be resumed.` + reason;
                            logger.warn(`[AuthService] Resuming session failed ${reason}`);
                            config.onNotification?.({ text });
                        }

                        const locked = api.getState().sessionLocked;
                        const inactive = api.getState().sessionInactive;

                        /** if resume failed for any other reason than a locked or
                         * inactive session, trigger the session resume sequence.
                         * Session errors will be handled by the API listener */
                        if (!locked && !inactive) config.onSessionFailure?.(options);

                        return false;
                    }
                },
                tap((resumed) => {
                    /** Reset the internal resume session count when session
                     * resuming succeeds */
                    if (resumed) authService.resumeSession.resetCount();
                })
            )
        ),

        confirmPassword: (password: string): Promise<boolean> =>
            srpAuth({ api, credentials: { password }, config: { ...queryUnlock(), silence: true } })
                .then(() => true)
                .catch((error) => {
                    config.onNotification?.({ text: getApiErrorMessage(error) ?? error?.message });
                    return false;
                }),
    };

    api.subscribe(async (event) => {
        /** Ensure we have an active session before processing API events*/
        if (authStore.hasSession()) {
            switch (event.type) {
                case 'session': {
                    if (event.status === 'inactive') {
                        config.onNotification?.({ text: c('Warning').t`Your session is inactive.` });
                        await authService.logout({ soft: true, broadcast: true });
                    }

                    if (event.status === 'locked') {
                        const locked = authStore.getLockStatus() === SessionLockStatus.LOCKED;

                        if (!locked) {
                            config.onNotification?.({
                                key: NotificationKey.SESSION_LOCK,
                                text: c('Warning').t`Your session was locked.`,
                            });
                        }

                        await authService.lock({ soft: true, broadcast: true });
                    }

                    break;
                }

                case 'refresh': {
                    const { data } = event;
                    if (authStore.getUID() === data.UID) {
                        /** The `onSessionRefresh` callback is invoked to persist the new tokens.
                         * If this callback throws an error, it is crucial to avoid updating the
                         * authentication store data. This precaution prevents potential inconsistencies
                         * between the store and persisted data. The provisional refresh token is confirmed
                         * only upon the initial use of the new access token. */
                        await config.onSessionRefresh?.(authStore.getLocalID(), data, true);
                        authStore.setSession(data);
                    }
                }
            }
        }
    });

    return authService;
};

export type AuthService = ReturnType<typeof createAuthService>;
