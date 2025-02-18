import type { ThunkAction, UnknownAction } from '@reduxjs/toolkit';
import { c } from 'ttag';

import { CryptoProxy, PrivateKeyReference, PublicKeyReference } from '@proton/crypto';
import type { ProtonThunkArguments } from '@proton/redux-shared-store';
import {
    activatePasswordlessKey,
    checkMemberAddressAvailability,
    createMemberAddress,
    createMember as createMemberConfig,
    privatizeMember,
    updateName,
    updateQuota,
    updateRole,
    updateRolePasswordless,
    updateVPN,
} from '@proton/shared/lib/api/members';
import {
    updateOrganizationKeysLegacy,
    updateOrganizationKeysV2,
    updatePasswordlessOrganizationKeys,
} from '@proton/shared/lib/api/organization';
import {
    DEFAULT_ENCRYPTION_CONFIG,
    ENCRYPTION_CONFIGS,
    ENCRYPTION_TYPES,
    MEMBER_PRIVATE,
    MEMBER_ROLE,
    VPN_CONNECTIONS,
} from '@proton/shared/lib/constants';
import { getIsAddressEnabled } from '@proton/shared/lib/helpers/address';
import { captureMessage } from '@proton/shared/lib/helpers/sentry';
import type {
    Address,
    Api,
    CachedOrganizationKey,
    EnhancedMember,
    KeyTransparencyCommit,
    KeyTransparencyVerify,
    Member,
} from '@proton/shared/lib/interfaces';
import type { GetPublicKeysForInbox } from '@proton/shared/lib/interfaces/hooks/GetPublicKeysForInbox';
import {
    acceptInvitation,
    generateOrganizationKeys,
    generatePasswordlessOrganizationKey,
    generatePrivateMemberInvitation,
    generatePublicMemberInvitation,
    getDecryptedUserKeys,
    getHasMigratedAddressKeys,
    getIsPasswordless,
    getOrganizationKeyToken,
    getPrimaryKey,
    getPrivateMemberPublicKey,
    getReEncryptedPublicMemberTokensPayloadLegacy,
    getReEncryptedPublicMemberTokensPayloadV2,
    setupMemberKeys,
    splitKeys,
} from '@proton/shared/lib/keys';
import { decryptKeyPacket } from '@proton/shared/lib/keys/keypacket';
import { srpVerify } from '@proton/shared/lib/srp';
import isTruthy from '@proton/utils/isTruthy';

import { type OrganizationKeyState, organizationKeyThunk } from '../';
import { addressKeysThunk } from '../addressKeys';
import { addressesThunk } from '../addresses';
import { getMemberAddresses, membersThunk } from '../members';
import { userKeysThunk } from '../userKeys';

export const getPrivateAdminError = () => {
    return c('passwordless').t`Private users can be promoted to admin when they've signed in for the first time`;
};

export const getPrivatizeError = () => {
    return c('passwordless').t`You must privatize all users before generating a new organization key`;
};

export const getOrganizationTokenThunk = (): ThunkAction<
    Promise<string>,
    OrganizationKeyState,
    ProtonThunkArguments,
    UnknownAction
> => {
    return async (dispatch, _, extra) => {
        const key = await dispatch(organizationKeyThunk());
        const userKeys = await dispatch(userKeysThunk());
        const keyPassword = extra.authentication.getPassword();
        return getOrganizationKeyToken({ userKeys, keyPassword, Key: key?.Key });
    };
};

export interface PublicMemberKeyPayload {
    type: 0;
    member: Member;
    email: string;
    address: Address | undefined;
    privateKey: PrivateKeyReference;
}

export interface PrivateMemberKeyPayload {
    type: 1;
    member: Member;
    email: string;
    address: Address;
    publicKey: PublicKeyReference;
}

export type MemberKeyPayload = PrivateMemberKeyPayload | PublicMemberKeyPayload;

export type PublicMembersReEncryptPayload = {
    member: Member;
    memberAddresses: Address[];
}[];

export interface OrganizationKeyRotationPayload {
    publicMembersToReEncryptPayload: PublicMembersReEncryptPayload;
    memberKeyPayloads: MemberKeyPayload[];
}

// Error that can be ignored when e.g. rotating org keys
class ConstraintError extends Error {}

export const getMemberKeyPayload = async ({
    organizationKey,
    getPublicKeysForInbox,
    member,
    memberAddresses,
}: {
    organizationKey: CachedOrganizationKey;
    getPublicKeysForInbox: GetPublicKeysForInbox;
    member: Member;
    memberAddresses: Address[];
}): Promise<MemberKeyPayload> => {
    const address: Address | undefined = memberAddresses.filter(
        (address) => getIsAddressEnabled(address) && address.HasKeys
    )[0];

    if (member.Private === MEMBER_PRIVATE.READABLE) {
        if (!member.Keys?.length) {
            throw new ConstraintError(getPrivateAdminError());
        }
        // Only needed to decrypt the user keys here.
        if (!organizationKey?.privateKey) {
            throw new Error(c('passwordless').t`Organization key must be activated to give admin privileges`);
        }
        const memberUserKeys = await getDecryptedUserKeys(member.Keys, '', organizationKey);
        const privateKey = getPrimaryKey(memberUserKeys)?.privateKey;
        if (!privateKey) {
            throw new Error('Unable to decrypt non-private user keys');
        }
        return {
            type: 0,
            member,
            address,
            email: address?.Email || member.Name,
            privateKey,
        };
    }

    if (!address) {
        throw new ConstraintError(getPrivateAdminError());
    }
    const email = address.Email;
    const publicKey = await getPrivateMemberPublicKey({
        getPublicKeysForInbox,
        email,
    });
    if (!publicKey) {
        throw new Error(getPrivateAdminError());
    }
    return {
        type: 1,
        member,
        address,
        email,
        publicKey,
    };
};

export const getMemberKeyPayloads = ({
    getPublicKeysForInbox,
    members,
}: {
    getPublicKeysForInbox: GetPublicKeysForInbox;
    members: EnhancedMember[];
}): ThunkAction<Promise<MemberKeyPayload[]>, OrganizationKeyState, ProtonThunkArguments, UnknownAction> => {
    return async (dispatch) => {
        const organizationKey = await dispatch(organizationKeyThunk());
        if (!getIsPasswordless(organizationKey?.Key)) {
            throw new Error('Only used on passwordless organizations');
        }
        return (
            await Promise.all(
                members.map(async (member) => {
                    try {
                        return await getMemberKeyPayload({
                            member,
                            memberAddresses: await dispatch(getMemberAddresses({ member, retry: true })),
                            getPublicKeysForInbox,
                            organizationKey,
                        });
                    } catch (e) {
                        if (e instanceof ConstraintError) {
                            return undefined;
                        }
                        throw e;
                    }
                })
            )
        ).filter(isTruthy);
    };
};

export const getPublicMembersToReEncryptPayload = (): ThunkAction<
    Promise<PublicMembersReEncryptPayload>,
    OrganizationKeyState,
    ProtonThunkArguments,
    UnknownAction
> => {
    return async (dispatch) => {
        const organizationKey = await dispatch(organizationKeyThunk());
        const members = await dispatch(membersThunk());

        const publicMembers = members.filter((member) => member.Private === MEMBER_PRIVATE.READABLE);

        if (publicMembers.length >= 1) {
            if (!organizationKey?.privateKey) {
                throw new Error(getPrivatizeError());
            }
            const publicMembersToReEncrypt = await Promise.all(
                publicMembers.map(async (member) => {
                    if (!member.Keys?.length) {
                        return null;
                    }
                    if (!organizationKey?.privateKey) {
                        throw new Error(getPrivatizeError());
                    }
                    const memberUserKeys = await getDecryptedUserKeys(member.Keys, '', organizationKey);
                    const privateKey = getPrimaryKey(memberUserKeys)?.privateKey;
                    if (!privateKey) {
                        throw new Error('Missing private key');
                    }
                    const memberAddresses = await dispatch(getMemberAddresses({ member, retry: true }));
                    return {
                        member,
                        memberUserKeys,
                        memberAddresses,
                    };
                })
            );
            return publicMembersToReEncrypt.filter(isTruthy);
        }

        return [];
    };
};

export const getKeyRotationPayload = ({
    getPublicKeysForInbox,
}: {
    getPublicKeysForInbox: GetPublicKeysForInbox;
}): ThunkAction<Promise<OrganizationKeyRotationPayload>, OrganizationKeyState, ProtonThunkArguments, UnknownAction> => {
    return async (dispatch) => {
        const userKeys = await dispatch(userKeysThunk());
        const organizationKey = await dispatch(organizationKeyThunk());
        if (!getIsPasswordless(organizationKey?.Key)) {
            throw new Error('Only used on passwordless organizations');
        }
        const userKey = userKeys[0]?.privateKey;
        if (!userKey) {
            throw new Error('Missing primary user key');
        }
        const [primaryAddress] = await dispatch(addressesThunk());
        if (!primaryAddress) {
            throw new Error('Missing primary address');
        }
        const [primaryAddressKey] = await dispatch(addressKeysThunk({ thunkArg: primaryAddress.ID }));
        if (!primaryAddressKey) {
            throw new Error('Missing primary address key');
        }
        const members = await dispatch(membersThunk());
        const otherAdminMembers = members.filter((member) => {
            return member.Role === MEMBER_ROLE.ORGANIZATION_ADMIN && !member.Self;
        });

        const [memberKeyPayloads, publicMembersToReEncryptPayload] = await Promise.all([
            dispatch(
                getMemberKeyPayloads({
                    getPublicKeysForInbox,
                    members: otherAdminMembers,
                })
            ),
            dispatch(getPublicMembersToReEncryptPayload()),
        ]);

        return {
            memberKeyPayloads,
            publicMembersToReEncryptPayload,
        };
    };
};
export const setAdminRoles = ({
    memberKeyPayloads,
    api,
}: { memberKeyPayloads: MemberKeyPayload[] } & {
    api: Api;
}): ThunkAction<Promise<void>, OrganizationKeyState, ProtonThunkArguments, UnknownAction> => {
    return async (dispatch) => {
        const userKeys = await dispatch(userKeysThunk());
        const organizationKey = await dispatch(organizationKeyThunk());
        if (!getIsPasswordless(organizationKey?.Key)) {
            throw new Error('Only used on passwordless organizations');
        }
        if (!organizationKey?.privateKey) {
            throw new Error('Organization key must be active to set admin roles');
        }
        const userKey = userKeys[0]?.privateKey;
        if (!userKey) {
            throw new Error('Missing primary user key');
        }
        const [primaryAddress] = await dispatch(addressesThunk());
        if (!primaryAddress) {
            throw new Error('Missing primary address');
        }
        const [primaryAddressKey] = await dispatch(addressKeysThunk({ thunkArg: primaryAddress.ID }));
        if (!primaryAddressKey) {
            throw new Error('Missing primary address key');
        }

        const { sessionKey, message } = await decryptKeyPacket({
            armoredMessage: organizationKey.Key.Token,
            decryptionKeys: userKeys.map(({ privateKey }) => privateKey),
        });
        const data = {
            sessionKey,
            binaryData: message.data,
        };
        const signer = {
            addressID: primaryAddress.ID,
            privateKey: primaryAddressKey.privateKey,
        };

        const { privateAdminPromises, publicAdminPromises } = memberKeyPayloads.reduce<{
            privateAdminPromises: ReturnType<typeof generatePrivateMemberInvitation>[];
            publicAdminPromises: ReturnType<typeof generatePublicMemberInvitation>[];
        }>(
            (acc, memberPayload) => {
                if (memberPayload.type === 1) {
                    const { member, publicKey, address } = memberPayload;
                    acc.privateAdminPromises.push(
                        generatePrivateMemberInvitation({
                            member,
                            publicKey,
                            addressID: address.ID,
                            signer,
                            data,
                        })
                    );
                } else {
                    const { member, privateKey } = memberPayload;
                    acc.publicAdminPromises.push(
                        generatePublicMemberInvitation({
                            member,
                            privateKey,
                            data,
                        })
                    );
                }

                return acc;
            },
            { privateAdminPromises: [], publicAdminPromises: [] }
        );

        const [privateAdminInvitations, publicAdminActivations] = await Promise.all([
            Promise.all(privateAdminPromises),
            Promise.all(publicAdminPromises),
        ]);

        const privatePromise = Promise.all(
            privateAdminInvitations.map((invitation) => {
                return api(
                    updateRolePasswordless({
                        memberID: invitation.MemberID,
                        Role: MEMBER_ROLE.ORGANIZATION_ADMIN,
                        OrganizationKeyInvitation: {
                            TokenKeyPacket: invitation.TokenKeyPacket,
                            Signature: invitation.Signature,
                            SignatureAddressID: invitation.SignatureAddressID,
                            EncryptionAddressID: invitation.EncryptionAddressID,
                        },
                    })
                );
            })
        );

        const publicPromise = Promise.all(
            publicAdminActivations.map((activation) => {
                return api(
                    updateRolePasswordless({
                        memberID: activation.MemberID,
                        Role: MEMBER_ROLE.ORGANIZATION_ADMIN,
                        OrganizationKeyActivation: {
                            TokenKeyPacket: activation.TokenKeyPacket,
                            Signature: activation.Signature,
                        },
                    })
                );
            })
        );

        await Promise.all([privatePromise, publicPromise]);
    };
};

export const rotateOrganizationKeys = ({
    password: newPassword,
}: {
    password: string;
}): ThunkAction<
    Promise<ReturnType<typeof updateOrganizationKeysV2> | ReturnType<typeof updateOrganizationKeysLegacy>>,
    OrganizationKeyState,
    ProtonThunkArguments,
    UnknownAction
> => {
    return async (dispatch, getState, extra) => {
        const organizationKey = await dispatch(organizationKeyThunk());

        const keyPassword = extra.authentication.getPassword();
        const addresses = await dispatch(addressesThunk());

        const publicMembersToReEncrypt = await dispatch(getPublicMembersToReEncryptPayload());

        const { privateKey, privateKeyArmored, backupKeySalt, backupArmoredPrivateKey } =
            await generateOrganizationKeys({
                keyPassword,
                backupPassword: newPassword,
                encryptionConfig: ENCRYPTION_CONFIGS[ENCRYPTION_TYPES.CURVE25519],
            });

        const publicKey = await CryptoProxy.importPublicKey({ armoredKey: privateKeyArmored });

        if (getHasMigratedAddressKeys(addresses)) {
            let members: Parameters<typeof updateOrganizationKeysV2>[0]['Members'] = [];
            if (publicMembersToReEncrypt.length >= 1) {
                if (!organizationKey?.privateKey) {
                    throw new Error(getPrivatizeError());
                }
                members = await getReEncryptedPublicMemberTokensPayloadV2({
                    publicMembers: publicMembersToReEncrypt,
                    oldOrganizationKey: organizationKey,
                    newOrganizationKey: { privateKey, publicKey },
                });
            }
            return updateOrganizationKeysV2({
                PrivateKey: privateKeyArmored,
                BackupPrivateKey: backupArmoredPrivateKey,
                BackupKeySalt: backupKeySalt,
                Members: members,
            });
        }

        let tokens: Parameters<typeof updateOrganizationKeysLegacy>[0]['Tokens'] = [];
        if (publicMembersToReEncrypt.length >= 1) {
            if (!organizationKey?.privateKey) {
                throw new Error(getPrivatizeError());
            }
            tokens = await getReEncryptedPublicMemberTokensPayloadLegacy({
                publicMembers: publicMembersToReEncrypt,
                oldOrganizationKey: organizationKey,
                newOrganizationKey: { privateKey, publicKey },
            });
        }
        return updateOrganizationKeysLegacy({
            PrivateKey: privateKeyArmored,
            BackupPrivateKey: backupArmoredPrivateKey,
            BackupKeySalt: backupKeySalt,
            Tokens: tokens,
        });
    };
};

export const rotatePasswordlessOrganizationKeys = ({
    publicMembersToReEncryptPayload,
    memberKeyPayloads,
}: OrganizationKeyRotationPayload): ThunkAction<
    Promise<ReturnType<typeof updatePasswordlessOrganizationKeys>>,
    OrganizationKeyState,
    ProtonThunkArguments,
    UnknownAction
> => {
    return async (dispatch) => {
        const userKeys = await dispatch(userKeysThunk());
        const organizationKey = await dispatch(organizationKeyThunk());
        if (!getIsPasswordless(organizationKey?.Key)) {
            throw new Error('Only used on passwordless organizations');
        }
        const userKey = userKeys[0]?.privateKey;
        if (!userKey) {
            throw new Error('Missing primary user key');
        }
        const [primaryAddress] = await dispatch(addressesThunk());
        if (!primaryAddress) {
            throw new Error('Missing primary address');
        }
        const [primaryAddressKey] = await dispatch(addressKeysThunk({ thunkArg: primaryAddress.ID }));
        if (!primaryAddressKey) {
            throw new Error('Missing primary address key');
        }

        const { signature, privateKey, privateKeyArmored, encryptedToken } = await generatePasswordlessOrganizationKey({
            userKey,
            encryptionConfig: ENCRYPTION_CONFIGS[ENCRYPTION_TYPES.CURVE25519],
        });

        const { sessionKey, message } = await decryptKeyPacket({
            armoredMessage: encryptedToken,
            decryptionKeys: [userKey],
        });
        const data = { binaryData: message.data, sessionKey };
        const signer = {
            addressID: primaryAddress.ID,
            privateKey: primaryAddressKey.privateKey,
        };

        const { privateAdminPromises, publicAdminPromises } = memberKeyPayloads.reduce<{
            privateAdminPromises: ReturnType<typeof generatePrivateMemberInvitation>[];
            publicAdminPromises: ReturnType<typeof generatePublicMemberInvitation>[];
        }>(
            (acc, memberPayload) => {
                if (memberPayload.type === 1) {
                    const { member, publicKey, address } = memberPayload;
                    acc.privateAdminPromises.push(
                        generatePrivateMemberInvitation({
                            member,
                            publicKey,
                            addressID: address.ID,
                            signer,
                            data,
                        })
                    );
                } else {
                    const { member, privateKey } = memberPayload;
                    acc.publicAdminPromises.push(
                        generatePublicMemberInvitation({
                            member,
                            privateKey,
                            data,
                        })
                    );
                }

                return acc;
            },
            { privateAdminPromises: [], publicAdminPromises: [] }
        );

        const [privateAdminInvitations, publicAdminActivations] = await Promise.all([
            Promise.all(privateAdminPromises),
            Promise.all(publicAdminPromises),
        ]);

        let memberTokens: Parameters<typeof updatePasswordlessOrganizationKeys>[0]['Members'] = [];
        if (publicMembersToReEncryptPayload.length >= 1) {
            if (!organizationKey?.privateKey) {
                throw new Error('Public members received without an existing organization key.');
            }
            const publicKey = await CryptoProxy.importPublicKey({ armoredKey: privateKeyArmored });
            memberTokens = await getReEncryptedPublicMemberTokensPayloadV2({
                publicMembers: publicMembersToReEncryptPayload,
                oldOrganizationKey: organizationKey,
                newOrganizationKey: { privateKey, publicKey },
            });
        }

        return updatePasswordlessOrganizationKeys({
            PrivateKey: privateKeyArmored,
            Signature: signature,
            Token: encryptedToken,
            Members: memberTokens,
            AdminActivations: publicAdminActivations,
            AdminInvitations: privateAdminInvitations,
        });
    };
};

export const setAdminRole = ({
    member,
    payload,
    api,
}: {
    member: Member;
    payload: MemberKeyPayload | null;
    api: Api;
}): ThunkAction<Promise<void>, OrganizationKeyState, ProtonThunkArguments, UnknownAction> => {
    return async (dispatch) => {
        const organizationKey = await dispatch(organizationKeyThunk());

        if (!getIsPasswordless(organizationKey?.Key)) {
            await api(updateRole(member.ID, MEMBER_ROLE.ORGANIZATION_ADMIN));
            return;
        }

        if (!payload) {
            throw new Error('Missing payload');
        }

        await dispatch(setAdminRoles({ memberKeyPayloads: [payload], api }));
    };
};

interface CreateMemberPayload {
    name: string;
    address: { Local: string; Domain: string };
    private: boolean;
    storage: number;
    vpn?: boolean;
    password: string;
    role: MEMBER_ROLE | null;
}

export const editMember = ({
    member,
    memberDiff,
    memberKeyPacketPayload,
    api,
}: {
    member: Member;
    memberDiff: Partial<CreateMemberPayload>;
    memberKeyPacketPayload: MemberKeyPayload | null;
    api: Api;
}): ThunkAction<Promise<boolean>, OrganizationKeyState, ProtonThunkArguments, UnknownAction> => {
    return async (dispatch) => {
        if (memberDiff.name !== undefined) {
            await api(updateName(member.ID, memberDiff.name));
        }
        if (memberDiff.storage !== undefined) {
            await api(updateQuota(member.ID, memberDiff.storage));
        }
        if (memberDiff.vpn !== undefined) {
            await api(updateVPN(member.ID, memberDiff.vpn ? VPN_CONNECTIONS : 0));
        }
        if (memberDiff.role === MEMBER_ROLE.ORGANIZATION_ADMIN) {
            await dispatch(setAdminRole({ member, payload: memberKeyPacketPayload, api }));
        }
        if (memberDiff.role === MEMBER_ROLE.ORGANIZATION_MEMBER) {
            await api(updateRole(member.ID, MEMBER_ROLE.ORGANIZATION_MEMBER));
        }
        if (memberDiff.private) {
            await api(privatizeMember(member.ID));
        }
        return Object.values(memberDiff).some((value) => value !== undefined);
    };
};

export const createMember = ({
    member: model,
    keyTransparencyVerify,
    keyTransparencyCommit,
    getPublicKeysForInbox,
    api,
}: {
    member: CreateMemberPayload;
    keyTransparencyVerify: KeyTransparencyVerify;
    keyTransparencyCommit: KeyTransparencyCommit;
    getPublicKeysForInbox: GetPublicKeysForInbox;
    api: Api;
}): ThunkAction<Promise<void>, OrganizationKeyState, ProtonThunkArguments, UnknownAction> => {
    return async (dispatch) => {
        const userKeys = await dispatch(userKeysThunk());
        const ownerAddresses = await dispatch(addressesThunk());
        const organizationKey = await dispatch(organizationKeyThunk());

        if (!model.private) {
            if (!organizationKey?.privateKey) {
                throw new Error(c('Error').t`Organization key must be activated to create non-private users`);
            }
        }

        if (model.private) {
            if (model.role === MEMBER_ROLE.ORGANIZATION_ADMIN) {
                if (getIsPasswordless(organizationKey?.Key)) {
                    throw new Error(getPrivateAdminError());
                }
            }
        }

        await api(checkMemberAddressAvailability(model.address));

        const { Member } = await srpVerify<{ Member: Member }>({
            api,
            credentials: { password: model.password },
            config: createMemberConfig({
                Name: model.name || model.address.Local,
                Private: +model.private,
                MaxSpace: +model.storage,
                MaxVPN: model.vpn ? VPN_CONNECTIONS : 0,
            }),
        });

        const { Address: memberAddress } = await api<{ Address: Address }>(
            createMemberAddress(Member.ID, model.address)
        );
        const memberAddresses = [memberAddress];
        let memberWithKeys: Member | undefined;

        if (!model.private && organizationKey?.privateKey) {
            const result = await setupMemberKeys({
                api,
                ownerAddresses,
                member: Member,
                memberAddresses,
                organizationKey: organizationKey.privateKey,
                encryptionConfig: ENCRYPTION_CONFIGS[DEFAULT_ENCRYPTION_CONFIG],
                password: model.password,
                keyTransparencyVerify,
            });
            memberWithKeys = result.Member;
            await keyTransparencyCommit(userKeys);
        }

        if (model.role === MEMBER_ROLE.ORGANIZATION_ADMIN) {
            if (getIsPasswordless(organizationKey?.Key)) {
                if (!model.private && memberWithKeys) {
                    const memberKeyPayload = await getMemberKeyPayload({
                        organizationKey,
                        member: memberWithKeys,
                        memberAddresses,
                        getPublicKeysForInbox,
                    });
                    await dispatch(setAdminRoles({ api, memberKeyPayloads: [memberKeyPayload] }));
                } else {
                    // Ignore, can't set non-private users admins on creation
                }
            } else {
                await api(updateRole(Member.ID, MEMBER_ROLE.ORGANIZATION_ADMIN));
            }
        }
    };
};

export type AcceptOrganizationKeyInvitePayload =
    | {
          state: 'verified';
          result: {
              keyPacket: string;
              signature: string;
          };
      }
    | {
          state: 'unverified' | 'public-keys';
          result: null;
      };
export const prepareAcceptOrganizationKeyInvite = ({
    adminEmail,
    getPublicKeysForInbox,
}: {
    adminEmail: string;
    getPublicKeysForInbox: GetPublicKeysForInbox;
}): ThunkAction<
    Promise<AcceptOrganizationKeyInvitePayload>,
    OrganizationKeyState,
    ProtonThunkArguments,
    UnknownAction
> => {
    return async (dispatch) => {
        const userKeys = await dispatch(userKeysThunk());
        const organizationKey = await dispatch(organizationKeyThunk());
        const addresses = await dispatch(addressesThunk());

        if (!getIsPasswordless(organizationKey?.Key)) {
            throw new Error('Can only be used on passwordless orgs');
        }
        const primaryUserKey = userKeys[0];
        if (!primaryUserKey) {
            throw new Error('Missing primary user key');
        }
        const targetAddress = addresses?.find((address) => address.ID === organizationKey.Key.EncryptionAddressID);
        if (!targetAddress) {
            throw new Error('Missing encryption address');
        }

        const addressKeys = await dispatch(addressKeysThunk({ thunkArg: targetAddress.ID }));
        if (!addressKeys.length) {
            throw new Error('Missing address keys');
        }

        const apiKeysConfig = await getPublicKeysForInbox({
            email: adminEmail,
            lifetime: 0,
        });

        const apiErrors = apiKeysConfig.Errors || [];
        if (apiErrors.length > 0) {
            throw new Error(apiErrors[0]);
        }

        const verificationKeys = apiKeysConfig.publicKeys.map(({ publicKey }) => publicKey);
        if (!verificationKeys?.length) {
            return {
                state: 'public-keys',
                result: null,
            };
        }

        const splitAddressKeys = splitKeys(addressKeys);
        try {
            const result = await acceptInvitation({
                Token: organizationKey.Key.Token,
                Signature: organizationKey.Key.Signature,
                decryptionKeys: splitAddressKeys.privateKeys,
                verificationKeys,
                encryptionKey: primaryUserKey.privateKey,
            });
            return {
                state: 'verified',
                result,
            };
        } catch (error: any) {
            captureMessage('Passwordless: Error accepting invite', { level: 'error', extra: { error } });
            return {
                state: 'unverified',
                result: null,
            };
        }
    };
};

export const acceptOrganizationKeyInvite = ({
    api,
    payload,
}: {
    api: Api;
    payload: AcceptOrganizationKeyInvitePayload;
}): ThunkAction<Promise<void>, OrganizationKeyState, ProtonThunkArguments, UnknownAction> => {
    return async (dispatch) => {
        if (payload.state === 'verified') {
            await api(
                activatePasswordlessKey({
                    TokenKeyPacket: payload.result.keyPacket,
                    Signature: payload.result.signature,
                })
            );
            // Warning: Force a refetch of the org key because it's not present in the event manager.
            await dispatch(organizationKeyThunk({ forceFetch: true }));
        }
    };
};
