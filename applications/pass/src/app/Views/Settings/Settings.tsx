import { type ComponentProps, type FC, useEffect, useMemo, useState } from 'react';
import { type RouteChildrenProps } from 'react-router-dom';

import { c } from 'ttag';

import { Tabs } from '@proton/components/components';
import { usePassCore } from '@proton/pass/components/Core/PassCoreProvider';
import { LockConfirmContextProvider } from '@proton/pass/components/Lock/LockConfirmContextProvider';
import { Import } from '@proton/pass/components/Settings/Import';
import { useNavigateToAccount } from '@proton/pass/hooks/useNavigateToAccount';
import { type Unpack } from '@proton/pass/types';
import { PASS_APP_NAME } from '@proton/shared/lib/constants';

import { Export } from './Tabs/Export';
import { General } from './Tabs/General';
import { Security } from './Tabs/Security';
import { Support } from './Tabs/Support';

import './Settings.scss';

type SettingTab = Unpack<Exclude<ComponentProps<typeof Tabs>['tabs'], undefined>> & { hash: string };

const getSettingsTabs: () => SettingTab[] = () => {
    const tabs = [
        {
            hash: 'general',
            title: c('Label').t`General`,
            content: <General />,
        },
        {
            hash: 'security',
            title: c('Label').t`Security`,
            content: <Security />,
        },
        {
            hash: 'import',
            title: c('Label').t`Import`,
            content: <Import />,
        },
        {
            hash: 'export',
            title: c('Label').t`Export`,
            content: <Export />,
        },
        {
            hash: 'support',
            title: c('Label').t`Support`,
            content: <Support />,
        },
        {
            hash: 'account',
            title: c('Label').t`Account`,
            content: <></>,
        },
    ];

    return tabs;
};

const pathnameToIndex = (tabs: SettingTab[], hash: string) => {
    const idx = tabs.findIndex((tab) => tab.hash === hash);
    return idx !== -1 ? idx : 0;
};

export const SettingsTabs: FC<RouteChildrenProps> = (props) => {
    const navigateToAccount = useNavigateToAccount();
    const { config, openSettings } = usePassCore();
    const pathname = props.location.hash?.substring(1, props.location.hash.length);

    const tabs = useMemo(getSettingsTabs, []);
    const [activeTab, setActiveTab] = useState<number>(pathnameToIndex(tabs, pathname));

    const handleOnChange = (nextTab: number) => {
        if (tabs[nextTab].hash === 'account') navigateToAccount();
        else openSettings?.(tabs[nextTab].hash);
    };

    useEffect(() => setActiveTab(pathnameToIndex(tabs, pathname)), [pathname]);

    return (
        <>
            <Tabs
                className="w-full"
                contentClassName="p-0"
                navContainerClassName="pass-settings--tabs mb-2 pt-4 sticky top-0"
                onChange={handleOnChange}
                tabs={tabs}
                value={activeTab}
            />
            <div className="mt-auto">
                <hr />
                <span className="block text-sm color-weak text-center">
                    {PASS_APP_NAME} v{config.APP_VERSION}
                </span>
            </div>
        </>
    );
};

export const Settings: FC<RouteChildrenProps> = (props) => {
    return (
        <div className="pass-settings flex flex-column w-full p-4 pt-0 h-full overflow-auto">
            <LockConfirmContextProvider>
                <SettingsTabs {...props} />
            </LockConfirmContextProvider>
        </div>
    );
};
