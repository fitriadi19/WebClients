import { type FC, type PropsWithChildren, useEffect } from 'react';
import { Provider as ReduxProvider } from 'react-redux';

import { useNotifications } from '@proton/components/hooks';
import { usePassCore } from '@proton/pass/components/Core/PassCoreProvider';
import { useNotificationEnhancer } from '@proton/pass/hooks/useNotificationEnhancer';
import { isDocumentVisible, useVisibleEffect } from '@proton/pass/hooks/useVisibleEffect';
import { authStore } from '@proton/pass/lib/auth/store';
import { clientReady } from '@proton/pass/lib/client';
import { ACTIVE_POLLING_TIMEOUT } from '@proton/pass/lib/events/constants';
import {
    draftsGarbageCollect,
    passwordHistoryGarbageCollect,
    startEventPolling,
    stateSync,
    stopEventPolling,
} from '@proton/pass/store/actions';
import { selectLocale } from '@proton/pass/store/selectors';
import { AppStatus } from '@proton/pass/types';
import { pipe } from '@proton/pass/utils/fp/pipe';
import noop from '@proton/utils/noop';

import { deletePassDB, getDBCache, writeDBCache } from '../../lib/database';
import { i18n } from '../../lib/i18n';
import { settings } from '../../lib/settings';
import { telemetry } from '../../lib/telemetry';
import { useAuthService } from '../Context/AuthServiceProvider';
import { useClientRef } from '../Context/ClientProvider';
import { type ServiceWorkerMessageHandler, useServiceWorker } from '../ServiceWorker/ServiceWorkerProvider';
import { rootSaga } from './root.saga';
import { sagaMiddleware, store } from './store';

export const StoreProvider: FC<PropsWithChildren> = ({ children }) => {
    const core = usePassCore();
    const authService = useAuthService();
    const client = useClientRef();
    const sw = useServiceWorker();
    const { createNotification } = useNotifications();
    const enhance = useNotificationEnhancer();

    useEffect(() => {
        const runner = sagaMiddleware.run(
            rootSaga.bind(null, {
                endpoint: 'web',

                getAppState: () => client.current.state,
                getAuthService: () => authService,
                getAuthStore: () => authStore,
                getCache: () => getDBCache(authStore.getUserID()!),
                getEventInterval: () => ACTIVE_POLLING_TIMEOUT,
                getSettings: settings.resolve,
                getTelemetry: () => telemetry,

                onBoot: (res) => {
                    if (res.ok) {
                        client.current.setStatus(AppStatus.READY);

                        telemetry.start().catch(noop);
                        void i18n.setLocale(selectLocale(store.getState()));

                        store.dispatch(draftsGarbageCollect());
                        store.dispatch(passwordHistoryGarbageCollect());

                        if (isDocumentVisible()) store.dispatch(startEventPolling());
                    } else {
                        client.current.setStatus(AppStatus.ERROR);
                        if (res.clearCache) void deletePassDB(authStore.getUserID()!);
                    }
                },

                onLocaleUpdated: core.i18n.setLocale,
                onNotification: pipe(enhance, createNotification),
                onSettingsUpdated: settings.sync,

                setCache: async (encryptedCache) => {
                    /** Cache only if the tab is visible to avoid extraneous IDB writes */
                    if (isDocumentVisible()) return writeDBCache(authStore.getUserID()!, encryptedCache);
                },
            })
        );

        const handleAction: ServiceWorkerMessageHandler<'action'> = ({ localID, action }) => {
            if (authStore.hasSession(localID)) store.dispatch(action);
        };

        sw.on('action', handleAction);

        /** When hot-reloading: this `useEffect` can re-trigger,
         * so cancel the on-going saga runner. */
        return () => {
            runner.cancel();
            sw.off('action', handleAction);
        };
    }, []);

    useVisibleEffect((visible) => {
        /** visible will be truthy only when the document goes from an inactive to an
         * active state. This means the tab came into active focus after being hidden:
         * In this case, silently synchronize the state in case me missed some actions */
        if (visible && clientReady(client.current.state.status)) store.dispatch(stateSync());
        else if (!visible) store.dispatch(stopEventPolling());
    });

    return <ReduxProvider store={store}>{children}</ReduxProvider>;
};
