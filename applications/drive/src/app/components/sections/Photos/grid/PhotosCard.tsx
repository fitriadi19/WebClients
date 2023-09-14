import React, { CSSProperties, FC, useEffect, useRef, useState } from 'react';

import { formatDuration } from 'date-fns';
import { c } from 'ttag';

import { ButtonLike } from '@proton/atoms/Button';
import { Checkbox, FileIcon, Icon } from '@proton/components/components';
import { isVideo } from '@proton/shared/lib/helpers/mimetype';
import { dateLocale } from '@proton/shared/lib/i18n';
import playCircleFilledIcon from '@proton/styles/assets/img/drive/play-circle-filled.svg';
import clsx from '@proton/utils/clsx';

import type { PhotoLink } from '../../../../store/';
import SignatureIcon from '../../../SignatureIcon';
import { getMimeTypeDescription } from '../../helpers';
import { formatVideoDuration } from './formatVideoDuration';

import './PhotosCard.scss';

type Props = {
    photo: PhotoLink;
    selected: boolean;
    onRender: (linkId: string) => void;
    onRenderLoadedLink: (linkId: string, domRef: React.MutableRefObject<unknown>) => void;
    style: CSSProperties;
    onClick: () => void;
    onSelect: (isSelected: boolean) => void;
    showCheckbox: boolean;
};

const getAltText = ({ mimeType, name }: PhotoLink) =>
    `${c('Label').t`Photo`} - ${getMimeTypeDescription(mimeType || '')} - ${name}`;

export const PhotosCard: FC<Props> = ({
    style,
    onRender,
    onRenderLoadedLink,
    photo,
    onClick,
    onSelect,
    selected,
    showCheckbox,
}) => {
    const [imageReady, setImageReady] = useState(false);
    const ref = useRef(null);

    // First call when photo is rendered to request caching link meta data.
    useEffect(() => {
        onRender(photo.linkId);
    }, [photo.linkId]);

    // Once we have link meta data (link has name which is missing during
    // photo listing), we can initiate thumbnail loading.
    // The separation is needed to call thumbanil queue when link is already
    // present in cache to not fetch or decrypt meta data more than once.
    useEffect(() => {
        if (photo.name) {
            onRenderLoadedLink(photo.linkId, ref);
        }
    }, [photo.name]);

    const thumbUrl = photo.cachedThumbnailUrl;
    const isThumbnailLoading = photo.hasThumbnail === undefined || (photo.hasThumbnail && !imageReady);
    const isActive = !!photo.activeRevision.id && !!photo.activeRevision.photo.linkId;

    useEffect(() => {
        if (thumbUrl) {
            const image = new Image();
            image.src = thumbUrl;
            image.onload = () => {
                setImageReady(true);
            };
        }
    }, [thumbUrl]);

    /*// TODO: Keyboard navigation*/

    return (
        <ButtonLike
            as="div"
            ref={ref}
            style={style}
            className={clsx(
                'relative photos-card p-0 border-none rounded-none',
                isThumbnailLoading && 'photos-card--loading',
                !showCheckbox && 'photos-card--hide-checkbox',
                selected && 'photos-card--selected'
            )}
            onClick={onClick}
        >
            <Checkbox
                className="absolute top-0 left-0 ml-2 mt-2"
                checked={selected}
                onClick={(e) => e.stopPropagation()}
                onChange={() => {
                    onSelect(!selected);
                }}
            />

            {!isThumbnailLoading && isActive ? (
                <div className="w-full h-full relative">
                    {!photo.hasThumbnail ? (
                        <div className="flex flex-align-items-center flex-justify-center w-full h-full photos-card-thumbnail photos-card-thumbnail--empty">
                            <FileIcon mimeType={photo.mimeType || ''} size={48} />
                        </div>
                    ) : (
                        <img
                            data-testid="photo-card"
                            src={thumbUrl}
                            alt={getAltText(photo)}
                            className="w-full h-full photos-card-thumbnail"
                        />
                    )}
                    {(photo.signatureIssues || photo.isShared) && (
                        <div className="absolute top right mr-2 mt-2 flex flex-align-items-center gap-1">
                            {photo.signatureIssues && (
                                <SignatureIcon
                                    isFile
                                    signatureIssues={photo.signatureIssues}
                                    className="color-danger"
                                />
                            )}
                            {photo.isShared && (
                                <div className="photos-card-share-icon rounded-50 flex flex-align-items-center flex-justify-center">
                                    <Icon name="link" color="white" size={12} />
                                </div>
                            )}
                        </div>
                    )}
                    {photo.mimeType && isVideo(photo.mimeType) && (
                        <div className="w-full absolute bottom flex flex-justify-end flex-align-items-center px-2 py-2 photos-card-video-info">
                            {photo.duration && (
                                <time
                                    className="color-invert text-semibold mr-0.5"
                                    dateTime={formatDuration(
                                        { seconds: Math.floor(photo.duration) },
                                        {
                                            locale: dateLocale,
                                        }
                                    )}
                                >
                                    {formatVideoDuration(photo.duration)}
                                </time>
                            )}
                            <img src={playCircleFilledIcon} alt="" />
                        </div>
                    )}
                </div>
            ) : null}
        </ButtonLike>
    );
};
