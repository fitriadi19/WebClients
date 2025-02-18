import type { FC, ReactNode } from 'react';

import { CircleLoader } from '@proton/atoms/CircleLoader';
import { Scroll } from '@proton/atoms/Scroll';
import clsx from '@proton/utils/clsx';

import './Panel.scss';

type Props = {
    header?: ReactNode;
    children?: ReactNode;
    className?: string;
    loading?: boolean;
};

export const Panel: FC<Props> = ({ header, children, className, loading }) => {
    return (
        <article className={clsx('pass-panel flex flex-column flex-nowrap', className)}>
            {header && <div className="shrink-0 px-4 py-3">{header}</div>}
            <div className="flex-auto h-full overflow-hidden relative">
                {loading && <CircleLoader size="small" className="z-up absolute inset-center" />}
                <Scroll
                    className={clsx(
                        'pass-panel--content absolute w-full h-full',
                        loading && 'opacity-30 pointer-events-none'
                    )}
                >
                    <div className="px-4 pt-1 pb-3">{children}</div>
                </Scroll>
            </div>
        </article>
    );
};
