import { c } from 'ttag';

import isTruthy from '@proton/utils/isTruthy';
import truncate from '@proton/utils/truncate';

import { CONTACT_CARD_TYPE, FORBIDDEN_LABEL_NAMES } from '../../constants';
import { normalize } from '../../helpers/string';
import {
    ContactGroup,
    ContactMetadata,
    IMPORT_GROUPS_ACTION,
    ImportCategories,
    ImportedContact,
    SimpleEncryptedContact,
} from '../../interfaces/contacts';
import {
    ACCEPTED_EXTENSIONS,
    EXTENSION,
    EncryptedContact,
    ImportContactsModel,
} from '../../interfaces/contacts/Import';
import { VCardContact, VCardProperty } from '../../interfaces/contacts/VCard';
import { SimpleMap } from '../../interfaces/utils';
import { MAX_CONTACT_ID_CHARS_DISPLAY } from '../constants';
import { IMPORT_CONTACT_ERROR_TYPE, ImportContactError } from '../errors/ImportContactError';
import { createContactPropertyUid } from '../properties';
import { getSupportedContactName } from '../surgery';
import { getContactHasName, parseToVCard } from '../vcard';

export const getIsAcceptedExtension = (extension: string): extension is ACCEPTED_EXTENSIONS => {
    return Object.values(EXTENSION).includes(extension as EXTENSION);
};

export const getHasPreVcardsContacts = (
    model: ImportContactsModel
): model is ImportContactsModel & Required<Pick<ImportContactsModel, 'preVcardsContacts'>> => {
    return !!model.preVcardsContacts;
};

/**
 * Try to get a string that identifies a contact. This will be used in case of errors
 */
export const getContactId = (vcardOrVCardContact: string | VCardContact) => {
    // translator: When having an error importing a contact for which we can't find a name, we display an error message `Contact ${contactId}: error description` with contactId = 'unknown'
    const unknownString = c('Import contact. Contact identifier').t`unknown`;
    if (typeof vcardOrVCardContact !== 'string') {
        const fn = vcardOrVCardContact.fn[0]?.value;
        if (fn) {
            return fn;
        }
        const email = vcardOrVCardContact.email?.[0]?.value;
        if (email) {
            return email;
        }
        return unknownString;
    }
    // try to get the name of the contact from FN, which is a required field in a vcard
    const contentLineSeparator = vcardOrVCardContact.includes('\r\n') ? '\r\n' : '\n';
    const contentLineSeparatorLength = contentLineSeparator.length;
    const indexOfFNProperty = vcardOrVCardContact.toLowerCase().indexOf(`${contentLineSeparator}fn`);
    const indexOfFNValue = vcardOrVCardContact.indexOf(':', indexOfFNProperty);
    if (indexOfFNValue === -1 || indexOfFNProperty === -1) {
        return unknownString;
    }
    let indexOfNextField = vcardOrVCardContact.indexOf(contentLineSeparator, indexOfFNValue);
    let FNvalue = vcardOrVCardContact.substring(indexOfFNValue + 1, indexOfNextField);
    while (
        vcardOrVCardContact[indexOfNextField + contentLineSeparatorLength] === ' ' &&
        FNvalue.length < MAX_CONTACT_ID_CHARS_DISPLAY
    ) {
        const oldIndex = indexOfNextField;
        indexOfNextField = vcardOrVCardContact.indexOf(contentLineSeparator, oldIndex + contentLineSeparatorLength);
        FNvalue += vcardOrVCardContact.substring(oldIndex + contentLineSeparatorLength + 1, indexOfNextField);
    }

    return truncate(FNvalue, MAX_CONTACT_ID_CHARS_DISPLAY);
};

export const getSupportedContact = (vcard: string) => {
    try {
        const contactId = getContactId(vcard);

        if (vcard.includes('VERSION:2.1')) {
            throw new ImportContactError(IMPORT_CONTACT_ERROR_TYPE.UNSUPPORTED_VCARD_VERSION, contactId);
        }

        const contact = parseToVCard(vcard);

        if (!getContactHasName(contact)) {
            const supportedContactName = getSupportedContactName(contact);

            if (!supportedContactName) {
                throw new ImportContactError(IMPORT_CONTACT_ERROR_TYPE.MISSING_FN, contactId);
            }

            const supportedFnProperty: VCardProperty<string> = {
                field: 'fn',
                uid: createContactPropertyUid(),
                value: supportedContactName,
            };

            contact.fn = [supportedFnProperty];
        }

        return contact;
    } catch (error: any) {
        if (error instanceof ImportContactError) {
            throw error;
        }
        const contactId = getContactId(vcard);
        throw new ImportContactError(IMPORT_CONTACT_ERROR_TYPE.EXTERNAL_ERROR, contactId, error);
    }
};

export const getSupportedContacts = (vcards: string[]) => {
    return vcards
        .map((vcard) => {
            try {
                return getSupportedContact(vcard);
            } catch (error: any) {
                if (error instanceof ImportContactError) {
                    return error;
                }
                const contactId = getContactId(vcard);
                return new ImportContactError(IMPORT_CONTACT_ERROR_TYPE.EXTERNAL_ERROR, contactId, error);
            }
        })
        .filter(isTruthy);
};

export const haveCategories = (contacts: ImportedContact[]) => {
    return contacts.some(({ categories }) => categories.some((category) => category.contactEmailIDs?.length));
};

/**
 * Extract the info about categories relevant for importing groups, i.e.
 * extract categories with corresponding contact email ids (if any) for a submitted contact
 */
export const extractContactImportCategories = (
    contact: ContactMetadata,
    { categories, contactEmails }: EncryptedContact
) => {
    const withGroup = categories.map(({ name, group }) => {
        const matchingContactEmailIDs = contactEmails
            .filter(
                ({ group: emailGroup }) =>
                    // If category group is not defined, we consider it applies to all email
                    group === undefined ||
                    // If category group is defined, we consider it has to match with the email group
                    emailGroup === group
            )
            .map(({ email }) => {
                const { ID } = contact.ContactEmails.find(({ Email }) => Email === email) || {};
                return ID;
            })
            .filter(isTruthy);

        if (!matchingContactEmailIDs.length) {
            return { name };
        }
        return { name, contactEmailIDs: matchingContactEmailIDs };
    });
    const categoriesMap = withGroup.reduce<SimpleMap<string[]>>((acc, { name, contactEmailIDs = [] }) => {
        const category = acc[name];
        if (category && contactEmailIDs.length) {
            category.push(...contactEmailIDs);
        } else {
            acc[name] = [...contactEmailIDs];
        }
        return acc;
    }, {});

    return Object.entries(categoriesMap).map(([name, contactEmailIDs]) => ({ name, contactEmailIDs }));
};

/**
 * Given a list of imported contacts, get a list of the categories that can be imported, each of them with
 * a list of contactEmailIDs or contactIDs plus total number of contacts that would go into the category
 */
export const getImportCategories = (contacts: ImportedContact[]) => {
    const allCategoriesMap = contacts.reduce<
        SimpleMap<Pick<ImportCategories, 'contactEmailIDs' | 'contactIDs' | 'totalContacts'>>
    >((acc, { contactID, categories, contactEmailIDs: contactEmailIDsOfContact }) => {
        if (
            // No categories to consider
            !categories.length ||
            // We ignore groups on contact with no emails
            !contactEmailIDsOfContact.length
        ) {
            return acc;
        }
        categories.forEach(({ name, contactEmailIDs = [] }) => {
            const category = acc[name];
            if (contactEmailIDs.length === 0) {
                // We ignore groups on contact if no emails are assigned
                return;
            }
            if (!category) {
                if (contactEmailIDs.length === contactEmailIDsOfContact.length) {
                    acc[name] = { contactEmailIDs: [], contactIDs: [contactID], totalContacts: 1 };
                } else {
                    acc[name] = { contactEmailIDs: [...contactEmailIDs], contactIDs: [], totalContacts: 1 };
                }
            } else if (contactEmailIDs.length === contactEmailIDsOfContact.length) {
                acc[name] = {
                    contactEmailIDs: category.contactEmailIDs,
                    contactIDs: [...category.contactIDs, contactID],
                    totalContacts: category.totalContacts + 1,
                };
            } else {
                acc[name] = {
                    contactEmailIDs: [...category.contactEmailIDs, ...contactEmailIDs],
                    contactIDs: category.contactIDs,
                    totalContacts: category.totalContacts + 1,
                };
            }
        });
        return acc;
    }, {});

    return Object.entries(allCategoriesMap)
        .map(([name, value]) => {
            if (!value) {
                return;
            }
            return {
                name,
                contactEmailIDs: value.contactEmailIDs,
                contactIDs: value.contactIDs,
                totalContacts: value.totalContacts,
            };
        })
        .filter(isTruthy);
};

export const getImportCategoriesModel = (contacts: ImportedContact[], groups: ContactGroup[] = []) => {
    const categories = getImportCategories(contacts).map((category) => {
        const existingGroup = groups.find(({ Name }) => Name === category.name);
        const action = existingGroup && groups.length ? IMPORT_GROUPS_ACTION.MERGE : IMPORT_GROUPS_ACTION.CREATE;
        const targetGroup = existingGroup || groups[0];
        const targetName = existingGroup ? '' : category.name;
        const result: ImportCategories = {
            ...category,
            action,
            targetGroup,
            targetName,
        };
        if (action === IMPORT_GROUPS_ACTION.CREATE && FORBIDDEN_LABEL_NAMES.includes(normalize(targetName))) {
            result.error = c('Error').t`Invalid name`;
        }
        return result;
    });
    return categories;
};

export const splitErrors = <T>(contacts: (T | ImportContactError)[]) => {
    return contacts.reduce<{ errors: ImportContactError[]; rest: T[] }>(
        (acc, contact) => {
            if (contact instanceof ImportContactError) {
                acc.errors.push(contact);
            } else {
                acc.rest.push(contact);
            }
            return acc;
        },
        { errors: [], rest: [] }
    );
};

/**
 * Split encrypted contacts depending on having the CATEGORIES property.
 */
export const splitEncryptedContacts = (contacts: SimpleEncryptedContact[] = []) =>
    contacts.reduce<{ withCategories: SimpleEncryptedContact[]; withoutCategories: SimpleEncryptedContact[] }>(
        (acc, contact) => {
            const {
                contact: { Cards, error },
            } = contact;
            if (error) {
                return acc;
            }
            if (Cards.some(({ Type, Data }) => Type === CONTACT_CARD_TYPE.CLEAR_TEXT && Data.includes('CATEGORIES'))) {
                acc.withCategories.push(contact);
            } else {
                acc.withoutCategories.push(contact);
            }
            return acc;
        },
        { withCategories: [], withoutCategories: [] }
    );
