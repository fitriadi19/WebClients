import { ThemeColor } from '@proton/colors';
import { APP_NAMES } from '@proton/shared/lib/constants';
import { Address, Organization, Subscription, UserModel } from '@proton/shared/lib/interfaces';

import { getAccountAppRoutes } from '../containers/account/routes';
import { getCalendarAppRoutes } from '../containers/calendar/routes';
import { getDriveAppRoutes } from '../containers/drive/routes';
import { getMailAppRoutes } from '../containers/mail/routes';
import { getOrganizationAppRoutes } from '../containers/organization/routes';
import { getPassAppRoutes } from '../containers/pass/routes';
import { getVpnAppRoutes } from '../containers/vpn/routes';

interface Arguments {
    app: APP_NAMES;
    user: UserModel;
    addresses: Address[] | undefined;
    subscription: Subscription | undefined;
    organization: Organization | undefined;
    isReferralProgramEnabled: boolean;
    isSmtpTokenEnabled: boolean;
    isDataRecoveryAvailable: boolean;
    isSessionRecoveryAvailable: boolean;
    isGmailSyncEnabled: boolean;
    recoveryNotification?: ThemeColor;
    isOrgSpamBlockListEnabled: boolean;
    isProtonSentinelEligible: boolean;
    isProtonSentinelFeatureEnabled: boolean;
    isProtonSentinelUpsellEnabled: boolean;
    isOrgTwoFactorEnabled: boolean;
    isEmailForwardingEnabled: boolean;
    hasUserAccessToInboxDesktop: boolean;
    isNotifInboxDesktopAppOn: boolean;
    isStorageSplitEnabled: boolean;
}

export const getRoutes = ({
    app,
    user,
    organization,
    addresses,
    subscription,
    isDataRecoveryAvailable,
    isSessionRecoveryAvailable,
    isReferralProgramEnabled,
    isSmtpTokenEnabled,
    isGmailSyncEnabled,
    recoveryNotification,
    isOrgSpamBlockListEnabled,
    isProtonSentinelEligible,
    isProtonSentinelFeatureEnabled,
    isProtonSentinelUpsellEnabled,
    isOrgTwoFactorEnabled,
    isEmailForwardingEnabled,
    hasUserAccessToInboxDesktop,
    isNotifInboxDesktopAppOn,
    isStorageSplitEnabled,
}: Arguments) => {
    return {
        account: getAccountAppRoutes({
            app,
            user,
            subscription,
            addresses,
            isDataRecoveryAvailable,
            isSessionRecoveryAvailable,
            isReferralProgramEnabled,
            recoveryNotification,
            isGmailSyncEnabled,
            organization,
            isProtonSentinelEligible,
            isProtonSentinelFeatureEnabled,
            isProtonSentinelUpsellEnabled,
            isStorageSplitEnabled,
        }),
        mail: getMailAppRoutes({
            app,
            user,
            addresses,
            organization,
            isSmtpTokenEnabled,
            isEmailForwardingEnabled,
            hasUserAccessToInboxDesktop,
            isNotifInboxDesktopAppOn,
        }),
        calendar: getCalendarAppRoutes({ app }),
        drive: getDriveAppRoutes({ app }),
        pass: getPassAppRoutes({ app }),
        organization: getOrganizationAppRoutes({
            user,
            organization,
            subscription,
            isOrgSpamBlockListEnabled,
            isOrgTwoFactorEnabled,
        }),
        vpn: getVpnAppRoutes({ app }),
    };
};

export type Routes = ReturnType<typeof getRoutes>;
