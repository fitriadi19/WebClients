import type { FC, PropsWithChildren } from 'react';
import { useSelector } from 'react-redux';

import { isPaidPlan } from '@proton/pass/lib/user/user.predicates';
import { selectPassPlan } from '@proton/pass/store/selectors';

import './PersistentUpsellBar.scss';

export const PersistentUpsellBar: FC<PropsWithChildren> = ({ children }) => {
    const passPlan = useSelector(selectPassPlan);
    if (isPaidPlan(passPlan)) return null;

    return (
        <div className="pass-bottom-bar flex items-center justify-center flex-nowrap w-full p-2 color-norm">
            <div className="flex gap-2 items-center text-center text-xs">{children}</div>
        </div>
    );
};
