import { c, msgid } from 'ttag';

import { FAMILY_MAX_USERS, PLANS, PROTON_SENTINEL_NAME } from '@proton/shared/lib/constants';
import { Audience, FreePlanDefault, PlansMap } from '@proton/shared/lib/interfaces';

import { getStorage } from './drive';
import { PlanCardFeature, PlanCardFeatureDefinition } from './interface';

export const getNUsersText = (n: number) => {
    return c('new_plans: feature').ngettext(msgid`Up to ${n} user`, `Up to ${n} users`, n);
};

const getUsers = (): PlanCardFeature => {
    return {
        name: 'user-number',
        target: Audience.FAMILY,
        plans: {
            [PLANS.FREE]: {
                text: c('new_plans: feature').t`1 user`,
                included: true,
            },
            [PLANS.BUNDLE]: null,
            [PLANS.MAIL]: null,
            [PLANS.VPN]: null,
            [PLANS.PASS_PLUS]: null,
            [PLANS.DRIVE]: null,
            [PLANS.FAMILY]: {
                text: getNUsersText(FAMILY_MAX_USERS),
                included: true,
                highlight: true,
            },
            [PLANS.MAIL_PRO]: null,
            [PLANS.BUNDLE_PRO]: null,
            [PLANS.VPN_PRO]: null,
            [PLANS.VPN_BUSINESS]: null,
        },
    };
};

export const getUsersFeature = (n: number): PlanCardFeatureDefinition => {
    return {
        text: getNUsersText(n),
        icon: 'users',
        included: true,
    };
};

export const getSupport = (type: 'limited' | 'priority'): PlanCardFeatureDefinition => {
    return {
        text:
            type === 'limited'
                ? c('new_plans: feature').t`Limited support`
                : c('new_plans: feature').t`Priority support`,
        included: true,
        icon: 'life-ring',
    };
};

const getEasySwitch = (): PlanCardFeatureDefinition => {
    return {
        text: c('new_plans: feature').t`Easy Switch import assistant`,
        tooltip: c('new_plans: tooltip').t`Quickly transfer your emails, calendars or contacts from any provider`,
        included: true,
    };
};

export const getSentinel = (included: boolean = true): PlanCardFeatureDefinition => {
    return {
        text: c('new_plans: feature').t`${PROTON_SENTINEL_NAME} program`,
        tooltip: c('new_plans: tooltip')
            .t`Provides the highest level of account security protection and specialist support`,
        included: included,
        icon: 'shield',
    };
};

export const getHighlightFeatures = (plansMap: PlansMap, freePlan: FreePlanDefault): PlanCardFeature[] => {
    return [
        getUsers(),
        getStorage(plansMap, freePlan),
        {
            name: 'support',
            plans: {
                [PLANS.FREE]: getSupport('limited'),
                [PLANS.BUNDLE]: getSupport('priority'),
                [PLANS.MAIL]: getSupport('priority'),
                [PLANS.VPN]: getSupport('priority'),
                [PLANS.DRIVE]: getSupport('priority'),
                [PLANS.PASS_PLUS]: getSupport('priority'),
                [PLANS.FAMILY]: getSupport('priority'),
                [PLANS.MAIL_PRO]: getSupport('priority'),
                [PLANS.BUNDLE_PRO]: getSupport('priority'),
                [PLANS.VPN_PRO]: getSupport('priority'),
                [PLANS.VPN_BUSINESS]: getSupport('priority'),
            },
        },
        {
            name: 'sentinel',
            plans: {
                [PLANS.FREE]: getSentinel(false),
                [PLANS.BUNDLE]: getSentinel(),
                [PLANS.MAIL]: getSentinel(false),
                [PLANS.VPN]: getSentinel(false),
                [PLANS.DRIVE]: getSentinel(false),
                [PLANS.PASS_PLUS]: getSentinel(),
                [PLANS.FAMILY]: getSentinel(),
                [PLANS.MAIL_PRO]: getSentinel(false),
                [PLANS.BUNDLE_PRO]: getSentinel(),
                [PLANS.VPN_PRO]: getSentinel(false),
                [PLANS.VPN_BUSINESS]: getSentinel(),
            },
        },
        {
            name: 'easy-switch',
            plans: {
                [PLANS.FREE]: getEasySwitch(),
                [PLANS.BUNDLE]: getEasySwitch(),
                [PLANS.MAIL]: getEasySwitch(),
                [PLANS.VPN]: getEasySwitch(),
                [PLANS.DRIVE]: getEasySwitch(),
                [PLANS.PASS_PLUS]: getEasySwitch(),
                [PLANS.FAMILY]: getEasySwitch(),
                [PLANS.MAIL_PRO]: getEasySwitch(),
                [PLANS.BUNDLE_PRO]: getEasySwitch(),
                [PLANS.VPN_PRO]: null,
                [PLANS.VPN_BUSINESS]: null,
            },
        },
    ];
};
