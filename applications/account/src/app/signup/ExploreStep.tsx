import { useEffect, useState } from 'react';

import { c } from 'ttag';

import { Button } from '@proton/atoms';
import { Icon, Logo, useConfig } from '@proton/components';
import { useLoading } from '@proton/hooks';
import metrics from '@proton/metrics';
import { getAppName } from '@proton/shared/lib/apps/helper';
import { APPS, APP_NAMES, BRAND_NAME } from '@proton/shared/lib/constants';
import isTruthy from '@proton/utils/isTruthy';

import Content from '../public/Content';
import Header from '../public/Header';
import Main from '../public/Main';
import { getSignupApplication } from './helper';

interface Props {
    onExplore: (app: APP_NAMES) => Promise<void>;
    padding?: boolean;
}

const ExploreStep = ({ padding, onExplore }: Props) => {
    const { APP_NAME } = useConfig();
    const [type, setType] = useState<APP_NAMES | undefined>(undefined);
    const [loading, withLoading] = useLoading();

    useEffect(() => {
        void metrics.core_signup_pageLoad_total.increment({
            step: 'recovery',
            application: getSignupApplication(APP_NAME),
        });
    }, []);

    return (
        <Main padding={padding}>
            <Header title={c('new_plans: title').t`Start exploring the ${BRAND_NAME} universe`} />
            <Content>
                <ul className="unstyled m-0 divide-y">
                    {[APPS.PROTONMAIL, APPS.PROTONCALENDAR, APPS.PROTONDRIVE, APPS.PROTONVPN_SETTINGS, APPS.PROTONPASS]
                        .filter(isTruthy)
                        .map((app) => {
                            const name = getAppName(app);
                            const showLoader = type === app && loading;
                            return (
                                <li key={app}>
                                    <Button
                                        loading={showLoader}
                                        data-testid={app.replace('proton-', 'explore-')}
                                        size="large"
                                        shape="ghost"
                                        className="flex items-center text-left my-2"
                                        fullWidth
                                        onClick={() => {
                                            if (loading) {
                                                return;
                                            }
                                            setType(app);
                                            void withLoading(onExplore(app));
                                        }}
                                    >
                                        <Logo
                                            appName={app}
                                            size={15}
                                            variant="glyph-only"
                                            className="shrink-0 mr-2"
                                            aria-hidden="true"
                                        />{' '}
                                        <span className="flex-1">{name}</span>
                                        {!showLoader && (
                                            <span className="shrink-0" aria-hidden="true">
                                                <Icon name="arrow-right" />
                                            </span>
                                        )}
                                    </Button>
                                </li>
                            );
                        })}
                </ul>
            </Content>
        </Main>
    );
};

export default ExploreStep;
