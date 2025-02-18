import { CryptoProxy } from '@proton/crypto';
import { activatePasswordlessKey } from '@proton/shared/lib/api/members';
import {
    getIsPasswordless,
    getReplacedAddressKeyTokens,
    reencryptOrganizationToken,
    splitKeys,
} from '@proton/shared/lib/keys';
import noop from '@proton/utils/noop';

import { createUserKeyRoute, replaceAddressTokens } from '../../api/keys';
import { DEFAULT_ENCRYPTION_CONFIG, ENCRYPTION_CONFIGS } from '../../constants';
import {
    Address,
    Api,
    CachedOrganizationKey,
    DecryptedKey,
    EncryptionConfig,
    KeyTransparencyVerify,
    UserModel,
} from '../../interfaces';
import { storeDeviceRecovery } from '../../recoveryFile/deviceRecovery';
import { getActiveKeys } from '../getActiveKeys';
import { getHasMigratedAddressKeys } from '../keyMigration';
import { generateUserKey } from '../userKeys';
import { createAddressKeyLegacy, createAddressKeyV2 } from './addAddressKeyHelper';

interface AddAddressKeysProcessArguments {
    api: Api;
    addressKeys: DecryptedKey[];
    userKeys: DecryptedKey[];
    address: Address;
    addresses: Address[];
    encryptionConfig: EncryptionConfig;
    keyPassword: string;
    keyTransparencyVerify: KeyTransparencyVerify;
}

export const addAddressKeysProcess = async ({
    api,
    encryptionConfig,
    addresses,
    address,
    addressKeys,
    userKeys,
    keyPassword,
    keyTransparencyVerify,
}: AddAddressKeysProcessArguments) => {
    const hasMigratedAddressKeys = getHasMigratedAddressKeys(addresses);

    const activeKeys = await getActiveKeys(address, address.SignedKeyList, address.Keys, addressKeys);

    if (hasMigratedAddressKeys) {
        return createAddressKeyV2({
            api,
            userKeys,
            encryptionConfig,
            activeKeys,
            address,
            keyTransparencyVerify,
        });
    }

    return createAddressKeyLegacy({
        api,
        address,
        encryptionConfig,
        passphrase: keyPassword,
        activeKeys,
        keyTransparencyVerify,
    });
};

interface AddUserKeysProcessArguments {
    api: Api;
    encryptionConfig?: EncryptionConfig;
    user: UserModel;
    userKeys: DecryptedKey[];
    addresses: Address[];
    passphrase: string;
    isDeviceRecoveryAvailable?: boolean;
    isDeviceRecoveryEnabled?: boolean;
    organizationKey?: CachedOrganizationKey;
    call: () => Promise<void>;
}

export const addUserKeysProcess = async ({
    api,
    encryptionConfig = ENCRYPTION_CONFIGS[DEFAULT_ENCRYPTION_CONFIG],
    user,
    userKeys,
    addresses,
    passphrase,
    organizationKey,
    isDeviceRecoveryAvailable,
    isDeviceRecoveryEnabled,
    call,
}: AddUserKeysProcessArguments) => {
    const { privateKey, privateKeyArmored } = await generateUserKey({
        passphrase,
        encryptionConfig,
    });

    await api(
        createUserKeyRoute({
            Primary: 1,
            PrivateKey: privateKeyArmored,
        })
    );

    const splitUserKeys = splitKeys(userKeys);

    if (getHasMigratedAddressKeys(addresses)) {
        const replacedResult = await getReplacedAddressKeyTokens({
            privateKeys: splitUserKeys.privateKeys,
            addresses,
            privateKey,
        });
        if (replacedResult.AddressKeyTokens.length) {
            await api(replaceAddressTokens(replacedResult)).catch(/*ignore failures */ noop);
        }
    }

    if (getIsPasswordless(organizationKey?.Key)) {
        const result = await reencryptOrganizationToken({
            Token: organizationKey.Key.Token,
            encryptionKey: privateKey,
            signingKey: privateKey,
            decryptionKeys: splitUserKeys.privateKeys,
        });
        await api(
            activatePasswordlessKey({
                TokenKeyPacket: result.keyPacket,
                Signature: result.signature,
            })
        ).catch(/*ignore failures */ noop);
    }

    // Store a new device recovery immediately to avoid having the storing trigger asynchronously which would cause red notification flashes
    if (isDeviceRecoveryAvailable && isDeviceRecoveryEnabled) {
        const publicKey = await CryptoProxy.importPublicKey({
            binaryKey: await CryptoProxy.exportPublicKey({ key: privateKey, format: 'binary' }),
        });
        await storeDeviceRecovery({
            api,
            user,
            userKeys: [{ ID: 'tmp-id', privateKey, publicKey }, ...userKeys],
        });
    }
    await call();

    return privateKey;
};
