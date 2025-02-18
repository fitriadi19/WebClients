import { type FC, useCallback } from 'react';

import { usePopupContext } from 'proton-pass-extension/lib/components/Context/PopupProvider';
import { PromptForReload } from 'proton-pass-extension/lib/components/Extension/ExtensionError';
import { useRequestForkWithPermissions } from 'proton-pass-extension/lib/hooks/useRequestFork';
import { c } from 'ttag';

import { LobbyContent } from '@proton/pass/components/Layout/Lobby/LobbyContent';
import { LobbyLayout } from '@proton/pass/components/Layout/Lobby/LobbyLayout';
import { clientErrored } from '@proton/pass/lib/client';
import { popupMessage, sendMessage } from '@proton/pass/lib/extension/message';
import { WorkerMessageType } from '@proton/pass/types';
import { FORK_TYPE } from '@proton/shared/lib/authentication/ForkInterface';
import { PASS_APP_NAME } from '@proton/shared/lib/constants';

export const Lobby: FC = () => {
    const { state, logout } = usePopupContext();
    const errored = clientErrored(state.status);

    const login = useRequestForkWithPermissions({ autoClose: true });
    const handleRegister = useCallback(async () => login(FORK_TYPE.SIGNUP), []);

    const handleLogin = () =>
        errored
            ? sendMessage(
                  popupMessage({
                      type: WorkerMessageType.AUTH_INIT,
                      options: { retryable: false },
                  })
              )
            : login();

    return (
        <LobbyLayout overlay>
            <LobbyContent
                status={state.status}
                onLogin={handleLogin}
                onLogout={logout}
                onRegister={handleRegister}
                renderError={() => (
                    <PromptForReload
                        message={c('Warning')
                            .t`Something went wrong while starting ${PASS_APP_NAME}. Please try refreshing or reloading the extension`}
                    />
                )}
            />
        </LobbyLayout>
    );
};
