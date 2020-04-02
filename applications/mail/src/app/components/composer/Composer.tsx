import React, { useState, useEffect, CSSProperties, useRef } from 'react';
import {
    classnames,
    useToggle,
    useWindowSize,
    useNotifications,
    useApi,
    useMailSettings,
    useAuthentication
} from 'react-components';
import { c } from 'ttag';
import { Address } from 'proton-shared/lib/interfaces';
import { noop } from 'proton-shared/lib/helpers/function';
import { wait } from 'proton-shared/lib/helpers/promise';
import { setBit, clearBit } from 'proton-shared/lib/helpers/bitset';

import { MapSendPreferences } from '../../helpers/message/sendPreferences';
import { MessageExtended } from '../../models/message';
import ComposerTitleBar from './ComposerTitleBar';
import ComposerMeta from './ComposerMeta';
import ComposerContent from './ComposerContent';
import ComposerActions from './ComposerActions';
import {
    COMPOSER_GUTTER,
    COMPOSER_VERTICAL_GUTTER,
    APP_BAR_WIDTH,
    HEADER_HEIGHT,
    COMPOSER_HEIGHT,
    COMPOSER_SWITCH_MODE
} from '../../containers/ComposerContainer';
import { getRecipients, getAttachments } from '../../helpers/message/messages';
import { upload, ATTACHMENT_ACTION, UploadResult } from '../../helpers/attachment/attachmentUploader';
import { Attachment } from '../../models/attachment';
import { removeAttachment } from '../../api/attachments';
import { createEmbeddedMap, readCID, isEmbeddable } from '../../helpers/embedded/embeddeds';
import { InsertRef } from './editor/Editor';
import { setContent } from '../../helpers/message/messageContent';
import ComposerPasswordModal from './ComposerPasswordModal';
import ComposerExpirationModal from './ComposerExpirationModal';
import { useHandler } from '../../hooks/useHandler';
import { isPlainText } from '../../helpers/message/messages';
import { Upload } from '../../helpers/upload';
import { useMessage } from '../../hooks/useMessage';
import { useInitializeMessage } from '../../hooks/useMessageReadActions';
import { useCreateDraft, useSaveDraft, useDeleteDraft, useUpdateAttachments } from '../../hooks/useMessageWriteActions';
import { useSendMessage } from '../../hooks/useSendMessage';
import { isNewDraft } from '../../helpers/message/messageDraft';

enum ComposerInnerModal {
    None,
    Password,
    Expiration
}

export interface PendingUpload {
    file: File;
    upload: Upload<UploadResult>;
}

/**
 * Create a new MessageExtended with props from both m1 and m2
 * Almost a standard deep merge but simplified with specific needs
 * m2 props will override those from m1
 */
const mergeMessages = (m1: MessageExtended, m2: Partial<MessageExtended>): MessageExtended => ({
    ...m1,
    ...m2,
    data: { ...m1.data, ...m2.data }
});

const computeStyle = (
    inputStyle: CSSProperties,
    minimized: boolean,
    maximized: boolean,
    width: number,
    height: number
): CSSProperties => {
    if (minimized) {
        return {
            ...inputStyle,
            height: 'auto'
        };
    }
    if (maximized) {
        return {
            ...inputStyle,
            right: COMPOSER_GUTTER,
            width: width - COMPOSER_GUTTER - APP_BAR_WIDTH,
            height: height - COMPOSER_VERTICAL_GUTTER * 2
        };
    }
    return inputStyle;
};

interface Props {
    style?: CSSProperties;
    focus: boolean;
    messageID: string;
    addresses: Address[];
    onFocus: () => void;
    onClose: () => void;
}

const Composer = ({ style: inputStyle = {}, focus, messageID, addresses, onFocus, onClose: inputOnClose }: Props) => {
    const api = useApi();
    const [mailSettings] = useMailSettings();
    const [width, height] = useWindowSize();
    const { createNotification } = useNotifications();
    const auth = useAuthentication();

    // Minimized status of the composer
    const { state: minimized, toggle: toggleMinimized } = useToggle(false);

    // Maximized status of the composer
    const { state: maximized, toggle: toggleMaximized } = useToggle(false);

    // Indicates that the composer is in its initial opening
    // Needed to be able to force focus only at first time
    const [opening, setOpening] = useState(true);

    // Indicates that the composer is being closed
    // Needed to keep component alive while saving/deleting on close
    const [closing, setClosing] = useState(false);

    // Indicates that the composer is open but the edited message is not yet ready
    // Needed to prevent edition while data is not ready
    const [editorReady, setEditorReady] = useState(false);

    // Flag representing the presence of an inner modal on the composer
    const [innerModal, setInnerModal] = useState(ComposerInnerModal.None);

    // Model value of the edited message in the composer
    const [modelMessage, setModelMessage] = useState<MessageExtended>({
        localID: messageID,
        data: {
            Subject: '' // Needed fot the subject input controlled field
        }
    });

    // Pending files to upload
    const [pendingFiles, setPendingFiles] = useState<File[]>();

    // Pending uploads
    const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>();

    // Map of send preferences for each recipient
    const [mapSendPrefs, setMapSendPrefs] = useState<MapSendPreferences>({});

    // Synced with server version of the edited message
    const { message: syncedMessage, addAction } = useMessage(messageID);

    // All message actions
    const initialize = useInitializeMessage(syncedMessage.localID);
    const createDraft = useCreateDraft();
    const saveDraft = useSaveDraft();
    const sendMessage = useSendMessage();
    const deleteDraft = useDeleteDraft(syncedMessage);
    const updateAttachments = useUpdateAttachments(syncedMessage);

    const syncLock = syncedMessage.actionStatus !== undefined;
    const syncActivity = syncedMessage.actionStatus || '';

    // Manage focus from the container yet keeping logic in each component
    const addressesBlurRef = useRef<() => void>(noop);
    const addressesFocusRef = useRef<() => void>(noop);
    const contentFocusRef = useRef<() => void>(noop);

    // Get a ref on the editor to trigger insertion of embedded images
    const contentInsertRef: InsertRef = useRef();

    // onClose handler can be called in a async handler
    // Input onClose ref can change in the meantime
    const onClose = useHandler(inputOnClose);

    useEffect(() => {
        if (!syncLock && !syncedMessage.data?.ID && isNewDraft(syncedMessage.localID)) {
            addAction(() => createDraft(syncedMessage));
        }

        if (
            !syncLock &&
            (syncedMessage.data?.ID || (!syncedMessage.data?.ID && !isNewDraft(syncedMessage.localID))) &&
            syncedMessage.initialized === undefined
        ) {
            addAction(initialize);
        }

        if (modelMessage.document === undefined) {
            setModelMessage({
                ...modelMessage,
                data: { ...modelMessage.data, ...syncedMessage.data },
                document: syncedMessage.document
            });
        }
    }, [syncLock, syncedMessage]);

    useEffect(() => {
        if (!maximized && height - COMPOSER_VERTICAL_GUTTER - HEADER_HEIGHT < COMPOSER_HEIGHT - COMPOSER_SWITCH_MODE) {
            toggleMaximized();
        }
        if (maximized && height - COMPOSER_VERTICAL_GUTTER - HEADER_HEIGHT > COMPOSER_HEIGHT + COMPOSER_SWITCH_MODE) {
            toggleMaximized();
        }
    }, [height]);

    // Manage focus at opening
    useEffect(() => {
        if (!opening || !editorReady) {
            return;
        }
        setTimeout(() => {
            if (getRecipients(syncedMessage.data).length === 0) {
                addressesFocusRef.current();
            } else {
                contentFocusRef.current();
            }
        });
        setOpening(false);
    }, [editorReady]);

    const autoSave = useHandler(
        (message: MessageExtended) => {
            addAction(() => saveDraft(message));
        },
        { debounce: 2000 }
    );

    const handleChange = (message: Partial<MessageExtended>) => {
        const newModelMessage = mergeMessages(modelMessage, message);
        setModelMessage(newModelMessage);
        autoSave(newModelMessage);
    };
    const handleChangeContent = (content: string) => {
        setContent(modelMessage, content);
        const newModelMessage = { ...modelMessage };
        setModelMessage(newModelMessage);
        autoSave(newModelMessage);
    };
    const handleChangeFlag = (changes: Map<number, boolean>) => {
        let Flags = modelMessage.data?.Flags || 0;
        changes.forEach((isAdd, flag) => {
            const action = isAdd ? setBit : clearBit;
            Flags = action(Flags, flag);
        });
        handleChange({ data: { Flags } });
    };
    const save = async (messageToSave = modelMessage) => {
        await saveDraft(messageToSave);
        createNotification({ text: c('Info').t`Message saved` });
    };

    const removePendingUpload = (pendingUpload: PendingUpload) => {
        const newPendingUploads = pendingUploads?.filter((aPendingUpload) => aPendingUpload !== pendingUpload);
        setPendingUploads(newPendingUploads);
    };
    const handleAddAttachmentEnd = useHandler(async (action: ATTACHMENT_ACTION, pendingUpload: PendingUpload) => {
        removePendingUpload(pendingUpload);

        const uploadResult = await pendingUpload.upload.resultPromise; // should be instant
        const updatedMessage = await addAction(() => updateAttachments([uploadResult], action));
        const Attachments = getAttachments(updatedMessage.data);

        const newModelMessage = mergeMessages(modelMessage, { data: { Attachments } });
        setModelMessage(newModelMessage);

        if (action == ATTACHMENT_ACTION.INLINE) {
            // Needed to wait for the setModelMessage to be applied before inserting the image in the editor
            // Insertion will trigger a change and update the model which has to be updated
            await wait(0);

            const cid = readCID(uploadResult.attachment);
            const newEmbeddeds = createEmbeddedMap([[cid, updatedMessage.embeddeds?.get(cid)]]);

            contentInsertRef.current?.(newEmbeddeds);
        }
    });
    const handleAddAttachmentsUpload = async (action: ATTACHMENT_ACTION, files = pendingFiles || []) => {
        setPendingFiles(undefined);

        const uploads = upload(files, syncedMessage, action, auth.UID);
        const pendingUploads = files?.map((file, i) => ({ file, upload: uploads[i] }));
        setPendingUploads(pendingUploads);

        pendingUploads.forEach((pendingUpload) => {
            pendingUpload.upload.resultPromise.then(() => handleAddAttachmentEnd(action, pendingUpload));
        });
    };
    const handleAddEmbeddedImages = async (files: File[]) =>
        handleAddAttachmentsUpload(ATTACHMENT_ACTION.INLINE, files);
    const handleAddAttachmentsStart = async (files: File[]) => {
        const embeddable = files.every((file) => isEmbeddable(file.type));
        const plainText = isPlainText(modelMessage.data);

        if (!plainText && embeddable) {
            setPendingFiles(files);
        } else {
            handleAddAttachmentsUpload(ATTACHMENT_ACTION.ATTACHMENT, files);
        }
    };
    const handleRemoveAttachment = (attachment: Attachment) => async () => {
        await api(removeAttachment(attachment.ID || '', modelMessage.data?.ID || ''));
        const Attachments = modelMessage.data?.Attachments?.filter((a: Attachment) => a.ID !== attachment.ID);
        const newModelMessage = mergeMessages(modelMessage, { data: { Attachments } });
        setModelMessage(newModelMessage);
        save(modelMessage);
    };
    const handleRemoveUpload = (pendingUpload: PendingUpload) => () => {
        pendingUpload.upload.abort();
        removePendingUpload(pendingUpload);
    };
    const handlePassword = () => {
        setInnerModal(ComposerInnerModal.Password);
    };
    const handleExpiration = () => {
        setInnerModal(ComposerInnerModal.Expiration);
    };
    const handleCloseInnerModal = () => {
        setInnerModal(ComposerInnerModal.None);
    };
    const handleSave = async () => {
        await save();
    };
    const handleSend = async () => {
        await addAction(() => sendMessage(syncedMessage));
        createNotification({ text: c('Success').t`Message sent` });
        onClose();
    };
    const handleDelete = async () => {
        setClosing(true);
        await addAction(deleteDraft);
        createNotification({ text: c('Info').t`Message discarded` });
        onClose();
    };
    const handleClick = async () => {
        if (minimized) {
            toggleMinimized();
        }
        onFocus();
    };
    const handleClose = async () => {
        setClosing(true);
        await save();
        onClose();
    };
    const handleContentFocus = () => {
        addressesBlurRef.current();
        onFocus(); // Events on the main div will not fire because/ the editor is in an iframe
    };

    if (closing) {
        return null;
    }

    const style = computeStyle(inputStyle, minimized, maximized, width, height);

    return (
        <div
            className={classnames([
                'composer flex flex-column p0-5',
                !focus && 'composer-blur',
                minimized && 'composer-minimized pb0'
            ])}
            style={style}
            onFocus={onFocus}
            onClick={handleClick}
        >
            <ComposerTitleBar
                message={modelMessage}
                minimized={minimized}
                maximized={maximized}
                toggleMinimized={toggleMinimized}
                toggleMaximized={toggleMaximized}
                onClose={handleClose}
            />
            {!minimized && (
                <div className="flex flex-column flex-item-fluid relative mw100">
                    {innerModal === ComposerInnerModal.Password && (
                        <ComposerPasswordModal
                            message={modelMessage.data}
                            onClose={handleCloseInnerModal}
                            onChange={handleChange}
                        />
                    )}
                    {innerModal === ComposerInnerModal.Expiration && (
                        <ComposerExpirationModal
                            message={modelMessage.data}
                            onClose={handleCloseInnerModal}
                            onChange={handleChange}
                        />
                    )}
                    <div
                        className={classnames([
                            'flex-column flex-item-fluid mw100',
                            // Only hide the editor not to unload it each time a modal is on top
                            innerModal === ComposerInnerModal.None ? 'flex' : 'hidden'
                        ])}
                    >
                        <ComposerMeta
                            message={modelMessage}
                            addresses={addresses}
                            mailSettings={mailSettings}
                            mapSendPrefs={mapSendPrefs}
                            setMapSendPrefs={setMapSendPrefs}
                            disabled={!editorReady}
                            onChange={handleChange}
                            addressesBlurRef={addressesBlurRef}
                            addressesFocusRef={addressesFocusRef}
                        />
                        <ComposerContent
                            message={modelMessage}
                            disabled={!editorReady}
                            onEditorReady={() => setEditorReady(true)}
                            onChange={handleChange}
                            onChangeContent={handleChangeContent}
                            onChangeFlag={handleChangeFlag}
                            onFocus={handleContentFocus}
                            onAddAttachments={handleAddAttachmentsStart}
                            onAddEmbeddedImages={handleAddEmbeddedImages}
                            onRemoveAttachment={handleRemoveAttachment}
                            onRemoveUpload={handleRemoveUpload}
                            pendingFiles={pendingFiles}
                            pendingUploads={pendingUploads}
                            onCancelEmbedded={() => setPendingFiles(undefined)}
                            onSelectEmbedded={handleAddAttachmentsUpload}
                            contentFocusRef={contentFocusRef}
                            contentInsertRef={contentInsertRef}
                        />
                        <ComposerActions
                            message={modelMessage}
                            lock={syncLock || !editorReady}
                            activity={syncActivity}
                            onAddAttachments={handleAddAttachmentsStart}
                            onExpiration={handleExpiration}
                            onPassword={handlePassword}
                            onSave={handleSave}
                            onSend={handleSend}
                            onDelete={handleDelete}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

export default Composer;
