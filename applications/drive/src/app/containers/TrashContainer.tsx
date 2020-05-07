import React, { useEffect, useMemo } from 'react';
import { RouteComponentProps } from 'react-router-dom';
import { c } from 'ttag';

import Page, { PageMainArea } from '../components/Page';
import TrashToolbar from '../components/Drive/Trash/TrashToolbar';
import Trash from '../components/Drive/Trash/Trash';
import { useDriveCache } from '../components/DriveCache/DriveCacheProvider';
import TrashContentProvider from '../components/Drive/Trash/TrashContentProvider';
import { useDriveActiveFolder } from '../components/Drive/DriveFolderProvider';

const TrashContainer = ({ match }: RouteComponentProps<{ shareId?: string }>) => {
    const { setFolder } = useDriveActiveFolder();
    const cache = useDriveCache();
    const shareId = useMemo(() => {
        const shareId = match.params.shareId || cache.get.defaultShareMeta()?.ShareID;
        if (!shareId) {
            throw new Error('Drive is not initilized, cache has been cleared unexpectedly');
        }
        return shareId;
    }, [match.params.shareId]);

    useEffect(() => {
        setFolder(undefined);
    }, []);

    return (
        <Page title={c('Title').t`Trash`}>
            <TrashContentProvider shareId={shareId}>
                <TrashToolbar shareId={shareId} />
                <PageMainArea hasToolbar className="flex flex-column flex-nowrap">
                    <div className="p1 strong border-bottom">{c('Info').t`Trash`}</div>
                    {shareId && <Trash shareId={shareId} />}
                </PageMainArea>
            </TrashContentProvider>
        </Page>
    );
};

export default TrashContainer;
