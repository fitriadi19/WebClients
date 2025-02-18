import { MutableRefObject, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { c } from 'ttag';

import { Button, Href, InlineLinkButton } from '@proton/atoms';
import {
    Alert,
    Challenge,
    ChallengeError,
    ChallengeRef,
    ChallengeResult,
    Checkbox,
    Icon,
    Info,
    InputFieldTwo,
    Label,
    PasswordInputTwo,
    useErrorHandler,
    useFormErrors,
    useLocalState,
    useNotifications,
} from '@proton/components';
import { startUnAuthFlow } from '@proton/components/containers/api/unAuthenticatedApi';
import { AuthType } from '@proton/components/containers/login/interface';
import { handleExternalSSOLogin, handleLogin } from '@proton/components/containers/login/loginActions';
import { useLoading } from '@proton/hooks';
import { auth, getInfo } from '@proton/shared/lib/api/auth';
import { getApiError, getApiErrorMessage } from '@proton/shared/lib/api/helpers/apiErrorHelper';
import { AuthResponse, AuthVersion, SSOInfoResponse } from '@proton/shared/lib/authentication/interface';
import { BRAND_NAME } from '@proton/shared/lib/constants';
import { API_CUSTOM_ERROR_CODES } from '@proton/shared/lib/errors';
import { withUIDHeaders } from '@proton/shared/lib/fetch/headers';
import { isElectronApp } from '@proton/shared/lib/helpers/desktop';
import { requiredValidator } from '@proton/shared/lib/helpers/formValidators';
import { getKnowledgeBaseUrl } from '@proton/shared/lib/helpers/url';
import { Api, Unwrap } from '@proton/shared/lib/interfaces';
import noop from '@proton/utils/noop';

import type { Paths } from '../content/helper';
import SupportDropdown from '../public/SupportDropdown';
import { defaultPersistentKey } from '../public/helper';
import Loader from '../signup/Loader';

export interface LoginFormRef {
    getIsLoading: () => void;
}

interface Props {
    modal?: boolean;
    api: Api;
    onSubmit: (data: {
        authType: AuthType;
        authResponse: AuthResponse;
        authVersion: AuthVersion;
        uid: string | undefined;
        username: string;
        password: string;
        persistent: boolean;
        payload: ChallengeResult;
    }) => Promise<void>;
    signInText?: string;
    externalSSO?: boolean;
    externalSSOToken?: string;
    defaultUsername?: string;
    hasRemember?: boolean;
    hasTrustedDeviceRecovery: boolean;
    paths: Paths;
    authType: AuthType;
    onChangeAuthType: (authType: AuthType) => void;
    loginFormRef: MutableRefObject<LoginFormRef | undefined>;
}

const LoginForm = ({
    api,
    modal,
    authType,
    onChangeAuthType,
    onSubmit,
    defaultUsername = '',
    signInText = c('Action').t`Sign in`,
    hasRemember,
    hasTrustedDeviceRecovery,
    externalSSO,
    externalSSOToken,
    paths,
    loginFormRef,
}: Props) => {
    const handleError = useErrorHandler();
    const [submitting, withSubmitting] = useLoading();
    const [username, setUsername] = useState(defaultUsername);
    const [password, setPassword] = useState('');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [maybePersistent, setPersistent] = useLocalState(false, defaultPersistentKey);
    const persistent = isElectronApp ? true : maybePersistent;
    const { createNotification } = useNotifications();

    const usernameRef = useRef<HTMLInputElement>(null);
    const challengeRefLogin = useRef<ChallengeRef>();
    const [challengeLoading, setChallengeLoading] = useState(true);
    const [challengeError, setChallengeError] = useState(false);
    const [externalSSOState, setExternalSSOState] = useState<
        | {
              challengeResult: ChallengeResult;
              abortController: AbortController;
              ssoInfoResponse: SSOInfoResponse;
          }
        | undefined
    >(undefined);
    const onceRef = useRef(false);

    const loading = Boolean(challengeLoading);

    useImperativeHandle(loginFormRef, () => ({
        getIsLoading: () => {
            return loading || submitting || externalSSOState;
        },
    }));

    useEffect(() => {
        if (loading) {
            return;
        }
        usernameRef.current?.focus();
    }, [loading]);

    const { validator, onFormSubmit } = useFormErrors();

    const learnMore = (
        <Href
            className="color-inherit inline-block"
            key="learn-more"
            href={getKnowledgeBaseUrl('/how-to-access-protonmail-in-private-incognito-mode')}
        >
            {c('Info').t`Learn more`}
        </Href>
    );

    const keepMeSignedInLearnMoreLink = (
        <Href
            className="color-inherit inline-block link-focus"
            key="learn-more"
            href={getKnowledgeBaseUrl('/keep-me-signed-in')}
        >
            {c('Info').t`Why?`}
        </Href>
    );

    const signUp = paths.signup && (
        <Link key="signup" className="link link-focus text-nowrap" to={paths.signup}>
            {c('Link').t`Create account`}
        </Link>
    );

    const updateErrorMessage = (error: any) => {
        setErrorMsg(getApiErrorMessage(error) || c('Error').t`Unknown error`);
    };

    const handleSubmitExternalSSOToken = async ({
        uid,
        token,
        payload,
    }: {
        uid: string | undefined;
        token: string;
        payload: ChallengeResult | undefined;
    }) => {
        let authResponse: AuthResponse;
        try {
            const config = auth({ SSOResponseToken: token }, persistent);
            authResponse = await api<AuthResponse>(uid ? withUIDHeaders(uid, config) : config);
        } catch (e) {
            handleError(e);
            throw e;
        }

        return onSubmit({
            authType: AuthType.ExternalSSO,
            authVersion: 4 as const,
            authResponse,
            uid,
            username,
            password: '',
            payload,
            persistent,
        });
    };
    const handleSubmitExternalSSO = async () => {
        setExternalSSOState(undefined);

        let ssoInfoResponse: SSOInfoResponse | undefined;
        try {
            await startUnAuthFlow();
            ssoInfoResponse = await api<SSOInfoResponse>(getInfo(username, 'SSO'));
        } catch (e) {
            const { code } = getApiError(e);
            if (code === API_CUSTOM_ERROR_CODES.AUTH_SWITCH_TO_SRP) {
                onChangeAuthType(AuthType.SRP);
                handleError(e);
                setPassword('');
                return;
            }
            handleError(e);
            throw e;
        }

        const challengeResult = await challengeRefLogin.current?.getChallenge().catch(noop);

        const abortController = new AbortController();
        setExternalSSOState({ challengeResult, abortController, ssoInfoResponse });
        let externalSSOResult: Unwrap<ReturnType<typeof handleExternalSSOLogin>>;

        try {
            externalSSOResult = await handleExternalSSOLogin({
                signal: abortController.signal,
                token: ssoInfoResponse.SSOChallengeToken,
            });
        } catch (e) {
            throw e;
        } finally {
            setExternalSSOState(undefined);
        }

        return handleSubmitExternalSSOToken({
            uid: externalSSOResult.uid,
            token: externalSSOResult.token,
            payload: challengeResult,
        });
    };

    const handleSubmitSRP = async () => {
        const payload = await challengeRefLogin.current?.getChallenge().catch(noop);

        let result: Unwrap<ReturnType<typeof handleLogin>>;

        try {
            await startUnAuthFlow();
            result = await handleLogin({
                username,
                persistent,
                payload,
                password,
                api,
            });
        } catch (e) {
            const { code } = getApiError(e);

            if (code === API_CUSTOM_ERROR_CODES.AUTH_SWITCH_TO_SSO) {
                onChangeAuthType(AuthType.ExternalSSO);
                createNotification({
                    type: 'info',
                    text: c('Info')
                        .t`Your organization uses single sign-on (SSO). Press Sign in to continue with your SSO provider.`,
                });
                return;
            } else if (code === API_CUSTOM_ERROR_CODES.INVALID_LOGIN) {
                updateErrorMessage(e);
                return;
            }

            handleError(e);
            throw e;
        }

        return onSubmit({
            authType: AuthType.SRP,
            authResponse: result.authResult.result,
            authVersion: result.authResult.authVersion,
            uid: undefined,
            payload,
            username,
            password,
            persistent,
        });
    };

    useEffect(() => {
        if (submitting || loading || !externalSSOToken || onceRef.current) {
            return;
        }
        onceRef.current = true;
        withSubmitting(
            handleSubmitExternalSSOToken({
                uid: undefined,
                token: externalSSOToken,
                payload: undefined,
            })
        ).catch(noop);
    }, [loading]);

    const abortExternalSSO = () => {
        externalSSOState?.abortController.abort();
        setExternalSSOState(undefined);
    };

    useEffect(() => {
        // This handles the case for:
        // 1) Being on the unlock/2fa screen and hitting the back button
        // 2) Being on the unlock/2fa screen and hitting the browser back button e.g. ending up on signup and then
        // going back here
        // And preemptively starting it before user interaction
        startUnAuthFlow().catch(noop);
        return () => {
            externalSSOState?.abortController.abort();
        };
    }, []);

    if (challengeError) {
        return <ChallengeError />;
    }

    return (
        <>
            {loading && (
                <div className="text-center absolute inset-center">
                    <Loader />
                </div>
            )}
            <form
                name="loginForm"
                className={loading ? 'visibility-hidden' : undefined}
                onSubmit={(event) => {
                    event.preventDefault();
                    setErrorMsg(null);

                    if (authType === AuthType.SRP) {
                        if (submitting || !onFormSubmit()) {
                            return;
                        }
                        withSubmitting(handleSubmitSRP()).catch(noop);
                    } else {
                        if (submitting) {
                            return;
                        }
                        withSubmitting(handleSubmitExternalSSO()).catch(noop);
                    }
                }}
                method="post"
            >
                <Challenge
                    className="h-0 absolute"
                    empty
                    tabIndex={-1}
                    challengeRef={challengeRefLogin}
                    type={0}
                    name="login"
                    onSuccess={() => {
                        setChallengeLoading(false);
                    }}
                    onError={() => {
                        setChallengeLoading(false);
                        setChallengeError(true);
                    }}
                />
                <InputFieldTwo
                    id="username"
                    bigger
                    label={authType === AuthType.ExternalSSO ? c('Label').t`Email` : c('Label').t`Email or username`}
                    error={validator([requiredValidator(username)]) || !!errorMsg}
                    disableChange={submitting}
                    autoComplete="username"
                    value={username}
                    onValue={setUsername}
                    ref={usernameRef}
                    onChange={() => setErrorMsg(null)}
                />
                {authType === AuthType.ExternalSSO ? null : (
                    <InputFieldTwo
                        id="password"
                        bigger
                        label={c('Label').t`Password`}
                        error={validator([requiredValidator(password)]) || !!errorMsg}
                        as={PasswordInputTwo}
                        disableChange={submitting}
                        autoComplete="current-password"
                        value={password}
                        onValue={setPassword}
                        rootClassName="mt-2"
                        onChange={() => setErrorMsg(null)}
                    />
                )}

                {errorMsg && (
                    <Alert
                        className="mb-4 bg-weak w-full border-none pl-3 pr-4 py-3 gap-3 rounded-lg flex items-start flex-nowrap"
                        type="error"
                    >
                        <div className="flex justify-start items-start shrink-0 pt-0.5">
                            <Icon name="exclamation-circle-filled" className="color-danger shrink-0" />
                        </div>
                        {errorMsg}
                    </Alert>
                )}

                {hasRemember && authType !== AuthType.ExternalSSO && !isElectronApp && (
                    <div className="flex flex-row items-start">
                        <Checkbox
                            id="staySignedIn"
                            className="mt-2 mr-2"
                            checked={persistent}
                            onChange={submitting ? noop : () => setPersistent(!persistent)}
                        />

                        {hasTrustedDeviceRecovery ? (
                            <div className="flex-1">
                                <Label htmlFor="staySignedIn" className="flex items-center">
                                    {c('Label').t`Keep me signed in`}
                                </Label>
                                <div className="color-weak">
                                    {c('Info').jt`Recommended on trusted devices. ${keepMeSignedInLearnMoreLink}`}
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1">
                                <Label htmlFor="staySignedIn" className="flex items-center">
                                    <span className="pr-2">{c('Label').t`Keep me signed in`}</span>
                                    <span className="flex">
                                        <Info
                                            title={c('Info').t`You'll stay signed in even after you close the browser.`}
                                        />
                                    </span>
                                </Label>
                                <div className="color-weak">
                                    {c('Info')
                                        .jt`Not your device? Use a private browsing window to sign in and close it when done. ${learnMore}`}
                                </div>
                            </div>
                        )}
                    </div>
                )}
                <Button
                    size="large"
                    color="norm"
                    type="submit"
                    fullWidth
                    loading={submitting}
                    className={modal ? 'mt-4' : 'mt-6'}
                >
                    {
                        // translator: when the "sign in" button is in loading state, it gets updated to "Signing in"
                        submitting ? c('Action').t`Signing in` : signInText
                    }
                </Button>

                {(() => {
                    if (authType === AuthType.ExternalSSO) {
                        return (
                            <>
                                {externalSSOState && (
                                    <Button
                                        size="large"
                                        type="button"
                                        shape="ghost"
                                        color="norm"
                                        fullWidth
                                        className="mt-2"
                                        onClick={() => {
                                            abortExternalSSO();
                                        }}
                                    >
                                        {c('Action').t`Cancel`}
                                    </Button>
                                )}
                                {!externalSSOState && (
                                    <div className="text-center mt-4">
                                        <InlineLinkButton
                                            type="button"
                                            color="norm"
                                            disabled={submitting}
                                            onClick={() => {
                                                abortExternalSSO();
                                                onChangeAuthType(AuthType.SRP);
                                                setPassword('');
                                            }}
                                        >
                                            {c('Action').t`Sign in with password`}
                                        </InlineLinkButton>
                                    </div>
                                )}
                            </>
                        );
                    }

                    return (
                        <>
                            {externalSSO && (
                                <>
                                    <Button
                                        size="large"
                                        type="button"
                                        shape="ghost"
                                        color="norm"
                                        fullWidth
                                        disabled={submitting}
                                        className="mt-2"
                                        onClick={() => {
                                            abortExternalSSO();
                                            onChangeAuthType(AuthType.ExternalSSO);
                                        }}
                                    >
                                        <div className="inline-flex items-center flex-nowrap gap-2">
                                            {c('Action').t`Sign in with SSO`}
                                            <Info
                                                title={c('Info')
                                                    .t`For members of organizations using single sign-on (SAML SSO)`}
                                            />
                                        </div>
                                    </Button>
                                </>
                            )}

                            {signUp && !modal && (
                                <div className="text-center mt-4">
                                    {
                                        // translator: Full sentence "New to Proton? Create account"
                                        c('Go to sign up').jt`New to ${BRAND_NAME}? ${signUp}`
                                    }
                                </div>
                            )}

                            {!modal && (
                                <>
                                    <hr className="my-4" />

                                    <div className="text-center">
                                        <SupportDropdown
                                            buttonClassName="mx-auto link link-focus"
                                            content={c('Link').t`Trouble signing in?`}
                                        >
                                            <Link
                                                to={paths.reset}
                                                className="dropdown-item-link w-full px-4 py-2 flex items-center text-no-decoration text-left"
                                            >
                                                <Icon name="key" className="mr-2" />
                                                {c('Link').t`Reset password`}
                                            </Link>
                                            <Link
                                                to={paths.forgotUsername}
                                                className="dropdown-item-link w-full px-4 py-2 flex items-center text-no-decoration text-left"
                                            >
                                                <Icon name="user-circle" className="mr-2" />
                                                {c('Link').t`Forgot username?`}
                                            </Link>
                                        </SupportDropdown>
                                    </div>
                                </>
                            )}
                        </>
                    );
                })()}
            </form>
        </>
    );
};

export default LoginForm;
