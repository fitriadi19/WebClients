import { useEffect, useState } from 'react';

import { c } from 'ttag';

import { MemberKeyPayload, getMemberKeyPayloads, setAdminRoles } from '@proton/account';
import { Button } from '@proton/atoms';
import { useLoading } from '@proton/hooks';
import { useDispatch } from '@proton/redux-shared-store';
import { getSilentApi } from '@proton/shared/lib/api/helpers/customConfig';
import { EnhancedMember } from '@proton/shared/lib/interfaces';

import { ModalProps, ModalTwo, ModalTwoContent, ModalTwoFooter, ModalTwoHeader } from '../../components';
import { useApi, useErrorHandler, useEventManager, useGetPublicKeysForInbox, useNotifications } from '../../hooks';
import AdministratorList from './AdministratorList';

interface Props extends Omit<ModalProps, 'children' | 'title' | 'buttons'> {
    members: EnhancedMember[];
}

export const InviteOrganizationKeysModal = ({ members, ...rest }: Props) => {
    const dispatch = useDispatch();
    const [loading, withLoading] = useLoading();
    const [loadingInit, withLoadingInit] = useLoading(true);
    const getPublicKeysForInbox = useGetPublicKeysForInbox();
    const { call } = useEventManager();
    const normalApi = useApi();
    const silentApi = getSilentApi(normalApi);
    const { createNotification } = useNotifications();
    const [result, setResult] = useState<null | MemberKeyPayload[]>(null);
    const errorHandler = useErrorHandler();

    useEffect(() => {
        const run = async () => {
            setResult(null);
            const result = await dispatch(
                getMemberKeyPayloads({
                    getPublicKeysForInbox,
                    members,
                })
            );
            setResult(result);
        };
        withLoadingInit(run()).catch(errorHandler);
    }, []);

    const handleSubmit = async (result: MemberKeyPayload[]) => {
        try {
            await dispatch(
                setAdminRoles({
                    memberKeyPayloads: result,
                    api: silentApi,
                })
            );
            await call();
            createNotification({ text: c('Success').t`Administrator privileges restored` });
            rest.onClose?.();
        } catch (e) {
            errorHandler(e);
        }
    };

    return (
        <ModalTwo open {...rest}>
            <ModalTwoHeader title={c('Title').t`Restore administrator privileges`} {...rest} />
            <ModalTwoContent>
                <div>{c('passwordless')
                    .t`This will send the latest organization key to the administrators that currently don't have access to it.`}</div>
                <AdministratorList loading={loadingInit} members={result} expandByDefault={true}>
                    {c('passwordless').t`The following administrators will get access to the organization key.`}
                </AdministratorList>
            </ModalTwoContent>
            <ModalTwoFooter>
                <Button onClick={rest.onClose}>{c('Action').t`Cancel`}</Button>
                <Button
                    color="norm"
                    loading={loading}
                    disabled={loadingInit}
                    onClick={() => {
                        if (!result) {
                            return;
                        }
                        withLoading(handleSubmit(result));
                    }}
                >
                    {c('Title').t`Confirm`}
                </Button>
            </ModalTwoFooter>
        </ModalTwo>
    );
};

export default InviteOrganizationKeysModal;
