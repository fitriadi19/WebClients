import { ReactNode, useEffect, useState } from 'react';

import { AppsDropdown, Sidebar, SidebarContactItem, SidebarNav, useDrawer } from '@proton/components';
import SidebarStorageUpsell from '@proton/components/containers/payments/subscription/SidebarStorageUpsell';
import useDisplayContactsWidget from '@proton/components/hooks/useDisplayContactsWidget';
import { APPS } from '@proton/shared/lib/constants';
import { DRAWER_NATIVE_APPS } from '@proton/shared/lib/drawer/interfaces';

import useActiveShare from '../../../../hooks/drive/useActiveShare';
import { useDebug } from '../../../../hooks/drive/useDebug';
import { ShareWithKey, useDefaultShare } from '../../../../store';
import { useCreateDevice } from '../../../../store/_shares/useCreateDevice';
import { useCreatePhotos } from '../../../../store/_shares/useCreatePhotos';
import DriveSidebarFooter from './DriveSidebarFooter';
import DriveSidebarList from './DriveSidebarList';

interface Props {
    isHeaderExpanded: boolean;
    toggleHeaderExpanded: () => void;
    primary: ReactNode;
    logo: ReactNode;
}

const DriveSidebar = ({ logo, primary, isHeaderExpanded, toggleHeaderExpanded }: Props) => {
    const { activeShareId } = useActiveShare();
    const { getDefaultShare } = useDefaultShare();
    const { toggleDrawerApp } = useDrawer();
    const debug = useDebug();

    const [defaultShare, setDefaultShare] = useState<ShareWithKey>();
    const { createDevice } = useCreateDevice();
    const { createPhotosShare } = useCreatePhotos();

    useEffect(() => {
        void getDefaultShare().then(setDefaultShare);
    }, [getDefaultShare]);

    const displayContactsInHeader = useDisplayContactsWidget();

    /*
     * The sidebar supports multiple shares, but as we currently have
     * only one main share in use, we gonna use the default share only,
     * unless the opposite is decided.
     */
    const shares = defaultShare ? [defaultShare] : [];
    return (
        <Sidebar
            app={APPS.PROTONDRIVE}
            appsDropdown={<AppsDropdown app={APPS.PROTONDRIVE} />}
            logo={logo}
            expanded={isHeaderExpanded}
            onToggleExpand={toggleHeaderExpanded}
            primary={primary}
            version={<DriveSidebarFooter />}
            contactsButton={
                displayContactsInHeader && (
                    <SidebarContactItem
                        onClick={() => {
                            toggleHeaderExpanded();
                            toggleDrawerApp({ app: DRAWER_NATIVE_APPS.CONTACTS })();
                        }}
                    />
                )
            }
            growContent={false}
            postFooter={<SidebarStorageUpsell app={APPS.PROTONDRIVE} />}
        >
            <SidebarNav>
                <div>
                    <DriveSidebarList shareId={activeShareId} userShares={shares} />
                </div>
            </SidebarNav>
            {debug ? <button onClick={createDevice}>Create device</button> : null}
            {debug ? <button onClick={createPhotosShare}>Create photos</button> : null}
        </Sidebar>
    );
};

export default DriveSidebar;
