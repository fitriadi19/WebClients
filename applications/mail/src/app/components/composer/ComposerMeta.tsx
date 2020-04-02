import React, { useState, ChangeEvent, MutableRefObject, SetStateAction, Dispatch } from 'react';
import { c } from 'ttag';
import { Label, Select, Input, generateUID } from 'react-components';
import { Address, MailSettings } from 'proton-shared/lib/interfaces';
import { MapSendPreferences } from '../../helpers/message/sendPreferences';

import ComposerAddresses from './addresses/Addresses';
import { MessageExtended } from '../../models/message';
import { getFromAdresses } from '../../helpers/addresses';

interface Props {
    message: MessageExtended;
    addresses: Address[];
    mailSettings: MailSettings;
    mapSendPrefs: MapSendPreferences;
    setMapSendPrefs: Dispatch<SetStateAction<MapSendPreferences>>;
    disabled: boolean;
    onChange: (message: Partial<MessageExtended>) => void;
    addressesBlurRef: MutableRefObject<() => void>;
    addressesFocusRef: MutableRefObject<() => void>;
}

const ComposerMeta = ({
    message,
    addresses,
    mapSendPrefs,
    setMapSendPrefs,
    disabled,
    onChange,
    addressesBlurRef,
    addressesFocusRef
}: Props) => {
    const [uid] = useState(generateUID('composer'));

    const addressesOptions = getFromAdresses(addresses, message.originalTo).map((address: Address) => ({
        text: address.Email,
        value: address.ID
    }));

    const handleFromChange = (event: ChangeEvent) => {
        const select = event.target as HTMLSelectElement;
        const AddressID = select.value;
        const address = addresses.find((address: Address) => address.ID === AddressID);
        const Sender = address ? { Name: address.DisplayName, Address: address.Email } : undefined;
        onChange({ data: { AddressID, Sender } });
    };

    const handleSubjectChange = (event: ChangeEvent) => {
        const input = event.target as HTMLInputElement;
        onChange({ data: { Subject: input.value } });
    };

    return (
        <div className="composer-meta w100">
            <div className="flex flex-row flex-nowrap flex-items-center pl0-5 pr0-5 mb0-5">
                <Label htmlFor={`from-${uid}`} className="composer-meta-label bold">
                    {c('Info').t`From`}
                </Label>
                <Select
                    id={`from-${uid}`}
                    options={addressesOptions}
                    value={message.data?.AddressID}
                    disabled={disabled}
                    onChange={handleFromChange}
                    onFocus={addressesBlurRef.current}
                ></Select>
            </div>
            <ComposerAddresses
                message={message}
                mapSendPrefs={mapSendPrefs}
                setMapSendPrefs={setMapSendPrefs}
                disabled={disabled}
                onChange={onChange}
                addressesBlurRef={addressesBlurRef}
                addressesFocusRef={addressesFocusRef}
            />
            <div className="flex flex-row flex-nowrap flex-items-center pl0-5 pr0-5 mb0-5">
                <Label htmlFor={`subject-${uid}`} className="composer-meta-label pt0 bold">
                    {c('Info').t`Subject`}
                </Label>
                <Input
                    id={`subject-${uid}`}
                    value={message.data?.Subject}
                    placeholder={c('Placeholder').t`Subject`}
                    disabled={disabled}
                    onChange={handleSubjectChange}
                    onFocus={addressesBlurRef.current}
                />
            </div>
        </div>
    );
};

export default ComposerMeta;
