import { type FC, useEffect } from 'react';
import { Provider as ReduxProvider } from 'react-redux';

import { useNotifications } from '@proton/components/hooks';
import { usePassCore } from '@proton/pass/components/Core/PassCoreProvider';
import { useNotificationEnhancer } from '@proton/pass/hooks/useNotificationEnhancer';
import { ACTIVE_POLLING_TIMEOUT } from '@proton/pass/lib/events/constants';
import { INITIAL_SETTINGS } from '@proton/pass/store/reducers/settings';
import { AppStatus } from '@proton/pass/types';
import { pipe } from '@proton/pass/utils/fp/pipe';

import { authStore } from '../../lib/core';
import { getDBCache, writeDBCache } from '../../lib/database';
import { useAuthService } from '../Context/AuthServiceProvider';
import { useClientRef } from '../Context/ClientProvider';
import { rootSaga } from './root-saga';
import { sagaMiddleware, store } from './store';

export const StoreProvider: FC = ({ children }) => {
    const authService = useAuthService();
    const client = useClientRef();
    const { createNotification } = useNotifications();
    const { onLink } = usePassCore();
    const notificationEnhancer = useNotificationEnhancer({ onLink });

    useEffect(() => {
        const runner = sagaMiddleware.run(
            rootSaga.bind(null, {
                getAppState: () => client.current.state,
                getAuthService: () => authService,
                getAuthStore: () => authStore,
                getCache: () => getDBCache(authStore.getUserID()!),
                getEventInterval: () => ACTIVE_POLLING_TIMEOUT,
                getLocalSettings: async () => INITIAL_SETTINGS,
                getTelemetry: () => null,
                onBoot: ({ ok }) => client.current.setStatus(ok ? AppStatus.READY : AppStatus.ERROR),
                onNotification: pipe(notificationEnhancer, createNotification),
                setCache: (encryptedCache) => writeDBCache(authStore.getUserID()!, encryptedCache),
            })
        );

        /* when hot-reloading: this `useEffect` will re-trigger,
         * so cancel the on-going saga runner. */
        return () => runner.cancel();
    }, []);

    return <ReduxProvider store={store}>{children}</ReduxProvider>;
};
