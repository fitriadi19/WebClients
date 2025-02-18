import { type FC, type ReactNode, useEffect, useState } from 'react';

import { c } from 'ttag';

import { Button, CircleLoader } from '@proton/atoms';
import passBrandText from '@proton/pass/assets/protonpass-brand.svg';
import { Unlock } from '@proton/pass/components/Lock/Unlock';
import { clientBusy, clientErrored, clientLocked, clientStale } from '@proton/pass/lib/client';
import { AppStatus, type Maybe } from '@proton/pass/types';
import { BRAND_NAME, PASS_APP_NAME } from '@proton/shared/lib/constants';

import './LobbyContent.scss';

const ERROR_TIMEOUT = 15_000;

type Props = {
    status: AppStatus;
    onLogin: () => void;
    onLogout: (options: { soft: boolean }) => void;
    onRegister: () => void;
    renderError: () => ReactNode;
};

export const LobbyContent: FC<Props> = ({ status, onLogin, onLogout, onRegister, renderError }) => {
    const [timeoutError, setTimeoutError] = useState(false);
    const stale = clientStale(status);
    const busy = clientBusy(status);
    const locked = clientLocked(status);
    const [unlocking, setUnlocking] = useState(false);
    const canSignOut = !unlocking && (clientErrored(status) || locked);

    useEffect(() => {
        setTimeoutError(false);
        let timer: Maybe<NodeJS.Timeout> = stale ? setTimeout(() => setTimeoutError(true), ERROR_TIMEOUT) : undefined;
        return () => clearTimeout(timer);
    }, [stale]);

    const brandNameJSX = (
        <img
            src={passBrandText}
            className="pass-lobby--brand-text ml-2 h-custom shrink-0"
            style={{ '--h-custom': '1.5rem' }}
            key="brand"
            alt=""
        />
    );

    if (busy) {
        return timeoutError ? (
            <>{renderError()}</>
        ) : (
            <div
                key="lobby-loading"
                className="flex flex-column items-center gap-3 mt-12 w-full anime-fade-in"
                style={{ '--anime-delay': '250ms' }}
            >
                <CircleLoader size="medium" />
                <span className="block text-sm text-weak">
                    {(() => {
                        switch (status) {
                            case AppStatus.AUTHORIZED:
                            case AppStatus.AUTHORIZING:
                                // translator: status message displayed when loading
                                return c('Info').t`Signing you in`;
                            case AppStatus.BOOTING:
                                return c('Info').t`Decrypting your data`;
                            default:
                                return c('Info').t`Loading ${PASS_APP_NAME}`;
                        }
                    })()}
                </span>
            </div>
        );
    }

    return (
        <div key="lobby" className="anime-fade-in" style={{ '--anime-delay': '250ms' }}>
            <div className="flex flex-column items-center gap-3">
                <span className="pass-lobby--heading text-bold text-norm text-no-wrap flex flex-nowrap items-end justify-center user-select-none">
                    {locked
                        ? c('lobby: Title').jt`Unlock ${brandNameJSX}`
                        : c('lobby: Title').jt`Welcome to ${brandNameJSX}`}
                </span>
                <span className="text-norm">
                    {locked ? c('lobby: Info').jt`Enter your PIN code` : c('lobby: Info').jt`Sign in to your account`}
                </span>
            </div>

            <div className="flex-1 mt-8 flex flex-column gap-2">
                {!locked && (
                    <Button pill shape="solid" color="norm" className="w-full" onClick={onLogin}>
                        {clientErrored(status)
                            ? c('Action').t`Sign back in`
                            : c('Action').t`Sign in with ${BRAND_NAME}`}
                    </Button>
                )}

                {!(locked || canSignOut) && (
                    <Button pill shape="solid" color="weak" className="w-full" onClick={onRegister}>
                        {c('Action').t`Create a ${BRAND_NAME} account`}
                    </Button>
                )}

                {locked && (
                    <div className="mb-8">
                        <Unlock onLoading={setUnlocking} />
                        {unlocking && <CircleLoader size="small" className="mt-12" />}
                    </div>
                )}

                {canSignOut && (
                    <Button
                        className="w-full"
                        color="danger"
                        onClick={() => onLogout({ soft: true })}
                        pill
                        shape="outline"
                    >
                        {c('Action').t`Sign out`}
                    </Button>
                )}
            </div>
        </div>
    );
};
