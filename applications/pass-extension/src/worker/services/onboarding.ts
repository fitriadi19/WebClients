import { browserLocalStorage } from '@proton/pass/extension/storage';
import { selectCanLockSession } from '@proton/pass/store';
import {
    type Maybe,
    MaybeNull,
    type OnboardingAcknowledgment,
    OnboardingMessage,
    type OnboardingState,
    WorkerMessageType,
} from '@proton/pass/types';
import { withPayloadLens } from '@proton/pass/utils/fp';
import { logger } from '@proton/pass/utils/logger';
import { merge } from '@proton/pass/utils/object';
import { UNIX_DAY, getEpoch } from '@proton/pass/utils/time';
import identity from '@proton/utils/identity';

import { INITIAL_ONBOARDING_STATE } from '../../shared/constants';
import WorkerMessageBroker from '../channel';
import { withContext } from '../context/helpers';
import store from '../store';

type OnboardingContext = { state: OnboardingState };
type OnboardingWhen = (previousAck: Maybe<OnboardingAcknowledgment>, state: OnboardingState) => boolean;
type OnboardingOnAck = (ack: OnboardingAcknowledgment) => OnboardingAcknowledgment;
type OnboardingRule = { message: OnboardingMessage; when?: OnboardingWhen; onAcknowledge?: OnboardingOnAck };

const createOnboardingRule = (options: OnboardingRule): OnboardingRule => ({
    message: options.message,
    onAcknowledge: options.onAcknowledge,
    when: (previousAck, state) =>
        options.when?.(previousAck, state) ?? !state.acknowledged.some((data) => data.message === options.message),
});

/* Define the onboarding rules here :
 * - each rule must be registered on a specific `OnboardingMessage` type
 * - define an optional predicate for when to show the message
 * - order is important: we will apply the first matched rule */
const ONBOARDING_RULES: OnboardingRule[] = [
    createOnboardingRule({
        message: OnboardingMessage.UPDATE_AVAILABLE,
        onAcknowledge: withContext<OnboardingOnAck>((ctx, ack) => {
            /* keep a reference to the current available update so as
             * not to re-prompt the user with this update if ignored */
            return merge(ack, {
                extraData: {
                    version: ctx.service.activation.getAvailableUpdate(),
                },
            });
        }),
        when: withContext<OnboardingWhen>((ctx, previous) => {
            const availableVersion = ctx.service.activation.getAvailableUpdate();
            const previousAckVersion = previous?.extraData?.version as MaybeNull<string>;
            const shouldPrompt = !previous || previousAckVersion !== availableVersion;

            return availableVersion !== null && shouldPrompt;
        }),
    }),
    createOnboardingRule({ message: OnboardingMessage.WELCOME, when: () => false }),
    createOnboardingRule({
        message: OnboardingMessage.SECURE_EXTENSION,
        when: (previous, { installedOn }) => {
            const now = getEpoch();
            const hasLock = selectCanLockSession(store.getState());
            const shouldPrompt = !previous || now - installedOn > UNIX_DAY;

            return !hasLock && shouldPrompt;
        },
    }),
];

export const createOnboardingService = () => {
    const ctx: OnboardingContext = { state: INITIAL_ONBOARDING_STATE };

    /* Every setState call will have the side-effect of
     * updating the locally stored onboarding state  */
    const setState = (state: Partial<OnboardingState>) => {
        ctx.state = merge(ctx.state, state);
        void browserLocalStorage.setItem('onboarding', JSON.stringify(ctx.state));
    };

    const onInstall = () => setState({ installedOn: getEpoch() });
    const onUpdate = () => setState({ updatedOn: getEpoch() });

    /* Reset the state's acknowledged messages. This may be
     * useful when logging out a user - preserves timestamps */
    const reset = () => setState({ acknowledged: [] });

    /* Acknowledges the current onboarding message by either pushing
     * it to the acknowledged messages list or updating the entry */
    const acknowledge = (message: OnboardingMessage) => {
        logger.info(`[Worker::Onboarding] Acknowledging "${OnboardingMessage[message]}"`);
        const acknowledged = ctx.state.acknowledged.find((data) => data.message === message);
        const onAcknowledge = ONBOARDING_RULES.find((rule) => rule.message === message)?.onAcknowledge ?? identity;

        setState({
            acknowledged: [
                ...ctx.state.acknowledged.filter((data) => data.message !== message),
                onAcknowledge({ message, acknowledgedOn: getEpoch(), count: (acknowledged?.count ?? 0) + 1 }),
            ],
        });

        return true;
    };

    /* Define extra rules in the `ONBOARDING_RULES` constant :
     * we will resolve the first message that matches the rule's
     * `when` condition */
    const getMessage = () =>
        ONBOARDING_RULES.find(({ message, when }) =>
            when?.(
                ctx.state.acknowledged.find((ack) => message === ack.message),
                ctx.state
            )
        )?.message;

    /* hydrate the onboarding state value from the storage
     * on service creation. This will noop on first install */
    void browserLocalStorage.getItem('onboarding').then((data) => data && setState(JSON.parse(data)));
    WorkerMessageBroker.registerMessage(WorkerMessageType.ONBOARDING_REQUEST, () => ({ message: getMessage() }));
    WorkerMessageBroker.registerMessage(WorkerMessageType.ONBOARDING_ACK, withPayloadLens('message', acknowledge));

    return { reset, onInstall, onUpdate };
};

export type OnboardingService = ReturnType<typeof createOnboardingService>;
