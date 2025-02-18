import { c } from 'ttag';

import { CryptoProxy, PrivateKeyReference, SessionKey } from '@proton/crypto';
import {
    queryCreateFile,
    queryCreateFileRevision,
    queryDeleteFileRevision,
    queryRequestUpload,
    queryUpdateFileRevision,
    queryVerificationData,
} from '@proton/shared/lib/api/drive/files';
import { base64StringToUint8Array, uint8ArrayToBase64String } from '@proton/shared/lib/helpers/encoding';
import {
    CreateFileResult,
    CreateFileRevisionResult,
    GetVerificationDataResult,
    RequestUploadResult,
} from '@proton/shared/lib/interfaces/drive/file';
import { encryptName, generateLookupHash } from '@proton/shared/lib/keys/driveKeys';

import { TransferCancel, TransferSkipped } from '../../../components/TransferManager/transfer';
import useQueuedFunction from '../../../hooks/util/useQueuedFunction';
import { logError } from '../../../utils/errorHandling';
import { EnrichedError } from '../../../utils/errorHandling/EnrichedError';
import { ValidationError } from '../../../utils/errorHandling/ValidationError';
import retryOnError from '../../../utils/retryOnError';
import { isPhotosDisabledUploadError } from '../../../utils/transfer';
import { useDebouncedRequest } from '../../_api';
import { useDriveEventManager } from '../../_events';
import { DecryptedLink, useLink, useLinksActions, validateLinkName } from '../../_links';
import { useShare } from '../../_shares';
import { useVolumesState } from '../../_volumes';
import { MAX_TOO_MANY_REQUESTS_WAIT, MAX_UPLOAD_BLOCKS_LOAD } from '../constants';
import { initUploadFileWorker } from '../initUploadFileWorker';
import {
    FileKeys,
    FileRequestBlock,
    PhotoUpload,
    ThumbnailRequestBlock,
    TransferConflictStrategy,
    UploadFileControls,
    VerificationData,
} from '../interface';
import { ConflictStrategyHandler, UploadUserError } from './interface';
import { generateClientUid } from './uploadClientUid';
import useUploadHelper from './useUploadHelper';

type LogCallback = (message: string) => void;

interface FileRevision {
    isNewFile: boolean;
    filename: string;
    fileID: string;
    revisionID: string;
    previousRevisionID?: string;
    sessionKey: SessionKey;
    privateKey: PrivateKeyReference;
    // Callbacks to control local client UIDs.
    // See useUploadClientUid for more details.
    uploadFinished: () => void;
    uploadFailed: () => void;
}

export default function useUploadFile() {
    const debouncedRequest = useDebouncedRequest();
    const queuedFunction = useQueuedFunction();
    const { getLinkPrivateKey, getLinkSessionKey, getLinkHashKey } = useLink();
    const { trashLinks, deleteChildrenLinks } = useLinksActions();
    const { getShareCreatorKeys } = useShare();
    const { findAvailableName, getLinkByName, findDuplicateContentHash } = useUploadHelper();
    const driveEventManager = useDriveEventManager();
    const volumeState = useVolumesState();

    const request = <T>(args: object, abortSignal?: AbortSignal) => {
        return debouncedRequest<T>(
            {
                ...args,
                maxRetryWaitSeconds: MAX_TOO_MANY_REQUESTS_WAIT,
            },
            abortSignal
        );
    };

    const initFileUpload = (
        shareId: string,
        parentId: string,
        file: File,
        getFileConflictStrategy: ConflictStrategyHandler,
        log: LogCallback,
        isForPhotos: boolean = false
    ): UploadFileControls => {
        let shareKeysCache: Awaited<ReturnType<typeof getShareCreatorKeys>>;
        const getShareKeys = async (abortSignal: AbortSignal) => {
            if (!shareKeysCache) {
                shareKeysCache = await getShareCreatorKeys(abortSignal, shareId);
            }

            return shareKeysCache;
        };

        const createFile = async (
            abortSignal: AbortSignal,
            filename: string,
            mimeType: string,
            hash: string,
            keys: FileKeys,
            previousClientUid?: string
        ): Promise<FileRevision> => {
            const error = validateLinkName(file.name);
            if (error) {
                throw new ValidationError(error);
            }

            const [addressKeyInfo, parentPrivateKey] = await Promise.all([
                getShareKeys(abortSignal),
                getLinkPrivateKey(abortSignal, shareId, parentId),
            ]);

            const Name = await encryptName(filename, parentPrivateKey, addressKeyInfo.privateKey);

            checkSignal(abortSignal, filename);

            const { clientUid, uploadFinished, uploadFailed } = generateClientUid(previousClientUid);

            // Do not abort using signal - file could be created and we
            // wouldn't know ID to do proper cleanup.
            const createFilePromise = () =>
                request<CreateFileResult>(
                    queryCreateFile(shareId, {
                        ContentKeyPacket: keys.contentKeyPacket,
                        ContentKeyPacketSignature: keys.contentKeyPacketSignature,
                        Hash: hash,
                        MIMEType: mimeType,
                        Name,
                        NodeKey: keys.nodeKey,
                        NodePassphrase: keys.nodePassphrase,
                        NodePassphraseSignature: keys.nodePassphraseSignature,
                        ParentLinkID: parentId,
                        SignatureAddress: addressKeyInfo.address.Email,
                        ClientUID: clientUid,
                    })
                ).catch((err) => {
                    uploadFailed();
                    // See RFC Feature flag handling for more info
                    if (err.status === 424 && err.data?.Code === 2032 && isForPhotos) {
                        const error = new Error(
                            c('Error').t`Photos upload is temporarily disabled. Please try again later`
                        );
                        error.name = 'PhotosUploadDisabled';
                        throw error;
                    }
                    throw err;
                });
            const createFile = retryOnError<CreateFileResult>({
                fn: () => createFilePromise(),
                shouldRetryBasedOnError: (error: unknown) => isPhotosDisabledUploadError(error as Error),
                maxRetriesNumber: 3,
                backoff: true,
            });

            const { File: createdFile } = await createFile();

            return {
                fileID: createdFile.ID,
                filename,
                isNewFile: true,
                privateKey: keys.privateKey,
                revisionID: createdFile.RevisionID,
                sessionKey: keys.sessionKey,
                uploadFinished,
                uploadFailed,
            };
        };

        const createRevision = async (abortSignal: AbortSignal, link: DecryptedLink): Promise<FileRevision> => {
            const currentActiveRevisionID = link.activeRevision?.id;
            if (!currentActiveRevisionID) {
                throw new Error(c('Error').t`The original file has missing active revision`);
            }

            const [privateKey, sessionKey] = await Promise.all([
                getLinkPrivateKey(abortSignal, shareId, link.linkId),
                getLinkSessionKey(abortSignal, shareId, link.linkId),
            ]);
            if (!sessionKey) {
                throw new Error(c('Error').t`The original file has missing session key`);
            }

            checkSignal(abortSignal, link.name);

            const { clientUid, uploadFinished, uploadFailed } = generateClientUid();

            // Do not abort using signal - revision could be created and we
            // wouldn't know ID to do proper cleanup.
            const { Revision } = await request<CreateFileRevisionResult>(
                queryCreateFileRevision(shareId, link.linkId, currentActiveRevisionID, clientUid)
            ).catch((err) => {
                if (err.data?.Code === 2500) {
                    throw new UploadUserError(
                        c('Error').t`The new revision of original file is not uploaded yet, please try again later`
                    );
                }
                throw err;
            });

            return {
                isNewFile: false,
                filename: file.name,
                fileID: link.linkId,
                revisionID: Revision.ID,
                previousRevisionID: currentActiveRevisionID,
                sessionKey,
                privateKey,
                uploadFinished,
                uploadFailed,
            };
        };

        /**
         * replaceFile loads all children in the target folder and finds
         * the link which is about to be replaced. If the original link is
         * a folder, the the whole folder is moved to trash and new file is
         * created. If the original link is file, new revision is created.
         */
        const replaceFile = async (
            abortSignal: AbortSignal,
            mimeType: string,
            keys: FileKeys
        ): Promise<FileRevision> => {
            const link = await getLinkByName(abortSignal, shareId, parentId, file.name);
            // If collision happened but the link is not present, that means
            // the file is just being uploaded.
            if (!link) {
                throw new UploadUserError(c('Error').t`The original file is not uploaded yet, please try again later`);
            }

            checkSignal(abortSignal, file.name);
            if (!link.isFile) {
                const parentHashKey = await getLinkHashKey(abortSignal, shareId, parentId);
                if (!parentHashKey) {
                    throw Error(c('Error').t`The original file has missing hash key`);
                }
                const hash = await generateLookupHash(file.name, parentHashKey);

                await trashLinks(abortSignal, [{ shareId, parentLinkId: parentId, linkId: link.linkId }]);
                return createFile(abortSignal, file.name, mimeType, hash, keys);
            }
            return createRevision(abortSignal, link);
        };

        /**
         * replaceDraft removes previous link completely and creates new
         * file, because API does not allow creation of new revision for link
         * without any revision. One day it would be good to keep the draft
         * and just finish upload of the missing blocks.
         */
        const replaceDraft = async (
            abortSignal: AbortSignal,
            filename: string,
            mimeType: string,
            hash: string,
            keys: FileKeys,
            linkId: string,
            clientUid?: string
        ) => {
            await deleteChildrenLinks(abortSignal, shareId, parentId, [linkId]);
            return createFile(abortSignal, filename, mimeType, hash, keys, clientUid);
        };

        const createFileRevision = queuedFunction(
            'create_file_revision',
            async (abortSignal: AbortSignal, mimeType: string, keys: FileKeys): Promise<FileRevision> => {
                const volumeId = volumeState.findVolumeId(shareId);
                if (!volumeId) {
                    throw new Error('Trying to find missing volume');
                }
                const {
                    filename: newName,
                    hash,
                    draftLinkId,
                    clientUid,
                    isDuplicatePhotos = false,
                }: {
                    filename: string;
                    hash: string;
                    clientUid?: string;
                    draftLinkId?: string;
                    isDuplicatePhotos?: boolean;
                } = isForPhotos
                    ? await findDuplicateContentHash(abortSignal, {
                          file,
                          volumeId,
                          shareId,
                          parentLinkId: parentId,
                      })
                    : await findAvailableName(abortSignal, { shareId, parentLinkId: parentId, filename: file.name });

                checkSignal(abortSignal, file.name);
                // Automatically replace file - previous draft was uploaded
                // by the same client.
                if (draftLinkId && clientUid) {
                    log(`Automatically replacing draft link ID: ${draftLinkId}`);
                    // Careful: uploading duplicate file has different name and
                    // this newName has to be used, not file.name.
                    // Example: upload A, then do it again with adding number
                    // A (2) which will fail, then do it again to replace draft
                    // with new upload - it needs to be A (2), not just A.
                    return replaceDraft(abortSignal, newName, mimeType, hash, keys, draftLinkId, clientUid);
                }

                if (isDuplicatePhotos) {
                    throw new TransferSkipped({
                        message: c('Info').t`This item already exists in your library`,
                    });
                }

                if (file.name === newName) {
                    log(`Creating new file`);
                    return createFile(abortSignal, file.name, mimeType, hash, keys);
                }

                log(`Name conflict`);
                const link = await getLinkByName(abortSignal, shareId, parentId, file.name);
                const originalIsFolder = link ? !link.isFile : false;

                const conflictStrategy = await getFileConflictStrategy(abortSignal, !!draftLinkId, originalIsFolder);
                log(`Conflict resolved with: ${conflictStrategy}`);
                if (conflictStrategy === TransferConflictStrategy.Rename) {
                    log(`Creating new file`);
                    return createFile(abortSignal, newName, mimeType, hash, keys);
                }
                if (conflictStrategy === TransferConflictStrategy.Replace) {
                    if (draftLinkId) {
                        log(`Replacing draft`);
                        return replaceDraft(abortSignal, file.name, mimeType, hash, keys, draftLinkId);
                    }
                    log(`Replacing file`);
                    return replaceFile(abortSignal, mimeType, keys);
                }
                if (conflictStrategy === TransferConflictStrategy.Skip) {
                    throw new TransferCancel({ message: c('Info').t`Transfer skipped for file "${file.name}"` });
                }
                throw new Error(`Unknown conflict strategy: ${conflictStrategy}`);
            },
            MAX_UPLOAD_BLOCKS_LOAD
        );

        // If the upload was aborted but we already called finalize to commit
        // revision, we cannot delete the revision. API does not support
        // aborting of request, so the request will finish anyway. And calling
        // deletion and revision commiting at the same time can cause confusing
        // error "file not found".
        // Other options would be to wait for finalize to finish and then to
        // delete it right away. But thats more complex and probably this is
        // safer option to do.
        let finalizeCalled = false;
        // Keep promise reference so when upload is canceled but init is not
        // finished yet, onError handler can wait for the creation to get ID
        // with created file or revision to do proper clean-up.
        let createdFileRevisionPromise: Promise<FileRevision>;

        return initUploadFileWorker(
            file,
            isForPhotos,
            {
                initialize: async (abortSignal: AbortSignal) => {
                    log(`Loading parent keys`);
                    const [addressKeyInfo, parentPrivateKey] = await Promise.all([
                        getShareKeys(abortSignal),
                        getLinkPrivateKey(abortSignal, shareId, parentId),
                    ]);
                    return {
                        addressPrivateKey: addressKeyInfo.privateKey,
                        parentPrivateKey,
                    };
                },
                createFileRevision: async (abortSignal: AbortSignal, mimeType: string, keys: FileKeys) => {
                    createdFileRevisionPromise = createFileRevision(abortSignal, mimeType, keys);
                    const [createdFileRevision, addressKeyInfo, parentHashKey] = await Promise.all([
                        createdFileRevisionPromise,
                        getShareKeys(abortSignal),
                        getLinkHashKey(abortSignal, shareId, parentId),
                    ]);
                    checkSignal(abortSignal, createdFileRevision.filename);
                    log(`Link ID: ${createdFileRevision.fileID}, revision ID: ${createdFileRevision.revisionID}`);

                    return {
                        fileName: createdFileRevision.filename,
                        privateKey: createdFileRevision.privateKey,
                        sessionKey: createdFileRevision.sessionKey,
                        parentHashKey,
                        address: {
                            privateKey: addressKeyInfo.privateKey,
                            email: addressKeyInfo.address.Email,
                        },
                    };
                },
                getVerificationData: async (abortSignal: AbortSignal) => {
                    const createdFileRevision = await createdFileRevisionPromise;
                    if (!createdFileRevision) {
                        throw new Error(`Draft for "${file.name}" hasn't been created prior to verifying`);
                    }

                    log(`Requesting verifier data`);
                    try {
                        const { VerificationCode, ContentKeyPacket } = await request<GetVerificationDataResult>(
                            queryVerificationData(shareId, createdFileRevision.fileID, createdFileRevision.revisionID),
                            abortSignal
                        );

                        const verifierSessionKey = await CryptoProxy.decryptSessionKey({
                            binaryMessage: base64StringToUint8Array(ContentKeyPacket),
                            decryptionKeys: createdFileRevision.privateKey,
                        });

                        if (!verifierSessionKey) {
                            throw new Error('Verification session key could not be decrypted');
                        }

                        return {
                            verificationCode: base64StringToUint8Array(VerificationCode),
                            verifierSessionKey,
                        } satisfies VerificationData;
                    } catch (e) {
                        throw new EnrichedError('Upload failed: Verification of data failed', {
                            extra: { e },
                        });
                    }
                },
                createBlockLinks: async (
                    abortSignal: AbortSignal,
                    fileBlocks: FileRequestBlock[],
                    thumbnailBlocks?: ThumbnailRequestBlock[]
                ) => {
                    const createdFileRevision = await createdFileRevisionPromise;
                    if (!createdFileRevision) {
                        throw new Error(`Draft for "${file.name}" hasn't been created prior to uploading`);
                    }
                    log(
                        `Requesting tokens for ${fileBlocks.length} blocks and ${
                            thumbnailBlocks?.length || 0
                        } thumbnail blocks`
                    );
                    const addressKeyInfo = await getShareKeys(abortSignal);
                    const { UploadLinks, ThumbnailLinks } = await request<RequestUploadResult>(
                        queryRequestUpload({
                            BlockList: fileBlocks.map((block) => ({
                                Index: block.index,
                                Hash: uint8ArrayToBase64String(block.hash),
                                EncSignature: block.signature,
                                Size: block.size,
                                Verifier: {
                                    Token: uint8ArrayToBase64String(block.verificationToken),
                                },
                            })),
                            AddressID: addressKeyInfo.address.ID,
                            LinkID: createdFileRevision.fileID,
                            RevisionID: createdFileRevision.revisionID,
                            ShareID: shareId,
                            ThumbnailList: thumbnailBlocks?.map((block) => ({
                                Hash: uint8ArrayToBase64String(block.hash),
                                Size: block.size,
                                Type: block.type,
                            })),
                        }),
                        abortSignal
                    );
                    log(
                        `Got tokens for ${UploadLinks.length} blocks and ${
                            ThumbnailLinks?.length || 0
                        } thumbnail blocks`
                    );
                    return {
                        fileLinks: UploadLinks.map((link, index) => ({
                            index: fileBlocks[index].index,
                            token: link.Token,
                            url: link.BareURL,
                        })),
                        thumbnailLinks: ThumbnailLinks?.map((link, index) => ({
                            index,
                            token: link.Token,
                            url: link.BareURL,
                        })),
                    };
                },
                finalize: queuedFunction(
                    'upload_finalize',
                    async (signature: string, signatureAddress: string, xattr: string, photo?: PhotoUpload) => {
                        const createdFileRevision = await createdFileRevisionPromise;
                        if (!createdFileRevision) {
                            throw new Error(`Draft for "${file.name}" hasn't been created prior to uploading`);
                        }

                        if (finalizeCalled) {
                            return;
                        }
                        finalizeCalled = true;

                        log(`Commiting revision`);
                        await request(
                            queryUpdateFileRevision(
                                shareId,
                                createdFileRevision.fileID,
                                createdFileRevision.revisionID,
                                {
                                    ManifestSignature: signature,
                                    SignatureAddress: signatureAddress,
                                    XAttr: xattr,
                                    Photo: photo
                                        ? {
                                              MainPhotoLinkID: null, // This is for live photos
                                              CaptureTime: photo.captureTime,
                                              Exif: photo.encryptedExif,
                                              ContentHash: photo.contentHash,
                                          }
                                        : undefined,
                                }
                            )
                        );
                        log(`Revision commited`);

                        createdFileRevision.uploadFinished();

                        const volumeId = volumeState.findVolumeId(shareId);
                        if (volumeId) {
                            await driveEventManager.pollEvents.volumes(volumeId, {
                                includeCommon: true,
                            });
                        }
                    },
                    5
                ),
                onError: async (err) => {
                    if (finalizeCalled && err.name === 'AbortError') {
                        return;
                    }
                    finalizeCalled = true;

                    // If creation of revision failed, it is already processed by
                    // this handler. Do not throw it here again.
                    const createdFileRevision = await createdFileRevisionPromise?.catch(() => undefined);
                    try {
                        if (createdFileRevision) {
                            createdFileRevision.uploadFailed();
                            if (createdFileRevision.isNewFile) {
                                log(`Deleting file`);
                                // Cleanup should not be able to abort.
                                await deleteChildrenLinks(new AbortController().signal, shareId, parentId, [
                                    createdFileRevision.fileID,
                                ]);
                            } else {
                                log(`Deleting revision`);
                                await request(
                                    queryDeleteFileRevision(
                                        shareId,
                                        createdFileRevision.fileID,
                                        createdFileRevision.revisionID
                                    )
                                );
                            }
                        }
                    } catch (err: any) {
                        log(`Cleanup failed due to ${err}`);
                        logError(err);
                    }
                },
            },
            (message) => log(`worker: ${message}`)
        );
    };

    return {
        initFileUpload,
    };
}

function checkSignal(abortSignal: AbortSignal, name: string) {
    if (abortSignal.aborted) {
        throw new TransferCancel({ message: c('Info').t`Transfer canceled for file "${name}"` });
    }
}
